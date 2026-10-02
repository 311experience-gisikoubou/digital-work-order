const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const visualSource = fs.readFileSync(path.join(root, 'app', 'visual-snapshot.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const canonical = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'canonical', 'tooth-chart-sync-spec-v1.json'), 'utf8'
));
const CANONICAL_FDI_IDS = [
  ...canonical.coordinates.upper,
  ...canonical.coordinates.lower
].map(tooth => tooth.num);
const CANONICAL_FDI_KEYS = CANONICAL_FDI_IDS.map(String);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function freshToothMap(overrides = {}) {
  const map = {};
  CANONICAL_FDI_IDS.forEach(id => {
    map[String(id)] = { baseState: 'normal', caution: false };
  });
  Object.entries(overrides).forEach(([id, entry]) => {
    map[String(id)] = entry;
  });
  return map;
}

function freshCoords(overrides = {}) {
  const map = {};
  [...canonical.coordinates.upper, ...canonical.coordinates.lower].forEach(tooth => {
    map[String(tooth.num)] = {
      cx: tooth.cx, cy: tooth.cy, rx: tooth.rx, ry: tooth.ry
    };
  });
  Object.entries(overrides).forEach(([id, entry]) => {
    map[String(id)] = entry;
  });
  return map;
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function buildVisualContext(overrides = {}) {
  const toothMap = has(overrides, 'toothMap')
    ? overrides.toothMap
    : freshToothMap();
  const context = {
    getToothStateSnapshot: has(overrides, 'getToothStateSnapshot')
      ? overrides.getToothStateSnapshot
      : () => toothMap,
    claspState: has(overrides, 'claspState') ? overrides.claspState : {},
    drawStrokes: has(overrides, 'drawStrokes') ? overrides.drawStrokes : [],
    memoStrokes: has(overrides, 'memoStrokes') ? overrides.memoStrokes : [],
    coords: has(overrides, 'coords') ? overrides.coords : freshCoords()
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(visualSource, context);
  return context;
}

function buildValidSnapshot(overrides = {}) {
  const teeth = freshToothMap({
    17: { baseState: 'missing', caution: true },
    16: { baseState: 'abutment', caution: false }
  });
  return {
    schemaVersion: 'dwo-visual-snapshot-v1',
    teeth,
    selectedTeeth: [17],
    claspState: { 17: [{ uid: 'sample', type: 'W', dir: null }] },
    drawing: {
      strokes: [{ color: '#000', width: 6, d: 'M0 0' }],
      memoStrokes: [{ color: '#111', width: 4, d: 'M1 1' }]
    },
    coordinates: freshCoords(),
    ...overrides
  };
}

test('freeze creates exact visualSnapshot schema using canonical 32 FDI teeth', () => {
  const context = buildVisualContext();
  const snapshot = context.freezeVisualSnapshot();
  assert.ok(snapshot);
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ['claspState', 'coordinates', 'drawing', 'schemaVersion', 'selectedTeeth', 'teeth']
  );
  assert.equal(snapshot.schemaVersion, 'dwo-visual-snapshot-v1');
  assert.deepEqual(Object.keys(snapshot.teeth).sort(), [...CANONICAL_FDI_KEYS].sort());
  assert.deepEqual(Object.keys(snapshot.coordinates).sort(), [...CANONICAL_FDI_KEYS].sort());
  assert.deepEqual(Object.keys(snapshot.drawing).sort(), ['memoStrokes', 'strokes']);
});

test('selectedTeeth is derived only from missing teeth and is sorted/unique', () => {
  const toothMap = freshToothMap({
    38: { baseState: 'missing', caution: false },
    11: { baseState: 'missing', caution: true },
    26: { baseState: 'abutment', caution: true },
    12: { baseState: 'normal', caution: true }
  });
  const context = buildVisualContext({ toothMap });
  const snapshot = context.freezeVisualSnapshot();
  assert.ok(snapshot);
  assert.deepEqual(plain(snapshot.selectedTeeth), [11, 38]);
  assert.equal(new Set(snapshot.selectedTeeth).size, snapshot.selectedTeeth.length);
});

test('teeth, clasp, drawing and coordinates are deep copies', () => {
  const toothMap = freshToothMap({ 17: { baseState: 'missing', caution: false } });
  const claspState = { 17: [{ uid: 'a', type: 'W', dir: null }] };
  const drawStrokes = [{ color: '#000', width: 6, d: 'M0 0' }];
  const memoStrokes = [{ color: '#111', width: 4, d: 'M1 1' }];
  const coords = freshCoords();
  const context = buildVisualContext({
    toothMap, claspState, drawStrokes, memoStrokes, coords
  });
  const snapshot = context.freezeVisualSnapshot();
  const frozen = plain(snapshot);

  toothMap['17'].baseState = 'normal';
  claspState[17].push({ uid: 'b', type: 'R', dir: null });
  drawStrokes.push({ color: '#fff', width: 2, d: 'M9 9' });
  memoStrokes.push({ color: '#222', width: 1, d: 'M8 8' });
  coords['17'].cx = 9999;

  assert.deepEqual(plain(snapshot), frozen);
  assert.notEqual(snapshot.teeth, toothMap);
  assert.notEqual(snapshot.claspState, claspState);
  assert.notEqual(snapshot.drawing.strokes, drawStrokes);
  assert.notEqual(snapshot.drawing.memoStrokes, memoStrokes);
  assert.notEqual(snapshot.coordinates, coords);
});

test('freeze fails closed for missing/malformed/non-JSON-safe state', () => {
  const scenarios = [
    { getToothStateSnapshot: undefined },
    { getToothStateSnapshot: () => { const m = freshToothMap(); delete m['38']; return m; } },
    { getToothStateSnapshot: () => freshToothMap({ 17: { baseState: 'bad', caution: false } }) },
    { claspState: [] },
    { claspState: { 17: [{ uid: 'x', bad: () => {} }] } },
    { drawStrokes: 'bad' },
    { memoStrokes: undefined },
    { drawStrokes: [{ width: Number.POSITIVE_INFINITY }] },
    { coords: (() => { const c = freshCoords(); delete c['38']; return c; })() },
    { coords: (() => { const c = freshCoords(); c['99'] = { cx: 1, cy: 1, rx: 1, ry: 1 }; return c; })() },
    { coords: (() => { const c = freshCoords(); c['17'].cx = Number.NaN; return c; })() }
  ];
  scenarios.forEach(scenario => {
    const context = buildVisualContext(scenario);
    assert.equal(context.freezeVisualSnapshot(), null);
  });
});

test('strict validator accepts valid snapshot and rejects malformed variants', () => {
  const context = buildVisualContext();
  const valid = buildValidSnapshot();
  assert.equal(context.isValidVisualSnapshot(valid), true);

  const cases = [
    { ...valid, schemaVersion: 'wrong' },
    { ...valid, extra: true },
    (() => { const copy = plain(valid); delete copy.teeth['38']; return copy; })(),
    (() => { const copy = plain(valid); copy.teeth['17'].baseState = 'bad'; return copy; })(),
    (() => { const copy = plain(valid); copy.teeth['17'].extra = true; return copy; })(),
    { ...valid, selectedTeeth: ['17'] },
    { ...valid, selectedTeeth: [17, 17] },
    { ...valid, selectedTeeth: [11, 17] },
    { ...valid, claspState: [] },
    { ...valid, claspState: { bad: () => {} } },
    { ...valid, drawing: { strokes: [] } },
    { ...valid, drawing: { strokes: 'bad', memoStrokes: [] } },
    (() => { const copy = plain(valid); delete copy.coordinates['38']; return copy; })(),
    (() => { const copy = plain(valid); copy.coordinates['17'].cx = 'bad'; return copy; })(),
    (() => { const copy = plain(valid); copy.coordinates['17'].extra = 1; return copy; })()
  ];
  cases.forEach(snapshot => assert.equal(context.isValidVisualSnapshot(snapshot), false));
});

const stableStart = appSource.indexOf('//  連携用 stable workOrderRef');
const submitStart = appSource.indexOf('//  受注一覧反映処理', stableStart);
const resetStart = appSource.indexOf('function resetForm()', submitStart);
assert.ok(stableStart >= 0 && submitStart > stableStart && resetStart > submitStart);
const appRegionStart = appSource.lastIndexOf('// ============================================================', stableStart);
const submitBlock = appSource.slice(appRegionStart, resetStart);

function buildSubmitContext(overrides = {}) {
  const captured = { toasts: [], refCalls: 0 };
  let handler = null;
  const context = {
    document: {
      getElementById(id) {
        if (id === 'submit-btn') {
          return { addEventListener(_, fn) { handler = fn; } };
        }
        return null;
      }
    },
    state: { orders: [] },
    collectFormData: overrides.collectFormData || (() => ({
      clinicName: 'SAMPLE',
      selectedTeeth: [99],
      memoStrokes: [{ stale: true }],
      status: 'pending',
      createdAt: '2026-10-02T00:00:00.000Z',
      id: 'local_1'
    })),
    validate: overrides.validate || (() => []),
    freezeVisualSnapshot: has(overrides, 'freezeVisualSnapshot')
      ? overrides.freezeVisualSnapshot
      : () => buildValidSnapshot(),
    showToast(message, kind) { captured.toasts.push({ message, kind }); },
    syncTemporaryOrdersToSession() { captured.synced = true; },
    syncOrderLossGuard() { captured.guarded = true; },
    resetForm() { captured.reset = true; },
    crypto: {
      randomUUID() {
        captured.refCalls += 1;
        return '123e4567-e89b-42d3-a456-426614174000';
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(submitBlock, context);
  return { context, captured, handler: () => handler };
}

test('submit sequence validates, freezes, creates ref, applies compatibility, then pushes/resets', () => {
  const validationIndex = appSource.indexOf('const errors = validate(data);');
  const freezeIndex = appSource.indexOf('freezeVisualSnapshot()');
  const refIndex = appSource.indexOf('data.workOrderRef = generateWorkOrderRef();');
  const selectedIndex = appSource.indexOf('data.selectedTeeth = JSON.parse(JSON.stringify(visualSnapshot.selectedTeeth));');
  const memoIndex = appSource.indexOf('data.memoStrokes = JSON.parse(JSON.stringify(visualSnapshot.drawing.memoStrokes));');
  const snapshotIndex = appSource.indexOf('data.visualSnapshot = visualSnapshot;');
  const pushIndex = appSource.indexOf('state.orders.unshift(data);');
  const resetIndex = appSource.indexOf('resetForm();', pushIndex);
  assert.ok(validationIndex < freezeIndex);
  assert.ok(freezeIndex < refIndex);
  assert.ok(refIndex < selectedIndex);
  assert.ok(selectedIndex < memoIndex && memoIndex < snapshotIndex);
  assert.ok(snapshotIndex < pushIndex && pushIndex < resetIndex);
});

test('successful submit stores snapshot-derived compatibility fields from one freeze', async () => {
  const snapshot = buildValidSnapshot();
  let freezeCalls = 0;
  const { context, captured, handler } = buildSubmitContext({
    freezeVisualSnapshot: () => { freezeCalls += 1; return snapshot; }
  });
  await handler()();

  assert.equal(freezeCalls, 1);
  assert.equal(captured.refCalls, 1);
  assert.equal(context.state.orders.length, 1);
  const order = context.state.orders[0];
  assert.deepEqual(plain(order.selectedTeeth), plain(snapshot.selectedTeeth));
  assert.deepEqual(plain(order.memoStrokes), plain(snapshot.drawing.memoStrokes));
  assert.notEqual(order.selectedTeeth, snapshot.selectedTeeth);
  assert.notEqual(order.memoStrokes, snapshot.drawing.memoStrokes);
  assert.equal(order.visualSnapshot, snapshot);
  assert.equal(captured.reset, true);
  assert.equal(captured.synced, true);
});

test('required-field validation failure blocks freeze/ref/push/reset', async () => {
  let freezeCalls = 0;
  const { context, captured, handler } = buildSubmitContext({
    validate: () => ['患者名'],
    freezeVisualSnapshot: () => { freezeCalls += 1; return buildValidSnapshot(); }
  });
  await handler()();

  assert.equal(freezeCalls, 0);
  assert.equal(captured.refCalls, 0);
  assert.equal(context.state.orders.length, 0);
  assert.equal(captured.reset, undefined);
  assert.equal(captured.synced, undefined);
});

test('snapshot failure or throw blocks workOrderRef/push/reset and shows error', async () => {
  for (const freezeVisualSnapshot of [
    () => null,
    () => { throw new Error('synthetic freeze failure'); }
  ]) {
    const { context, captured, handler } = buildSubmitContext({ freezeVisualSnapshot });
    await handler()();
    assert.equal(captured.refCalls, 0);
    assert.equal(context.state.orders.length, 0);
    assert.equal(captured.reset, undefined);
    assert.equal(captured.synced, undefined);
    assert.equal(captured.toasts.length, 1);
    assert.equal(captured.toasts[0].kind, 'error');
  }
});

const sessionStart = ordersSource.indexOf('//  Same-tab temporary-order reload recovery');
const sessionEnd = ordersSource.indexOf('//  受注サマリー', sessionStart);
assert.ok(sessionStart >= 0 && sessionEnd > sessionStart);
const sessionRegionStart = ordersSource.lastIndexOf('// ============================================================', sessionStart);
const sessionRegionEnd = ordersSource.lastIndexOf('// ============================================================', sessionEnd);
const sessionRegion = ordersSource.slice(sessionRegionStart, sessionRegionEnd);

function loadSessionValidator(visualValidator) {
  const context = {
    state: { orders: [] },
    window: {},
    isValidVisualSnapshot: visualValidator
  };
  vm.createContext(context);
  vm.runInContext(sessionRegion, context);
  return context;
}

function syntheticOrder(overrides = {}) {
  return {
    clinicName: 'SAMPLE-CLINIC',
    doctorName: 'SAMPLE-DOCTOR',
    patientName: 'SAMPLE-PATIENT',
    patientAge: '65',
    patientGender: 'female',
    issueDate: '2026-10-02',
    selectedTeeth: [17],
    insuranceType: 'insurance',
    orderTypes: ['完成'],
    devices: [],
    deliveryDate: '2026-10-20',
    remarks: '',
    memoStrokes: [{ color: '#111', width: 4, d: 'M1 1' }],
    status: 'pending',
    createdAt: '2026-10-02T00:00:00.000Z',
    id: 'local_1',
    workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  };
}

test('session validator preserves old orders without visualSnapshot', () => {
  const visualContext = buildVisualContext();
  const context = loadSessionValidator(visualContext.isValidVisualSnapshot);
  const order = syntheticOrder({ selectedTeeth: ['11'], memoStrokes: [] });
  delete order.visualSnapshot;
  assert.equal(context.isValidSessionOrder(order), true);
});

test('session validator accepts valid new order with matching compatibility fields', () => {
  const visualContext = buildVisualContext();
  const context = loadSessionValidator(visualContext.isValidVisualSnapshot);
  const snapshot = buildValidSnapshot();
  const order = syntheticOrder({
    selectedTeeth: snapshot.selectedTeeth,
    memoStrokes: snapshot.drawing.memoStrokes,
    visualSnapshot: snapshot
  });
  assert.equal(context.isValidSessionOrder(order), true);
});

test('session validator rejects snapshot/compatibility mismatch and invalid snapshot', () => {
  const visualContext = buildVisualContext();
  const context = loadSessionValidator(visualContext.isValidVisualSnapshot);
  const snapshot = buildValidSnapshot();

  assert.equal(context.isValidSessionOrder(syntheticOrder({
    selectedTeeth: [11],
    memoStrokes: snapshot.drawing.memoStrokes,
    visualSnapshot: snapshot
  })), false);

  assert.equal(context.isValidSessionOrder(syntheticOrder({
    selectedTeeth: snapshot.selectedTeeth,
    memoStrokes: [],
    visualSnapshot: snapshot
  })), false);

  const bad = { ...snapshot, schemaVersion: 'wrong' };
  assert.equal(context.isValidSessionOrder(syntheticOrder({
    selectedTeeth: bad.selectedTeeth,
    memoStrokes: bad.drawing.memoStrokes,
    visualSnapshot: bad
  })), false);
});

test('session envelope accepts mixed old/new orders and version remains v1', () => {
  const visualContext = buildVisualContext();
  const context = loadSessionValidator(visualContext.isValidVisualSnapshot);
  const snapshot = buildValidSnapshot();
  const oldOrder = syntheticOrder({
    id: 'local_1',
    workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174000',
    selectedTeeth: ['11'],
    memoStrokes: []
  });
  const newOrder = syntheticOrder({
    id: 'local_2',
    workOrderRef: 'dwo:223e4567-e89b-42d3-a456-426614174000',
    selectedTeeth: snapshot.selectedTeeth,
    memoStrokes: snapshot.drawing.memoStrokes,
    visualSnapshot: snapshot
  });
  assert.equal(
    context.validateSessionOrdersEnvelope({
      schemaVersion: 'dwo-session-orders-v1',
      orders: [oldOrder, newOrder]
    }).length,
    2
  );
  assert.match(ordersSource, /ORDER_SESSION_SCHEMA_VERSION = 'dwo-session-orders-v1'/);
});

test('script order loads visual snapshot after tooth state and before session validation', () => {
  const toothIndex = html.indexOf('<script src="app/tooth-state.js">');
  const visualIndex = html.indexOf('<script src="app/visual-snapshot.js">');
  const draftIndex = html.indexOf('<script src="app/draft-persistence.js">');
  const ordersIndex = html.indexOf('<script src="orders.js">');
  assert.ok(toothIndex >= 0 && visualIndex >= 0 && draftIndex >= 0 && ordersIndex >= 0);
  assert.ok(toothIndex < visualIndex);
  assert.ok(visualIndex < draftIndex);
  assert.ok(visualIndex < ordersIndex);
});

test('Stage 4 connects PDF only and keeps unrelated protected consumers isolated', () => {
  const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
  assert.equal(pdfSource.includes('visualSnapshot'), true);
  assert.equal(pdfSource.includes('buildOrderChartHTML'), true);

  for (const file of [
    'modal.js', 'media.js', 'calendar.js',
    'delivery-intake-export.js', 'tooth-chart.js', 'app/tooth-state.js'
  ]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(source.includes('freezeVisualSnapshot'), false, file);
    assert.equal(source.includes('isValidVisualSnapshot'), false, file);
    if (file !== 'app/tooth-state.js') {
      assert.equal(source.includes('visualSnapshot'), false, file);
    }
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const modalSource = fs.readFileSync(path.join(root, 'modal.js'), 'utf8');
const intakeSource = fs.readFileSync(path.join(root, 'delivery-intake-export.js'), 'utf8');

function baseOrder(overrides = {}) {
  return {
    clinicName: 'SAMPLE',
    doctorName: 'DOCTOR',
    patientName: 'PATIENT',
    patientAge: '65',
    patientGender: 'female',
    issueDate: '2026-10-02',
    insuranceType: 'insurance',
    orderTypes: ['完成'],
    devices: [],
    selectedTeeth: [],
    memoStrokes: [],
    deliveryDate: '2026-10-20',
    remarks: '',
    status: 'pending',
    createdAt: '2026-10-02T00:00:00.000Z',
    id: 'local_1',
    workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  };
}

function loadOrderValidator() {
  const start = ordersSource.indexOf('//  Same-tab temporary-order reload recovery');
  const end = ordersSource.indexOf('//  受注サマリー', start);
  const regionStart = ordersSource.lastIndexOf('// ============================================================', start);
  const regionEnd = ordersSource.lastIndexOf('// ============================================================', end);
  const context = { state: { orders: [] }, window: {} };
  vm.createContext(context);
  vm.runInContext(ordersSource.slice(regionStart, regionEnd), context);
  return context;
}

function loadPdf() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    formatJapaneseEraDate(value) { return value; },
    window: { location: { assign() {} } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pdfSource, sandbox, { filename: 'pdf.js' });
  return sandbox;
}

test('collectFormData stores all active clasp/bar values and derives legacy scalar from the first value', () => {
  assert.ok(appSource.includes('function getToggleVals(group)'));
  assert.ok(appSource.includes("const claspTypes = ins === 'insurance' ? getToggleVals('clasp-ins')"));
  assert.ok(appSource.includes('const claspType = claspTypes[0] ?? null;'));
  assert.ok(appSource.includes("const barTypes = ins === 'insurance' ? getToggleVals('bar-ins')"));
  assert.ok(appSource.includes('const barType = barTypes[0] ?? null;'));
  assert.ok(appSource.includes('claspTypes,'));
  assert.ok(appSource.includes('barTypes,'));
});

test('session validator accepts legacy scalar-only orders and strict new arrays', () => {
  const context = loadOrderValidator();
  assert.equal(context.isValidSessionOrder(baseOrder({
    claspType: 'ワイヤー鉤',
    barType: 'キャストバー'
  })), true);

  assert.equal(context.isValidSessionOrder(baseOrder({
    claspTypes: ['ワイヤー鉤', 'キャスト鉤'],
    claspType: 'ワイヤー鉤',
    barTypes: ['キャストバー', '屈曲バー'],
    barType: 'キャストバー'
  })), true);

  assert.equal(context.isValidSessionOrder(baseOrder({
    claspTypes: ['ワイヤー鉤', 'キャスト鉤'],
    claspType: 'キャスト鉤',
    barTypes: ['キャストバー'],
    barType: 'キャストバー'
  })), false);

  assert.equal(context.isValidSessionOrder(baseOrder({
    claspTypes: ['ワイヤー鉤'],
    claspType: 'ワイヤー鉤',
    barTypes: ['キャストバー', 42],
    barType: 'キャストバー'
  })), false);
});

test('PDF prints every selected clasp/bar and device counts do not drop the second bar', () => {
  const sandbox = loadPdf();
  sandbox.__order = baseOrder({
    claspTypes: ['ワイヤー鉤', 'キャスト鉤'],
    claspType: 'ワイヤー鉤',
    barTypes: ['キャストバー', '屈曲バー'],
    barType: 'キャストバー',
    castBarCounts: { upper: 1, lower: 1 },
    reinforcementWireCount: 0
  });
  const html = vm.runInContext("_buildPrintHTML(__order, '', null, '')", sandbox);
  assert.ok(html.includes('ワイヤー鉤 / キャスト鉤'));
  assert.ok(html.includes('キャストバー / 屈曲バー'));
  assert.ok(html.includes('キャストバー ×2'));
  assert.ok(html.includes('屈曲バー ×1'));
  assert.equal((html.match(/キャストバー ×2/g) || []).length, 1);
});

test('details view shows array values with scalar fallback', () => {
  assert.ok(modalSource.includes('Array.isArray(order.claspTypes)'));
  assert.ok(modalSource.includes('Array.isArray(order.barTypes)'));
  assert.ok(modalSource.includes("order.claspTypes : (order.claspType ? [order.claspType] : [])"));
  assert.ok(modalSource.includes("order.barTypes : (order.barType ? [order.barType] : [])"));
});

test('delivery-intake-v1 remains scalar-compatible', () => {
  assert.ok(intakeSource.includes("addInstruction(fields, 'clasp_type', order.claspType)"));
  assert.ok(intakeSource.includes("addInstruction(fields, 'bar_type', order.barType)"));
  assert.ok(appSource.includes('const claspType = claspTypes[0] ?? null;'));
  assert.ok(appSource.includes('const barType = barTypes[0] ?? null;'));
});

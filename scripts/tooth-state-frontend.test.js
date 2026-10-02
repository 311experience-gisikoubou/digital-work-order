const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const toothSource = fs.readFileSync(path.join(root, 'tooth-chart.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'app', 'tooth-state.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const visualSource = css + '\n' + html;
const canonical = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'canonical', 'tooth-chart-sync-spec-v1.json'), 'utf8'
));

function extractArray(name) {
  const start = toothSource.indexOf(`var ${name} = [`);
  assert.ok(start >= 0, `missing array ${name}`);
  const open = toothSource.indexOf('[', start);
  const end = toothSource.indexOf('\n];', open);
  assert.ok(end > open, `unterminated array ${name}`);
  return vm.runInNewContext(toothSource.slice(open, end + 2));
}

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const upper = extractArray('upperTeeth');
const lower = extractArray('lowerTeeth');
const ids = [...upper, ...lower].map(item => item.num);
const functionNames = [
  'defaultToothState',
  'getAllToothIds',
  'applyModeToTooth',
  'syncSelectedTeethFromState',
  'updateCanonicalResults',
  'refreshCanonicalToothState',
  'handleCanonicalNumericToothClick',
  'handleCanonicalSvgToothClick',
  'setTeethMissing',
  'getToothStateSnapshot',
  'isValidToothStateSnapshot',
  'restoreToothStateSnapshot',
  'resetCanonicalToothState',
  'selectUpperDentureCanonical',
  'selectLowerDentureCanonical'
];

function boot() {
  const calls = { render: 0, results: 0, display: 0 };
  const context = {
    upperTeeth: JSON.parse(JSON.stringify(upper)),
    lowerTeeth: JSON.parse(JSON.stringify(lower)),
    toothState: {},
    currentMode: 'missing',
    UPPER_DENTURE_TEETH: [17,16,15,14,13,12,11,21,22,23,24,25,26,27],
    LOWER_DENTURE_TEETH: [47,46,45,44,43,42,41,31,32,33,34,35,36,37],
    state: { selectedTeeth: new Set() },
    document: {
      querySelectorAll() { return []; },
      querySelector() { return null; },
      getElementById() { return null; }
    },
    updateTeethDisplay() { calls.display += 1; },
    renderToothVisual() { calls.render += 1; },
    renderAllToothVisuals() { calls.render += 1; },
    updateResults() { calls.results += 1; },
    drawMode: false,
    drag: { moved: false },
    claspMode: null,
    activeClaspUid: null,
    applyClaspToTooth() { throw new Error('unexpected clasp path'); },
    renderAllClasps() {}
  };
  vm.createContext(context);
  vm.runInContext('var TOOTH_BASE_STATES = ["normal","missing","abutment"];', context);
  for (const name of functionNames) vm.runInContext(extractFunction(name), context);
  for (const num of ids) context.toothState[num] = context.defaultToothState();
  return { context, calls };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('canonical coordinates and all 32 FDI IDs are preserved exactly', () => {
  const actual = { upper: plain(upper), lower: plain(lower) };
  assert.deepEqual(actual, canonical.coordinates);
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
  assert.deepEqual(ids, [
    18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
    48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38
  ]);
});

test('snapshot exposes exactly 32 canonical states', () => {
  const { context } = boot();
  const snapshot = plain(context.getToothStateSnapshot());
  assert.equal(Object.keys(snapshot).length, 32);
  assert.deepEqual(Object.keys(snapshot).sort(), ids.map(String).sort());
  for (const entry of Object.values(snapshot)) {
    assert.deepEqual(entry, { baseState: 'normal', caution: false });
  }
});

test('missing and abutment are exclusive while caution is independent', () => {
  const { context } = boot();
  context.applyModeToTooth(26, 'missing');
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'missing', caution: false });
  context.applyModeToTooth(26, 'caution');
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'missing', caution: true });
  context.applyModeToTooth(26, 'abutment');
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'abutment', caution: true });
  context.applyModeToTooth(26, 'abutment');
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'normal', caution: true });
  context.applyModeToTooth(26, 'caution');
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'normal', caution: false });
});

test('numeric and SVG click paths mutate the same canonical state', () => {
  const { context } = boot();
  context.currentMode = 'missing';
  context.handleCanonicalNumericToothClick(16);
  assert.equal(context.toothState[16].baseState, 'missing');
  assert.deepEqual([...context.state.selectedTeeth], [16]);

  context.currentMode = 'abutment';
  context.handleCanonicalSvgToothClick(16);
  assert.deepEqual(plain(context.toothState[16]), { baseState: 'abutment', caution: false });
  assert.equal(context.state.selectedTeeth.has(16), false);

  context.currentMode = 'caution';
  context.handleCanonicalSvgToothClick(16);
  assert.deepEqual(plain(context.toothState[16]), { baseState: 'abutment', caution: true });
});

test('selectedTeeth is rebuilt only from missing base states', () => {
  const { context } = boot();
  context.toothState[11] = { baseState: 'missing', caution: true };
  context.toothState[12] = { baseState: 'abutment', caution: true };
  context.toothState[13] = { baseState: 'normal', caution: true };
  context.state.selectedTeeth.add(99);
  context.syncSelectedTeethFromState();
  assert.deepEqual([...context.state.selectedTeeth], [11]);
});

test('clear and reset remove both base state and caution', () => {
  const { context } = boot();
  context.toothState[21] = { baseState: 'abutment', caution: true };
  context.applyModeToTooth(21, 'clear');
  assert.deepEqual(plain(context.toothState[21]), { baseState: 'normal', caution: false });

  context.toothState[22] = { baseState: 'missing', caution: true };
  context.toothState[23] = { baseState: 'abutment', caution: true };
  context.resetCanonicalToothState();
  for (const num of ids) {
    assert.deepEqual(plain(context.toothState[num]), { baseState: 'normal', caution: false });
  }
  assert.equal(context.state.selectedTeeth.size, 0);
});

test('strict restore rejects malformed snapshots without partial mutation', () => {
  const { context } = boot();
  const valid = plain(context.getToothStateSnapshot());
  valid['26'] = { baseState: 'abutment', caution: true };
  assert.equal(context.restoreToothStateSnapshot(valid), true);
  assert.deepEqual(plain(context.toothState[26]), { baseState: 'abutment', caution: true });

  const before = plain(context.getToothStateSnapshot());
  const unknownTooth = { ...before, 99: { baseState: 'missing', caution: false } };
  assert.equal(context.restoreToothStateSnapshot(unknownTooth), false);
  assert.deepEqual(plain(context.getToothStateSnapshot()), before);

  const badState = plain(before);
  badState['26'] = { baseState: 'invalid', caution: true };
  assert.equal(context.restoreToothStateSnapshot(badState), false);
  assert.deepEqual(plain(context.getToothStateSnapshot()), before);

  const extraField = plain(before);
  extraField['26'] = { baseState: 'abutment', caution: true, extra: true };
  assert.equal(context.restoreToothStateSnapshot(extraField), false);
  assert.deepEqual(plain(context.getToothStateSnapshot()), before);
});

test('7-7 denture helpers always set missing regardless of current mode', () => {
  const { context } = boot();
  context.currentMode = 'caution';
  context.toothState[16].caution = true;
  context.selectUpperDentureCanonical();
  const upper77 = [17,16,15,14,13,12,11,21,22,23,24,25,26,27];
  for (const num of upper77) assert.equal(context.toothState[num].baseState, 'missing');
  assert.equal(context.toothState[16].caution, true);
  assert.equal(context.toothState[18].baseState, 'normal');

  context.currentMode = 'abutment';
  context.selectLowerDentureCanonical();
  const lower77 = [47,46,45,44,43,42,41,31,32,33,34,35,36,37];
  for (const num of lower77) assert.equal(context.toothState[num].baseState, 'missing');
  assert.equal(context.toothState[48].baseState, 'normal');
});

test('UI exposes abutment mode and independent caution visuals', () => {
  assert.match(html, /data-mode="abutment"[^>]*>[^<]*(?:<[^>]+>[^<]*<\/[^>]+>)?支台歯|data-mode="abutment"/);
  assert.match(html, /id="r-abutment"/);
  assert.match(visualSource, /\.tooth-el\.abutment/);
  assert.match(visualSource, /\.tooth-caution-mark\.show/);
  assert.match(visualSource, /\.tooth\.abutment/);
  assert.match(visualSource, /\.tooth\.caution/);
  assert.match(source, /stamp\.textContent = '支'/);
  assert.match(html, /app\/tooth-state\.js/);
});

test('approved tooth geometry is not regenerated or replaced', () => {
  assert.equal((toothSource.match(/var upperTeeth = \[/g) || []).length, 1);
  assert.equal((toothSource.match(/var lowerTeeth = \[/g) || []).length, 1);
  assert.match(html, /<img[^>]+alt="歯式図"/);
  assert.match(toothSource, /coords\[t\.num\]=\{cx:t\.cx,cy:t\.cy,rx:t\.rx,ry:t\.ry\}/);
});

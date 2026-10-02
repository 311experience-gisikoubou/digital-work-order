const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');

function loadPdf() {
  const sandbox = {
    console, setTimeout, clearTimeout, Blob, URL,
    formatJapaneseEraDate(value) { return value; },
    window: { location: { assign() {} } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pdfSource, sandbox, { filename: 'pdf.js' });
  return sandbox;
}

function toothMap(overrides = {}) {
  const ids = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
    48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  const map = {};
  ids.forEach(id => { map[String(id)] = { baseState: 'normal', caution: false }; });
  Object.assign(map, overrides);
  return map;
}

function order(overrides = {}) {
  return {
    clinicName: 'SAMPLE', doctorName: 'DOCTOR', patientName: 'PATIENT',
    patientAge: '65', patientGender: 'female', issueDate: '2026-10-02',
    insuranceType: 'insurance', orderTypes: ['完成'], devices: [],
    selectedTeeth: [18], deliveryDate: '2026-10-20', nextAppointment: '',
    remarks: '', memoStrokes: [], shippingDate: '2026-10-02',
    standardDeliveryDate: '2026-10-20', businessDaysFromShipping: 8,
    expediteFeeYen: 3000, status: 'pending',
    createdAt: '2026-10-02T00:00:00.000Z', id: 'local_1',
    workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  };
}

test('order collection freezes delivery metrics already calculated by calendar.js', () => {
  for (const token of [
    'shippingDate: shippingDateValue',
    'standardDeliveryDate: standardDeliveryDateValue',
    'businessDaysFromShipping: businessDaysFromShippingValue',
    'expediteFeeYen: expediteFeeYenValue'
  ]) assert.ok(appSource.includes(token), token);
  assert.ok(appSource.includes('HOLIDAYS_CACHE'));
  assert.ok(appSource.includes('countBizDays(shippingDateValue, deliveryDateValue, holidaySnapshot)'));
});

test('PDF tooth-number block is 8-to-8 on both jaws', () => {
  for (const token of ['tnSpan(18,8)', 'tnSpan(28,8)', 'tnSpan(48,8)', 'tnSpan(38,8)']) {
    assert.ok(pdfSource.includes(token), token);
  }
});

test('PDF uses per-order snapshot states and shows shipping/expedite data', () => {
  const sandbox = loadPdf();
  const teeth = toothMap({
    18: { baseState: 'missing', caution: false },
    16: { baseState: 'abutment', caution: true }
  });
  const visualSnapshot = {
    teeth, selectedTeeth: [18],
    claspState: { 16: [{ type: 'W' }] },
    drawing: { strokes: [], memoStrokes: [] },
    coordinates: {}
  };
  sandbox.__order = order({ visualSnapshot });
  const html = vm.runInContext("_buildPrintHTML(__order, 'CHART_ONE', null, 'MEMO_ONE')", sandbox);
  assert.ok(html.includes('tn-missing'));
  assert.ok(html.includes('tn-abutment'));
  assert.ok(html.includes('tn-caution'));
  assert.ok(html.includes('模型発送予定日'));
  assert.ok(html.includes('10月2日(金)'));
  assert.ok(html.includes('急ぎ料金'));
  assert.ok(html.includes('¥3,000'));
  assert.ok(html.includes('WC ×1'));
});

test('two-up PDF keeps each order chart and memo separate', () => {
  const sandbox = loadPdf();
  sandbox.__one = order({ patientName: 'ONE', id: 'local_1' });
  sandbox.__two = order({
    patientName: 'TWO', id: 'local_2',
    workOrderRef: 'dwo:223e4567-e89b-42d3-a456-426614174000'
  });
  const html = vm.runInContext(
    "_buildPrintHTML(__one, 'CHART_ONE', __two, 'MEMO_ONE', 'CHART_TWO', 'MEMO_TWO')",
    sandbox
  );
  const split = html.split('<div class="perforated"></div>');
  assert.equal(split.length, 2);
  assert.ok(split[0].includes('CHART_ONE') && split[0].includes('MEMO_ONE'));
  assert.ok(!split[0].includes('CHART_TWO') && !split[0].includes('MEMO_TWO'));
  assert.ok(split[1].includes('CHART_TWO') && split[1].includes('MEMO_TWO'));
});

test('legacy order without visualSnapshot never borrows the current chart', () => {
  const sandbox = loadPdf();
  sandbox.__order = order();
  const html = vm.runInContext("_buildPrintHTML(__order, '', null, '')", sandbox);
  assert.ok(html.includes('図情報なし'));
  assert.ok(!html.includes('CHART_ONE'));
  assert.ok(pdfSource.includes("if (!order || !order.visualSnapshot"));
});

test('PDF clasp summary no longer reads the live global claspState', () => {
  const start = pdfSource.indexOf('function buildSlip(');
  const end = pdfSource.indexOf('  var css =', start);
  const slipSource = pdfSource.slice(start, end);
  assert.ok(slipSource.includes('order.visualSnapshot.claspState'));
  assert.ok(!slipSource.includes("typeof claspState !== 'undefined'"));
});

test('session validation permits valid frozen delivery metrics and rejects bad values', () => {
  const start = ordersSource.indexOf('//  Same-tab temporary-order reload recovery');
  const end = ordersSource.indexOf('//  受注サマリー', start);
  const regionStart = ordersSource.lastIndexOf('// ============================================================', start);
  const regionEnd = ordersSource.lastIndexOf('// ============================================================', end);
  const context = { state: { orders: [] }, window: {} };
  vm.createContext(context);
  vm.runInContext(ordersSource.slice(regionStart, regionEnd), context);
  const valid = order();
  assert.equal(context.isValidSessionOrder(valid), true);
  assert.equal(context.isValidSessionOrder({ ...valid, expediteFeeYen: -1 }), false);
  assert.equal(context.isValidSessionOrder({ ...valid, businessDaysFromShipping: 2.5 }), false);
});

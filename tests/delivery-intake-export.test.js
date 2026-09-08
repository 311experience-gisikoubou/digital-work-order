const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const exportSource = fs.readFileSync(path.join(root, 'delivery-intake-export.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const context = { Blob };
vm.createContext(context);
vm.runInContext(exportSource, context);

const {
  buildDigitalWorkOrderIntake,
  buildDeliveryIntakeFilename,
  downloadDeliveryIntakeJson
} = context;

const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
function sampleOrder() {
  return {
    workOrderRef: REF,
    issueDate: '2026-09-08',
    createdAt: '2026-09-08T06:00:00.000Z',
    clinicName: '架空連携歯科',
    doctorName: ' 架空医師 ',
    patientName: '架空患者',
    deliveryDate: '2026-09-12',
    insuranceType: 'insurance',
    selectedTeeth: [11, 12],
    orderTypes: ['新製'],
    repairDetail: '修理詳細',
    bedType: 'レジン床',
    devices: ['義歯'],
    claspType: 'ワイヤー鉤',
    barType: 'キャストバー',
    castBarCounts: { upper: 1, lower: 2 },
    reinforcementWireCount: 2,
    rimountJaws: { upper: true, lower: false },
    rimountCount: 1,
    hasMetalup: true,
    metalupDetail: '2歯',
    hasKyoko: true,
    kyokoDetail: '補強床詳細',
    toothAnterior: 'レジン歯',
    toothPosterior: '硬レ歯',
    shadeGuide: 'A3',
    shadeNumber: '42',
    taigoha: true,
    bite: true,
    goaFlag: true,
    hasArticulator: true,
    articulatorType: '半調節性',
    articulatorDetail: '架空咬合器',
    remarks: '架空テスト備考',
    patientAge: 'FORBIDDEN_AGE',
    patientGender: 'FORBIDDEN_GENDER',
    memoStrokes: [{ d: 'FORBIDDEN_STROKE' }],
    id: 'FORBIDDEN_LOCAL_ID',
    status: 'FORBIDDEN_STATUS',
    nextAppointment: 'FORBIDDEN_NEXT_APPOINTMENT',
    priority: 'FORBIDDEN_PRIORITY',
    surchargeAmount: 'FORBIDDEN_SURCHARGE',
    fee: 'FORBIDDEN_FEE',
    price: 'FORBIDDEN_PRICE',
    amount: 'FORBIDDEN_AMOUNT',
    sales: 'FORBIDDEN_SALES'
  };
}

function toHost(value) {
  return JSON.parse(JSON.stringify(value));
}

function instructionMap(payload) {
  return Object.fromEntries(payload.sourceInstructions.map(field => [field.code, field.values]));
}

test('maps exact intake-v1 top-level fields and preserves stable metadata', () => {
  const payload = toHost(buildDigitalWorkOrderIntake(sampleOrder()));
  assert.deepEqual(Object.keys(payload), [
    'schemaVersion', 'sourceSystem', 'workOrderRef', 'sourceIssueDate',
    'sourceCreatedAt', 'clinicDisplayName', 'doctorDisplayName',
    'patientDisplayName', 'dueDate', 'sourceClassification',
    'sourceTeeth', 'sourceInstructions'
  ]);
  assert.equal(payload.workOrderRef, REF);
  assert.equal(payload.sourceCreatedAt, '2026-09-08T06:00:00.000Z');
  assert.equal(payload.doctorDisplayName, '架空医師');
  assert.deepEqual(payload.sourceTeeth, ['11', '12']);
});

test('maps explicit clinical instructions using receiver-supported codes', () => {
  const payload = toHost(buildDigitalWorkOrderIntake(sampleOrder()));
  const instructions = instructionMap(payload);
  assert.deepEqual(instructions.order_type, ['新製']);
  assert.deepEqual(instructions.cast_bar_count, ['upper=1', 'lower=2']);
  assert.deepEqual(instructions.reinforcement_wire_count, ['2']);
  assert.deepEqual(instructions.rimount, ['upper', 'count=1']);
  assert.deepEqual(instructions.artificial_tooth, ['anterior=レジン歯', 'posterior=硬レ歯']);
  assert.deepEqual(instructions.shade, ['guide=A3', 'number=42']);
  assert.deepEqual(instructions.opposing_tooth, ['enabled']);
  assert.deepEqual(instructions.bite, ['enabled']);
  assert.deepEqual(instructions.goa, ['enabled']);
  assert.deepEqual(instructions.articulator, ['半調節性', '架空咬合器']);
  assert.deepEqual(instructions.remarks, ['架空テスト備考']);
  assert.equal(Object.hasOwn(instructions, 'priority'), false);
});

test('forbidden source fields and fee-like canaries never enter the payload', () => {
  const serialized = JSON.stringify(buildDigitalWorkOrderIntake(sampleOrder()));
  for (const canary of [
    'FORBIDDEN_AGE', 'FORBIDDEN_GENDER', 'FORBIDDEN_STROKE',
    'FORBIDDEN_LOCAL_ID', 'FORBIDDEN_STATUS', 'FORBIDDEN_NEXT_APPOINTMENT',
    'FORBIDDEN_PRIORITY', 'FORBIDDEN_SURCHARGE', 'FORBIDDEN_FEE',
    'FORBIDDEN_PRICE', 'FORBIDDEN_AMOUNT', 'FORBIDDEN_SALES'
  ]) assert.equal(serialized.includes(canary), false, canary);
});

test('filename uses only the stable UUID and no business display names', () => {
  const filename = buildDeliveryIntakeFilename(REF);
  assert.equal(filename, 'dwo_123e4567-e89b-42d3-a456-426614174000.json');
  assert.equal(filename.includes('架空連携歯科'), false);
  assert.equal(filename.includes('架空患者'), false);
});

test('fails closed for invalid or temporary references and invalid metadata', () => {
  const invalidRef = sampleOrder();
  invalidRef.workOrderRef = 'local_123';
  assert.throws(() => buildDigitalWorkOrderIntake(invalidRef), /DELIVERY_INTAKE_EXPORT_INVALID_REF/);

  const invalidDate = sampleOrder();
  invalidDate.issueDate = '2026-02-31';
  assert.throws(() => buildDigitalWorkOrderIntake(invalidDate), /DELIVERY_INTAKE_EXPORT_INVALID_METADATA/);

  const invalidCreatedAt = sampleOrder();
  invalidCreatedAt.createdAt = '2026-09-08';
  assert.throws(() => buildDigitalWorkOrderIntake(invalidCreatedAt), /DELIVERY_INTAKE_EXPORT_INVALID_METADATA/);
});

test('doctor is optional and blank doctor maps to null', () => {
  const order = sampleOrder();
  order.doctorName = '   ';
  const payload = toHost(buildDigitalWorkOrderIntake(order));
  assert.equal(payload.doctorDisplayName, null);
});

test('download helper stays browser-local, uses private filename, and revokes URL after delay', async () => {
  let clicked = false;
  let removed = false;
  let appended = false;
  let revoked = null;
  let delayMs = null;
  let capturedBlob = null;
  const anchor = { style: {}, click() { clicked = true; }, remove() { removed = true; } };
  const env = {
    Blob,
    URL: {
      createObjectURL(blob) { capturedBlob = blob; return 'blob:synthetic'; },
      revokeObjectURL(url) { revoked = url; }
    },
    document: {
      createElement(tag) { assert.equal(tag, 'a'); return anchor; },
      body: { appendChild(node) { assert.equal(node, anchor); appended = true; } }
    },
    setTimeout(fn, ms) { delayMs = ms; fn(); return 1; }
  };
  const result = toHost(downloadDeliveryIntakeJson(sampleOrder(), env));
  assert.equal(result.filename, 'dwo_123e4567-e89b-42d3-a456-426614174000.json');
  assert.equal(anchor.download, result.filename);
  assert.equal(anchor.href, 'blob:synthetic');
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(appended, true);
  assert.equal(delayMs, 1000);
  assert.equal(revoked, 'blob:synthetic');
  assert.ok(capturedBlob instanceof Blob);
  const downloaded = JSON.parse(await capturedBlob.text());
  assert.equal(downloaded.workOrderRef, REF);
});

test('export code has no network path and order-list action is explicit only', () => {
  assert.equal(exportSource.includes('fetch('), false);
  assert.equal(exportSource.includes('XMLHttpRequest'), false);
  assert.equal(exportSource.includes('WebSocket'), false);
  assert.equal(exportSource.includes('firebase'), false);
  assert.equal(exportSource.includes('JSON.stringify(order)'), false);
  assert.match(ordersSource, /downloadDeliveryIntakeJson\(order\)/);
  assert.match(ordersSource, /bridgeBtn\.textContent\s*=\s*'\\u7d0d\\u54c1\\u9023\\u643a'/);
  assert.equal(appSource.includes('downloadDeliveryIntakeJson'), false);
});

test('export script loads before order-list code that invokes it', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const exportIndex = html.indexOf('delivery-intake-export.js');
  const ordersIndex = html.indexOf('orders.js');
  assert.ok(exportIndex >= 0 && ordersIndex > exportIndex);
});

test('rimount enabled state is preserved even without jaw detail', () => {
  const order = sampleOrder();
  order.hasRimount = true;
  order.rimountJaws = { upper: false, lower: false };
  order.rimountCount = 0;
  const payload = toHost(buildDigitalWorkOrderIntake(order));
  assert.deepEqual(instructionMap(payload).rimount, ['enabled']);
});

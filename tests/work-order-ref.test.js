const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const stableStart = appSource.indexOf('//  連携用 stable workOrderRef');
const submitStart = appSource.indexOf('//  送信処理', stableStart);
assert.ok(stableStart >= 0 && submitStart > stableStart);

const stableBlock = appSource.slice(
  appSource.lastIndexOf('// ============================================================', stableStart),
  appSource.lastIndexOf('// ============================================================', submitStart)
);
const context = {};
vm.createContext(context);
vm.runInContext(stableBlock, context);
const { generateWorkOrderRef } = context;

const REF_PATTERN = /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('creates a canonical dwo UUID v4 reference', () => {
  assert.match(generateWorkOrderRef(webcrypto), REF_PATTERN);
});

test('sequential synthetic references are unique', () => {
  const refs = new Set();
  for (let i = 0; i < 256; i += 1) refs.add(generateWorkOrderRef(webcrypto));
  assert.equal(refs.size, 256);
});

test('getRandomValues fallback sets UUID v4 version and variant bits', () => {
  const fakeCrypto = {
    getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
      return bytes;
    }
  };
  const ref = generateWorkOrderRef(fakeCrypto);
  assert.match(ref, REF_PATTERN);
  assert.equal(ref.split(':')[1][14], '4');
  assert.match(ref.split(':')[1][19], /[89ab]/);
});

test('fails closed when secure randomness is unavailable', () => {
  assert.throws(() => generateWorkOrderRef({}), /SECURE_WORK_ORDER_REF_UNAVAILABLE/);
});

test('fails closed when randomUUID returns a malformed value', () => {
  assert.throws(
    () => generateWorkOrderRef({ randomUUID: () => 'not-a-uuid' }),
    /SECURE_WORK_ORDER_REF_INVALID/
  );
});

test('generator does not use timestamp, Math.random, or business values', () => {
  for (const forbidden of ['Date.now', 'Math.random', 'clinic', 'patient', 'doctor']) {
    assert.equal(stableBlock.includes(forbidden), false, forbidden);
  }
});

test('submit assigns workOrderRef after validation and before local save', () => {
  const validationIndex = appSource.indexOf('const errors = validate(data);');
  const assignIndex = appSource.indexOf('data.workOrderRef = generateWorkOrderRef();');
  const saveIndex = appSource.indexOf('state.orders.unshift(data);');
  assert.ok(validationIndex >= 0 && validationIndex < assignIndex && assignIndex < saveIndex);
  assert.match(appSource, /id:\s*'local_'\s*\+\s*Date\.now\(\)/);
});

test('collectFormData remains unchanged for PDF preview collection', () => {
  assert.match(appSource, /function collectFormData\(\) \{/);
  assert.equal(appSource.includes('assignWorkOrderRef'), false);
  const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
  assert.match(pdfSource, /collectFormData\(\)/);
  assert.equal(pdfSource.includes('generateWorkOrderRef'), false);
});

test('index script order is not changed for stable reference generation', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(html.includes('work-order-ref.js'), false);
});

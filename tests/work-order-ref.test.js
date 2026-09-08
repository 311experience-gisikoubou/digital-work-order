const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const { generateWorkOrderRef } = require(path.join(root, 'work-order-ref.js'));

const REF_PATTERN = /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('creates a canonical dwo UUID v4 reference', () => {
  assert.match(generateWorkOrderRef(), REF_PATTERN);
});

test('sequential synthetic references are unique', () => {
  const refs = new Set();
  for (let i = 0; i < 256; i += 1) refs.add(generateWorkOrderRef());
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
  assert.throws(
    () => generateWorkOrderRef({}),
    /SECURE_WORK_ORDER_REF_UNAVAILABLE/
  );
});

test('fails closed when randomUUID returns a malformed value', () => {
  assert.throws(
    () => generateWorkOrderRef({ randomUUID: () => 'not-a-uuid' }),
    /SECURE_WORK_ORDER_REF_INVALID/
  );
});

test('generator does not use timestamp, Math.random, or business values', () => {
  const source = fs.readFileSync(path.join(root, 'work-order-ref.js'), 'utf8');
  for (const forbidden of ['Date.now', 'Math.random', 'clinic', 'patient', 'doctor']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('submit path assigns workOrderRef while local UI id remains separate', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /collectFormData\(\{ assignWorkOrderRef: true \}\)/);
  assert.match(source, /workOrderRef:\s*generateWorkOrderRef\(\)/);
  assert.match(source, /id:\s*'local_'\s*\+\s*Date\.now\(\)/);
});

test('PDF preview path does not request a stable workOrderRef', () => {
  const source = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
  assert.match(source, /collectFormData\(\)/);
  assert.equal(source.includes('assignWorkOrderRef'), false);
});

test('work-order-ref script loads before app.js', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refIndex = html.indexOf('<script src="work-order-ref.js"></script>');
  const appIndex = html.indexOf('<script src="app.js"></script>');
  assert.ok(refIndex >= 0);
  assert.ok(appIndex >= 0);
  assert.ok(refIndex < appIndex);
});

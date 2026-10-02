const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');
const T = require('../media-transfer-package.js');

// 架空サンプルのみ。患者名・医院名は使わない。
const WORK_ORDER_REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const ATT_1 = 'att-123e4567-e89b-42d3-a456-426614174001';
const ATT_2 = 'att-223e4567-e89b-42d3-a456-426614174002';

const CRYPTO_OPTS = { crypto: webcrypto };

function sortedKeys(obj) { return Object.keys(obj).slice().sort(); }

// seedから始まる単調増加パターンで埋める。位置ごとに内容が変わるため、
// チャンクの入替・差替えが検出できることをテストで確認できる（全バイト同値だと入替が無害化してしまう）。
function blobFromSize(size, seed, mime) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (seed + i) % 256;
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

function sampleWorkOrder(overrides) {
  return Object.assign({
    workOrderRef: WORK_ORDER_REF,
    issueDate: '2026-10-02',
    orderTypes: ['crown']
  }, overrides || {});
}

function attachment(attachmentId, kind, mime, size, fill) {
  return {
    meta: { attachmentId, kind, mime, size, name: 'ignored-sample-name.bin' },
    blob: blobFromSize(size, fill, mime)
  };
}

test('empty media produces a manifest with no attachments and verifies', async () => {
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), [], CRYPTO_OPTS);
  assert.deepEqual(pkg.manifest.attachments, []);
  const result = await T.verifyPackage(pkg, CRYPTO_OPTS);
  assert.equal(result.ok, true);
  assert.equal(result.attachmentCount, 0);
});

test('multi-chunk media splits deterministically and verifies', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  const entry = pkg.manifest.attachments[0];
  assert.equal(entry.chunks.length, 3);
  assert.deepEqual(entry.chunks.map(c => c.size), [4, 4, 2]);
  assert.deepEqual(entry.chunks.map(c => c.index), [0, 1, 2]);
  assert.equal(pkg.attachments[ATT_1].chunks.length, 3);
  const result = await T.verifyPackage(pkg, CRYPTO_OPTS);
  assert.equal(result.ok, true);
});

test('manifest exact structure: schema-versioned keys only, no patient/clinic identifiers', async () => {
  const items = [attachment(ATT_1, 'image', 'image/jpeg', 3, 1)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 2 }, CRYPTO_OPTS));
  const manifest = pkg.manifest;
  assert.deepEqual(sortedKeys(manifest), ['attachments', 'createdAt', 'schemaVersion', 'workOrder', 'workOrderRef'].sort());
  assert.equal(manifest.schemaVersion, T.SCHEMA_VERSION);
  assert.equal(manifest.workOrderRef, WORK_ORDER_REF);
  assert.deepEqual(sortedKeys(manifest.workOrder), ['sha256', 'size'].sort());
  const entry = manifest.attachments[0];
  assert.deepEqual(sortedKeys(entry), ['attachmentId', 'chunks', 'kind', 'mime', 'sha256', 'size'].sort());
  assert.ok(!('name' in entry));
  entry.chunks.forEach(chunk => {
    assert.deepEqual(sortedKeys(chunk), ['index', 'sha256', 'size'].sort());
  });
});

test('verifyPackage accepts an untampered package', async () => {
  const items = [attachment(ATT_1, 'audio', 'audio/webm', 5, 9), attachment(ATT_2, 'file', 'application/pdf', 1, 2)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 2 }, CRYPTO_OPTS));
  const result = await T.verifyPackage(pkg, CRYPTO_OPTS);
  assert.equal(result.ok, true);
  assert.equal(result.attachmentCount, 2);
});

test('verifyPackage rejects a tampered work-order.json payload', async () => {
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), [], CRYPTO_OPTS);
  pkg.workOrder.blob = new Blob(['{"workOrderRef":"dwo:tampered"}'], { type: 'application/json' });
  await assert.rejects(() => T.verifyPackage(pkg, CRYPTO_OPTS), { code: 'TRANSFER_TAMPERED' });
});

test('verifyPackage rejects a tampered chunk payload', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  pkg.attachments[ATT_1].chunks[1] = blobFromSize(4, 0xff);
  await assert.rejects(() => T.verifyPackage(pkg, CRYPTO_OPTS), { code: 'TRANSFER_TAMPERED' });
});

test('verifyPackage rejects a missing file and a missing chunk', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7), attachment(ATT_2, 'file', 'application/pdf', 1, 3)];
  const pkgMissingFile = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  delete pkgMissingFile.attachments[ATT_2];
  await assert.rejects(() => T.verifyPackage(pkgMissingFile, CRYPTO_OPTS), { code: 'TRANSFER_MISSING_FILE' });

  const pkgShortChunks = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  pkgShortChunks.attachments[ATT_1].chunks.pop();
  await assert.rejects(() => T.verifyPackage(pkgShortChunks, CRYPTO_OPTS), { code: 'TRANSFER_CHUNK_COUNT_MISMATCH' });

  const pkgNullChunk = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  pkgNullChunk.attachments[ATT_1].chunks[1] = null;
  await assert.rejects(() => T.verifyPackage(pkgNullChunk, CRYPTO_OPTS), { code: 'TRANSFER_MISSING_CHUNK' });
});

test('verifyPackage rejects reordered chunks', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  const chunks = pkg.attachments[ATT_1].chunks;
  const swapped = [chunks[1], chunks[0], chunks[2]];
  pkg.attachments[ATT_1].chunks = swapped;
  await assert.rejects(() => T.verifyPackage(pkg, CRYPTO_OPTS), { code: 'TRANSFER_TAMPERED' });
});

test('verifyPackage rejects duplicate attachmentId metadata in the manifest', async () => {
  const items = [attachment(ATT_1, 'file', 'application/pdf', 2, 5)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  pkg.manifest.attachments.push(JSON.parse(JSON.stringify(pkg.manifest.attachments[0])));
  await assert.rejects(() => T.verifyPackage(pkg, CRYPTO_OPTS), { code: 'TRANSFER_MALFORMED_MANIFEST' });
});

test('verifyPackage rejects a foreign attachment payload not listed in the manifest', async () => {
  const items = [attachment(ATT_1, 'file', 'application/pdf', 2, 5)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  pkg.attachments[ATT_2] = { chunks: [blobFromSize(2, 9)] };
  await assert.rejects(() => T.verifyPackage(pkg, CRYPTO_OPTS), { code: 'TRANSFER_FOREIGN_ATTACHMENT' });
});

test('resume continues at the first unconfirmed chunk after confirmation', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  const progress = T.createProgress(pkg.manifest);
  assert.equal(progress.nextChunkIndex(ATT_1), 0);
  progress.confirmChunk(ATT_1, 0);
  assert.equal(progress.nextChunkIndex(ATT_1), 1);
  assert.equal(progress.isAttachmentComplete(ATT_1), false);

  // 再開: 保存済み進捗から再構成し、確認済みチャンクの次から続けられる。
  const resumed = T.createProgress(pkg.manifest, progress.snapshot());
  assert.equal(resumed.nextChunkIndex(ATT_1), 1);
  resumed.confirmChunk(ATT_1, 1);
  resumed.confirmChunk(ATT_1, 2);
  assert.equal(resumed.isAttachmentComplete(ATT_1), true);
  assert.equal(resumed.isComplete(), true);
});

test('skipped or out-of-order confirmation is rejected (fail closed)', async () => {
  const items = [attachment(ATT_1, 'video', 'video/mp4', 10, 7)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  const progress = T.createProgress(pkg.manifest);
  assert.throws(() => progress.confirmChunk(ATT_1, 1), { code: 'TRANSFER_PROGRESS_MISMATCH' });
  progress.confirmChunk(ATT_1, 0);
  assert.throws(() => progress.confirmChunk(ATT_1, 0), { code: 'TRANSFER_PROGRESS_MISMATCH' });
  assert.throws(() => progress.confirmChunk(ATT_1, 3), { code: 'TRANSFER_PROGRESS_MISMATCH' });
  assert.throws(() => progress.confirmChunk('att-does-not-exist', 0), { code: 'TRANSFER_UNKNOWN_ATTACHMENT' });
});

test('createProgress rejects a saved state that mismatches the manifest', async () => {
  const items = [attachment(ATT_1, 'file', 'application/pdf', 2, 5)];
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
  assert.throws(() => T.createProgress(pkg.manifest, { 'att-unknown': 0 }), { code: 'TRANSFER_PROGRESS_MISMATCH' });
  assert.throws(() => T.createProgress(pkg.manifest, { [ATT_1]: 99 }), { code: 'TRANSFER_PROGRESS_MISMATCH' });
});

test('buildPackage rejects duplicate attachment metadata supplied by the caller', async () => {
  const items = [attachment(ATT_1, 'file', 'application/pdf', 2, 5), attachment(ATT_1, 'file', 'application/pdf', 2, 5)];
  await assert.rejects(
    () => T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, CRYPTO_OPTS),
    { code: 'TRANSFER_DUPLICATE_ATTACHMENT' }
  );
});

test('buildPackage and verifyPackage fail closed when crypto.subtle is unavailable', async () => {
  await assert.rejects(
    () => T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), [], { crypto: {} }),
    { code: 'TRANSFER_CRYPTO_UNAVAILABLE' }
  );
  const pkg = await T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), [], CRYPTO_OPTS);
  await assert.rejects(
    () => T.verifyPackage(pkg, { crypto: {} }),
    { code: 'TRANSFER_CRYPTO_UNAVAILABLE' }
  );
});

test('buildPackage rejects an invalid workOrderRef', async () => {
  await assert.rejects(
    () => T.buildPackage('dwo:not-a-uuid', sampleWorkOrder(), [], CRYPTO_OPTS),
    { code: 'TRANSFER_INVALID_WORK_ORDER_REF' }
  );
});

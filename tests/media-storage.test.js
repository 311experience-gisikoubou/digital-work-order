const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const S = require('../media-storage.js');
const M = require('../media.js');

// 架空サンプルのみ
const SAMPLES = {
  photo: { name: 'photo-sample.jpg', type: 'image/jpeg', size: 123456, kind: 'image', source: 'camera-photo' },
  movie: { name: 'movie-sample.mov', type: 'video/quicktime', size: 2345678, kind: 'video', source: 'camera-video' },
  voice: { name: 'voice-sample.webm', type: 'audio/webm', size: 34567, kind: 'audio', source: 'recording' },
  note: { name: 'note-sample.pdf', type: 'application/pdf', size: 45678, kind: 'file', source: 'file-picker' }
};
const WORK_ORDER_REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';

// 実サイズのBlobは作らず、size/typeだけ持つ架空Blobを使う（memory adapterは中身を読まない）。
function fakeBlob(sample) { return { size: sample.size, type: sample.type, name: sample.name }; }

function makeEnv(options) {
  const blobStore = S.createMemoryBlobStore(options && { failOn: options.blobFail });
  const metaStore = S.createMemoryMetaStore(options && { failOn: options.metaFail });
  const log = [];
  const origPut = blobStore.put;
  blobStore.put = async (name, blob) => { log.push('opfs:put'); return origPut(name, blob); };
  const origMeta = metaStore.putAttachment;
  metaStore.putAttachment = async meta => { log.push('meta:put'); return origMeta(meta); };
  const persistence = S.createPersistence({ blobStore, metaStore, crypto: webcrypto });
  return { blobStore, metaStore, persistence, log };
}

async function addSample(env, sample) {
  return env.persistence.persistAttachment({
    blob: fakeBlob(sample), source: sample.source, kind: sample.kind, name: sample.name
  });
}

// restoreOwnerは実Blobを包むため、restore系テストでは実Blobを保存する。
function realBlob(sample) {
  const blob = new Blob([new Uint8Array(16)], { type: sample.type });
  return blob;
}

test('status enum accepts the 6 defined values and rejects unknown values', () => {
  assert.deepEqual(S.STATUSES, ['unsent', 'sending', 'cloud_uploaded', 'lab_receipt_pending', 'lab_received', 'deletable']);
  S.STATUSES.forEach(status => assert.equal(S.isValidStatus(status), true, status));
  ['', 'UNSENT', 'sent', 'done', null, undefined, 1, {}].forEach(status => assert.equal(S.isValidStatus(status), false, String(status)));
  assert.equal(S.INITIAL_STATUS, 'unsent');
  assert.equal(S.STATUS_LABELS.unsent, '未送信');
  assert.equal(Object.isFrozen(S.STATUSES), true);
});

function validMeta(overrides) {
  const id = 'att-123e4567-e89b-42d3-a456-426614174001';
  return Object.assign({
    schemaVersion: 'dwo-media-meta-v1',
    attachmentId: id,
    ownerType: 'draft',
    ownerRef: 'draft:123e4567-e89b-42d3-a456-426614174002',
    status: 'unsent',
    source: 'file-picker',
    kind: 'file',
    name: 'note-sample.pdf',
    mime: 'application/pdf',
    size: 45678,
    createdAt: 1700000000000,
    opfsName: id
  }, overrides);
}

test('metadata strict schema accepts a valid record and every status', () => {
  assert.equal(S.metadataProblem(validMeta()), null);
  S.STATUSES.forEach(status => assert.equal(S.isValidMetadata(validMeta({ status })), true, status));
  assert.equal(S.isValidMetadata(validMeta({ mime: '' })), true);
  assert.equal(S.isValidMetadata(validMeta({ ownerType: 'work-order', ownerRef: WORK_ORDER_REF })), true);
});

test('metadata rejects unknown status, owner, kind, source and mismatched owner form', () => {
  assert.equal(S.isValidMetadata(validMeta({ status: 'shipped' })), false);
  assert.equal(S.isValidMetadata(validMeta({ ownerType: 'clinic' })), false);
  assert.equal(S.isValidMetadata(validMeta({ ownerType: 'work-order' })), false);
  assert.equal(S.isValidMetadata(validMeta({ ownerType: 'draft', ownerRef: WORK_ORDER_REF })), false);
  assert.equal(S.isValidMetadata(validMeta({ ownerRef: 'draft:not-a-uuid' })), false);
  assert.equal(S.isValidMetadata(validMeta({ kind: 'document' })), false);
  assert.equal(S.isValidMetadata(validMeta({ source: 'cloud' })), false);
  assert.equal(S.isValidMetadata(validMeta({ schemaVersion: 'dwo-media-meta-v2' })), false);
  assert.equal(S.isValidMetadata(validMeta({ opfsName: 'att-123e4567-e89b-42d3-a456-426614174999' })), false);
  assert.equal(S.isValidMetadata(validMeta({ size: -1 })), false);
  assert.equal(S.isValidMetadata(validMeta({ size: 1.5 })), false);
  assert.equal(S.isValidMetadata(validMeta({ name: 'a/b.jpg' })), false);
  assert.equal(S.isValidMetadata(validMeta({ name: '' })), false);
  assert.equal(S.isValidMetadata(null), false);
  assert.equal(S.isValidMetadata([]), false);
});

test('metadata rejects Blob / objectUrl / patient / clinic and any unknown property', () => {
  ['blob', 'file', 'objectUrl', 'url', 'data', 'patientName', 'clinicName', 'doctorName', 'workOrderRef', 'extra'].forEach(key => {
    assert.equal(S.isValidMetadata(validMeta({ [key]: 'x' })), false, key);
  });
  assert.equal(S.isValidMetadata(validMeta({ blob: new Blob(['x']) })), false);
  const missing = validMeta();
  delete missing.status;
  assert.equal(S.isValidMetadata(missing), false);
  S.META_KEYS.forEach(key => assert.doesNotMatch(key, /blob|file$|objectUrl|patient|clinic|doctor/i));
});

test('attachment / draft / workOrderRef IDs use safe random formats', () => {
  const ids = new Set();
  for (let i = 0; i < 100; i += 1) {
    const id = S.newAttachmentId(webcrypto);
    assert.match(id, /^att-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 100);
  assert.match(S.newDraftRef(webcrypto), /^draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(S.isValidAttachmentId('media-abc-1-deadbeef'), false);
  assert.equal(S.isValidDraftRef('draft:../../x'), false);
  assert.equal(S.isValidWorkOrderRef(WORK_ORDER_REF), true);
  assert.equal(S.isValidWorkOrderRef('dwo:1'), false);
  assert.equal(S.isValidWorkOrderRef('local_123'), false);
});

test('getRandomValues fallback yields UUID v4 and missing randomness is unavailable', () => {
  const fake = { getRandomValues(bytes) { bytes.forEach((_, i) => { bytes[i] = i + 1; }); return bytes; } };
  assert.match(S.newDraftRef(fake), /^draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => S.newDraftRef({}), { code: 'MEDIA_STORAGE_UNAVAILABLE' });
  assert.throws(() => S.newDraftRef({ randomUUID: () => 'not-a-uuid' }), { code: 'MEDIA_STORAGE_UNAVAILABLE' });
  const src = fs.readFileSync(path.join(root, 'media-storage.js'), 'utf8');
  // IDにMath.randomは使わない。Date.nowはcreatedAtの既定値だけに使う。
  assert.doesNotMatch(src, /Math\.random/);
  assert.equal((src.match(/Date\.now/g) || []).length, 1);
});

test('OPFS path is fixed and never contains file name, patient, clinic or workOrderRef', async () => {
  const env = makeEnv();
  const meta = await addSample(env, SAMPLES.photo);
  const p = S.opfsPathFor(meta.attachmentId);
  assert.equal(p, 'dwo-media-v1/blobs/' + meta.attachmentId);
  assert.equal(meta.opfsName, meta.attachmentId);
  assert.doesNotMatch(p, /photo-sample|jpg|patient|clinic|dwo:|draft/);
  assert.deepEqual(Array.from(env.blobStore.files.keys()), [meta.attachmentId]);
  assert.throws(() => S.opfsPathFor('../photo-sample.jpg'), { code: 'MEDIA_STORAGE_INVALID' });
  assert.throws(() => S.opfsPathFor(WORK_ORDER_REF), { code: 'MEDIA_STORAGE_INVALID' });
});

test('persist writes OPFS first, then metadata; metadata holds no Blob', async () => {
  const env = makeEnv();
  const meta = await addSample(env, SAMPLES.movie);
  assert.deepEqual(env.log, ['opfs:put', 'meta:put']);
  assert.equal(meta.status, 'unsent');
  assert.equal(meta.ownerType, 'draft');
  assert.equal(meta.kind, 'video');
  assert.equal(meta.mime, 'video/quicktime');
  assert.equal(meta.size, 2345678);
  assert.equal(S.isValidMetadata(meta), true);
  const stored = env.metaStore.records.get(meta.attachmentId);
  assert.deepEqual(Object.keys(stored).sort(), S.META_KEYS.slice().sort());
  assert.equal(JSON.stringify(stored).includes('blob:'), false);
  assert.equal(await env.persistence.getOrCreateActiveDraft(), meta.ownerRef);
});

test('OPFS write failure creates no metadata', async () => {
  const env = makeEnv({ blobFail: { put: true } });
  await assert.rejects(() => addSample(env, SAMPLES.photo), { code: 'MEDIA_STORAGE_WRITE_FAILED' });
  assert.equal(env.metaStore.records.size, 0);
  assert.equal(env.blobStore.files.size, 0);
  assert.deepEqual(env.log, ['opfs:put']);
});

test('quota errors map to a safe Japanese message', async () => {
  const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
  const env = makeEnv({ blobFail: { put: quota } });
  await assert.rejects(() => addSample(env, SAMPLES.photo), error => {
    assert.equal(error.code, 'MEDIA_STORAGE_QUOTA');
    assert.match(error.userMessage, /空き容量/);
    return true;
  });
  assert.equal(env.metaStore.records.size, 0);
});

test('metadata failure rolls back the OPFS file', async () => {
  const env = makeEnv({ metaFail: { putAttachment: true } });
  await assert.rejects(() => addSample(env, SAMPLES.voice), { code: 'MEDIA_STORAGE_WRITE_FAILED' });
  assert.equal(env.blobStore.files.size, 0);
  assert.equal(env.metaStore.records.size, 0);
});

test('metadata failure with rollback failure still reports failure and creates no metadata', async () => {
  const env = makeEnv({ metaFail: { putAttachment: true }, blobFail: {} });
  const origDelete = env.blobStore.delete;
  env.blobStore.delete = async () => { throw new Error('delete-failed'); };
  await assert.rejects(() => addSample(env, SAMPLES.voice), { code: 'MEDIA_STORAGE_WRITE_FAILED' });
  assert.equal(env.metaStore.records.size, 0);
  env.blobStore.delete = origDelete;
});

test('restore returns only active-draft metadata and rebuilds typed Blobs', async () => {
  const env = makeEnv();
  const a = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
  const b = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.voice), source: 'recording', kind: 'audio', name: SAMPLES.voice.name });
  const draft = await env.persistence.getOrCreateActiveDraft();
  const restored = await env.persistence.restoreOwner(draft);
  assert.equal(restored.items.length, 2);
  assert.deepEqual(restored.items.map(i => i.meta.attachmentId).sort(), [a.attachmentId, b.attachmentId].sort());
  restored.items.forEach(item => {
    assert.equal(item.blob.type, item.meta.mime);
    assert.equal(item.meta.status, 'unsent');
  });
  // 別ownerは復元されない
  const other = await env.persistence.restoreOwner('draft:123e4567-e89b-42d3-a456-426614174099');
  assert.equal(other.items.length, 0);
  await assert.rejects(() => env.persistence.restoreOwner('clinic-a'), { code: 'MEDIA_STORAGE_INVALID' });
});

test('restore drops metadata whose OPFS file is missing and cleans it up', async () => {
  const env = makeEnv();
  const a = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
  const b = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.note), source: 'file-picker', kind: 'file', name: SAMPLES.note.name });
  env.blobStore.files.delete(a.attachmentId);
  const draft = await env.persistence.getOrCreateActiveDraft();
  const restored = await env.persistence.restoreOwner(draft);
  assert.deepEqual(restored.items.map(i => i.meta.attachmentId), [b.attachmentId]);
  assert.equal(restored.missing, 1);
  assert.equal(restored.invalid, 0);
  assert.equal(restored.corrupt, 0);
  assert.equal(env.metaStore.records.has(a.attachmentId), false);
  assert.equal(env.metaStore.records.has(b.attachmentId), true);
});

test('restore cleans invalid metadata of the requested owner; valid sibling restores and bad row cannot be committed', async () => {
  const cases = {
    'unknown status': { status: 'archived' },
    'unknown property': { objectUrl: 'blob:sample/1' },
    'unknown owner type': { ownerType: 'clinic' }
  };
  const badId = 'att-123e4567-e89b-42d3-a456-426614174003';
  for (const [label, override] of Object.entries(cases)) {
    const env = makeEnv();
    const draft = await env.persistence.getOrCreateActiveDraft();
    const good = validMeta({ ownerRef: draft, size: 16 });
    const bad = validMeta(Object.assign({ ownerRef: draft, attachmentId: badId, opfsName: badId }, override));
    [good, bad].forEach(m => {
      env.metaStore.records.set(m.attachmentId, m);
      env.blobStore.files.set(m.opfsName, realBlob(SAMPLES.note));
    });
    const restored = await env.persistence.restoreOwner(draft);
    assert.deepEqual(restored.items.map(i => i.meta.attachmentId), [good.attachmentId], label);
    assert.equal(restored.invalid, 1, label);
    assert.equal(restored.missing, 0, label);
    assert.equal(restored.corrupt, 0, label);
    assert.equal(env.metaStore.records.has(badId), false, label);
    assert.equal(env.blobStore.files.has(badId), false, label);
    const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
    assert.equal(receipt.count, 1, label);
  }
});

test('restore cleans invalid metadata even when its attachmentId is not a safe id (no OPFS delete attempted)', async () => {
  const env = makeEnv();
  const draft = await env.persistence.getOrCreateActiveDraft();
  env.metaStore.records.set('../evil', { attachmentId: '../evil', ownerRef: draft, junk: true });
  const blobDeletes = [];
  const origDelete = env.blobStore.delete;
  env.blobStore.delete = async name => { blobDeletes.push(name); return origDelete(name); };
  const restored = await env.persistence.restoreOwner(draft);
  assert.equal(restored.invalid, 1);
  assert.equal(env.metaStore.records.size, 0);
  assert.deepEqual(blobDeletes, []);
});

test('restore cleans size-mismatch files (metadata first, then file) and they cannot block a later commit', async () => {
  const env = makeEnv();
  const a = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
  const b = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.note), source: 'file-picker', kind: 'file', name: SAMPLES.note.name });
  env.blobStore.files.set(a.attachmentId, new Blob([new Uint8Array(3)]));
  const order = [];
  const origMetaDelete = env.metaStore.deleteAttachment;
  env.metaStore.deleteAttachment = async id => { order.push('meta'); return origMetaDelete(id); };
  const origBlobDelete = env.blobStore.delete;
  env.blobStore.delete = async name => { order.push('opfs'); return origBlobDelete(name); };
  const draft = await env.persistence.getOrCreateActiveDraft();
  const restored = await env.persistence.restoreOwner(draft);
  assert.deepEqual(restored.items.map(i => i.meta.attachmentId), [b.attachmentId]);
  assert.equal(restored.corrupt, 1);
  assert.deepEqual(order, ['meta', 'opfs']);
  assert.equal(env.metaStore.records.has(a.attachmentId), false);
  assert.equal(env.blobStore.files.has(a.attachmentId), false);
  const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
  assert.equal(receipt.count, 1);
});

test('restore fails closed when cleanup cannot delete metadata', async () => {
  const makeCase = async kind => {
    const env = makeEnv();
    const a = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
    const draft = await env.persistence.getOrCreateActiveDraft();
    if (kind === 'missing') env.blobStore.files.delete(a.attachmentId);
    if (kind === 'corrupt') env.blobStore.files.set(a.attachmentId, new Blob([new Uint8Array(3)]));
    if (kind === 'invalid') env.metaStore.records.get(a.attachmentId).status = 'archived';
    env.metaStore.failOn.deleteAttachment = true;
    return { env, draft, a };
  };
  for (const kind of ['missing', 'corrupt', 'invalid']) {
    const { env, draft, a } = await makeCase(kind);
    await assert.rejects(() => env.persistence.restoreOwner(draft), { code: 'MEDIA_STORAGE_RESTORE_FAILED' }, kind);
    // metadataを消せなかった場合、OPFSファイルも消さない。
    if (kind !== 'missing') assert.equal(env.blobStore.files.has(a.attachmentId), true, kind);
  }
});

test('commit still rejects and does not rotate when an invalid row survives (strict)', async () => {
  const env = makeEnv();
  const draft = await env.persistence.getOrCreateActiveDraft();
  const bad = validMeta({ ownerRef: draft, status: 'archived' });
  env.metaStore.records.set(bad.attachmentId, bad);
  await assert.rejects(() => env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF), { code: 'MEDIA_STORAGE_INVALID' });
  assert.equal(await env.persistence.getOrCreateActiveDraft(), draft);
});

test('restore never commits a missing record and reports the missing count', async () => {
  const env = makeEnv();
  const a = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
  env.blobStore.files.delete(a.attachmentId);
  const draft = await env.persistence.getOrCreateActiveDraft();
  const restored = await env.persistence.restoreOwner(draft);
  assert.equal(restored.items.length, 0);
  assert.equal(restored.missing, 1);
  const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
  assert.equal(receipt.count, 0);
  assert.equal(env.metaStore.records.has(a.attachmentId), false);
});

test('OPFS orphan without metadata is never restored', async () => {
  const env = makeEnv();
  env.blobStore.files.set('att-123e4567-e89b-42d3-a456-426614174006', realBlob(SAMPLES.photo));
  const draft = await env.persistence.getOrCreateActiveDraft();
  const restored = await env.persistence.restoreOwner(draft);
  assert.equal(restored.items.length, 0);
  assert.equal(env.blobStore.files.size, 1);
});

test('delete removes metadata first, then the OPFS file best-effort', async () => {
  const env = makeEnv();
  const meta = await addSample(env, SAMPLES.photo);
  const order = [];
  const origMetaDelete = env.metaStore.deleteAttachment;
  env.metaStore.deleteAttachment = async id => { order.push('meta'); return origMetaDelete(id); };
  const origBlobDelete = env.blobStore.delete;
  env.blobStore.delete = async name => { order.push('opfs'); return origBlobDelete(name); };
  const result = await env.persistence.removeAttachment(meta.attachmentId);
  assert.deepEqual(order, ['meta', 'opfs']);
  assert.deepEqual(result, { metadataDeleted: true, fileDeleted: true });
  assert.equal(env.metaStore.records.size, 0);
  assert.equal(env.blobStore.files.size, 0);
});

test('OPFS delete failure leaves an orphan that is not restored', async () => {
  const env = makeEnv();
  const meta = await env.persistence.persistAttachment({ blob: realBlob(SAMPLES.photo), source: 'camera-photo', kind: 'image', name: SAMPLES.photo.name });
  env.blobStore.failOn.delete = true;
  const result = await env.persistence.removeAttachment(meta.attachmentId);
  assert.deepEqual(result, { metadataDeleted: true, fileDeleted: false });
  assert.equal(env.blobStore.files.size, 1);
  const restored = await env.persistence.restoreOwner(meta.ownerRef);
  assert.equal(restored.items.length, 0);
});

test('metadata delete failure keeps the OPFS file untouched', async () => {
  const env = makeEnv();
  const meta = await addSample(env, SAMPLES.photo);
  env.metaStore.failOn.deleteAttachment = true;
  await assert.rejects(() => env.persistence.removeAttachment(meta.attachmentId), { code: 'MEDIA_STORAGE_DELETE_FAILED' });
  assert.equal(env.blobStore.files.size, 1);
  assert.equal(env.metaStore.records.size, 1);
});

test('commit rebinds all draft metadata to workOrderRef and rotates the active draft atomically', async () => {
  const env = makeEnv();
  const a = await addSample(env, SAMPLES.photo);
  const b = await addSample(env, SAMPLES.voice);
  const before = await env.persistence.getOrCreateActiveDraft();
  const filesBefore = Array.from(env.blobStore.files.keys()).sort();
  const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
  assert.equal(receipt.count, 2);
  assert.equal(receipt.previousDraft, before);
  assert.notEqual(receipt.activeDraft, before);
  assert.equal(await env.persistence.getOrCreateActiveDraft(), receipt.activeDraft);
  [a, b].forEach(m => {
    const stored = env.metaStore.records.get(m.attachmentId);
    assert.equal(stored.ownerType, 'work-order');
    assert.equal(stored.ownerRef, WORK_ORDER_REF);
    assert.equal(stored.status, 'unsent');
    assert.equal(S.isValidMetadata(stored), true);
  });
  // OPFSは移動しない
  assert.deepEqual(Array.from(env.blobStore.files.keys()).sort(), filesBefore);
  // 新しいdraftには添付がない
  const fresh = await env.persistence.restoreOwner(receipt.activeDraft);
  assert.equal(fresh.items.length, 0);
});

test('commit with zero attachments still rotates the draft', async () => {
  const env = makeEnv();
  const before = await env.persistence.getOrCreateActiveDraft();
  const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
  assert.equal(receipt.count, 0);
  assert.notEqual(receipt.activeDraft, before);
});

test('commit failure changes neither metadata owner nor active draft', async () => {
  const env = makeEnv();
  const a = await addSample(env, SAMPLES.photo);
  const before = await env.persistence.getOrCreateActiveDraft();
  env.metaStore.failOn.commit = true;
  await assert.rejects(() => env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF), { code: 'MEDIA_STORAGE_COMMIT_FAILED' });
  assert.equal(env.metaStore.records.get(a.attachmentId).ownerType, 'draft');
  assert.equal(await env.persistence.getOrCreateActiveDraft(), before);
});

test('commit fails closed when an OPFS file is missing', async () => {
  const env = makeEnv();
  const a = await addSample(env, SAMPLES.photo);
  const before = await env.persistence.getOrCreateActiveDraft();
  env.blobStore.files.delete(a.attachmentId);
  await assert.rejects(() => env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF), { code: 'MEDIA_STORAGE_FILE_MISSING' });
  assert.equal(env.metaStore.records.get(a.attachmentId).ownerType, 'draft');
  assert.equal(await env.persistence.getOrCreateActiveDraft(), before);
});

async function commitFailClosed(setup, code) {
  const env = makeEnv();
  const sibling = await addSample(env, SAMPLES.photo);
  const before = await env.persistence.getOrCreateActiveDraft();
  const target = await addSample(env, SAMPLES.note);
  setup(env, target, before);
  const filesBefore = Array.from(env.blobStore.files.keys()).sort();
  await assert.rejects(() => env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF), { code });
  assert.equal(env.metaStore.records.get(sibling.attachmentId).ownerType, 'draft');
  assert.equal(env.metaStore.records.get(sibling.attachmentId).ownerRef, before);
  assert.equal(await env.persistence.getOrCreateActiveDraft(), before);
  assert.deepEqual(Array.from(env.blobStore.files.keys()).sort(), filesBefore);
}

test('commit rejects unknown status in the active draft; valid sibling stays draft', async () => {
  await commitFailClosed((env, t) => { env.metaStore.records.get(t.attachmentId).status = 'archived'; }, 'MEDIA_STORAGE_INVALID');
});

test('commit rejects unknown property in the active draft; valid sibling stays draft', async () => {
  await commitFailClosed((env, t) => { env.metaStore.records.get(t.attachmentId).objectUrl = 'blob:sample/1'; }, 'MEDIA_STORAGE_INVALID');
});

test('commit rejects a malformed active-draft row; valid sibling stays draft', async () => {
  await commitFailClosed((env, t) => { env.metaStore.records.set(t.attachmentId, { attachmentId: t.attachmentId, ownerRef: env.metaStore.records.get(t.attachmentId).ownerRef }); }, 'MEDIA_STORAGE_INVALID');
});

test('commit rejects a row whose ownerRef does not match the active draft', async () => {
  await commitFailClosed((env, t) => {
    const other = 'draft:123e4567-e89b-42d3-a456-426614174099';
    const listByOwner = env.metaStore.listByOwner;
    env.metaStore.listByOwner = async ref => (await listByOwner(ref)).map(r => (r.attachmentId === t.attachmentId ? Object.assign({}, r, { ownerRef: other }) : r));
  }, 'MEDIA_STORAGE_INVALID');
});

test('commit rejects OPFS size mismatch before binding; activeDraft unchanged', async () => {
  await commitFailClosed((env, t) => { env.blobStore.files.set(t.attachmentId, { size: t.size + 1, type: t.mime }); }, 'MEDIA_STORAGE_INVALID');
});

test('commit rejects a missing OPFS file before binding; valid sibling stays draft', async () => {
  await commitFailClosed((env, t) => { env.blobStore.files.delete(t.attachmentId); }, 'MEDIA_STORAGE_FILE_MISSING');
});

test('decideCommit: unpersisted item fails; no persistence + zero items skips; persistence + zero items commits', () => {
  const ids = new Set(['a']);
  assert.equal(M.decideCommit({ items: [{ id: 'a' }], persistedIds: ids, persistenceReady: true }), 'commit');
  assert.equal(M.decideCommit({ items: [{ id: 'a' }, { id: 'b' }], persistedIds: ids, persistenceReady: true }), 'fail');
  assert.equal(M.decideCommit({ items: [], persistedIds: new Set(), persistenceReady: true }), 'commit');
  assert.equal(M.decideCommit({ items: [], persistedIds: new Set(), persistenceReady: false }), 'skip');
  assert.equal(M.decideCommit({ items: [{ id: 'a' }], persistedIds: ids, persistenceReady: false }), 'fail');
});

test('media.js keeps a failed-persist attachment in memory without marking it persisted', () => {
  const src = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
  const start = src.indexOf('function addAttachment');
  const body = src.slice(start, src.indexOf('function bindFileInput', start));
  const catchBody = body.slice(body.indexOf('} catch (error) {'), body.indexOf('} finally {'));
  assert.match(catchBody, /store\.add\(blob/);
  assert.doesNotMatch(catchBody, /persistedIds\.add/);
  assert.match(src, /commitDraftToWorkOrder/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('この端末内に一時保存されます。外部には送信されません。'));
  assert.ok(!html.includes('画面を閉じると消えます'));
});

test('commit rejects an invalid workOrderRef', async () => {
  const env = makeEnv();
  await addSample(env, SAMPLES.photo);
  for (const ref of ['', 'local_123', 'dwo:1', 'draft:123e4567-e89b-42d3-a456-426614174000', null, undefined, 'dwo:123e4567-e89b-12d3-a456-426614174000']) {
    await assert.rejects(() => env.persistence.commitDraftToWorkOrder(ref), { code: 'MEDIA_STORAGE_INVALID' }, String(ref));
  }
  assert.equal(S.rebindMetadata(validMeta(), WORK_ORDER_REF).ownerRef, WORK_ORDER_REF);
  assert.throws(() => S.rebindMetadata(validMeta(), 'bad'), { code: 'MEDIA_STORAGE_INVALID' });
});

test('rebind skips invalid or already work-order metadata (fail closed)', () => {
  assert.equal(S.rebindMetadata(validMeta({ status: 'archived' }), WORK_ORDER_REF), null);
  assert.equal(S.rebindMetadata(validMeta({ objectUrl: 'blob:x' }), WORK_ORDER_REF), null);
  assert.equal(S.rebindMetadata(validMeta({ ownerType: 'work-order', ownerRef: WORK_ORDER_REF }), WORK_ORDER_REF), null);
});

test('commit does not pull in metadata owned by other drafts or work orders', async () => {
  const env = makeEnv();
  await addSample(env, SAMPLES.photo);
  const foreign = validMeta({ attachmentId: 'att-123e4567-e89b-42d3-a456-426614174010', opfsName: 'att-123e4567-e89b-42d3-a456-426614174010' });
  env.metaStore.records.set(foreign.attachmentId, foreign);
  env.blobStore.files.set(foreign.opfsName, realBlob(SAMPLES.note));
  const receipt = await env.persistence.commitDraftToWorkOrder(WORK_ORDER_REF);
  assert.equal(receipt.count, 1);
  assert.equal(env.metaStore.records.get(foreign.attachmentId).ownerType, 'draft');
});

test('active draft setting is created once, reused, and repaired when invalid', async () => {
  const env = makeEnv();
  const first = await env.persistence.getOrCreateActiveDraft();
  assert.equal(await env.persistence.getOrCreateActiveDraft(), first);
  env.metaStore.settings.set('activeDraft', { key: 'activeDraft', value: 'clinic-a' });
  const repaired = await env.persistence.getOrCreateActiveDraft();
  assert.notEqual(repaired, first);
  assert.equal(S.isValidDraftRef(repaired), true);
});

test('unavailable randomness makes persistence unavailable (safe side)', async () => {
  const blobStore = S.createMemoryBlobStore();
  const metaStore = S.createMemoryMetaStore();
  const persistence = S.createPersistence({ blobStore, metaStore, crypto: {} });
  await assert.rejects(() => persistence.getOrCreateActiveDraft(), { code: 'MEDIA_STORAGE_UNAVAILABLE' });
  await assert.rejects(() => persistence.persistAttachment({ blob: fakeBlob(SAMPLES.photo), source: 'file-picker', kind: 'image', name: 'photo-sample.jpg' }), { code: 'MEDIA_STORAGE_UNAVAILABLE' });
  assert.equal(blobStore.files.size, 0);
});

test('unsupported environments yield an unavailable persistence with a Japanese message', async () => {
  assert.equal(S.supportsOpfs({}), false);
  assert.equal(S.supportsOpfs({ navigator: { storage: { getDirectory() {} } } }), false);
  const noIdb = S.createBrowserPersistence({ navigator: {} });
  assert.equal(noIdb.available, false);
  const noOpfs = S.createBrowserPersistence({ indexedDB: {}, navigator: {} });
  assert.equal(noOpfs.available, false);
  assert.equal(noOpfs.reason, 'opfs-unsupported');
  await assert.rejects(() => noOpfs.commitDraftToWorkOrder(WORK_ORDER_REF), error => {
    assert.equal(error.code, 'MEDIA_STORAGE_UNAVAILABLE');
    assert.equal(error.userMessage, 'このブラウザでは添付を安全に保存できないため受注へ反映できません');
    return true;
  });
  await assert.rejects(() => noOpfs.persistAttachment({}), { code: 'MEDIA_STORAGE_UNAVAILABLE' });
  assert.equal(S.createBrowserPersistence({ indexedDB: {}, navigator: { storage: { getDirectory() {} } }, FileSystemFileHandle: { prototype: { createWritable() {} } } }).available, true);
});

test('modules load without DOM, expose globals, and media-storage stays local-only', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(globalThis.ReferenceMediaStorage, S);
  assert.equal(globalThis.ReferenceMediaManager, M);
  const src = fs.readFileSync(path.join(root, 'media-storage.js'), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|subtle|createObjectURL|collectFormData/);
  const ui = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
  assert.doesNotMatch(ui, /indexedDB|getDirectory|FileSystemFileHandle/);
});

test('media store keeps provided id / createdAt for restored items and defaults otherwise', () => {
  const urlApi = { createObjectURL: () => 'blob:sample/1', revokeObjectURL() {} };
  const store = M.createAttachmentStore(urlApi);
  const item = store.add(fakeBlob(SAMPLES.photo), { id: 'att-123e4567-e89b-42d3-a456-426614174020', createdAt: 1700000000000 });
  assert.equal(item.id, 'att-123e4567-e89b-42d3-a456-426614174020');
  assert.equal(item.createdAt, 1700000000000);
  const plain = store.add(fakeBlob(SAMPLES.note));
  assert.match(plain.id, /^media-/);
  assert.equal(typeof M.hasAttachments, 'function');
  assert.deepEqual(Object.keys(item).filter(k => /url/i.test(k)), ['objectUrl']);
});

test('without DOM, the manager commit is a no-op for zero attachments', async () => {
  assert.equal(M.hasAttachments(), false);
  assert.deepEqual(await M.commitCurrentDraft(WORK_ORDER_REF), { committed: 0 });
});

test('index.html loads media-storage.js exactly once, before media.js', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const storageAt = html.indexOf('<script src="media-storage.js"></script>');
  const mediaAt = html.indexOf('<script src="media.js"></script>');
  assert.ok(storageAt > 0 && mediaAt > storageAt);
  assert.equal(html.split('<script src="media-storage.js"></script>').length, 2);
});

test('submit binds attachments after workOrderRef and before state.orders; failure returns early', () => {
  const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const validateAt = src.indexOf('const errors = validate(data)');
  const refAt = src.indexOf('data.workOrderRef = generateWorkOrderRef()');
  const commitAt = src.indexOf('await ReferenceMediaManager.commitCurrentDraft(data.workOrderRef)');
  const unshiftAt = src.indexOf('state.orders.unshift(data)');
  const resetAt = src.indexOf('resetForm();', unshiftAt);
  assert.ok(validateAt > 0 && refAt > validateAt && commitAt > refAt && unshiftAt > commitAt && resetAt > unshiftAt);
  const failure = src.slice(commitAt, unshiftAt);
  assert.match(failure, /catch \(error\)[\s\S]*showToast\([\s\S]*'error'\)[\s\S]*return;/);
  assert.match(src, /if \(submitInFlight\) return;/);
});

test('media.js commit fails closed for unpersisted attachments and clears UI only after commit', () => {
  const src = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
  const commitAt = src.indexOf('helpers.commitCurrentDraft = workOrderRef =>');
  const body = src.slice(commitAt, src.indexOf('render();\n    if (persistenceReady)', commitAt));
  assert.match(body, /decideCommit\(/);
  assert.ok(body.indexOf('commitDraftToWorkOrder') < body.indexOf('store.clear()'));
  // pagehideはURL/録音のみ解放し、永続データは消さない
  const releaseAt = src.indexOf('function releaseAll()');
  const release = src.slice(releaseAt, src.indexOf("global.addEventListener('pagehide'", releaseAt));
  assert.doesNotMatch(release, /removeAttachment|commitDraftToWorkOrder|deleteAttachment/);
});

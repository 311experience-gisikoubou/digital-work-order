const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const test = require('node:test');
const S = require('../media-storage.js');

const DRAFT_REF = 'draft:123e4567-e89b-42d3-a456-426614174050';
const WORK_ORDER_REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';

function makeEnv() {
  const blobStore = S.createMemoryBlobStore();
  const metaStore = S.createMemoryMetaStore();
  const persistence = S.createPersistence({ blobStore, metaStore, crypto: webcrypto });
  return { blobStore, metaStore, persistence };
}

async function add(env, name = 'sample.pdf') {
  return env.persistence.persistAttachment({
    blob: { size: 1234, type: 'application/pdf' },
    source: 'file-picker',
    kind: 'file',
    name,
    draftRef: DRAFT_REF
  });
}

test('Stage 5 compensation restores committed media to the original draft owner', async () => {
  const env = makeEnv();
  const a = await add(env, 'sample-a.pdf');
  const b = await add(env, 'sample-b.pdf');
  const filesBefore = [...env.blobStore.files.keys()].sort();

  const committed = await env.persistence.commitDraftToWorkOrder(DRAFT_REF, WORK_ORDER_REF);
  assert.equal(committed.count, 2);

  const rolledBack = await env.persistence.rollbackWorkOrderToDraft(WORK_ORDER_REF, DRAFT_REF);
  assert.equal(rolledBack.count, 2);
  for (const meta of [a, b]) {
    const stored = env.metaStore.records.get(meta.attachmentId);
    assert.equal(stored.ownerType, 'draft');
    assert.equal(stored.ownerRef, DRAFT_REF);
    assert.equal(S.isValidMetadata(stored), true);
  }
  assert.deepEqual([...env.blobStore.files.keys()].sort(), filesBefore);
});

test('compensation failure keeps metadata bound to the issued work order', async () => {
  const env = makeEnv();
  const a = await add(env);
  await env.persistence.commitDraftToWorkOrder(DRAFT_REF, WORK_ORDER_REF);
  env.metaStore.failOn.commit = true;

  await assert.rejects(
    () => env.persistence.rollbackWorkOrderToDraft(WORK_ORDER_REF, DRAFT_REF),
    { code: 'MEDIA_STORAGE_COMMIT_FAILED' }
  );
  const stored = env.metaStore.records.get(a.attachmentId);
  assert.equal(stored.ownerType, 'work-order');
  assert.equal(stored.ownerRef, WORK_ORDER_REF);
});

test('compensation rejects invalid refs and only reverses work-order metadata', async () => {
  const env = makeEnv();
  await assert.rejects(
    () => env.persistence.rollbackWorkOrderToDraft('bad', DRAFT_REF),
    { code: 'MEDIA_STORAGE_INVALID' }
  );
  await assert.rejects(
    () => env.persistence.rollbackWorkOrderToDraft(WORK_ORDER_REF, 'bad'),
    { code: 'MEDIA_STORAGE_INVALID' }
  );
  const draftMeta = S.buildMetadata({
    attachmentId: 'att-123e4567-e89b-42d3-a456-426614174001',
    ownerRef: DRAFT_REF,
    source: 'file-picker',
    kind: 'file',
    name: 'sample.pdf',
    mime: 'application/pdf',
    size: 1,
    createdAt: 1
  });
  assert.equal(S.rebindMetadataToDraft(draftMeta, DRAFT_REF), null);
});

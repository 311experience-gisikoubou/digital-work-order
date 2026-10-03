import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  RECEIVER_API_VERSION,
  acknowledgeReceiverJob,
  authenticateReceiver,
  createReceiverDownloadPlan,
  listReadyReceiverJobs
} from '../cloud/receiver-core.mjs';

const TOKEN = 'A'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');
const RK = 'rk_' + 'B'.repeat(43);
const JOB = 'job_' + 'C'.repeat(43);
const HASH0 = '0'.repeat(64);
const HASH1 = '1'.repeat(64);
const HASH2 = '2'.repeat(64);
const ACK_PROOF = 'a'.repeat(64);
const ACK_PROOF_HASH = createHash('sha256').update(ACK_PROOF).digest('hex');

function readyJob() {
  return {
    version: 'dwo-relay-v1',
    jobId: JOB,
    status: 'ready',
    descriptorSha256: 'd'.repeat(64),
    planSha256: 'e'.repeat(64),
    senderClinicDeviceId: 'dev_' + 'D'.repeat(22),
    senderSigningKeyId: 'sk_' + 'E'.repeat(43),
    recipientKeyId: RK,
    totalBytes: 333,
    objectSpecs: [
      { ordinal: 0, objectName: 'relay/v1/' + JOB + '/o/0000.bin', size: 111, ciphertextSha256: HASH0 },
      { ordinal: 1, objectName: 'relay/v1/' + JOB + '/o/0001.bin', size: 112, ciphertextSha256: HASH1 },
      { ordinal: 2, objectName: 'relay/v1/' + JOB + '/o/0002.bin', size: 110, ciphertextSha256: HASH2 }
    ],
    receiverAckProofHash: ACK_PROOF_HASH,
    receiverBootstrap: {
      version: 'dwo-receiver-bootstrap-v1',
      recipientKeyId: RK,
      ephemeralPublicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      hkdfSalt: 'salt_value',
      iv: 'iv_value',
      ciphertextSha256: HASH0,
      ciphertextSize: 111
    },
    createdAt: 1000,
    readyAt: 2000,
    expiresAt: 3000
  };
}

function makeDeps(options = {}) {
  const job = structuredClone(options.job || readyJob());
  const jobs = new Map([[job.jobId, job]]);
  const objects = new Set(job.objectSpecs.map(spec => spec.objectName));
  objects.add('relay/v1/job_UNRELATED/o/0000.bin');
  let deleteCalls = 0;
  let failDeleteCall = options.failDeleteCall || null;

  const jobStore = {
    async listReady(recipientKeyId) {
      const current = jobs.get(JOB);
      const legacy = current ? { ...structuredClone(current), receiverBootstrap: null } : null;
      return recipientKeyId === RK && current ? [legacy, current] : [];
    },
    async listPending(recipientKeyId) {
      const current = jobs.get(JOB);
      if (recipientKeyId !== RK || !current) return [];
      const legacy = current.status === 'ready' ? { ...structuredClone(current), receiverBootstrap: null } : null;
      return legacy ? [legacy, current] : [current];
    },
    async get(jobId) {
      return jobs.get(jobId) || null;
    },
    async issueAckCapability(jobId, recipientKeyId, capabilityHash) {
      const current = jobs.get(jobId);
      if (!current || current.status !== 'ready' || current.recipientKeyId !== recipientKeyId) {
        throw Object.assign(new Error('incompatible'), { code: 'RECEIVER_JOB_NOT_COMPATIBLE' });
      }
      const hashes = Array.isArray(current.ackCapabilityHashes) ? current.ackCapabilityHashes : [];
      if (!hashes.includes(capabilityHash)) hashes.push(capabilityHash);
      current.ackCapabilityHashes = hashes.slice(-4);
      return { issued: true };
    },
    async beginDelete(jobId, recipientKeyId, capabilityHash, ackProofHash, deletionNonce, startedAt) {
      const current = jobs.get(jobId);
      if (!current) return { missing: true };
      if (current.recipientKeyId !== recipientKeyId) {
        throw Object.assign(new Error('incompatible'), { code: 'RECEIVER_JOB_NOT_COMPATIBLE' });
      }
      if (current.status === 'deleting') return { record: current };
      if (current.status !== 'ready') {
        throw Object.assign(new Error('bad state'), { code: 'RECEIVER_DELETE_STATE_INVALID' });
      }
      if (!Array.isArray(current.ackCapabilityHashes) || !current.ackCapabilityHashes.includes(capabilityHash) ||
          current.receiverAckProofHash !== ackProofHash) {
        throw Object.assign(new Error('bad cap'), { code: 'RECEIVER_ACK_CAPABILITY_INVALID' });
      }
      current.status = 'deleting';
      current.deletionNonce = deletionNonce;
      current.deletionStartedAt = startedAt;
      current.updatedAt = startedAt;
      delete current.ackCapabilityHashes;
      return { record: current };
    },
    async finalizeDelete(jobId, recipientKeyId, deletionNonce) {
      const current = jobs.get(jobId);
      if (!current) return { missing: true };
      if (current.status !== 'deleting' || current.recipientKeyId !== recipientKeyId ||
          current.deletionNonce !== deletionNonce) {
        throw Object.assign(new Error('bad state'), { code: 'RECEIVER_DELETE_STATE_INVALID' });
      }
      jobs.delete(jobId);
      return { deleted: true };
    }
  };

  const storage = {
    async createReadUrl(spec) {
      return 'https://storage.test/read/' + encodeURIComponent(spec.objectName);
    },
    async deleteObject(objectName) {
      deleteCalls += 1;
      if (failDeleteCall && deleteCalls === failDeleteCall) {
        failDeleteCall = null;
        throw Object.assign(new Error('simulated delete failure'), { code: 'SIMULATED_DELETE_FAILURE' });
      }
      objects.delete(objectName);
      return { deleted: true };
    },
    async statObject(objectName) {
      return { exists: objects.has(objectName) };
    }
  };

  return {
    jobs,
    objects,
    get deleteCalls() { return deleteCalls; },
    deps: { jobStore, storage }
  };
}

test('receiver bearer authentication stores/compares only sha256 hash', () => {
  assert.deepEqual(
    authenticateReceiver('Bearer ' + TOKEN, TOKEN_HASH, RK),
    { recipientKeyId: RK }
  );
  assert.throws(
    () => authenticateReceiver('Bearer ' + 'Z'.repeat(43), TOKEN_HASH, RK),
    { code: 'RECEIVER_AUTH_INVALID' }
  );
  assert.throws(
    () => authenticateReceiver('', TOKEN_HASH, RK),
    { code: 'RECEIVER_AUTH_REQUIRED' }
  );
});

test('pending list filters legacy jobs and marks ready/deleting state explicitly', async () => {
  const state = makeDeps();
  const result = await listReadyReceiverJobs(RK, state.deps, { limit: 10 });
  assert.equal(result.version, RECEIVER_API_VERSION);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.jobs[0], {
    jobId: JOB,
    status: 'ready',
    recipientKeyId: RK,
    totalBytes: 333,
    objectCount: 3,
    createdAt: 1000,
    readyAt: 2000
  });

  const current = state.jobs.get(JOB);
  current.status = 'deleting';
  current.deletionNonce = 'del_' + 'Q'.repeat(22);
  current.deletionStartedAt = 2500;
  const retry = await listReadyReceiverJobs(RK, state.deps, { limit: 10 });
  assert.equal(retry.jobs.length, 1);
  assert.equal(retry.jobs[0].status, 'deleting');
});

test('download plan exposes opaque URLs + one-time ACK capability and persists only its hash', async () => {
  const state = makeDeps();
  const result = await createReceiverDownloadPlan(JOB, RK, state.deps, { ttlMs: 120000 });
  assert.equal(result.version, RECEIVER_API_VERSION);
  assert.equal(result.jobId, JOB);
  assert.match(result.ackCapability, /^[A-Za-z0-9_-]{40,200}$/);
  assert.equal(result.objects.length, 3);
  result.objects.forEach((item, index) => {
    assert.equal(item.ordinal, index);
    assert.equal('objectName' in item, false);
    assert.match(item.downloadUrl, /^https:\/\/storage\.test\/read\//);
  });
  const record = state.jobs.get(JOB);
  assert.equal(JSON.stringify(record).includes(result.ackCapability), false);
  assert.ok(record.ackCapabilityHashes.includes(createHash('sha256').update(result.ackCapability).digest('hex')));

  const visible = JSON.stringify(result);
  assert.equal(visible.includes('workOrderRef'), false);
  assert.equal(visible.includes('patientName'), false);
  assert.equal(visible.includes('clinicName'), false);
  assert.equal(visible.includes('attachmentId'), false);
});

test('receiver cannot list or download another recipient key job', async () => {
  const state = makeDeps();
  const other = 'rk_' + 'Q'.repeat(43);
  const list = await listReadyReceiverJobs(other, state.deps, { limit: 10 });
  assert.equal(list.jobs.length, 0);
  await assert.rejects(
    () => createReceiverDownloadPlan(JOB, other, state.deps),
    { code: 'RECEIVER_JOB_NOT_COMPATIBLE' }
  );
});

test('wrong ACK capability deletes nothing; valid ACK deletes exact job objects and metadata only', async () => {
  const state = makeDeps();
  const plan = await createReceiverDownloadPlan(JOB, RK, state.deps, { ttlMs: 120000 });
  const before = new Set(state.objects);

  await assert.rejects(
    () => acknowledgeReceiverJob(JOB, RK, 'Z'.repeat(43), ACK_PROOF, state.deps, { now: () => 3000 }),
    { code: 'RECEIVER_ACK_CAPABILITY_INVALID' }
  );
  assert.deepEqual(state.objects, before);
  assert.equal(state.jobs.get(JOB).status, 'ready');

  await assert.rejects(
    () => acknowledgeReceiverJob(JOB, RK, plan.ackCapability, 'b'.repeat(64), state.deps, { now: () => 3000 }),
    { code: 'RECEIVER_ACK_CAPABILITY_INVALID' }
  );
  assert.deepEqual(state.objects, before);
  assert.equal(state.jobs.get(JOB).status, 'ready');

  const result = await acknowledgeReceiverJob(JOB, RK, plan.ackCapability, ACK_PROOF, state.deps, { now: () => 3000 });
  assert.deepEqual(result, { version: RECEIVER_API_VERSION, jobId: JOB, status: 'deleted' });
  assert.equal(state.jobs.has(JOB), false);
  assert.equal(state.objects.has('relay/v1/job_UNRELATED/o/0000.bin'), true);
  assert.equal(state.objects.size, 1);
});

test('partial delete keeps deleting metadata and resumes without ACK capability on next attempt', async () => {
  const state = makeDeps({ failDeleteCall: 2 });
  const plan = await createReceiverDownloadPlan(JOB, RK, state.deps, { ttlMs: 120000 });

  await assert.rejects(
    () => acknowledgeReceiverJob(JOB, RK, plan.ackCapability, ACK_PROOF, state.deps, { now: () => 3100 }),
    { code: 'SIMULATED_DELETE_FAILURE' }
  );
  const pending = state.jobs.get(JOB);
  assert.equal(pending.status, 'deleting');
  assert.equal('ackCapabilityHashes' in pending, false);
  assert.equal(state.objects.has(pending.objectSpecs[0].objectName), false);
  assert.equal(state.objects.has(pending.objectSpecs[1].objectName), true);

  const resumed = await acknowledgeReceiverJob(JOB, RK, undefined, undefined, state.deps, { now: () => 3200 });
  assert.equal(resumed.status, 'deleted');
  assert.equal(state.jobs.has(JOB), false);
  assert.equal(state.objects.has('relay/v1/job_UNRELATED/o/0000.bin'), true);
});

test('ACK after metadata is already gone is idempotent and performs no delete', async () => {
  const state = makeDeps();
  state.jobs.delete(JOB);
  const result = await acknowledgeReceiverJob(JOB, RK, undefined, undefined, state.deps, { now: () => 3300 });
  assert.equal(result.status, 'deleted');
  assert.equal(state.deleteCalls, 0);
});

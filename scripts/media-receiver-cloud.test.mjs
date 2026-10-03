import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  RECEIVER_API_VERSION,
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

function deps(job = readyJob()) {
  return {
    jobStore: {
      async listReady(recipientKeyId) {
        const legacy = { ...job, receiverBootstrap: null };
        return recipientKeyId === job.recipientKeyId ? [legacy, job] : [];
      },
      async get(jobId) {
        return jobId === job.jobId ? job : null;
      }
    },
    storage: {
      async createReadUrl(spec) {
        return 'https://storage.test/read/' + encodeURIComponent(spec.objectName);
      }
    }
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

test('ready list filters legacy jobs without encrypted receiver bootstrap', async () => {
  const result = await listReadyReceiverJobs(RK, deps(), { limit: 10 });
  assert.equal(result.version, RECEIVER_API_VERSION);
  assert.equal(result.jobs.length, 1);
  assert.deepEqual(result.jobs[0], {
    jobId: JOB,
    recipientKeyId: RK,
    totalBytes: 333,
    objectCount: 3,
    createdAt: 1000,
    readyAt: 2000
  });
});

test('download plan exposes only bootstrap routing metadata and opaque signed URLs', async () => {
  const result = await createReceiverDownloadPlan(JOB, RK, deps(), { ttlMs: 120000 });
  assert.equal(result.version, RECEIVER_API_VERSION);
  assert.equal(result.jobId, JOB);
  assert.equal(result.objects.length, 3);
  result.objects.forEach((item, index) => {
    assert.equal(item.ordinal, index);
    assert.equal('objectName' in item, false);
    assert.match(item.downloadUrl, /^https:\/\/storage\.test\/read\//);
  });
  const visible = JSON.stringify(result);
  assert.equal(visible.includes('workOrderRef'), false);
  assert.equal(visible.includes('patientName'), false);
  assert.equal(visible.includes('clinicName'), false);
  assert.equal(visible.includes('attachmentId'), false);
});

test('receiver cannot list or download another recipient key job', async () => {
  const other = 'rk_' + 'Q'.repeat(43);
  const list = await listReadyReceiverJobs(other, deps(), { limit: 10 });
  assert.equal(list.jobs.length, 0);
  await assert.rejects(
    () => createReceiverDownloadPlan(JOB, other, deps()),
    { code: 'RECEIVER_JOB_NOT_COMPATIBLE' }
  );
});

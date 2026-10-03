import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { completeRelayJob, createRelayJob } from '../cloud/relay-core.mjs';
import {
  acknowledgeReceiverJob,
  authenticateReceiver,
  createReceiverDownloadPlan,
  listReadyReceiverJobs
} from '../cloud/receiver-core.mjs';
import { computeAckProof, receiveOnce } from '../gateway/receiver-core.mjs';

const require = createRequire(import.meta.url);
const T = require('../media-transfer-package.js');
const C = require('../media-transfer-crypto.js');
const B = require('../media-receiver-bootstrap.js');
const R = require('../media-relay.js');

const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const ATT = 'att-123e4567-e89b-42d3-a456-426614174001';
const PATIENT = '架空患者Gateway';
const CLINIC = '架空医院Gateway';
const TOKEN = 'T'.repeat(43);
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex');

function bufferArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function buildFixture() {
  const recipient = await C.generateRecipientIdentity('gateway-e2e-passphrase', { crypto: webcrypto });
  const sender = await C.generateSenderIdentity({ crypto: webcrypto });
  const offer = await C.createPairingOffer(recipient, { crypto: webcrypto, now: () => 1000 });
  const response = await C.createPairingResponse(offer, sender, { crypto: webcrypto, now: () => 1001 });
  const fullRegistry = await C.verifyPairingResponse(offer, response, { crypto: webcrypto, now: () => 1002 });
  const cloudRegistry = {
    version: fullRegistry.version,
    clinicDeviceId: fullRegistry.clinicDeviceId,
    status: fullRegistry.status,
    pairedRecipientKeyId: fullRegistry.pairedRecipientKeyId,
    activeSigningKey: fullRegistry.activeSigningKey,
    updatedAt: fullRegistry.updatedAt
  };

  const mediaBytes = Uint8Array.from([11,12,13,14,15,16,17,18,19,20]);
  const pkg = await T.buildPackage(
    REF,
    { workOrderRef: REF, patientName: PATIENT, clinicName: CLINIC, issueDate: '2026-10-03' },
    [{
      meta: { attachmentId: ATT, kind: 'image', mime: 'image/jpeg', size: mediaBytes.length, name: 'patient-secret.jpg' },
      blob: new Blob([mediaBytes], { type: 'image/jpeg' })
    }],
    { crypto: webcrypto, chunkSize: 4, now: () => 2000 }
  );
  const envelope = await C.encryptPackage(pkg, sender, recipient, { crypto: webcrypto, now: () => 2100 });
  const built = await R.buildCreateRequest(envelope, sender, {
    crypto: webcrypto,
    now: () => 2200,
    recipientPublicInfo: recipient,
    bootstrapApi: B
  });
  return { recipient, sender, fullRegistry, cloudRegistry, built, mediaBytes };
}

function makeRelayState(cloudRegistry) {
  const jobs = new Map();
  const sessions = new Map();
  const objects = new Map();

  const jobStore = {
    async reserve(jobId, record) {
      if (jobs.has(jobId)) return { created: false, record: jobs.get(jobId) };
      const copy = structuredClone(record);
      jobs.set(jobId, copy);
      return { created: true, record: copy };
    },
    async get(jobId) {
      return jobs.get(jobId) || null;
    },
    async listReady(recipientKeyId, limit) {
      return [...jobs.values()]
        .filter(job => job.recipientKeyId === recipientKeyId && job.status === 'ready')
        .slice(0, limit);
    },
    async listPending(recipientKeyId, limit) {
      return [...jobs.values()]
        .filter(job => job.recipientKeyId === recipientKeyId && (job.status === 'ready' || job.status === 'deleting'))
        .slice(0, limit);
    },
    async issueAckCapability(jobId, recipientKeyId, capabilityHash) {
      const job = jobs.get(jobId);
      if (!job || job.status !== 'ready' || job.recipientKeyId !== recipientKeyId) {
        throw Object.assign(new Error('incompatible'), { code: 'RECEIVER_JOB_NOT_COMPATIBLE' });
      }
      const hashes = Array.isArray(job.ackCapabilityHashes) ? job.ackCapabilityHashes : [];
      if (!hashes.includes(capabilityHash)) hashes.push(capabilityHash);
      job.ackCapabilityHashes = hashes.slice(-4);
      return { issued: true };
    },
    async beginDelete(jobId, recipientKeyId, capabilityHash, ackProofHash, deletionNonce, startedAt) {
      const job = jobs.get(jobId);
      if (!job) return { missing: true };
      if (job.recipientKeyId !== recipientKeyId) {
        throw Object.assign(new Error('incompatible'), { code: 'RECEIVER_JOB_NOT_COMPATIBLE' });
      }
      if (job.status === 'deleting') return { record: job };
      if (job.status !== 'ready') {
        throw Object.assign(new Error('bad state'), { code: 'RECEIVER_DELETE_STATE_INVALID' });
      }
      if (!Array.isArray(job.ackCapabilityHashes) || !job.ackCapabilityHashes.includes(capabilityHash) ||
          job.receiverAckProofHash !== ackProofHash) {
        throw Object.assign(new Error('bad cap'), { code: 'RECEIVER_ACK_CAPABILITY_INVALID' });
      }
      job.status = 'deleting';
      job.deletionNonce = deletionNonce;
      job.deletionStartedAt = startedAt;
      job.updatedAt = startedAt;
      delete job.ackCapabilityHashes;
      return { record: job };
    },
    async finalizeDelete(jobId, recipientKeyId, deletionNonce) {
      const job = jobs.get(jobId);
      if (!job) return { missing: true };
      if (job.status !== 'deleting' || job.recipientKeyId !== recipientKeyId || job.deletionNonce !== deletionNonce) {
        throw Object.assign(new Error('bad state'), { code: 'RECEIVER_DELETE_STATE_INVALID' });
      }
      jobs.delete(jobId);
      return { deleted: true };
    },
    async setUploads(jobId, uploads, capabilityHash) {
      const job = jobs.get(jobId);
      if (!job.uploads) job.uploads = structuredClone(uploads);
      const hashes = Array.isArray(job.capabilityHashes) ? job.capabilityHashes : [];
      if (!hashes.includes(capabilityHash)) hashes.push(capabilityHash);
      job.capabilityHashes = hashes.slice(-4);
      return { uploads: structuredClone(job.uploads) };
    },
    async markReady(jobId, detail) {
      const job = jobs.get(jobId);
      job.status = 'ready';
      job.readyAt = detail.readyAt;
      delete job.uploads;
      delete job.capabilityHashes;
    }
  };

  const storage = {
    async createResumableUpload(spec) {
      const url = 'https://upload.test/' + encodeURIComponent(spec.objectName);
      sessions.set(url, structuredClone(spec));
      return url;
    },
    async statObject(objectName) {
      const item = objects.get(objectName);
      if (!item) return { exists: false, size: 0, metadata: {} };
      return { exists: true, size: item.buffer.length, metadata: item.metadata };
    },
    async createReadUrl(spec) {
      return 'https://download.test/' + encodeURIComponent(spec.objectName);
    },
    async deleteObject(objectName) {
      objects.delete(objectName);
      return { deleted: true };
    }
  };

  return {
    jobs,
    sessions,
    objects,
    deps: {
      registryStore: { async getSender() { return cloudRegistry; } },
      jobStore,
      storage
    }
  };
}

async function uploadBuiltParts(state, built, created) {
  for (const part of built.parts) {
    const target = created.uploads.find(item => item.slot === part.slot);
    assert.ok(target);
    const session = state.sessions.get(target.uploadUrl);
    assert.ok(session);
    const buffer = Buffer.from(await part.blob.arrayBuffer());
    assert.equal(buffer.length, session.size);
    state.objects.set(session.objectName, { buffer, metadata: session.metadata });
  }
}

function makeFetch(state, recipientKeyId, behavior = {}) {
  const tamperOrdinal = behavior.tamperOrdinal === undefined ? null : behavior.tamperOrdinal;
  let failAckRemaining = behavior.failAckOnce ? 1 : 0;
  return async (url, options = {}) => {
    if (url === 'https://relay.test/v1/receiver/jobs:list') {
      authenticateReceiver(options.headers.Authorization, TOKEN_HASH, recipientKeyId);
      const body = JSON.parse(options.body);
      const result = await listReadyReceiverJobs(recipientKeyId, state.deps, { limit: body.limit });
      return { ok: true, status: 200, async json() { return result; } };
    }
    const prefix = 'https://relay.test/v1/receiver/jobs/';
    if (url.startsWith(prefix) && url.endsWith(':download')) {
      authenticateReceiver(options.headers.Authorization, TOKEN_HASH, recipientKeyId);
      const jobId = decodeURIComponent(url.slice(prefix.length, -':download'.length));
      const result = await createReceiverDownloadPlan(jobId, recipientKeyId, state.deps, { ttlMs: 120000 });
      return { ok: true, status: 200, async json() { return result; } };
    }
    if (url.startsWith(prefix) && url.endsWith(':ack')) {
      authenticateReceiver(options.headers.Authorization, TOKEN_HASH, recipientKeyId);
      if (failAckRemaining > 0) {
        failAckRemaining -= 1;
        throw new Error('simulated ack network failure');
      }
      const jobId = decodeURIComponent(url.slice(prefix.length, -':ack'.length));
      const body = JSON.parse(options.body);
      const result = await acknowledgeReceiverJob(
        jobId,
        recipientKeyId,
        body.ackCapability,
        body.ackProof,
        state.deps,
        { now: () => 2700 }
      );
      return { ok: true, status: 200, async json() { return result; } };
    }
    if (url.startsWith('https://download.test/')) {
      const objectName = decodeURIComponent(url.slice('https://download.test/'.length));
      const item = state.objects.get(objectName);
      if (!item) return { ok: false, status: 404, async arrayBuffer() { return new ArrayBuffer(0); } };
      let buffer = Buffer.from(item.buffer);
      const match = /\/o\/(\d{4})\.bin$/.exec(objectName);
      const ordinal = match ? Number(match[1]) : -1;
      if (tamperOrdinal === ordinal) {
        buffer = Buffer.from(buffer);
        buffer[0] ^= 1;
      }
      return { ok: true, status: 200, async arrayBuffer() { return bufferArrayBuffer(buffer); } };
    }
    throw new Error('unexpected URL: ' + url);
  };
}

test('synthetic Phase7 end-to-end stores locally, ACKs, then deletes cloud ciphertext and job metadata', async () => {
  const fixture = await buildFixture();
  const state = makeRelayState(fixture.cloudRegistry);
  const created = await createRelayJob(fixture.built.request, state.deps, { crypto: webcrypto, now: () => 2300 });
  await uploadBuiltParts(state, fixture.built, created);
  await completeRelayJob(created.jobId, created.uploadCapability, state.deps, { crypto: webcrypto, now: () => 2400 });

  const cloudRecordText = JSON.stringify(state.jobs.get(created.jobId));
  for (const secret of [REF, ATT, PATIENT, CLINIC, 'patient-secret.jpg']) {
    assert.equal(cloudRecordText.includes(secret), false);
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-gateway-e2e-'));
  try {
    const options = {
      endpoint: 'https://relay.test',
      token: TOKEN,
      fetch: makeFetch(state, fixture.recipient.recipientKeyId),
      recipientKeyRingOrIdentity: fixture.recipient,
      senderRegistries: { version: 'dwo-gateway-sender-registry-v1', senders: [fixture.fullRegistry] },
      inboxRoot: root,
      crypto: webcrypto,
      now: () => 2500
    };
    const first = await receiveOnce(options);
    assert.equal(first.checked, 1);
    assert.equal(first.results[0].status, 'stored');
    assert.equal(first.results[0].cloudStatus, 'deleted');
    assert.equal(first.results[0].workOrderRef, REF);

    const finalDir = path.join(root, created.jobId);
    const entries = await fs.readdir(finalDir, { recursive: true });
    const allPaths = entries.join('\n');
    assert.equal(allPaths.includes(PATIENT), false);
    assert.equal(allPaths.includes(CLINIC), false);
    assert.equal(allPaths.includes(REF), false);
    assert.ok(entries.some(name => String(name).includes(ATT + '.jpg')));

    const workOrderText = await fs.readFile(path.join(finalDir, 'work-order.json'), 'utf8');
    assert.ok(workOrderText.includes(PATIENT));
    assert.ok(workOrderText.includes(CLINIC));
    const media = await fs.readFile(path.join(finalDir, 'media', ATT + '.jpg'));
    assert.deepEqual([...media], [...fixture.mediaBytes]);

    const receipt = JSON.parse(await fs.readFile(path.join(finalDir, 'receipt.json'), 'utf8'));
    assert.equal(receipt.jobId, created.jobId);
    assert.equal(receipt.workOrderRef, REF);
    assert.equal(receipt.receivedAt, 2500);

    assert.equal(state.jobs.has(created.jobId), false);
    assert.equal(state.objects.size, 0);

    const second = await receiveOnce(options);
    assert.equal(second.checked, 0);
    assert.deepEqual(second.results, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ciphertext tamper fails before local persistence and leaves no completed job directory', async () => {
  const fixture = await buildFixture();
  const state = makeRelayState(fixture.cloudRegistry);
  const created = await createRelayJob(fixture.built.request, state.deps, { crypto: webcrypto, now: () => 2300 });
  await uploadBuiltParts(state, fixture.built, created);
  await completeRelayJob(created.jobId, created.uploadCapability, state.deps, { crypto: webcrypto, now: () => 2400 });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-gateway-tamper-'));
  try {
    const result = await receiveOnce({
      endpoint: 'https://relay.test',
      token: TOKEN,
      fetch: makeFetch(state, fixture.recipient.recipientKeyId, { tamperOrdinal: 1 }),
      recipientKeyRingOrIdentity: fixture.recipient,
      senderRegistries: { version: 'dwo-gateway-sender-registry-v1', senders: [fixture.fullRegistry] },
      inboxRoot: root,
      crypto: webcrypto,
      now: () => 2600
    });
    assert.equal(result.results[0].status, 'failed');
    assert.equal(result.results[0].errorCode, 'GATEWAY_OBJECT_HASH_MISMATCH');
    await assert.rejects(() => fs.access(path.join(root, created.jobId)));
    assert.equal(state.jobs.get(created.jobId).status, 'ready');
    assert.ok(state.objects.size > 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ACK network failure keeps verified local data; next poll reuses receipt and completes cloud delete', async () => {
  const fixture = await buildFixture();
  const state = makeRelayState(fixture.cloudRegistry);
  const created = await createRelayJob(fixture.built.request, state.deps, { crypto: webcrypto, now: () => 2300 });
  await uploadBuiltParts(state, fixture.built, created);
  await completeRelayJob(created.jobId, created.uploadCapability, state.deps, { crypto: webcrypto, now: () => 2400 });

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-gateway-ack-retry-'));
  try {
    const fetch = makeFetch(state, fixture.recipient.recipientKeyId, { failAckOnce: true });
    const options = {
      endpoint: 'https://relay.test',
      token: TOKEN,
      fetch,
      recipientKeyRingOrIdentity: fixture.recipient,
      senderRegistries: { version: 'dwo-gateway-sender-registry-v1', senders: [fixture.fullRegistry] },
      inboxRoot: root,
      crypto: webcrypto,
      now: () => 2800
    };

    const first = await receiveOnce(options);
    assert.equal(first.checked, 1);
    assert.equal(first.results[0].status, 'failed');
    assert.equal(first.results[0].errorCode, 'GATEWAY_ACK_FAILED');
    await fs.access(path.join(root, created.jobId, 'receipt.json'));
    assert.equal(state.jobs.get(created.jobId).status, 'ready');
    assert.ok(state.objects.size > 0);

    const second = await receiveOnce(options);
    assert.equal(second.checked, 1);
    assert.equal(second.results[0].status, 'already-stored');
    assert.equal(second.results[0].cloudStatus, 'deleted');
    assert.equal(state.jobs.has(created.jobId), false);
    assert.equal(state.objects.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('deleting job resumes on next poll without re-downloading ciphertext', async () => {
  const fixture = await buildFixture();
  const state = makeRelayState(fixture.cloudRegistry);
  const created = await createRelayJob(fixture.built.request, state.deps, { crypto: webcrypto, now: () => 2300 });
  await uploadBuiltParts(state, fixture.built, created);
  await completeRelayJob(created.jobId, created.uploadCapability, state.deps, { crypto: webcrypto, now: () => 2400 });

  const plan = await createReceiverDownloadPlan(
    created.jobId,
    fixture.recipient.recipientKeyId,
    state.deps,
    { ttlMs: 120000 }
  );
  const ackProof = computeAckProof(created.jobId, fixture.built.request.envelopeHeader.descriptorSha256, REF);
  const capabilityHash = createHash('sha256').update(plan.ackCapability).digest('hex');
  const proofHash = createHash('sha256').update(ackProof).digest('hex');
  await state.deps.jobStore.beginDelete(
    created.jobId,
    fixture.recipient.recipientKeyId,
    capabilityHash,
    proofHash,
    'del_' + 'R'.repeat(22),
    2900
  );

  const firstObjectName = state.jobs.get(created.jobId).objectSpecs[0].objectName;
  state.objects.delete(firstObjectName);

  let downloadCalls = 0;
  const baseFetch = makeFetch(state, fixture.recipient.recipientKeyId);
  const fetch = async (url, options) => {
    if (url.startsWith('https://download.test/')) downloadCalls += 1;
    return baseFetch(url, options);
  };

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-gateway-delete-resume-'));
  try {
    const result = await receiveOnce({
      endpoint: 'https://relay.test',
      token: TOKEN,
      fetch,
      recipientKeyRingOrIdentity: fixture.recipient,
      senderRegistries: { version: 'dwo-gateway-sender-registry-v1', senders: [fixture.fullRegistry] },
      inboxRoot: root,
      crypto: webcrypto,
      now: () => 3000
    });
    assert.equal(result.checked, 1);
    assert.equal(result.results[0].status, 'delete-resumed');
    assert.equal(result.results[0].cloudStatus, 'deleted');
    assert.equal(downloadCalls, 0);
    assert.equal(state.jobs.has(created.jobId), false);
    assert.equal(state.objects.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

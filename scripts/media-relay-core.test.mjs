import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { completeRelayJob, createRelayJob, validateCreateRequest } from '../cloud/relay-core.mjs';

const require = createRequire(import.meta.url);
const T = require('../media-transfer-package.js');
const C = require('../media-transfer-crypto.js');
const R = require('../media-relay.js');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const PATIENT = '架空患者サーバーカナリア';
const CLINIC = '架空医院サーバーカナリア';
const ATT = 'att-123e4567-e89b-42d3-a456-426614174001';

function blob(bytes, type) {
  return new Blob([Uint8Array.from(bytes)], { type: type || 'application/octet-stream' });
}

async function fixture(nowValue = 1000) {
  const recipient = await C.generateRecipientIdentity('relay-core-test-passphrase', { crypto: webcrypto });
  const sender = await C.generateSenderIdentity({ crypto: webcrypto });
  const offer = await C.createPairingOffer(recipient, { crypto: webcrypto, now: () => nowValue });
  const response = await C.createPairingResponse(offer, sender, { crypto: webcrypto, now: () => nowValue });
  const fullRegistry = await C.verifyPairingResponse(offer, response, { crypto: webcrypto, now: () => nowValue });
  const registry = {
    version: fullRegistry.version,
    clinicDeviceId: fullRegistry.clinicDeviceId,
    status: fullRegistry.status,
    pairedRecipientKeyId: fullRegistry.pairedRecipientKeyId,
    activeSigningKey: fullRegistry.activeSigningKey,
    updatedAt: fullRegistry.updatedAt
  };
  const pkg = await T.buildPackage(
    REF,
    {
      workOrderRef: REF,
      patientName: PATIENT,
      clinicName: CLINIC,
      issueDate: '2026-10-03'
    },
    [{
      meta: {
        attachmentId: ATT,
        kind: 'image',
        mime: 'image/jpeg',
        size: 9,
        name: 'private-patient-photo.jpg'
      },
      blob: blob([1,2,3,4,5,6,7,8,9], 'image/jpeg')
    }],
    { crypto: webcrypto, chunkSize: 4 }
  );
  const envelope = await C.encryptPackage(pkg, sender, recipient, { crypto: webcrypto, now: () => nowValue });
  const built = await R.buildCreateRequest(envelope, sender, { crypto: webcrypto, now: () => nowValue });
  return { sender, recipient, registry, envelope, request: built.request };
}

function fakeDeps(registry) {
  const jobs = new Map();
  const sessions = [];
  const objects = new Map();
  return {
    jobs,
    sessions,
    objects,
    deps: {
      registryStore: {
        async getSender() { return registry; }
      },
      jobStore: {
        async reserve(jobId, record) {
          if (jobs.has(jobId)) return { created: false, record: jobs.get(jobId) };
          const stored = structuredClone(record);
          jobs.set(jobId, stored);
          return { created: true, record: stored };
        },
        async get(jobId) {
          return jobs.get(jobId) || null;
        },
        async setUploads(jobId, uploads, capabilityHash) {
          const record = jobs.get(jobId);
          if (!Array.isArray(record.uploads) || record.uploads.length === 0) record.uploads = structuredClone(uploads);
          const hashes = Array.isArray(record.capabilityHashes) ? record.capabilityHashes.slice() : [];
          if (!hashes.includes(capabilityHash)) hashes.push(capabilityHash);
          record.capabilityHashes = hashes.slice(-4);
          return { uploads: structuredClone(record.uploads) };
        },
        async markReady(jobId, detail) {
          const record = jobs.get(jobId);
          record.status = 'ready';
          record.readyAt = detail.readyAt;
          if (detail.clearUploads) delete record.uploads;
          if (detail.clearCapabilities) delete record.capabilityHashes;
        }
      },
      storage: {
        async createResumableUpload(spec) {
          sessions.push(structuredClone(spec));
          return 'https://storage.test/session/' + sessions.length;
        },
        async statObject(objectName) {
          return objects.get(objectName) || { exists: false, size: 0, metadata: {} };
        }
      }
    }
  };
}

test('valid active sender creates opaque idempotent job and no plaintext-identifying cloud metadata', async () => {
  const { registry, request } = await fixture();
  const env = fakeDeps(registry);
  const first = await createRelayJob(request, env.deps, { crypto: webcrypto, now: () => 1001 });
  const second = await createRelayJob(request, env.deps, { crypto: webcrypto, now: () => 1002 });

  assert.equal(first.jobId, second.jobId);
  assert.ok(first.jobId.startsWith('job_'));
  assert.notEqual(first.uploadCapability, second.uploadCapability);
  assert.deepEqual(first.uploads, second.uploads);
  assert.equal(env.sessions.length, request.plan.entries.length);
  assert.equal(env.jobs.get(first.jobId).capabilityHashes.length, 2);

  const record = env.jobs.get(first.jobId);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes(PATIENT), false);
  assert.equal(serialized.includes(CLINIC), false);
  assert.equal(serialized.includes(REF), false);
  assert.equal(serialized.includes(ATT), false);
  for (const spec of record.objectSpecs) {
    assert.match(spec.objectName, /^relay\/v1\/job_[A-Za-z0-9_-]+\/o\/\d{4}\.bin$/);
    assert.equal(spec.objectName.includes(REF), false);
    assert.equal(spec.objectName.includes(ATT), false);
  }
  for (const session of env.sessions) {
    const metadata = JSON.stringify(session.metadata);
    assert.equal(metadata.includes(REF), false);
    assert.equal(metadata.includes(ATT), false);
    assert.equal(metadata.includes(PATIENT), false);
    assert.equal(metadata.includes(CLINIC), false);
  }
});

test('unknown, revoked and mismatched sender registries fail closed', async () => {
  const { registry, request } = await fixture();
  const unknown = fakeDeps(null);
  await assert.rejects(
    () => createRelayJob(request, unknown.deps, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_SENDER_UNKNOWN' }
  );

  const revokedRegistry = { ...registry, status: 'revoked' };
  const revoked = fakeDeps(revokedRegistry);
  await assert.rejects(
    () => createRelayJob(request, revoked.deps, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_SENDER_REVOKED' }
  );

  const mismatchRegistry = { ...registry, pairedRecipientKeyId: registry.pairedRecipientKeyId + 'x' };
  const mismatch = fakeDeps(mismatchRegistry);
  await assert.rejects(
    () => createRelayJob(request, mismatch.deps, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_SENDER_MISMATCH' }
  );
});

test('tampered descriptor, plan and relay authorization signature are rejected', async () => {
  const { registry, request } = await fixture();

  const descriptorTamper = structuredClone(request);
  descriptorTamper.descriptor.workOrderRef = 'dwo:tampered';
  await assert.rejects(
    () => validateCreateRequest(descriptorTamper, registry, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_DESCRIPTOR_HASH_MISMATCH' }
  );

  const planTamper = structuredClone(request);
  planTamper.plan.entries[0].ciphertextSha256 = 'f'.repeat(64);
  await assert.rejects(
    () => validateCreateRequest(planTamper, registry, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_AUTHORIZATION_MISMATCH' }
  );

  const sigTamper = structuredClone(request);
  sigTamper.authorizationSignature =
    (sigTamper.authorizationSignature.startsWith('A') ? 'B' : 'A') +
    sigTamper.authorizationSignature.slice(1);
  await assert.rejects(
    () => validateCreateRequest(sigTamper, registry, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_INVALID_AUTHORIZATION_SIGNATURE' }
  );
});

test('size/count limits and conflicting replay fail closed', async () => {
  const { sender, registry, envelope, request } = await fixture();
  const tooLarge = structuredClone(request);
  tooLarge.plan.entries[0].size = 6 * 1024 * 1024;
  tooLarge.plan.totalBytes += tooLarge.plan.entries[0].size - request.plan.entries[0].size;
  const auth = await R.buildRelayAuthorization(envelope, tooLarge.plan, sender, { crypto: webcrypto, now: () => 1000 });
  tooLarge.authorization = auth.body;
  tooLarge.authorizationSignature = auth.signature;
  await assert.rejects(
    () => validateCreateRequest(tooLarge, registry, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_SIZE_LIMIT' }
  );

  const env = fakeDeps(registry);
  await createRelayJob(request, env.deps, { crypto: webcrypto, now: () => 1001 });
  const conflict = structuredClone(request);
  conflict.plan.entries[0].size += 1;
  conflict.plan.totalBytes += 1;
  const conflictAuth = await R.buildRelayAuthorization(envelope, conflict.plan, sender, { crypto: webcrypto, now: () => 1000 });
  conflict.authorization = conflictAuth.body;
  conflict.authorizationSignature = conflictAuth.signature;
  await assert.rejects(
    () => createRelayJob(conflict, env.deps, { crypto: webcrypto, now: () => 1001 }),
    { code: 'RELAY_IDEMPOTENCY_CONFLICT' }
  );
});

test('completion requires correct capability and exact uploaded sizes', async () => {
  const { registry, request } = await fixture();
  const env = fakeDeps(registry);
  const created = await createRelayJob(request, env.deps, { crypto: webcrypto, now: () => 1001 });
  const record = env.jobs.get(created.jobId);

  await assert.rejects(
    () => completeRelayJob(created.jobId, 'wrong_capability', env.deps, { crypto: webcrypto, now: () => 2000 }),
    { code: 'RELAY_CAPABILITY_INVALID' }
  );

  for (const spec of record.objectSpecs) {
    env.objects.set(spec.objectName, {
      exists: true,
      size: spec.size,
      metadata: { ciphertextSha256: spec.ciphertextSha256 }
    });
  }
  const firstSpec = record.objectSpecs[0];
  env.objects.set(firstSpec.objectName, {
    exists: true,
    size: firstSpec.size + 1,
    metadata: { ciphertextSha256: firstSpec.ciphertextSha256 }
  });
  await assert.rejects(
    () => completeRelayJob(created.jobId, created.uploadCapability, env.deps, { crypto: webcrypto, now: () => 2000 }),
    { code: 'RELAY_OBJECT_INCOMPLETE' }
  );

  env.objects.set(firstSpec.objectName, {
    exists: true,
    size: firstSpec.size,
    metadata: { ciphertextSha256: firstSpec.ciphertextSha256 }
  });
  assert.deepEqual(
    await completeRelayJob(created.jobId, created.uploadCapability, env.deps, { crypto: webcrypto, now: () => 2000 }),
    { jobId: created.jobId, status: 'ready' }
  );
  assert.equal(env.jobs.get(created.jobId).status, 'ready');
  assert.equal('uploads' in env.jobs.get(created.jobId), false);
  assert.equal('capabilityHashes' in env.jobs.get(created.jobId), false);
});

test('30-day lifecycle and deny-all direct client rules are fixed in repository config', () => {
  const lifecycle = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloud', 'storage-lifecycle.json'), 'utf8'));
  assert.deepEqual(lifecycle, {
    rule: [{ action: { type: 'Delete' }, condition: { age: 30 } }]
  });
  const firestoreRules = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'firestore.rules'), 'utf8');
  const storageRules = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'storage.rules'), 'utf8');
  assert.match(firestoreRules, /allow read, write: if false;/);
  assert.match(storageRules, /allow read, write: if false;/);

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloud', 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '22');
  assert.equal(pkg.dependencies['firebase-functions'], '7.4.0');
  assert.equal(pkg.dependencies['firebase-admin'], '14.5.0');
  assert.equal(pkg.dependencies['@google-cloud/storage'], '8.2.0');
});

test('cloud runtime source has no embedded secrets or unsafe request logging', () => {
  const runtime = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'index.mjs'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'cloud', 'README.md'), 'utf8');
  assert.doesNotMatch(runtime, /serviceAccount|private_key|client_email|console\.log|req\.body.*log/i);
  assert.match(runtime, /DWO_RELAY_BUCKET/);
  assert.match(runtime, /asia-northeast1/);
  assert.match(readme, /--clear-soft-delete/);
  assert.match(readme, /30-day/i);
  assert.match(readme, /Application Default Credentials/);
});

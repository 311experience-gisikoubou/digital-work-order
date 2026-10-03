const RELAY_PROTOCOL_VERSION = 'dwo-relay-v1';
const PLAN_VERSION = 'dwo-relay-plan-v1';
const AUTH_VERSION = 'dwo-relay-auth-v1';
const HEX64 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const DEFAULT_LIMITS = Object.freeze({
  maxObjects: 512,
  maxObjectBytes: 5 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxAuthLifetimeMs: 60 * 60 * 1000
});

export function relayError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw relayError('RELAY_NON_JSON_VALUE');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out = {};
    Object.keys(value).sort().forEach(key => {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
        throw relayError('RELAY_NON_JSON_VALUE');
      }
      out[key] = canonicalize(entry);
    });
    return out;
  }
  throw relayError('RELAY_NON_JSON_VALUE');
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function resolveCrypto(options) {
  const api = options && options.crypto ? options.crypto : globalThis.crypto;
  if (!api || !api.subtle || typeof api.getRandomValues !== 'function') throw relayError('RELAY_CRYPTO_UNAVAILABLE');
  return api;
}

function resolveNow(options) {
  if (options && typeof options.now === 'function') return options.now;
  return () => Date.now();
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64urlEncode(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(value) {
  if (typeof value !== 'string' || !BASE64URL.test(value)) throw relayError('RELAY_INVALID_SIGNATURE');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  try {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  } catch (_) {
    throw relayError('RELAY_INVALID_SIGNATURE');
  }
}

async function sha256Bytes(bytes, cryptoApi) {
  return new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
}

async function sha256Hex(bytes, cryptoApi) {
  return bytesToHex(await sha256Bytes(bytes, cryptoApi));
}

async function sha256Json(value, cryptoApi) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)), cryptoApi);
}

async function importSigningPublicKey(jwk, cryptoApi) {
  if (!isPlainObject(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' ||
      typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw relayError('RELAY_INVALID_REGISTRY');
  }
  try {
    return await cryptoApi.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
  } catch (_) {
    throw relayError('RELAY_INVALID_REGISTRY');
  }
}

async function verifyCanonicalSignature(body, signature, publicJwk, cryptoApi) {
  const key = await importSigningPublicKey(publicJwk, cryptoApi);
  try {
    return await cryptoApi.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64urlDecode(signature),
      new TextEncoder().encode(canonicalJson(body))
    );
  } catch (_) {
    return false;
  }
}

function assertOpaqueId(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 160) {
    throw relayError('RELAY_INVALID_REQUEST');
  }
}

function validateDescriptor(descriptor) {
  const keys = [
    'v', 'protocolVersion', 'workOrderRef', 'senderClinicDeviceId', 'senderSigningKeyId',
    'recipientKeyId', 'createdAt', 'ephemeralPublicJwk', 'hkdfSalt', 'manifestSha256',
    'workOrderSha256', 'attachments'
  ];
  if (!exactKeys(descriptor, keys)) throw relayError('RELAY_INVALID_REQUEST');
  if (typeof descriptor.v !== 'string' || typeof descriptor.protocolVersion !== 'string') throw relayError('RELAY_INVALID_REQUEST');
  if (typeof descriptor.workOrderRef !== 'string' || !descriptor.workOrderRef.startsWith('dwo:')) throw relayError('RELAY_INVALID_REQUEST');
  assertOpaqueId(descriptor.senderClinicDeviceId, 'dev_');
  assertOpaqueId(descriptor.senderSigningKeyId, 'sk_');
  assertOpaqueId(descriptor.recipientKeyId, 'rk_');
  if (!Number.isSafeInteger(descriptor.createdAt)) throw relayError('RELAY_INVALID_REQUEST');
  if (!HEX64.test(descriptor.manifestSha256) || !HEX64.test(descriptor.workOrderSha256)) throw relayError('RELAY_INVALID_REQUEST');
  if (!Array.isArray(descriptor.attachments)) throw relayError('RELAY_INVALID_REQUEST');
  const ids = new Set();
  descriptor.attachments.forEach(entry => {
    if (!exactKeys(entry, ['attachmentId', 'sha256', 'chunks'])) throw relayError('RELAY_INVALID_REQUEST');
    assertOpaqueId(entry.attachmentId, 'att-');
    if (ids.has(entry.attachmentId) || !HEX64.test(entry.sha256) || !Array.isArray(entry.chunks)) throw relayError('RELAY_INVALID_REQUEST');
    ids.add(entry.attachmentId);
    entry.chunks.forEach((chunk, index) => {
      if (!exactKeys(chunk, ['index', 'sha256']) || chunk.index !== index || !HEX64.test(chunk.sha256)) throw relayError('RELAY_INVALID_REQUEST');
    });
  });
}

function expectedLogicalEntries(descriptor, plan) {
  const out = [];
  if (plan && Array.isArray(plan.entries) && plan.entries[0] && plan.entries[0].kind === 'receiver-bootstrap') {
    out.push({ slot: 'receiver-bootstrap', kind: 'receiver-bootstrap' });
  }
  out.push(
    { slot: 'manifest', kind: 'manifest' },
    { slot: 'work-order', kind: 'work-order' }
  );
  descriptor.attachments.forEach(entry => {
    entry.chunks.forEach(chunk => {
      out.push({
        slot: `attachment:${entry.attachmentId}:${chunk.index}`,
        kind: 'attachment',
        attachmentId: entry.attachmentId,
        index: chunk.index
      });
    });
  });
  return out;
}

function validatePlan(plan, descriptor, limits) {
  if (!exactKeys(plan, ['version', 'totalBytes', 'entries']) || plan.version !== PLAN_VERSION) {
    throw relayError('RELAY_INVALID_PLAN');
  }
  if (!Number.isSafeInteger(plan.totalBytes) || plan.totalBytes <= 0 || !Array.isArray(plan.entries)) {
    throw relayError('RELAY_INVALID_PLAN');
  }
  const expected = expectedLogicalEntries(descriptor, plan);
  if (plan.entries.length !== expected.length || plan.entries.length > limits.maxObjects) throw relayError('RELAY_INVALID_PLAN');
  let total = 0;
  const ivs = new Set();
  plan.entries.forEach((entry, i) => {
    const logical = expected[i];
    const keys = logical.kind === 'attachment'
      ? ['slot', 'kind', 'attachmentId', 'index', 'iv', 'size', 'ciphertextSha256']
      : logical.kind === 'receiver-bootstrap'
        ? ['slot', 'kind', 'bootstrapVersion', 'recipientKeyId', 'ephemeralPublicJwk', 'hkdfSalt', 'iv', 'size', 'ciphertextSha256']
        : ['slot', 'kind', 'iv', 'size', 'ciphertextSha256'];
    if (!exactKeys(entry, keys)) throw relayError('RELAY_INVALID_PLAN');
    if (entry.slot !== logical.slot || entry.kind !== logical.kind) throw relayError('RELAY_PLAN_DESCRIPTOR_MISMATCH');
    if (logical.kind === 'attachment' && (entry.attachmentId !== logical.attachmentId || entry.index !== logical.index)) {
      throw relayError('RELAY_PLAN_DESCRIPTOR_MISMATCH');
    }
    if (logical.kind === 'receiver-bootstrap') {
      if (entry.bootstrapVersion !== 'dwo-receiver-bootstrap-v1' ||
          entry.recipientKeyId !== descriptor.recipientKeyId ||
          !isPlainObject(entry.ephemeralPublicJwk) ||
          entry.ephemeralPublicJwk.kty !== 'EC' || entry.ephemeralPublicJwk.crv !== 'P-256' ||
          typeof entry.ephemeralPublicJwk.x !== 'string' || typeof entry.ephemeralPublicJwk.y !== 'string' ||
          typeof entry.hkdfSalt !== 'string' || !BASE64URL.test(entry.hkdfSalt)) {
        throw relayError('RELAY_INVALID_RECEIVER_BOOTSTRAP');
      }
    }
    if (typeof entry.iv !== 'string' || !BASE64URL.test(entry.iv) || ivs.has(entry.iv)) throw relayError('RELAY_INVALID_PLAN');
    ivs.add(entry.iv);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > limits.maxObjectBytes) throw relayError('RELAY_SIZE_LIMIT');
    if (!HEX64.test(entry.ciphertextSha256)) throw relayError('RELAY_INVALID_PLAN');
    total += entry.size;
    if (total > limits.maxTotalBytes) throw relayError('RELAY_SIZE_LIMIT');
  });
  if (total !== plan.totalBytes) throw relayError('RELAY_INVALID_PLAN');
  return expected;
}

function validateRegistry(registry, descriptor) {
  if (!isPlainObject(registry)) throw relayError('RELAY_SENDER_UNKNOWN');
  const allowed = new Set(['version', 'clinicDeviceId', 'status', 'pairedRecipientKeyId', 'activeSigningKey', 'updatedAt']);
  if (Object.keys(registry).some(key => !allowed.has(key))) throw relayError('RELAY_INVALID_REGISTRY');
  if (registry.status !== 'active') throw relayError('RELAY_SENDER_REVOKED');
  if (registry.clinicDeviceId !== descriptor.senderClinicDeviceId ||
      registry.pairedRecipientKeyId !== descriptor.recipientKeyId) {
    throw relayError('RELAY_SENDER_MISMATCH');
  }
  const key = registry.activeSigningKey;
  if (!isPlainObject(key) || key.signingKeyId !== descriptor.senderSigningKeyId || !isPlainObject(key.publicJwk)) {
    throw relayError('RELAY_SENDER_MISMATCH');
  }
  if (Object.keys(key).some(k => !['signingKeyId', 'publicJwk', 'activatedAt'].includes(k))) {
    throw relayError('RELAY_INVALID_REGISTRY');
  }
  return key.publicJwk;
}

function validateAuthorizationShape(auth) {
  const keys = [
    'version', 'relayProtocolVersion', 'descriptorSha256', 'planSha256',
    'senderClinicDeviceId', 'senderSigningKeyId', 'recipientKeyId', 'totalBytes',
    'createdAt', 'expiresAt'
  ];
  if (!exactKeys(auth, keys) || auth.version !== AUTH_VERSION || auth.relayProtocolVersion !== RELAY_PROTOCOL_VERSION) {
    throw relayError('RELAY_INVALID_AUTHORIZATION');
  }
  if (!HEX64.test(auth.descriptorSha256) || !HEX64.test(auth.planSha256) ||
      !Number.isSafeInteger(auth.totalBytes) || !Number.isSafeInteger(auth.createdAt) || !Number.isSafeInteger(auth.expiresAt)) {
    throw relayError('RELAY_INVALID_AUTHORIZATION');
  }
}

export async function validateCreateRequest(request, senderRegistry, options = {}) {
  const cryptoApi = resolveCrypto(options);
  const now = resolveNow(options);
  const limits = Object.assign({}, DEFAULT_LIMITS, options.limits || {});
  if (!exactKeys(request, [
    'version', 'envelopeHeader', 'descriptor', 'envelopeSignature', 'plan',
    'authorization', 'authorizationSignature'
  ]) || request.version !== RELAY_PROTOCOL_VERSION) {
    throw relayError('RELAY_INVALID_REQUEST');
  }
  if (!exactKeys(request.envelopeHeader, ['version', 'descriptorSha256']) ||
      !HEX64.test(request.envelopeHeader.descriptorSha256) ||
      typeof request.envelopeSignature !== 'string' || !BASE64URL.test(request.envelopeSignature) ||
      typeof request.authorizationSignature !== 'string' || !BASE64URL.test(request.authorizationSignature)) {
    throw relayError('RELAY_INVALID_REQUEST');
  }
  validateDescriptor(request.descriptor);
  validatePlan(request.plan, request.descriptor, limits);
  validateAuthorizationShape(request.authorization);

  const descriptorSha256 = await sha256Json(request.descriptor, cryptoApi);
  if (descriptorSha256 !== request.envelopeHeader.descriptorSha256) throw relayError('RELAY_DESCRIPTOR_HASH_MISMATCH');
  const planSha256 = await sha256Json(request.plan, cryptoApi);
  const auth = request.authorization;
  if (auth.descriptorSha256 !== descriptorSha256 || auth.planSha256 !== planSha256 ||
      auth.senderClinicDeviceId !== request.descriptor.senderClinicDeviceId ||
      auth.senderSigningKeyId !== request.descriptor.senderSigningKeyId ||
      auth.recipientKeyId !== request.descriptor.recipientKeyId ||
      auth.totalBytes !== request.plan.totalBytes) {
    throw relayError('RELAY_AUTHORIZATION_MISMATCH');
  }
  if (auth.expiresAt <= auth.createdAt || auth.expiresAt - auth.createdAt > limits.maxAuthLifetimeMs ||
      now() < auth.createdAt - 60_000 || now() > auth.expiresAt) {
    throw relayError('RELAY_AUTHORIZATION_EXPIRED');
  }

  const publicJwk = validateRegistry(senderRegistry, request.descriptor);
  if (!(await verifyCanonicalSignature(request.descriptor, request.envelopeSignature, publicJwk, cryptoApi))) {
    throw relayError('RELAY_INVALID_ENVELOPE_SIGNATURE');
  }
  if (!(await verifyCanonicalSignature(auth, request.authorizationSignature, publicJwk, cryptoApi))) {
    throw relayError('RELAY_INVALID_AUTHORIZATION_SIGNATURE');
  }
  return { descriptorSha256, planSha256, limits };
}

async function deriveJobId(descriptorSha256, cryptoApi) {
  const digest = await sha256Bytes(new TextEncoder().encode('dwo-relay-job-v1|' + descriptorSha256), cryptoApi);
  return 'job_' + base64urlEncode(digest);
}

function generateCapability(cryptoApi) {
  const bytes = new Uint8Array(32);
  cryptoApi.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

async function capabilityHash(capability, cryptoApi) {
  return sha256Hex(new TextEncoder().encode(capability), cryptoApi);
}

function buildObjectSpecs(jobId, plan) {
  return plan.entries.map((entry, ordinal) => ({
    ordinal,
    objectName: `relay/v1/${jobId}/o/${String(ordinal).padStart(4, '0')}.bin`,
    size: entry.size,
    ciphertextSha256: entry.ciphertextSha256
  }));
}

function receiverBootstrapFromPlan(plan) {
  const entry = plan && Array.isArray(plan.entries) ? plan.entries[0] : null;
  if (!entry || entry.kind !== 'receiver-bootstrap') return null;
  return {
    version: entry.bootstrapVersion,
    recipientKeyId: entry.recipientKeyId,
    ephemeralPublicJwk: entry.ephemeralPublicJwk,
    hkdfSalt: entry.hkdfSalt,
    iv: entry.iv,
    ciphertextSha256: entry.ciphertextSha256,
    ciphertextSize: entry.size
  };
}

function sameJobRequest(record, validated, request) {
  return record && record.descriptorSha256 === validated.descriptorSha256 &&
    record.planSha256 === validated.planSha256 &&
    record.senderClinicDeviceId === request.descriptor.senderClinicDeviceId &&
    record.senderSigningKeyId === request.descriptor.senderSigningKeyId &&
    record.recipientKeyId === request.descriptor.recipientKeyId &&
    record.totalBytes === request.plan.totalBytes;
}

function validateDeps(deps) {
  if (!deps || !deps.registryStore || typeof deps.registryStore.getSender !== 'function' ||
      !deps.jobStore || typeof deps.jobStore.reserve !== 'function' ||
      typeof deps.jobStore.get !== 'function' || typeof deps.jobStore.setUploads !== 'function' ||
      typeof deps.jobStore.markReady !== 'function' ||
      !deps.storage || typeof deps.storage.createResumableUpload !== 'function' ||
      typeof deps.storage.statObject !== 'function') {
    throw relayError('RELAY_ADAPTER_UNAVAILABLE');
  }
}

export async function createRelayJob(request, deps, options = {}) {
  validateDeps(deps);
  const cryptoApi = resolveCrypto(options);
  const now = resolveNow(options);
  const registry = await deps.registryStore.getSender(request && request.descriptor && request.descriptor.senderClinicDeviceId);
  const validated = await validateCreateRequest(request, registry, options);
  const jobId = await deriveJobId(validated.descriptorSha256, cryptoApi);
  const capability = generateCapability(cryptoApi);
  const capHash = await capabilityHash(capability, cryptoApi);
  const objectSpecs = buildObjectSpecs(jobId, request.plan);
  const createdAt = now();
  const baseRecord = {
    version: RELAY_PROTOCOL_VERSION,
    jobId,
    status: 'uploading',
    descriptorSha256: validated.descriptorSha256,
    planSha256: validated.planSha256,
    senderClinicDeviceId: request.descriptor.senderClinicDeviceId,
    senderSigningKeyId: request.descriptor.senderSigningKeyId,
    recipientKeyId: request.descriptor.recipientKeyId,
    totalBytes: request.plan.totalBytes,
    objectSpecs,
    receiverBootstrap: receiverBootstrapFromPlan(request.plan),
    capabilityHashes: [capHash],
    createdAt,
    expiresAt: createdAt + 30 * 24 * 60 * 60 * 1000
  };

  const reservation = await deps.jobStore.reserve(jobId, baseRecord);
  const record = reservation && reservation.record ? reservation.record : baseRecord;
  if (!sameJobRequest(record, validated, request)) throw relayError('RELAY_IDEMPOTENCY_CONFLICT');
  if (record.status === 'ready') {
    return { jobId, status: 'ready', uploads: [] };
  }

  let uploads = Array.isArray(record.uploads) ? record.uploads : null;
  if (!uploads || uploads.length !== objectSpecs.length) {
    uploads = [];
    for (const spec of objectSpecs) {
      const uploadUrl = await deps.storage.createResumableUpload({
        objectName: spec.objectName,
        size: spec.size,
        metadata: {
          relayJobId: jobId,
          ordinal: String(spec.ordinal),
          expectedSize: String(spec.size),
          ciphertextSha256: spec.ciphertextSha256
        }
      });
      if (typeof uploadUrl !== 'string' || !uploadUrl.startsWith('https://')) throw relayError('RELAY_STORAGE_SESSION_FAILED');
      uploads.push({ ordinal: spec.ordinal, uploadUrl });
    }
  }
  // Rotate the completion capability on every create/retry. The adapter atomically
  // preserves the first published upload-session set and appends only hashed
  // capabilities, so concurrent retries cannot overwrite each other's usable state.
  const persisted = await deps.jobStore.setUploads(jobId, uploads, capHash);
  if (persisted && Array.isArray(persisted.uploads)) uploads = persisted.uploads;
  const clientUploads = uploads.map(item => {
    const planEntry = request.plan.entries[item.ordinal];
    if (!planEntry || typeof item.uploadUrl !== 'string') throw relayError('RELAY_JOB_STATE_INVALID');
    return { slot: planEntry.slot, uploadUrl: item.uploadUrl };
  });
  return { jobId, status: 'uploading', uploadCapability: capability, uploads: clientUploads };
}

export async function completeRelayJob(jobId, capability, deps, options = {}) {
  validateDeps(deps);
  const cryptoApi = resolveCrypto(options);
  const now = resolveNow(options);
  if (typeof jobId !== 'string' || !jobId.startsWith('job_') || typeof capability !== 'string' || !BASE64URL.test(capability)) {
    throw relayError('RELAY_INVALID_COMPLETE_REQUEST');
  }
  const record = await deps.jobStore.get(jobId);
  if (!record) throw relayError('RELAY_JOB_NOT_FOUND');
  if (record.status === 'ready') return { jobId, status: 'ready' };
  if (record.status !== 'uploading' || !Array.isArray(record.objectSpecs)) throw relayError('RELAY_JOB_STATE_INVALID');
  const presentedHash = await capabilityHash(capability, cryptoApi);
  if (!Array.isArray(record.capabilityHashes) || !record.capabilityHashes.includes(presentedHash)) {
    throw relayError('RELAY_CAPABILITY_INVALID');
  }

  for (const spec of record.objectSpecs) {
    const actual = await deps.storage.statObject(spec.objectName);
    if (!actual || actual.exists !== true || actual.size !== spec.size) throw relayError('RELAY_OBJECT_INCOMPLETE');
    if (actual.metadata && actual.metadata.ciphertextSha256 &&
        actual.metadata.ciphertextSha256 !== spec.ciphertextSha256) {
      throw relayError('RELAY_OBJECT_METADATA_MISMATCH');
    }
  }
  await deps.jobStore.markReady(jobId, { readyAt: now(), clearUploads: true, clearCapabilities: true });
  return { jobId, status: 'ready' };
}

export const constants = Object.freeze({
  RELAY_PROTOCOL_VERSION,
  PLAN_VERSION,
  AUTH_VERSION,
  DEFAULT_LIMITS
});

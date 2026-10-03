import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { persistVerifiedPackage } from './local-store.mjs';

const require = createRequire(import.meta.url);
const Transfer = require('../media-transfer-package.js');
const Crypto = require('../media-transfer-crypto.js');
const Bootstrap = require('../media-receiver-bootstrap.js');

const API_VERSION = 'dwo-receiver-api-v1';
const JOB_ID = /^job_[A-Za-z0-9_-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_OBJECTS = 512;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

function gatewayError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEndpoint(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^\s]+$/.test(value)) {
    throw gatewayError('GATEWAY_INVALID_ENDPOINT');
  }
  return value.replace(/\/+$/, '');
}

function validateToken(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(token)) {
    throw gatewayError('GATEWAY_INVALID_RECEIVER_TOKEN');
  }
  return token;
}

async function postJson(fetchApi, url, token, body, errorCode) {
  let response;
  try {
    response = await fetchApi(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw gatewayError(errorCode, error && error.message ? error.message : 'NETWORK');
  }
  if (!response || !response.ok) throw gatewayError(errorCode, String(response && response.status));
  try {
    return await response.json();
  } catch (_) {
    throw gatewayError(errorCode, 'INVALID_JSON');
  }
}

export async function listReadyJobs(options) {
  const opts = options || {};
  const endpoint = normalizeEndpoint(opts.endpoint);
  const token = validateToken(opts.token);
  const fetchApi = opts.fetch || globalThis.fetch;
  if (typeof fetchApi !== 'function') throw gatewayError('GATEWAY_FETCH_UNAVAILABLE');
  const limit = Number.isSafeInteger(opts.limit) ? opts.limit : 20;
  const value = await postJson(
    fetchApi,
    endpoint + '/v1/receiver/jobs:list',
    token,
    { version: API_VERSION, limit },
    'GATEWAY_LIST_FAILED'
  );
  if (!isObject(value) || value.version !== API_VERSION || !Array.isArray(value.jobs)) {
    throw gatewayError('GATEWAY_INVALID_LIST_RESPONSE');
  }
  value.jobs.forEach(job => {
    if (!isObject(job) || !JOB_ID.test(job.jobId || '') ||
        (job.status !== 'ready' && job.status !== 'deleting') ||
        !Number.isSafeInteger(job.totalBytes) || job.totalBytes <= 0 ||
        !Number.isSafeInteger(job.objectCount) || job.objectCount < 3 ||
        !Number.isSafeInteger(job.readyAt)) {
      throw gatewayError('GATEWAY_INVALID_LIST_RESPONSE');
    }
  });
  return value.jobs;
}

export async function getDownloadPlan(jobId, options) {
  const opts = options || {};
  if (!JOB_ID.test(jobId || '')) throw gatewayError('GATEWAY_INVALID_JOB_ID');
  const endpoint = normalizeEndpoint(opts.endpoint);
  const token = validateToken(opts.token);
  const fetchApi = opts.fetch || globalThis.fetch;
  if (typeof fetchApi !== 'function') throw gatewayError('GATEWAY_FETCH_UNAVAILABLE');
  const value = await postJson(
    fetchApi,
    endpoint + '/v1/receiver/jobs/' + encodeURIComponent(jobId) + ':download',
    token,
    { version: API_VERSION },
    'GATEWAY_DOWNLOAD_PLAN_FAILED'
  );
  validateDownloadPlan(value, jobId);
  return value;
}

export async function acknowledgeJob(jobId, ackCapability, ackProof, options) {
  const opts = options || {};
  if (!JOB_ID.test(jobId || '')) throw gatewayError('GATEWAY_INVALID_JOB_ID');
  if (ackCapability !== undefined && ackCapability !== null &&
      (typeof ackCapability !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(ackCapability))) {
    throw gatewayError('GATEWAY_INVALID_ACK_CAPABILITY');
  }
  if (ackProof !== undefined && ackProof !== null &&
      (typeof ackProof !== 'string' || !HEX64.test(ackProof))) {
    throw gatewayError('GATEWAY_INVALID_ACK_PROOF');
  }
  const endpoint = normalizeEndpoint(opts.endpoint);
  const token = validateToken(opts.token);
  const fetchApi = opts.fetch || globalThis.fetch;
  if (typeof fetchApi !== 'function') throw gatewayError('GATEWAY_FETCH_UNAVAILABLE');
  const body = { version: API_VERSION };
  if (ackCapability) body.ackCapability = ackCapability;
  if (ackProof) body.ackProof = ackProof;
  const value = await postJson(
    fetchApi,
    endpoint + '/v1/receiver/jobs/' + encodeURIComponent(jobId) + ':ack',
    token,
    body,
    'GATEWAY_ACK_FAILED'
  );
  if (!isObject(value) || value.version !== API_VERSION ||
      value.jobId !== jobId || value.status !== 'deleted') {
    throw gatewayError('GATEWAY_INVALID_ACK_RESPONSE');
  }
  return value;
}

function validateDownloadPlan(value, expectedJobId) {
  if (!isObject(value) || value.version !== API_VERSION || value.jobId !== expectedJobId ||
      typeof value.ackCapability !== 'string' || !/^[A-Za-z0-9_-]{40,200}$/.test(value.ackCapability) ||
      !isObject(value.bootstrap) || !Array.isArray(value.objects) ||
      value.objects.length < 3 || value.objects.length > MAX_OBJECTS) {
    throw gatewayError('GATEWAY_INVALID_DOWNLOAD_PLAN');
  }
  let total = 0;
  value.objects.forEach((item, index) => {
    if (!isObject(item) || item.ordinal !== index ||
        !Number.isSafeInteger(item.size) || item.size <= 0 ||
        !HEX64.test(item.ciphertextSha256 || '') ||
        typeof item.downloadUrl !== 'string' || !item.downloadUrl.startsWith('https://')) {
      throw gatewayError('GATEWAY_INVALID_DOWNLOAD_PLAN');
    }
    total += item.size;
    if (total > MAX_TOTAL_BYTES) throw gatewayError('GATEWAY_DOWNLOAD_SIZE_LIMIT');
  });
  if (value.bootstrap.ciphertextSize !== value.objects[0].size ||
      value.bootstrap.ciphertextSha256 !== value.objects[0].ciphertextSha256) {
    throw gatewayError('GATEWAY_INVALID_DOWNLOAD_PLAN');
  }
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function computeAckProof(jobId, descriptorSha256, workOrderRef) {
  if (!JOB_ID.test(jobId || '') || !HEX64.test(descriptorSha256 || '') ||
      typeof workOrderRef !== 'string' || !workOrderRef.startsWith('dwo:')) {
    throw gatewayError('GATEWAY_INVALID_ACK_PROOF_INPUT');
  }
  return createHash('sha256')
    .update('dwo-receiver-ack-v1|' + jobId + '|' + descriptorSha256 + '|' + workOrderRef, 'utf8')
    .digest('hex');
}

async function downloadOne(fetchApi, item, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchApi(item.downloadUrl, { method: 'GET', cache: 'no-store' });
      if (!response || !response.ok) {
        lastError = gatewayError('GATEWAY_OBJECT_DOWNLOAD_FAILED', String(response && response.status));
        if (response && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) break;
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length !== item.size) throw gatewayError('GATEWAY_OBJECT_SIZE_MISMATCH');
      if (sha256Buffer(buffer) !== item.ciphertextSha256) throw gatewayError('GATEWAY_OBJECT_HASH_MISMATCH');
      return new Blob([buffer], { type: 'application/octet-stream' });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || gatewayError('GATEWAY_OBJECT_DOWNLOAD_FAILED');
}

export async function downloadVerifiedObjects(plan, options = {}) {
  validateDownloadPlan(plan, plan && plan.jobId);
  const fetchApi = options.fetch || globalThis.fetch;
  if (typeof fetchApi !== 'function') throw gatewayError('GATEWAY_FETCH_UNAVAILABLE');
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) ? options.maxAttempts : 3;
  if (maxAttempts < 1 || maxAttempts > 5) throw gatewayError('GATEWAY_INVALID_RETRY_POLICY');
  const blobs = [];
  for (const item of plan.objects) blobs.push(await downloadOne(fetchApi, item, maxAttempts));
  return blobs;
}

function validatePartMetadata(metadata, descriptor) {
  if (!isObject(metadata) || !isObject(metadata.manifest) || !isObject(metadata.workOrder) ||
      typeof metadata.manifest.iv !== 'string' || typeof metadata.workOrder.iv !== 'string' ||
      !isObject(metadata.attachments) || !Array.isArray(descriptor.attachments)) {
    throw gatewayError('GATEWAY_INVALID_BOOTSTRAP_METADATA');
  }
  const ids = descriptor.attachments.map(entry => entry.attachmentId).sort();
  const actualIds = Object.keys(metadata.attachments).sort();
  if (ids.length !== actualIds.length || ids.some((id, i) => id !== actualIds[i])) {
    throw gatewayError('GATEWAY_INVALID_BOOTSTRAP_METADATA');
  }
  descriptor.attachments.forEach(entry => {
    const source = metadata.attachments[entry.attachmentId];
    if (!source || !Array.isArray(source.chunks) || source.chunks.length !== entry.chunks.length) {
      throw gatewayError('GATEWAY_INVALID_BOOTSTRAP_METADATA');
    }
    source.chunks.forEach((chunk, index) => {
      if (!isObject(chunk) || chunk.index !== index || typeof chunk.iv !== 'string') {
        throw gatewayError('GATEWAY_INVALID_BOOTSTRAP_METADATA');
      }
    });
  });
}

export async function reconstructEnvelope(plan, blobs, recipientKeyRingOrIdentity, options = {}) {
  validateDownloadPlan(plan, plan && plan.jobId);
  if (!Array.isArray(blobs) || blobs.length !== plan.objects.length) {
    throw gatewayError('GATEWAY_OBJECT_COUNT_MISMATCH');
  }
  const cryptoApi = options.crypto || webcrypto;
  const bootstrapApi = options.bootstrapApi || Bootstrap;
  const plaintext = await bootstrapApi.decryptReceiverBootstrap(
    plan.bootstrap,
    blobs[0],
    recipientKeyRingOrIdentity,
    { crypto: cryptoApi }
  );
  const descriptor = plaintext.descriptor;
  validatePartMetadata(plaintext.partMetadata, descriptor);

  const expectedCount = 3 + descriptor.attachments.reduce((sum, entry) => sum + entry.chunks.length, 0);
  if (blobs.length !== expectedCount) throw gatewayError('GATEWAY_OBJECT_COUNT_MISMATCH');

  let cursor = 3;
  const attachments = {};
  for (const entry of descriptor.attachments) {
    const metadata = plaintext.partMetadata.attachments[entry.attachmentId];
    const chunks = [];
    for (let i = 0; i < entry.chunks.length; i += 1) {
      chunks.push({ index: i, iv: metadata.chunks[i].iv, ciphertext: blobs[cursor] });
      cursor += 1;
    }
    attachments[entry.attachmentId] = { chunks };
  }

  return {
    version: plaintext.envelopeHeader.version,
    header: plaintext.envelopeHeader,
    descriptor,
    signature: plaintext.signature,
    parts: {
      manifest: { iv: plaintext.partMetadata.manifest.iv, ciphertext: blobs[1] },
      workOrder: { iv: plaintext.partMetadata.workOrder.iv, ciphertext: blobs[2] },
      attachments
    }
  };
}

function resolveSenderRegistry(collection, clinicDeviceId) {
  const list = Array.isArray(collection)
    ? collection
    : (collection && Array.isArray(collection.senders) ? collection.senders : []);
  const matches = list.filter(item => item && item.clinicDeviceId === clinicDeviceId);
  if (matches.length !== 1) throw gatewayError('GATEWAY_SENDER_REGISTRY_MISSING');
  return matches[0];
}

export async function processReadyJob(jobId, options) {
  const opts = options || {};
  const plan = await getDownloadPlan(jobId, opts);
  const blobs = await downloadVerifiedObjects(plan, opts);
  const envelope = await reconstructEnvelope(plan, blobs, opts.recipientKeyRingOrIdentity, opts);
  const senderRegistry = resolveSenderRegistry(opts.senderRegistries, envelope.descriptor.senderClinicDeviceId);
  const cryptoApi = opts.crypto || webcrypto;
  const decrypted = await (opts.cryptoApi || Crypto).decryptEnvelope(
    envelope,
    opts.recipientKeyRingOrIdentity,
    senderRegistry,
    { crypto: cryptoApi, transferApi: opts.transferApi || Transfer }
  );
  const stored = await (opts.persist || persistVerifiedPackage)(
    {
      jobId,
      workOrderRef: decrypted.workOrderRef,
      pkg: decrypted.package,
      descriptorSha256: envelope.header.descriptorSha256
    },
    { root: opts.inboxRoot, now: opts.now }
  );
  if (!stored || (stored.status !== 'stored' && stored.status !== 'already-stored')) {
    throw gatewayError('GATEWAY_PERSIST_RESULT_INVALID');
  }
  const ackProof = computeAckProof(jobId, envelope.header.descriptorSha256, decrypted.workOrderRef);
  const ack = await acknowledgeJob(jobId, plan.ackCapability, ackProof, opts);
  return {
    jobId,
    status: stored.status,
    cloudStatus: ack.status,
    workOrderRef: decrypted.workOrderRef,
    directory: stored.directory
  };
}

export async function resumeDeletingJob(jobId, options) {
  const ack = await acknowledgeJob(jobId, null, null, options);
  return { jobId, status: 'delete-resumed', cloudStatus: ack.status };
}

export async function receiveOnce(options) {
  const jobs = await listReadyJobs(options);
  const results = [];
  for (const job of jobs) {
    try {
      results.push(job.status === 'deleting'
        ? await resumeDeletingJob(job.jobId, options)
        : await processReadyJob(job.jobId, options));
    } catch (error) {
      results.push({ jobId: job.jobId, status: 'failed', errorCode: error && error.code ? error.code : 'GATEWAY_UNKNOWN_ERROR' });
    }
  }
  return { checked: jobs.length, results };
}

export const constants = Object.freeze({ API_VERSION, MAX_OBJECTS, MAX_TOTAL_BYTES });

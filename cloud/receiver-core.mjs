import { createHash, timingSafeEqual } from 'node:crypto';

export const RECEIVER_API_VERSION = 'dwo-receiver-api-v1';
const HEX64 = /^[0-9a-f]{64}$/;
const JOB_ID = /^job_[A-Za-z0-9_-]+$/;
const RECIPIENT_ID = /^rk_[A-Za-z0-9_-]+$/;

function receiverError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hashToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function authenticateReceiver(authorizationHeader, expectedTokenSha256, recipientKeyId) {
  if (typeof expectedTokenSha256 !== 'string' || !HEX64.test(expectedTokenSha256) ||
      typeof recipientKeyId !== 'string' || !RECIPIENT_ID.test(recipientKeyId)) {
    throw receiverError('RECEIVER_AUTH_CONFIG_INVALID');
  }
  if (typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) {
    throw receiverError('RECEIVER_AUTH_REQUIRED');
  }
  const token = authorizationHeader.slice(7);
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw receiverError('RECEIVER_AUTH_INVALID');
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedTokenSha256, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw receiverError('RECEIVER_AUTH_INVALID');
  }
  return { recipientKeyId };
}

function validateBootstrap(value, recipientKeyId) {
  const keys = ['version', 'recipientKeyId', 'ephemeralPublicJwk', 'hkdfSalt', 'iv', 'ciphertextSha256', 'ciphertextSize'];
  if (!isObject(value) || Object.keys(value).sort().join('|') !== keys.slice().sort().join('|')) {
    throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
  }
  if (value.version !== 'dwo-receiver-bootstrap-v1' || value.recipientKeyId !== recipientKeyId ||
      !isObject(value.ephemeralPublicJwk) || value.ephemeralPublicJwk.kty !== 'EC' ||
      value.ephemeralPublicJwk.crv !== 'P-256' ||
      typeof value.ephemeralPublicJwk.x !== 'string' || typeof value.ephemeralPublicJwk.y !== 'string' ||
      typeof value.hkdfSalt !== 'string' || typeof value.iv !== 'string' ||
      !HEX64.test(value.ciphertextSha256) ||
      !Number.isSafeInteger(value.ciphertextSize) || value.ciphertextSize <= 0) {
    throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
  }
  return value;
}

function validateObjectSpecs(value, jobId) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 512) throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
  value.forEach((spec, index) => {
    if (!isObject(spec) || spec.ordinal !== index ||
        typeof spec.objectName !== 'string' ||
        spec.objectName !== 'relay/v1/' + jobId + '/o/' + String(index).padStart(4, '0') + '.bin' ||
        !Number.isSafeInteger(spec.size) || spec.size <= 0 ||
        !HEX64.test(spec.ciphertextSha256)) {
      throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
    }
  });
  return value;
}

function validateReadyJob(job, recipientKeyId) {
  if (!isObject(job) || job.status !== 'ready' || job.recipientKeyId !== recipientKeyId ||
      typeof job.jobId !== 'string' || !JOB_ID.test(job.jobId) ||
      !Number.isSafeInteger(job.totalBytes) || job.totalBytes <= 0 ||
      !Number.isSafeInteger(job.createdAt) || !Number.isSafeInteger(job.readyAt)) {
    throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
  }
  const bootstrap = validateBootstrap(job.receiverBootstrap, recipientKeyId);
  const specs = validateObjectSpecs(job.objectSpecs, job.jobId);
  if (specs[0].size !== bootstrap.ciphertextSize ||
      specs[0].ciphertextSha256 !== bootstrap.ciphertextSha256) {
    throw receiverError('RECEIVER_JOB_NOT_COMPATIBLE');
  }
  return { bootstrap, specs };
}

function validateDeps(deps, requireReadUrl) {
  if (!deps || !deps.jobStore || typeof deps.jobStore.listReady !== 'function' ||
      typeof deps.jobStore.get !== 'function') {
    throw receiverError('RECEIVER_ADAPTER_UNAVAILABLE');
  }
  if (requireReadUrl && (!deps.storage || typeof deps.storage.createReadUrl !== 'function')) {
    throw receiverError('RECEIVER_ADAPTER_UNAVAILABLE');
  }
}

export async function listReadyReceiverJobs(recipientKeyId, deps, options = {}) {
  validateDeps(deps, false);
  if (typeof recipientKeyId !== 'string' || !RECIPIENT_ID.test(recipientKeyId)) {
    throw receiverError('RECEIVER_AUTH_CONFIG_INVALID');
  }
  const limit = Number.isSafeInteger(options.limit) ? options.limit : 20;
  if (limit < 1 || limit > 50) throw receiverError('RECEIVER_INVALID_LIMIT');
  const rows = await deps.jobStore.listReady(recipientKeyId, limit);
  if (!Array.isArray(rows)) throw receiverError('RECEIVER_ADAPTER_INVALID');
  const jobs = [];
  for (const job of rows) {
    try {
      const { specs } = validateReadyJob(job, recipientKeyId);
      jobs.push({
        jobId: job.jobId,
        recipientKeyId,
        totalBytes: job.totalBytes,
        objectCount: specs.length,
        createdAt: job.createdAt,
        readyAt: job.readyAt
      });
    } catch (error) {
      if (error && error.code === 'RECEIVER_JOB_NOT_COMPATIBLE') continue;
      throw error;
    }
  }
  jobs.sort((a, b) => a.readyAt - b.readyAt || a.jobId.localeCompare(b.jobId));
  return { version: RECEIVER_API_VERSION, jobs: jobs.slice(0, limit) };
}

export async function createReceiverDownloadPlan(jobId, recipientKeyId, deps, options = {}) {
  validateDeps(deps, true);
  if (typeof jobId !== 'string' || !JOB_ID.test(jobId)) throw receiverError('RECEIVER_JOB_ID_INVALID');
  const job = await deps.jobStore.get(jobId);
  if (!job) throw receiverError('RECEIVER_JOB_NOT_FOUND');
  const { bootstrap, specs } = validateReadyJob(job, recipientKeyId);
  const ttlMs = Number.isSafeInteger(options.ttlMs) ? options.ttlMs : 5 * 60 * 1000;
  if (ttlMs < 60_000 || ttlMs > 15 * 60 * 1000) throw receiverError('RECEIVER_DOWNLOAD_TTL_INVALID');

  const objects = [];
  for (const spec of specs) {
    const downloadUrl = await deps.storage.createReadUrl({ objectName: spec.objectName, ttlMs });
    if (typeof downloadUrl !== 'string' || !downloadUrl.startsWith('https://')) {
      throw receiverError('RECEIVER_DOWNLOAD_URL_INVALID');
    }
    objects.push({
      ordinal: spec.ordinal,
      size: spec.size,
      ciphertextSha256: spec.ciphertextSha256,
      downloadUrl
    });
  }
  return {
    version: RECEIVER_API_VERSION,
    jobId,
    recipientKeyId,
    bootstrap,
    objects
  };
}

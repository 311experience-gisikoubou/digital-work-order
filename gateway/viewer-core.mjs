// Phase 8 localhost-only read-only viewer: pure logic (no HTTP, no console output).
//
// This module only reads already-verified Gateway inbox job directories
// (<inboxRoot>/<opaque jobId>/) written by Phase 6/7's atomic local-store.mjs.
// It never writes, renames, or deletes anything in the inbox. It re-validates
// receipt.json + manifest.json + work-order.json consistency on every read
// (fail closed) instead of trusting the directory name alone, and only ever
// opens files by their exact known names inside a path-traversal-safe job
// directory. Media files are only ever resolved through the manifest-derived
// attachment map, never from raw request input.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const MediaTransferPackage = require('../media-transfer-package.js');

const RECEIPT_VERSION = 'dwo-gateway-receipt-v1';
const MANIFEST_SCHEMA_VERSION = 'dwo-media-transfer-v1';
const JOB_ID = /^job_[A-Za-z0-9_-]+$/;
const ATTACHMENT_ID = /^att-[A-Za-z0-9-]{1,120}$/;
const WORK_ORDER_REF = /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const KINDS = ['image', 'video', 'audio', 'file'];

// Must stay identical to gateway/local-store.mjs so attachment filenames are predictable
// from the manifest alone, without ever trusting a filename supplied by a request.
const EXTENSION_FOR_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'audio/wav': '.wav'
};

function extensionForMime(mime) {
  return EXTENSION_FOR_MIME[mime] || '.bin';
}

function viewerError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readRegularFile(file, label = path.basename(file)) {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (_) {
    throw viewerError('VIEWER_FILE_MISSING', label);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw viewerError('VIEWER_UNSAFE_FILE_TYPE', label);
  }
  try {
    return await fs.readFile(file);
  } catch (_) {
    throw viewerError('VIEWER_FILE_MISSING', label);
  }
}

async function readJsonFile(file) {
  const buffer = await readRegularFile(file);
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    throw viewerError('VIEWER_FILE_INVALID_JSON', path.basename(file));
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function validateReceiptShape(receipt, jobId) {
  if (!isPlainObject(receipt) || receipt.version !== RECEIPT_VERSION) throw viewerError('VIEWER_MALFORMED_RECEIPT');
  if (receipt.jobId !== jobId) throw viewerError('VIEWER_MALFORMED_RECEIPT', 'jobId');
  if (typeof receipt.workOrderRef !== 'string' || !WORK_ORDER_REF.test(receipt.workOrderRef)) {
    throw viewerError('VIEWER_MALFORMED_RECEIPT', 'workOrderRef');
  }
  if (!HEX64.test(receipt.workOrderSha256 || '')) throw viewerError('VIEWER_MALFORMED_RECEIPT', 'workOrderSha256');
  if (!Number.isSafeInteger(receipt.attachmentCount) || receipt.attachmentCount < 0) {
    throw viewerError('VIEWER_MALFORMED_RECEIPT', 'attachmentCount');
  }
  if (!Number.isSafeInteger(receipt.receivedAt) || receipt.receivedAt < 0) {
    throw viewerError('VIEWER_MALFORMED_RECEIPT', 'receivedAt');
  }
}

function validateManifestShape(manifest) {
  try {
    // Reuse the canonical Phase 3 closed manifest validator rather than
    // maintaining a weaker second copy in the viewer.
    MediaTransferPackage.createProgress(manifest);
  } catch (_) {
    throw viewerError('VIEWER_MALFORMED_MANIFEST');
  }
  if (!isPlainObject(manifest) || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw viewerError('VIEWER_MALFORMED_MANIFEST');
  }
  if (typeof manifest.workOrderRef !== 'string' || !WORK_ORDER_REF.test(manifest.workOrderRef)) {
    throw viewerError('VIEWER_MALFORMED_MANIFEST', 'workOrderRef');
  }
  if (!isPlainObject(manifest.workOrder) || !HEX64.test(manifest.workOrder.sha256 || '') ||
      !Number.isSafeInteger(manifest.workOrder.size) || manifest.workOrder.size < 0) {
    throw viewerError('VIEWER_MALFORMED_MANIFEST', 'workOrder');
  }
  if (!Array.isArray(manifest.attachments)) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'attachments');
  const seen = new Set();
  manifest.attachments.forEach(entry => {
    if (!isPlainObject(entry) || !ATTACHMENT_ID.test(entry.attachmentId || '')) {
      throw viewerError('VIEWER_MALFORMED_MANIFEST', 'attachmentId');
    }
    if (seen.has(entry.attachmentId)) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'duplicate attachmentId');
    seen.add(entry.attachmentId);
    if (!KINDS.includes(entry.kind)) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'kind');
    if (typeof entry.mime !== 'string' || /[\u0000-\u001f\u007f]/u.test(entry.mime)) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'mime');
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'size');
    if (!HEX64.test(entry.sha256 || '')) throw viewerError('VIEWER_MALFORMED_MANIFEST', 'sha256');
  });
}

// Resolves "<root>/<jobId>" and defensively re-confirms the result is a direct,
// non-escaping child of root. jobId is already whitelisted by JOB_ID above, so
// this is defense in depth rather than the only guard.
function resolveJobDir(root, jobId) {
  const resolvedRoot = path.resolve(root);
  const jobDir = path.resolve(resolvedRoot, jobId);
  if (path.dirname(jobDir) !== resolvedRoot) throw viewerError('VIEWER_PATH_TRAVERSAL_REJECTED');
  return jobDir;
}

// Loads and fully fail-closed validates one candidate job directory.
// Returns a verified job record, or throws if anything is malformed,
// inconsistent, or missing. Never writes anything.
export async function loadVerifiedJob(root, jobId) {
  if (!JOB_ID.test(jobId || '')) throw viewerError('VIEWER_INVALID_JOB_ID');
  const jobDir = resolveJobDir(root, jobId);
  let jobStat;
  try {
    jobStat = await fs.lstat(jobDir);
  } catch (_) {
    throw viewerError('VIEWER_FILE_MISSING', jobId);
  }
  if (!jobStat.isDirectory() || jobStat.isSymbolicLink()) {
    throw viewerError('VIEWER_UNSAFE_FILE_TYPE', jobId);
  }

  const receipt = await readJsonFile(path.join(jobDir, 'receipt.json'));
  validateReceiptShape(receipt, jobId);

  const manifest = await readJsonFile(path.join(jobDir, 'manifest.json'));
  validateManifestShape(manifest);

  if (manifest.workOrderRef !== receipt.workOrderRef) {
    throw viewerError('VIEWER_RECEIPT_MANIFEST_MISMATCH', 'workOrderRef');
  }
  if (manifest.attachments.length !== receipt.attachmentCount) {
    throw viewerError('VIEWER_RECEIPT_MANIFEST_MISMATCH', 'attachmentCount');
  }
  if (manifest.workOrder.sha256 !== receipt.workOrderSha256) {
    throw viewerError('VIEWER_RECEIPT_MANIFEST_MISMATCH', 'workOrderSha256');
  }

  const workOrderBuffer = await readRegularFile(path.join(jobDir, 'work-order.json'), 'work-order.json');
  if (workOrderBuffer.length !== manifest.workOrder.size || sha256(workOrderBuffer) !== manifest.workOrder.sha256) {
    throw viewerError('VIEWER_WORK_ORDER_HASH_MISMATCH');
  }
  let workOrder;
  try {
    workOrder = JSON.parse(workOrderBuffer.toString('utf8'));
  } catch (_) {
    throw viewerError('VIEWER_FILE_INVALID_JSON', 'work-order.json');
  }
  if (!isPlainObject(workOrder)) throw viewerError('VIEWER_FILE_INVALID_JSON', 'work-order.json');
  if (workOrder.workOrderRef !== receipt.workOrderRef) {
    throw viewerError('VIEWER_WORK_ORDER_REF_MISMATCH');
  }

  const attachments = [];
  for (const entry of manifest.attachments) {
    const filename = entry.attachmentId + extensionForMime(entry.mime);
    const mediaPath = path.join(jobDir, 'media', filename);
    let stat;
    try {
      stat = await fs.lstat(mediaPath);
    } catch (_) {
      throw viewerError('VIEWER_ATTACHMENT_FILE_MISSING', entry.attachmentId);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw viewerError('VIEWER_UNSAFE_FILE_TYPE', entry.attachmentId);
    }
    if (stat.size !== entry.size) {
      throw viewerError('VIEWER_ATTACHMENT_SIZE_MISMATCH', entry.attachmentId);
    }
    const mediaBuffer = await readRegularFile(mediaPath, entry.attachmentId);
    if (sha256(mediaBuffer) !== entry.sha256) {
      throw viewerError('VIEWER_ATTACHMENT_HASH_MISMATCH', entry.attachmentId);
    }
    attachments.push({
      attachmentId: entry.attachmentId,
      kind: entry.kind,
      mime: entry.mime,
      size: entry.size,
      filename
    });
  }

  return {
    jobId,
    directory: jobDir,
    workOrderRef: receipt.workOrderRef,
    receivedAt: receipt.receivedAt,
    attachmentCount: manifest.attachments.length,
    workOrder,
    attachments
  };
}

// Lists verified jobs newest-first. Candidate directories that fail validation
// are skipped (fail closed) rather than crashing the whole listing; they are
// reported only as an opaque count, never with their content.
export async function listVerifiedJobs(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return { jobs: [], invalidCount: 0 };
    throw error;
  }

  const candidates = entries
    .filter(entry => entry.isDirectory() && JOB_ID.test(entry.name))
    .map(entry => entry.name);

  const jobs = [];
  let invalidCount = 0;
  for (const jobId of candidates) {
    try {
      jobs.push(await loadVerifiedJob(root, jobId));
    } catch (_) {
      invalidCount += 1;
    }
  }

  jobs.sort((a, b) => (b.receivedAt - a.receivedAt) || (a.jobId < b.jobId ? 1 : -1));
  return { jobs, invalidCount };
}

function summarizeWorkOrder(workOrder) {
  const pick = key => (typeof workOrder[key] === 'string' && workOrder[key].trim() !== '' ? workOrder[key] : null);
  return {
    clinicName: pick('clinicName'),
    doctorName: pick('doctorName'),
    patientName: pick('patientName'),
    issueDate: pick('issueDate'),
    deliveryDate: pick('deliveryDate'),
    insuranceType: pick('insuranceType')
  };
}

export function summarizeJob(job) {
  const byKind = { image: 0, video: 0, audio: 0, file: 0 };
  job.attachments.forEach(item => { byKind[item.kind] = (byKind[item.kind] || 0) + 1; });
  return {
    jobId: job.jobId,
    workOrderRef: job.workOrderRef,
    receivedAt: job.receivedAt,
    attachmentCount: job.attachmentCount,
    attachmentCountsByKind: byKind,
    workOrderSummary: summarizeWorkOrder(job.workOrder)
  };
}

// Generic, order-preserving flattening of the plaintext work-order fields for
// detail display. Only JSON-safe scalar/array/object values are included;
// output is plain data, never HTML. Callers must render it with
// textContent / safe DOM construction, never innerHTML.
export function describeWorkOrderFields(workOrder) {
  return Object.keys(workOrder)
    .filter(key => key !== 'workOrderRef')
    .map(key => ({ key, value: workOrder[key] }));
}

export function findAttachment(job, attachmentId) {
  if (!ATTACHMENT_ID.test(attachmentId || '')) return null;
  return job.attachments.find(item => item.attachmentId === attachmentId) || null;
}

export function mediaFilePath(job, attachment) {
  return path.join(job.directory, 'media', attachment.filename);
}

export const constants = Object.freeze({
  RECEIPT_VERSION,
  MANIFEST_SCHEMA_VERSION,
  JOB_ID,
  ATTACHMENT_ID,
  WORK_ORDER_REF
});

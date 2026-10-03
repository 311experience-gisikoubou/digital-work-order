import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const RECEIPT_VERSION = 'dwo-gateway-receipt-v1';
const JOB_ID = /^job_[A-Za-z0-9_-]+$/;
const ATTACHMENT_ID = /^att-[A-Za-z0-9-]{1,120}$/;

function storeError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

function extensionForMime(mime) {
  const map = {
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
  return map[mime] || '.bin';
}

async function blobToBuffer(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function') throw storeError('GATEWAY_INVALID_BLOB');
  return Buffer.from(await blob.arrayBuffer());
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readExistingReceipt(finalDir, expectedJobId, expectedWorkOrderRef) {
  try {
    const raw = await fs.readFile(path.join(finalDir, 'receipt.json'), 'utf8');
    const receipt = JSON.parse(raw);
    if (receipt.version === RECEIPT_VERSION &&
        receipt.jobId === expectedJobId &&
        receipt.workOrderRef === expectedWorkOrderRef) {
      return receipt;
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (_) {
    return false;
  }
}

export async function persistVerifiedPackage(input, options = {}) {
  const { jobId, workOrderRef, pkg, descriptorSha256 } = input || {};
  if (!JOB_ID.test(jobId || '')) throw storeError('GATEWAY_INVALID_JOB_ID');
  if (typeof workOrderRef !== 'string' || !workOrderRef.startsWith('dwo:')) {
    throw storeError('GATEWAY_INVALID_WORK_ORDER_REF');
  }
  if (!pkg || !pkg.manifest || !pkg.workOrder || !pkg.attachments) {
    throw storeError('GATEWAY_INVALID_PACKAGE');
  }
  const root = options.root;
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw storeError('GATEWAY_INVALID_ROOT');
  const now = typeof options.now === 'function' ? options.now : () => Date.now();

  await fs.mkdir(root, { recursive: true });
  const finalDir = path.join(root, jobId);
  if (await exists(finalDir)) {
    const receipt = await readExistingReceipt(finalDir, jobId, workOrderRef);
    if (!receipt) throw storeError('GATEWAY_EXISTING_JOB_CONFLICT');
    return { status: 'already-stored', directory: finalDir, receipt };
  }

  const tempDir = path.join(root, '.tmp-' + jobId + '-' + randomBytes(6).toString('hex'));
  await fs.mkdir(path.join(tempDir, 'media'), { recursive: true });

  try {
    const manifestText = JSON.stringify(pkg.manifest, null, 2) + '\n';
    await fs.writeFile(path.join(tempDir, 'manifest.json'), manifestText, { flag: 'wx' });

    const workOrderBuffer = await blobToBuffer(pkg.workOrder.blob);
    if (workOrderBuffer.length !== pkg.manifest.workOrder.size ||
        sha256(workOrderBuffer) !== pkg.manifest.workOrder.sha256) {
      throw storeError('GATEWAY_WORK_ORDER_HASH_MISMATCH');
    }
    await fs.writeFile(path.join(tempDir, 'work-order.json'), workOrderBuffer, { flag: 'wx' });

    for (const entry of pkg.manifest.attachments) {
      if (!ATTACHMENT_ID.test(entry.attachmentId || '')) throw storeError('GATEWAY_INVALID_ATTACHMENT_ID');
      const payload = pkg.attachments[entry.attachmentId];
      if (!payload || !Array.isArray(payload.chunks) || payload.chunks.length !== entry.chunks.length) {
        throw storeError('GATEWAY_ATTACHMENT_MISSING');
      }
      const buffers = [];
      for (let i = 0; i < payload.chunks.length; i += 1) {
        const buffer = await blobToBuffer(payload.chunks[i]);
        if (buffer.length !== entry.chunks[i].size || sha256(buffer) !== entry.chunks[i].sha256) {
          throw storeError('GATEWAY_ATTACHMENT_HASH_MISMATCH');
        }
        buffers.push(buffer);
      }
      const combined = Buffer.concat(buffers);
      if (combined.length !== entry.size || sha256(combined) !== entry.sha256) {
        throw storeError('GATEWAY_ATTACHMENT_HASH_MISMATCH');
      }
      const filename = entry.attachmentId + extensionForMime(entry.mime);
      await fs.writeFile(path.join(tempDir, 'media', filename), combined, { flag: 'wx' });
    }

    const receipt = {
      version: RECEIPT_VERSION,
      jobId,
      workOrderRef,
      descriptorSha256: typeof descriptorSha256 === 'string' ? descriptorSha256 : null,
      workOrderSha256: pkg.manifest.workOrder.sha256,
      attachmentCount: pkg.manifest.attachments.length,
      receivedAt: now()
    };
    await fs.writeFile(path.join(tempDir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });

    try {
      await fs.rename(tempDir, finalDir);
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'ENOTEMPTY')) {
        const existing = await readExistingReceipt(finalDir, jobId, workOrderRef);
        if (existing) {
          await fs.rm(tempDir, { recursive: true, force: true });
          return { status: 'already-stored', directory: finalDir, receipt: existing };
        }
      }
      throw error;
    }
    return { status: 'stored', directory: finalDir, receipt };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export const constants = Object.freeze({ RECEIPT_VERSION });

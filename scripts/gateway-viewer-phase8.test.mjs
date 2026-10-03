import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listVerifiedJobs,
  loadVerifiedJob
} from '../gateway/viewer-core.mjs';
import { startViewer } from '../gateway/viewer-server.mjs';
import {
  loadInboxRootFromGatewayConfig,
  validateViewerPort
} from '../gateway/viewer-config.mjs';

const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const ATT = 'att-123e4567-e89b-42d3-a456-426614174001';
const JOB_OLD = 'job_' + 'A'.repeat(43);
const JOB_NEW = 'job_' + 'B'.repeat(43);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function makeOrder(overrides = {}) {
  return {
    workOrderRef: REF,
    issueDate: '2026-10-03',
    createdAt: '2026-10-03T00:00:00Z',
    clinicName: '架空医院Phase8',
    doctorName: '架空歯科医Phase8',
    patientName: '架空患者Phase8',
    deliveryDate: '2026-10-10',
    insuranceType: 'insurance',
    selectedTeeth: ['11', '12'],
    remarks: 'Phase 8 synthetic fixture',
    ...overrides
  };
}

async function writeSyntheticJob(root, {
  jobId = JOB_OLD,
  receivedAt = 1000,
  order = makeOrder(),
  mediaBytes = Buffer.from([1, 2, 3, 4, 5, 6]),
  manifestMutator = null,
  receiptMutator = null
} = {}) {
  const dir = path.join(root, jobId);
  const mediaDir = path.join(dir, 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  const workOrderBytes = Buffer.from(JSON.stringify(order));
  const workOrderSha = sha256(workOrderBytes);
  const mediaSha = sha256(mediaBytes);
  const manifest = {
    schemaVersion: 'dwo-media-transfer-v1',
    workOrderRef: REF,
    createdAt: 1234567890,
    workOrder: {
      size: workOrderBytes.length,
      sha256: workOrderSha
    },
    attachments: [{
      attachmentId: ATT,
      kind: 'image',
      mime: 'image/jpeg',
      size: mediaBytes.length,
      sha256: mediaSha,
      chunks: [{
        index: 0,
        size: mediaBytes.length,
        sha256: mediaSha
      }]
    }]
  };
  if (manifestMutator) manifestMutator(manifest);

  const receipt = {
    version: 'dwo-gateway-receipt-v1',
    jobId,
    workOrderRef: REF,
    descriptorSha256: 'd'.repeat(64),
    workOrderSha256: workOrderSha,
    attachmentCount: manifest.attachments.length,
    receivedAt
  };
  if (receiptMutator) receiptMutator(receipt);

  await fs.writeFile(path.join(dir, 'work-order.json'), workOrderBytes);
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  await fs.writeFile(path.join(mediaDir, ATT + '.jpg'), mediaBytes);
  return { dir, manifest, receipt, order, mediaBytes };
}

async function snapshotTree(root) {
  const out = {};
  async function walk(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const rel = prefix ? prefix + '/' + entry.name : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out[rel + '/'] = 'dir';
        await walk(full, rel);
      } else if (entry.isFile()) {
        out[rel] = sha256(await fs.readFile(full));
      } else {
        out[rel] = 'other';
      }
    }
  }
  await walk(root);
  return out;
}

async function withTempRoot(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-phase8-viewer-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('Phase 8 lists only verified opaque jobs newest-first and leaves inbox bytes unchanged', async () => {
  await withTempRoot(async root => {
    await writeSyntheticJob(root, { jobId: JOB_OLD, receivedAt: 1000 });
    await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 2000 });
    await fs.mkdir(path.join(root, '.tmp-' + JOB_NEW + '-synthetic'), { recursive: true });

    const before = await snapshotTree(root);
    const result = await listVerifiedJobs(root);
    const after = await snapshotTree(root);

    assert.deepEqual(result.jobs.map(job => job.jobId), [JOB_NEW, JOB_OLD]);
    assert.equal(result.invalidCount, 0);
    assert.equal(result.jobs[0].workOrder.patientName, '架空患者Phase8');
    assert.deepEqual(after, before);
  });
});

test('Phase 8 fails closed for malformed manifest, receipt mismatch, work-order ref mismatch, and media hash mismatch', async () => {
  await withTempRoot(async root => {
    const malformed = 'job_' + 'C'.repeat(43);
    await writeSyntheticJob(root, {
      jobId: malformed,
      manifestMutator: manifest => { delete manifest.attachments[0].chunks; }
    });
    await assert.rejects(
      () => loadVerifiedJob(root, malformed),
      error => error && error.code === 'VIEWER_MALFORMED_MANIFEST'
    );

    const receiptMismatch = 'job_' + 'D'.repeat(43);
    await writeSyntheticJob(root, {
      jobId: receiptMismatch,
      receiptMutator: receipt => { receipt.attachmentCount = 99; }
    });
    await assert.rejects(
      () => loadVerifiedJob(root, receiptMismatch),
      error => error && error.code === 'VIEWER_RECEIPT_MANIFEST_MISMATCH'
    );

    const refMismatch = 'job_' + 'E'.repeat(43);
    await writeSyntheticJob(root, {
      jobId: refMismatch,
      order: makeOrder({ workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174099' })
    });
    await assert.rejects(
      () => loadVerifiedJob(root, refMismatch),
      error => error && error.code === 'VIEWER_WORK_ORDER_REF_MISMATCH'
    );

    const mediaMismatch = 'job_' + 'F'.repeat(43);
    const fixture = await writeSyntheticJob(root, { jobId: mediaMismatch });
    await fs.writeFile(path.join(fixture.dir, 'media', ATT + '.jpg'), Buffer.from([9, 9, 9, 9, 9, 9]));
    await assert.rejects(
      () => loadVerifiedJob(root, mediaMismatch),
      error => error && error.code === 'VIEWER_ATTACHMENT_HASH_MISMATCH'
    );

    const listed = await listVerifiedJobs(root);
    assert.equal(listed.jobs.length, 0);
    assert.equal(listed.invalidCount, 4);
  });
});

test('Phase 8 rejects traversal-shaped job IDs and malformed viewer config', async () => {
  await withTempRoot(async root => {
    await assert.rejects(
      () => loadVerifiedJob(root, 'job_..'),
      error => error && error.code === 'VIEWER_INVALID_JOB_ID'
    );

    const configPath = path.join(root, 'gateway-config.json');
    await fs.writeFile(configPath, '{not-json');
    await assert.rejects(
      () => loadInboxRootFromGatewayConfig(configPath),
      error => error && error.code === 'VIEWER_CONFIG_INVALID'
    );

    await fs.writeFile(configPath, JSON.stringify({ inboxRoot: 'relative-inbox' }));
    assert.equal(
      await loadInboxRootFromGatewayConfig(configPath),
      path.resolve(root, 'relative-inbox')
    );

    assert.equal(validateViewerPort(4850), 4850);
    assert.throws(() => validateViewerPort(80), error => error && error.code === 'VIEWER_INVALID_PORT');
  });
});

test('Phase 8 localhost server exposes verified detail/media and reuses digital-work-order-intake-v1 without mutating inbox', async () => {
  await withTempRoot(async root => {
    const fixture = await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 3000 });
    const before = await snapshotTree(root);
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const address = server.address();
      assert.equal(address.address, '127.0.0.1');
      const base = 'http://127.0.0.1:' + address.port;

      const listResponse = await fetch(base + '/api/jobs', { cache: 'no-store' });
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('cache-control'), 'no-store');
      assert.equal(listResponse.headers.get('x-content-type-options'), 'nosniff');
      const listPayload = await listResponse.json();
      assert.equal(listPayload.jobs.length, 1);
      assert.equal(listPayload.jobs[0].jobId, JOB_NEW);

      const detailResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(JOB_NEW));
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.workOrderRef, REF);
      assert.equal(detail.attachments.length, 1);
      assert.equal(detail.attachments[0].attachmentId, ATT);

      const mediaResponse = await fetch(base + detail.attachments[0].url);
      assert.equal(mediaResponse.status, 200);
      assert.equal(mediaResponse.headers.get('content-type'), 'image/jpeg');
      assert.equal(mediaResponse.headers.get('cache-control'), 'no-store');
      assert.equal(mediaResponse.headers.get('x-content-type-options'), 'nosniff');
      assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), fixture.mediaBytes);

      const unknownMedia = await fetch(base + '/media/' + encodeURIComponent(JOB_NEW) + '/att-not-in-manifest');
      assert.equal(unknownMedia.status, 404);

      const traversal = await fetch(base + '/api/jobs/' + encodeURIComponent('job_..'));
      assert.equal(traversal.status, 400);

      const intakeResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(JOB_NEW) + '/delivery-intake.json');
      assert.equal(intakeResponse.status, 200);
      assert.match(intakeResponse.headers.get('content-disposition') || '', /^attachment; filename="dwo_[0-9a-f-]+\.json"$/);
      const intake = await intakeResponse.json();
      assert.equal(intake.schemaVersion, 'digital-work-order-intake-v1');
      assert.equal(intake.sourceSystem, 'digital-work-order');
      assert.equal(intake.workOrderRef, REF);
      assert.equal(intake.patientDisplayName, '架空患者Phase8');
      assert.deepEqual(intake.sourceTeeth, ['11', '12']);

      const after = await snapshotTree(root);
      assert.deepEqual(after, before);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

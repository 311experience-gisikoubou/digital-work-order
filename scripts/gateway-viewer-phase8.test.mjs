import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  listVerifiedJobs,
  loadVerifiedJob
} from '../gateway/viewer-core.mjs';
import { createViewerServer, startViewer } from '../gateway/viewer-server.mjs';
import {
  loadInboxRootFromGatewayConfig,
  loadRelatedMediaConfig,
  validateViewerPort
} from '../gateway/viewer-config.mjs';
import { caseIdForFilename, scanManualRoot } from '../gateway/related-media-core.mjs';

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

// Mirrors gateway/local-store.mjs's mime->extension map (and viewer-core's
// own copy of it) so synthetic attachment filenames stay realistic. Any mime
// not listed here (HTML/SVG/JS/unknown) is stored with ".bin", exactly like
// the real receiver would store it.
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

async function writeSyntheticJob(root, {
  jobId = JOB_OLD,
  receivedAt = 1000,
  order = makeOrder(),
  mediaBytes = Buffer.from([1, 2, 3, 4, 5, 6]),
  attachmentKind = 'image',
  attachmentMime = 'image/jpeg',
  manifestMutator = null,
  receiptMutator = null
} = {}) {
  const dir = path.join(root, jobId);
  const mediaDir = path.join(dir, 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  const workOrderBytes = Buffer.from(JSON.stringify(order));
  const workOrderSha = sha256(workOrderBytes);
  const mediaSha = sha256(mediaBytes);
  const mediaFilename = ATT + extensionForMime(attachmentMime);
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
      kind: attachmentKind,
      mime: attachmentMime,
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
  await fs.writeFile(path.join(mediaDir, mediaFilename), mediaBytes);
  return { dir, manifest, receipt, order, mediaBytes, mediaFilename };
}

// Opens a raw TCP socket to 127.0.0.1:port and writes the exact bytes of
// rawRequest (already including the request line, every header line, and
// the blank line that ends the header block). This is the only way to send
// a Host/Origin header or request-target that fetch()/undici would refuse
// to construct (duplicate Host, foreign Host, absolute-form target, etc.),
// which is exactly what the PHASE8-SEC-01 guard tests below need to exercise.
function sendRawRequest(port, rawRequest) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(rawRequest);
    });
    const chunks = [];
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('VIEWER_TEST_RAW_REQUEST_TIMEOUT'));
    });
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

function parseRawResponse(raw) {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headerBlock = headerEnd === -1 ? raw : raw.slice(0, headerEnd);
  const lines = headerBlock.split('\r\n');
  const statusMatch = /^HTTP\/1\.\d (\d{3})/.exec(lines[0] || '');
  const headers = {};
  for (let i = 1; i < lines.length; i += 1) {
    const sep = lines[i].indexOf(':');
    if (sep === -1) continue;
    headers[lines[i].slice(0, sep).trim().toLowerCase()] = lines[i].slice(sep + 1).trim();
  }
  return {
    status: statusMatch ? Number(statusMatch[1]) : null,
    headers,
    body: headerEnd === -1 ? '' : raw.slice(headerEnd + 4)
  };
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

test('U13 extracts the explicit KYYMMDD-NN case id and scans direct regular files only', async () => {
  assert.equal(caseIdForFilename('技工指示書_K991231-99_架空.pdf'), 'K991231-99');
  assert.equal(caseIdForFilename('k991231-99_動画.mov'), 'K991231-99');
  assert.equal(caseIdForFilename('case-42.pdf'), null);

  await withTempRoot(async root => {
    const manual = path.join(root, 'manual');
    await fs.mkdir(path.join(manual, 'nested'), { recursive: true });
    await fs.writeFile(path.join(manual, '技工指示書_K991231-99_架空.pdf'), Buffer.from('%PDF-synthetic'));
    await fs.writeFile(path.join(manual, 'no-case.pdf'), Buffer.from('%PDF-ignore'));
    await fs.writeFile(path.join(manual, 'K991231-99_動画.mov'), Buffer.from('same-video-bytes'));
    await fs.writeFile(path.join(manual, 'K991231-99_動画 (1).mov'), Buffer.from('same-video-bytes'));
    await fs.writeFile(path.join(manual, 'nested', 'K991231-99_ネスト.mov'), Buffer.from('must-not-recurse'));
    await fs.writeFile(path.join(manual, 'ignore.txt'), Buffer.from('ignore'));

    const scanned = await scanManualRoot(manual);
    assert.equal(scanned.pdfs.length, 1);
    assert.equal(scanned.pdfs[0].caseId, 'K991231-99');
    assert.equal(scanned.videos.length, 1, 'duplicate video bytes collapse by SHA-256');
    assert.equal(scanned.allVideos.length, 2, 'both direct duplicate filenames remain resolvable for drag/drop');
    assert.ok(scanned.allVideos.every(item => !item.absolutePath.includes('nested' + path.sep)));
  });
});

test('U13 manual-root PDF/video association is local-only, atomic, deduplicated, range-playable, and fail-closed', async () => {
  await withTempRoot(async root => {
    const inbox = path.join(root, 'inbox');
    const manual = path.join(root, 'manual');
    const store = path.join(root, 'app-state', 'related-media-associations.json');
    await fs.mkdir(inbox, { recursive: true });
    await fs.mkdir(manual, { recursive: true });

    const pdfName = '技工指示書_K991231-99_架空.pdf';
    const autoVideoName = 'K991231-99_動画.mov';
    const duplicateVideoName = 'K991231-99_動画 (1).mov';
    const manualVideoName = '追加動画.mov';
    const pdfBytes = Buffer.from('%PDF-synthetic');
    const autoVideoBytes = Buffer.from('same-video-bytes-0123456789');
    const manualVideoBytes = Buffer.from('manual-video-bytes-abcdefghij');

    await fs.writeFile(path.join(manual, pdfName), pdfBytes);
    await fs.writeFile(path.join(manual, autoVideoName), autoVideoBytes);
    await fs.writeFile(path.join(manual, duplicateVideoName), autoVideoBytes);
    await fs.writeFile(path.join(manual, manualVideoName), manualVideoBytes);

    const beforeManual = await snapshotTree(manual);
    const beforeInbox = await snapshotTree(inbox);
    const server = await startViewer({
      inboxRoot: inbox,
      manualRoot: manual,
      associationStorePath: store,
      port: 0
    });

    try {
      const port = server.address().port;
      const base = 'http://127.0.0.1:' + port;

      const listing = await fetch(base + '/api/related-media/pdfs');
      assert.equal(listing.status, 200);
      const pdfs = (await listing.json()).pdfs;
      assert.equal(pdfs.length, 1);
      assert.equal(pdfs[0].caseId, 'K991231-99');
      assert.equal(pdfs[0].relatedVideoCount, 1, 'same-case duplicate copies count once');

      const detailResponse = await fetch(base + '/api/related-media/pdfs/' + encodeURIComponent(pdfs[0].token));
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.pdf.mime, 'application/pdf');
      assert.equal(detail.videos.length, 1);
      assert.equal((await fetch(base + detail.pdf.url)).headers.get('content-type'), 'application/pdf');

      const videoRange = await fetch(base + detail.videos[0].url, { headers: { Range: 'bytes=1-4' } });
      assert.equal(videoRange.status, 206);
      assert.equal(videoRange.headers.get('content-type'), 'video/quicktime');
      assert.deepEqual(Buffer.from(await videoRange.arrayBuffer()), autoVideoBytes.subarray(1, 5));

      const associateBody = {
        pdfToken: pdfs[0].token,
        video: { basename: manualVideoName, size: manualVideoBytes.length, lastModified: 0 }
      };
      const associated = await fetch(base + '/api/related-media/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(associateBody)
      });
      assert.equal(associated.status, 200);
      assert.equal((await associated.json()).videos.length, 2);

      const duplicateAssociation = await fetch(base + '/api/related-media/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(associateBody)
      });
      assert.equal(duplicateAssociation.status, 200);
      assert.equal((await duplicateAssociation.json()).videos.length, 2);

      const missing = await fetch(base + '/api/related-media/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfToken: pdfs[0].token,
          video: { basename: 'outside.mov', size: manualVideoBytes.length }
        })
      });
      assert.equal(missing.status, 404);

      const traversal = await fetch(base + '/api/related-media/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfToken: pdfs[0].token,
          video: { basename: '../outside.mov', size: manualVideoBytes.length }
        })
      });
      assert.equal(traversal.status, 422);

      const wrongMethod = await fetch(base + '/api/related-media/pdfs', { method: 'POST' });
      assert.equal(wrongMethod.status, 405);

      const rawForeign = 'GET /api/related-media/pdfs HTTP/1.1\r\n' +
        'Host: evil.example.com\r\nConnection: close\r\n\r\n';
      assert.equal(parseRawResponse(await sendRawRequest(port, rawForeign)).status, 403);

      assert.deepEqual(await snapshotTree(manual), beforeManual);
      assert.deepEqual(await snapshotTree(inbox), beforeInbox);

      const saved = JSON.parse(await fs.readFile(store, 'utf8'));
      assert.equal(saved.version, 'dwo-related-media-associations-v1');
      assert.equal(saved.links.length, 1);
      assert.deepEqual(Object.keys(saved.links[0]).sort(), ['caseId', 'createdAt', 'pdfSha256', 'videoSha256'].sort());
      assert.equal(saved.links[0].caseId, 'K991231-99');
      assert.equal(JSON.stringify(saved).includes(pdfName), false);
      assert.equal(JSON.stringify(saved).includes(manualVideoName), false);

      const stateDirNames = await fs.readdir(path.dirname(store));
      assert.equal(stateDirNames.some(name => name.endsWith('.tmp')), false, 'atomic temp is cleaned/renamed');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('U13 viewer config is disabled by default and resolves manual root with app-state outside watched data', async () => {
  await withTempRoot(async root => {
    const configPath = path.join(root, 'gateway-config.json');
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, inboxRoot: 'inbox' }));
    const disabled = await loadRelatedMediaConfig(configPath);
    assert.deepEqual(disabled, { manualRoot: null, associationStorePath: null });

    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, inboxRoot: 'inbox', manualRoot: 'manual' }));
    const enabled = await loadRelatedMediaConfig(configPath);
    assert.equal(enabled.manualRoot, path.join(root, 'manual'));
    assert.equal(path.resolve(enabled.associationStorePath).startsWith(path.resolve(root, 'manual') + path.sep), false);
    assert.equal(path.resolve(enabled.associationStorePath).startsWith(path.resolve(root, 'inbox') + path.sep), false);
  });
});

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

test('PHASE8-SEC-01: rejects foreign/missing/malformed/duplicate/wrong-port Host and a foreign absolute-form request target', async () => {
  await withTempRoot(async root => {
    await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 3000 });
    const before = await snapshotTree(root);
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const port = server.address().port;
      const validHost = '127.0.0.1:' + port;
      const wrongPort = port === 65535 ? 65534 : 65535;

      const rejectCases = [
        { label: 'foreign host', headerLines: ['Host: evil.example.com'] },
        // Node's own HTTP/1.1 parser may itself reject a missing Host with a
        // parser-level 400 before our handler ever runs; either that or our
        // application 403 is an acceptable fail-closed outcome here. The
        // HTTP/1.0 case below proves the application-layer 403 directly.
        { label: 'missing host', headerLines: [], allowParserRejection: true },
        { label: 'trailing-dot host', headerLines: ['Host: 127.0.0.1.:' + port] },
        { label: 'wrong-port host', headerLines: ['Host: 127.0.0.1:' + wrongPort] },
        { label: 'duplicate host, same value', headerLines: ['Host: ' + validHost, 'Host: ' + validHost] },
        { label: 'duplicate host, different value', headerLines: ['Host: ' + validHost, 'Host: evil.example.com'] },
        { label: 'userinfo-shaped host', headerLines: ['Host: attacker@127.0.0.1:' + port] },
        { label: 'missing-port host', headerLines: ['Host: 127.0.0.1'] }
      ];

      for (const testCase of rejectCases) {
        const raw = 'GET /api/jobs HTTP/1.1\r\n' +
          testCase.headerLines.map(h => h + '\r\n').join('') +
          'Connection: close\r\n\r\n';
        const response = parseRawResponse(await sendRawRequest(port, raw));
        if (testCase.allowParserRejection) {
          assert.ok(response.status === 400 || response.status === 403, testCase.label);
          if (response.status === 403) {
            assert.equal(response.headers['x-content-type-options'], 'nosniff', testCase.label);
          }
          continue;
        }
        assert.equal(response.status, 403, testCase.label);
        assert.equal(response.headers['x-content-type-options'], 'nosniff', testCase.label);
        assert.equal(response.headers['access-control-allow-origin'], undefined, testCase.label);
      }

      // HTTP/1.0 does not require a Host header, so Node's parser will not
      // reject this one itself; a 403 here proves our own application guard
      // (not Node's parser) is what rejects a missing Host.
      const http10NoHostRaw = 'GET /api/jobs HTTP/1.0\r\nConnection: close\r\n\r\n';
      const http10Response = parseRawResponse(await sendRawRequest(port, http10NoHostRaw));
      assert.equal(http10Response.status, 403);
      assert.equal(http10Response.headers['x-content-type-options'], 'nosniff');

      const absoluteForeign = 'GET http://evil.example.com/api/jobs HTTP/1.1\r\n' +
        'Host: ' + validHost + '\r\n' +
        'Connection: close\r\n\r\n';
      const absoluteResponse = parseRawResponse(await sendRawRequest(port, absoluteForeign));
      assert.equal(absoluteResponse.status, 403);

      // Network-path reference ("//host/path") is also not origin-form and
      // must be rejected even with an otherwise-valid Host header.
      const networkPathForeign = 'GET //evil.example.com/api/jobs HTTP/1.1\r\n' +
        'Host: ' + validHost + '\r\n' +
        'Connection: close\r\n\r\n';
      const networkPathResponse = parseRawResponse(await sendRawRequest(port, networkPathForeign));
      assert.equal(networkPathResponse.status, 403);

      const validRaw = 'GET /api/jobs HTTP/1.1\r\nHost: ' + validHost + '\r\nConnection: close\r\n\r\n';
      const validResponse = parseRawResponse(await sendRawRequest(port, validRaw));
      assert.equal(validResponse.status, 200);

      const after = await snapshotTree(root);
      assert.deepEqual(after, before);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('PHASE8-SEC-01: rejects foreign/null/invalid/duplicate Origin while allowing absent or exactly-matching Origin', async () => {
  await withTempRoot(async root => {
    await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 3000 });
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const port = server.address().port;
      const validHost = '127.0.0.1:' + port;
      const validOrigin = 'http://' + validHost;

      const rejectCases = [
        { label: 'foreign origin', origins: ['http://evil.example.com'] },
        { label: 'null origin', origins: ['null'] },
        { label: 'malformed origin', origins: ['not-a-url'] },
        { label: 'duplicate origin, same value', origins: [validOrigin, validOrigin] },
        { label: 'duplicate origin, different value', origins: [validOrigin, 'http://evil.example.com'] }
      ];

      for (const testCase of rejectCases) {
        const raw = 'GET /api/jobs HTTP/1.1\r\n' +
          'Host: ' + validHost + '\r\n' +
          testCase.origins.map(o => 'Origin: ' + o + '\r\n').join('') +
          'Connection: close\r\n\r\n';
        const response = parseRawResponse(await sendRawRequest(port, raw));
        assert.equal(response.status, 403, testCase.label);
      }

      const matchingOriginRaw = 'GET /api/jobs HTTP/1.1\r\nHost: ' + validHost + '\r\nOrigin: ' + validOrigin + '\r\nConnection: close\r\n\r\n';
      const matchingResponse = parseRawResponse(await sendRawRequest(port, matchingOriginRaw));
      assert.equal(matchingResponse.status, 200);

      const noOriginRaw = 'GET /api/jobs HTTP/1.1\r\nHost: ' + validHost + '\r\nConnection: close\r\n\r\n';
      const noOriginResponse = parseRawResponse(await sendRawRequest(port, noOriginRaw));
      assert.equal(noOriginResponse.status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('PHASE8-SEC-01: ordinary same-endpoint GET/HEAD/view/intake flows still work normally, with or without a matching Origin', async () => {
  await withTempRoot(async root => {
    const fixture = await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 3000 });
    const before = await snapshotTree(root);
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const address = server.address();
      const base = 'http://127.0.0.1:' + address.port;

      // Plain fetch() never sends a Host/Origin header beyond what the
      // platform itself attaches (Origin is a Fetch-spec forbidden header
      // name, so a script cannot override it); this represents ordinary
      // direct browser navigation/same-origin fetch with Origin absent. The
      // matching-Origin-present path is exercised with a raw socket in the
      // Origin guard test above, since that is the only way to attach an
      // explicit Origin header in this test environment.
      const listResponse = await fetch(base + '/api/jobs');
      assert.equal(listResponse.status, 200);

      const headResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(JOB_NEW), { method: 'HEAD' });
      assert.equal(headResponse.status, 200);

      const detailResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(JOB_NEW));
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();

      const mediaHeadResponse = await fetch(base + detail.attachments[0].url, { method: 'HEAD' });
      assert.equal(mediaHeadResponse.status, 200);
      assert.equal(mediaHeadResponse.headers.get('content-type'), 'image/jpeg');

      const mediaRangeResponse = await fetch(base + detail.attachments[0].url, {
        headers: { Range: 'bytes=1-3' }
      });
      assert.equal(mediaRangeResponse.status, 206);
      assert.equal(mediaRangeResponse.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await mediaRangeResponse.arrayBuffer()), fixture.mediaBytes.subarray(1, 4));

      const intakeResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(JOB_NEW) + '/delivery-intake.json');
      assert.equal(intakeResponse.status, 200);

      const after = await snapshotTree(root);
      assert.deepEqual(after, before);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('PHASE8-SEC-01: createViewerServer + server.listen(port, \'127.0.0.1\') directly (no startViewer) enforces the guard via the accepted socket\'s own local port', async () => {
  await withTempRoot(async root => {
    await writeSyntheticJob(root, { jobId: JOB_NEW, receivedAt: 3000 });
    const server = await createViewerServer({ inboxRoot: root });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const port = server.address().port;

      const validRaw = 'GET /api/jobs HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nConnection: close\r\n\r\n';
      const validResponse = parseRawResponse(await sendRawRequest(port, validRaw));
      assert.equal(validResponse.status, 200);

      const foreignRaw = 'GET /api/jobs HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n';
      const foreignResponse = parseRawResponse(await sendRawRequest(port, foreignRaw));
      assert.equal(foreignResponse.status, 403);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('PHASE8-SEC-02: serves all nine explicit allowlisted image/video/audio kind/mime pairs inline for GET/HEAD/Range with synthetic (not real decodable) bytes', async () => {
  await withTempRoot(async root => {
    const safeSpecs = [
      { letter: 'N', kind: 'image', mime: 'image/jpeg' },
      { letter: 'O', kind: 'image', mime: 'image/png' },
      { letter: 'P', kind: 'image', mime: 'image/webp' },
      { letter: 'Q', kind: 'video', mime: 'video/mp4' },
      { letter: 'R', kind: 'video', mime: 'video/quicktime' },
      { letter: 'S', kind: 'audio', mime: 'audio/m4a' },
      { letter: 'T', kind: 'audio', mime: 'audio/mp4' },
      { letter: 'U', kind: 'audio', mime: 'audio/webm' },
      { letter: 'V', kind: 'audio', mime: 'audio/wav' }
    ];

    const fixtures = [];
    for (const spec of safeSpecs) {
      // Synthetic placeholder bytes only — these are not real/decodable
      // image/video/audio data, just a distinct byte sequence per MIME used
      // to prove the server streams the exact bytes through unmodified.
      const mediaBytes = Buffer.from('synthetic-' + spec.mime + '-bytes-0123456789');
      const jobId = 'job_' + spec.letter.repeat(43);
      fixtures.push({
        spec,
        jobId,
        fixture: await writeSyntheticJob(root, {
          jobId,
          receivedAt: 6000,
          attachmentKind: spec.kind,
          attachmentMime: spec.mime,
          mediaBytes
        })
      });
    }

    const before = await snapshotTree(root);
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const address = server.address();
      const base = 'http://127.0.0.1:' + address.port;

      for (const { spec, jobId, fixture } of fixtures) {
        const detailResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(jobId));
        assert.equal(detailResponse.status, 200, spec.mime);
        const detail = await detailResponse.json();
        const mediaUrl = base + detail.attachments[0].url;

        const getResponse = await fetch(mediaUrl);
        assert.equal(getResponse.status, 200, spec.mime + ' GET');
        assert.equal(getResponse.headers.get('content-type'), spec.mime, spec.mime + ' GET content-type');
        assert.equal(getResponse.headers.get('content-disposition'), null, spec.mime + ' GET disposition');
        assert.equal(getResponse.headers.get('content-security-policy'), null, spec.mime + ' GET csp');
        assert.deepEqual(Buffer.from(await getResponse.arrayBuffer()), fixture.mediaBytes, spec.mime + ' GET bytes');

        const headResponse = await fetch(mediaUrl, { method: 'HEAD' });
        assert.equal(headResponse.status, 200, spec.mime + ' HEAD');
        assert.equal(headResponse.headers.get('content-type'), spec.mime, spec.mime + ' HEAD content-type');
        assert.equal(headResponse.headers.get('content-disposition'), null, spec.mime + ' HEAD disposition');
        assert.equal(Number(headResponse.headers.get('content-length')), fixture.mediaBytes.length, spec.mime + ' HEAD length');

        const rangeResponse = await fetch(mediaUrl, { headers: { Range: 'bytes=1-3' } });
        assert.equal(rangeResponse.status, 206, spec.mime + ' range');
        assert.equal(rangeResponse.headers.get('content-type'), spec.mime, spec.mime + ' range content-type');
        assert.equal(rangeResponse.headers.get('content-disposition'), null, spec.mime + ' range disposition');
        assert.deepEqual(
          Buffer.from(await rangeResponse.arrayBuffer()),
          fixture.mediaBytes.subarray(1, 4),
          spec.mime + ' range bytes'
        );

        const rangeHeadResponse = await fetch(mediaUrl, { method: 'HEAD', headers: { Range: 'bytes=1-3' } });
        assert.equal(rangeHeadResponse.status, 206, spec.mime + ' range HEAD');
        assert.equal(rangeHeadResponse.headers.get('content-type'), spec.mime, spec.mime + ' range HEAD content-type');
      }

      const after = await snapshotTree(root);
      assert.deepEqual(after, before);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('PHASE8-SEC-02: forces safe download headers (never inline) for HTML/SVG/JS/unknown/mismatched-kind attachments on GET/HEAD/range, and keeps real video safely playable including Range', async () => {
  await withTempRoot(async root => {
    const unsafeSpecs = [
      { jobId: 'job_' + 'H'.repeat(43), attachmentKind: 'file', attachmentMime: 'text/html', bytes: Buffer.from('<script>alert(1)</script>') },
      { jobId: 'job_' + 'I'.repeat(43), attachmentKind: 'file', attachmentMime: 'image/svg+xml', bytes: Buffer.from('<svg onload="alert(1)"></svg>') },
      { jobId: 'job_' + 'J'.repeat(43), attachmentKind: 'file', attachmentMime: 'application/javascript', bytes: Buffer.from('alert(1)') },
      { jobId: 'job_' + 'K'.repeat(43), attachmentKind: 'file', attachmentMime: 'application/x-totally-unknown', bytes: Buffer.from([1, 2, 3]) },
      // Declared kind says "image" but the manifest mime is HTML: the kind/mime
      // pair must still fail the exact allowlist and be forced to download.
      { jobId: 'job_' + 'L'.repeat(43), attachmentKind: 'image', attachmentMime: 'text/html', bytes: Buffer.from('<script>alert(1)</script>') },
      { jobId: 'job_' + 'W'.repeat(43), attachmentKind: 'file', attachmentMime: 'application/xml', bytes: Buffer.from('<?xml version="1.0"?><a/>') },
      // Generic "file" kind is never in SAFE_MIME_BY_KIND even when the
      // declared mime looks like an otherwise-allowlisted image type.
      { jobId: 'job_' + 'X'.repeat(43), attachmentKind: 'file', attachmentMime: 'image/jpeg', bytes: Buffer.from([1, 2, 3, 4]) }
    ];

    const unsafeFixtures = [];
    for (const spec of unsafeSpecs) {
      unsafeFixtures.push({
        spec,
        fixture: await writeSyntheticJob(root, {
          jobId: spec.jobId,
          receivedAt: 4000,
          attachmentKind: spec.attachmentKind,
          attachmentMime: spec.attachmentMime,
          mediaBytes: spec.bytes
        })
      });
    }

    const safeVideoJobId = 'job_' + 'M'.repeat(43);
    const safeFixture = await writeSyntheticJob(root, {
      jobId: safeVideoJobId,
      receivedAt: 5000,
      attachmentKind: 'video',
      attachmentMime: 'video/mp4',
      mediaBytes: Buffer.from('fake-mp4-bytes-0123456789')
    });

    const before = await snapshotTree(root);
    const server = await startViewer({ inboxRoot: root, port: 0 });
    try {
      const address = server.address();
      const base = 'http://127.0.0.1:' + address.port;

      for (const { spec } of unsafeFixtures) {
        const detailResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(spec.jobId));
        assert.equal(detailResponse.status, 200, spec.attachmentMime);
        const detail = await detailResponse.json();
        const mediaUrl = base + detail.attachments[0].url;
        const expectedDisposition = 'attachment; filename="' + ATT + '.bin"';

        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(mediaUrl, { method });
          assert.equal(response.status, 200, spec.attachmentMime + ' ' + method);
          assert.equal(response.headers.get('content-type'), 'application/octet-stream', spec.attachmentMime + ' ' + method);
          assert.equal(response.headers.get('content-disposition'), expectedDisposition, spec.attachmentMime + ' ' + method);
          assert.equal(response.headers.get('x-content-type-options'), 'nosniff', spec.attachmentMime + ' ' + method);
          assert.equal(
            response.headers.get('content-security-policy'),
            "default-src 'none'; sandbox",
            spec.attachmentMime + ' ' + method
          );
        }

        const rangeResponse = await fetch(mediaUrl, { headers: { Range: 'bytes=0-0' } });
        assert.equal(rangeResponse.status, 206, spec.attachmentMime + ' range');
        assert.equal(rangeResponse.headers.get('content-type'), 'application/octet-stream', spec.attachmentMime + ' range');
        assert.equal(rangeResponse.headers.get('content-disposition'), expectedDisposition, spec.attachmentMime + ' range');
        assert.equal(
          rangeResponse.headers.get('content-security-policy'),
          "default-src 'none'; sandbox",
          spec.attachmentMime + ' range'
        );
      }

      const safeDetailResponse = await fetch(base + '/api/jobs/' + encodeURIComponent(safeVideoJobId));
      assert.equal(safeDetailResponse.status, 200);
      const safeDetail = await safeDetailResponse.json();
      const safeMediaUrl = base + safeDetail.attachments[0].url;

      const safeGet = await fetch(safeMediaUrl);
      assert.equal(safeGet.status, 200);
      assert.equal(safeGet.headers.get('content-type'), 'video/mp4');
      assert.equal(safeGet.headers.get('content-disposition'), null);
      assert.equal(safeGet.headers.get('content-security-policy'), null);
      assert.deepEqual(Buffer.from(await safeGet.arrayBuffer()), safeFixture.mediaBytes);

      const safeHead = await fetch(safeMediaUrl, { method: 'HEAD' });
      assert.equal(safeHead.status, 200);
      assert.equal(safeHead.headers.get('content-type'), 'video/mp4');

      const safeRange = await fetch(safeMediaUrl, { headers: { Range: 'bytes=0-3' } });
      assert.equal(safeRange.status, 206);
      assert.equal(safeRange.headers.get('content-type'), 'video/mp4');
      assert.equal(safeRange.headers.get('content-disposition'), null);
      assert.deepEqual(Buffer.from(await safeRange.arrayBuffer()), safeFixture.mediaBytes.subarray(0, 4));

      const after = await snapshotTree(root);
      assert.deepEqual(after, before);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});

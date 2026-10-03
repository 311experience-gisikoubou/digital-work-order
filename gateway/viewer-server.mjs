// Phase 8 localhost-only read-only Gateway viewer HTTP server.
//
// Node.js built-ins only (node:http, node:fs). No new dependency is added.
// The server binds only to 127.0.0.1 and never accepts a configurable host;
// nothing here writes, renames, or deletes anything under inboxRoot.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeWorkOrderFields,
  findAttachment,
  listVerifiedJobs,
  loadVerifiedJob,
  mediaFilePath,
  summarizeJob
} from './viewer-core.mjs';
import { buildDigitalWorkOrderIntake, buildDeliveryIntakeFilename } from './delivery-intake-reuse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SCRIPT_PATH = path.join(__dirname, 'viewer-client.js');
const LOOPBACK_HOST = '127.0.0.1';

function viewerServerError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, body, contentType) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// Fail-closed job lookup errors never leak internal detail to the HTTP
// response; the caller only learns "not found" / "bad request".
function statusForJobError(code) {
  if (code === 'VIEWER_INVALID_JOB_ID' || code === 'VIEWER_PATH_TRAVERSAL_REJECTED') return 400;
  return 404;
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return null;
  }
}

function buildIndexHtml() {
  return '<!doctype html>\n' +
    '<html lang="ja">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="robots" content="noindex, nofollow">\n' +
    '<title>Gateway Viewer (localhost only)</title>\n' +
    '<style>\n' +
    'body { font-family: sans-serif; margin: 1.5rem; color: #1a1a1a; }\n' +
    'h1 { font-size: 1.2rem; }\n' +
    '#job-list { list-style: none; padding: 0; }\n' +
    '#job-list li { border: 1px solid #ccc; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.5rem; cursor: pointer; }\n' +
    '#job-list li:hover { background: #f4f4f4; }\n' +
    '.field-row { display: flex; gap: 0.5rem; padding: 0.15rem 0; border-bottom: 1px solid #eee; }\n' +
    '.field-row .key { font-weight: bold; min-width: 10rem; }\n' +
    '.media-item { margin-bottom: 1rem; }\n' +
    'img, video { max-width: 480px; display: block; }\n' +
    'audio { display: block; }\n' +
    '#detail-panel { margin-top: 1.5rem; }\n' +
    'button { cursor: pointer; }\n' +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<h1>Digital Work Order Gateway Viewer (127.0.0.1 only, read-only)</h1>\n' +
    '<p>Phase 8: lists verified received jobs from the local inbox only. Nothing here is sent anywhere.</p>\n' +
    '<ul id="job-list"></ul>\n' +
    '<section id="detail-panel"></section>\n' +
    '<script src="/viewer-client.js"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    start = size - end;
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }
  return { start, end };
}

async function handleJobList(res, inboxRoot) {
  const { jobs, invalidCount } = await listVerifiedJobs(inboxRoot);
  sendJson(res, 200, { jobs: jobs.map(summarizeJob), invalidCount });
}

async function handleJobDetail(res, inboxRoot, rawJobId) {
  const jobId = decodeSegment(rawJobId);
  if (jobId === null) {
    sendJson(res, 400, { error: 'VIEWER_INVALID_JOB_ID' });
    return;
  }
  try {
    const job = await loadVerifiedJob(inboxRoot, jobId);
    sendJson(res, 200, {
      jobId: job.jobId,
      workOrderRef: job.workOrderRef,
      receivedAt: job.receivedAt,
      fields: describeWorkOrderFields(job.workOrder),
      attachments: job.attachments.map(item => ({
        attachmentId: item.attachmentId,
        kind: item.kind,
        mime: item.mime,
        size: item.size,
        url: '/media/' + encodeURIComponent(job.jobId) + '/' + encodeURIComponent(item.attachmentId)
      }))
    });
  } catch (error) {
    sendJson(res, statusForJobError(error && error.code), { error: (error && error.code) || 'VIEWER_UNKNOWN_ERROR' });
  }
}

async function handleDeliveryIntake(res, inboxRoot, rawJobId) {
  const jobId = decodeSegment(rawJobId);
  if (jobId === null) {
    sendJson(res, 400, { error: 'VIEWER_INVALID_JOB_ID' });
    return;
  }
  let job;
  try {
    job = await loadVerifiedJob(inboxRoot, jobId);
  } catch (error) {
    sendJson(res, statusForJobError(error && error.code), { error: (error && error.code) || 'VIEWER_UNKNOWN_ERROR' });
    return;
  }
  try {
    const payload = buildDigitalWorkOrderIntake(job.workOrder);
    const filename = buildDeliveryIntakeFilename(payload.workOrderRef);
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 422, { error: (error && error.code) || 'VIEWER_DELIVERY_INTAKE_BUILD_FAILED' });
  }
}

async function handleMedia(req, res, inboxRoot, rawJobId, rawAttachmentId) {
  const jobId = decodeSegment(rawJobId);
  const attachmentId = decodeSegment(rawAttachmentId);
  if (jobId === null || attachmentId === null) {
    sendJson(res, 400, { error: 'VIEWER_INVALID_MEDIA_PATH' });
    return;
  }
  let job;
  try {
    job = await loadVerifiedJob(inboxRoot, jobId);
  } catch (error) {
    sendJson(res, statusForJobError(error && error.code), { error: (error && error.code) || 'VIEWER_UNKNOWN_ERROR' });
    return;
  }
  // Media is only ever resolved through this manifest-derived attachment map,
  // never from the raw request path, so an unknown/foreign attachmentId
  // cannot read an arbitrary file.
  const attachment = findAttachment(job, attachmentId);
  if (!attachment) {
    sendJson(res, 404, { error: 'VIEWER_ATTACHMENT_NOT_FOUND' });
    return;
  }
  const filePath = mediaFilePath(job, attachment);
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (_) {
    sendJson(res, 404, { error: 'VIEWER_ATTACHMENT_NOT_FOUND' });
    return;
  }
  if (!stat.isFile() || stat.size !== attachment.size) {
    sendJson(res, 404, { error: 'VIEWER_ATTACHMENT_NOT_FOUND' });
    return;
  }

  const range = parseRange(req.headers.range, stat.size);
  const headers = {
    'Content-Type': attachment.mime || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes'
  };
  if (range) {
    headers['Content-Range'] = 'bytes ' + range.start + '-' + range.end + '/' + stat.size;
    headers['Content-Length'] = range.end - range.start + 1;
    res.writeHead(206, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fsSync.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fsSync.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res, inboxRoot, clientScript, indexHtml) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://' + LOOPBACK_HOST);
  } catch (_) {
    sendJson(res, 400, { error: 'VIEWER_INVALID_REQUEST' });
    return;
  }
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    sendText(res, 200, indexHtml, 'text/html; charset=utf-8');
    return;
  }
  if (pathname === '/viewer-client.js') {
    sendText(res, 200, clientScript, 'application/javascript; charset=utf-8');
    return;
  }
  if (pathname === '/api/jobs') {
    await handleJobList(res, inboxRoot);
    return;
  }

  let match = pathname.match(/^\/api\/jobs\/([^/]+)\/delivery-intake\.json$/);
  if (match) {
    await handleDeliveryIntake(res, inboxRoot, match[1]);
    return;
  }

  match = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (match) {
    await handleJobDetail(res, inboxRoot, match[1]);
    return;
  }

  match = pathname.match(/^\/media\/([^/]+)\/([^/]+)$/);
  if (match) {
    await handleMedia(req, res, inboxRoot, match[1], match[2]);
    return;
  }

  sendJson(res, 404, { error: 'VIEWER_NOT_FOUND' });
}

// Builds the HTTP server (not yet listening). inboxRoot must be an absolute
// path; this function performs no network bind.
export async function createViewerServer({ inboxRoot }) {
  if (typeof inboxRoot !== 'string' || !path.isAbsolute(inboxRoot)) {
    throw viewerServerError('VIEWER_INVALID_INBOX_ROOT');
  }
  const clientScript = await fs.readFile(CLIENT_SCRIPT_PATH, 'utf8');
  const indexHtml = buildIndexHtml();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, inboxRoot, clientScript, indexHtml).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'VIEWER_INTERNAL_ERROR' });
      else res.destroy();
    });
  });
  return server;
}

// Starts listening. The host is hardcoded to the loopback address and is not
// a parameter of this function, so no caller can make the viewer reachable
// from outside the lab PC.
export async function startViewer({ inboxRoot, port }) {
  const server = await createViewerServer({ inboxRoot });
  await new Promise((resolve, reject) => {
    const onError = reject;
    server.once('error', onError);
    server.listen(port, LOOPBACK_HOST, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  return server;
}

export const constants = Object.freeze({ LOOPBACK_HOST });

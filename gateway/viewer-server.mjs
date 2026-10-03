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

// --- PHASE8-SEC-01: loopback-only Host/Origin/request-target guard ---------
//
// Every route is guarded before it ever reads the inbox. The guard only
// trusts an exact, single, well-formed match against this server's own
// bound 127.0.0.1:<port> endpoint (the same loopback endpoint printed by
// viewer.mjs). It intentionally does not allow "localhost" or any other
// alias: this server never prints or documents a "localhost" URL, so
// accepting it would only widen the trusted set without a use case.
//
// rawHeaders (not just the normalized req.headers) is inspected so that a
// duplicate Host or Origin header line cannot slip through as a single
// "first value wins" normalization performed upstream of this check.
function rawHeaderValues(rawHeaders, name) {
  const lower = name.toLowerCase();
  const values = [];
  if (!Array.isArray(rawHeaders)) return values;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (typeof rawHeaders[i] === 'string' && rawHeaders[i].toLowerCase() === lower) {
      values.push(rawHeaders[i + 1]);
    }
  }
  return values;
}

function hasControlChars(value) {
  return typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value);
}

function isExactLoopbackHost(value, expectedPort) {
  if (typeof value !== 'string' || value === '' || hasControlChars(value)) return false;
  return value === LOOPBACK_HOST + ':' + expectedPort;
}

function isExactLoopbackOrigin(value, expectedPort) {
  if (typeof value !== 'string' || value === '' || hasControlChars(value)) return false;
  return value === 'http://' + LOOPBACK_HOST + ':' + expectedPort;
}

// An absolute-form request target ("GET http://host/path HTTP/1.1") is only
// ever used by explicit proxy-style clients, never by a browser navigating
// or fetching a direct origin like this one. Rejecting every absolute-form
// target unconditionally closes off a Host-header-only bypass (a request
// whose Host header is valid but whose request-target names a different
// authority) without needing a second authority parser.
function isAbsoluteFormRequestTarget(rawUrl) {
  return typeof rawUrl === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl);
}

function denyForbidden(res) {
  sendJson(res, 403, { error: 'VIEWER_FORBIDDEN' });
}

// Returns true if the request may proceed. On false it has already written
// a generic 403 response; callers must return immediately without reading
// the inbox. expectedPort is this process's own actual bound loopback port
// (resolved after listen()), never a value supplied by the request.
function enforceLoopbackGuard(req, res, expectedPort) {
  if (!Number.isSafeInteger(expectedPort)) {
    denyForbidden(res);
    return false;
  }
  if (isAbsoluteFormRequestTarget(req.url)) {
    denyForbidden(res);
    return false;
  }
  const hostValues = rawHeaderValues(req.rawHeaders, 'host');
  if (hostValues.length !== 1 || !isExactLoopbackHost(hostValues[0], expectedPort)) {
    denyForbidden(res);
    return false;
  }
  const originValues = rawHeaderValues(req.rawHeaders, 'origin');
  if (originValues.length > 1) {
    denyForbidden(res);
    return false;
  }
  // Origin is optional (ordinary direct browser navigation/same-origin GET
  // does not send one); when present it must match this same loopback
  // endpoint exactly. This also rejects the literal "null" origin and any
  // malformed/foreign value because none of those equal the expected string.
  if (originValues.length === 1 && !isExactLoopbackOrigin(originValues[0], expectedPort)) {
    denyForbidden(res);
    return false;
  }
  return true;
}

// --- PHASE8-SEC-02: never serve an arbitrary manifest MIME inline ----------
//
// Only this exact, explicit allowlist of already-supported image/video/audio
// MIME types (kept consistent with the kind/mime pairs local-store.mjs
// already writes) may be served with their real Content-Type for inline
// playback. Everything else — the generic "file" kind, HTML, SVG,
// JavaScript, XML, unknown types, or a kind/mime mismatch — is forced to a
// plain download. A manifest hash/signature proves the bytes were not
// tampered with in transit; it proves nothing about whether those bytes are
// safe for a browser to render or execute, so that trust is never extended
// to Content-Type selection here.
const SAFE_MIME_BY_KIND = Object.freeze({
  image: new Set(['image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/quicktime']),
  audio: new Set(['audio/m4a', 'audio/mp4', 'audio/webm', 'audio/wav'])
});
const FORCED_DOWNLOAD_CSP = "default-src 'none'; sandbox";

function isSafeInlineAttachment(attachment) {
  const safeSet = SAFE_MIME_BY_KIND[attachment.kind];
  return !!safeSet && safeSet.has(attachment.mime);
}

// Builds the response headers for one media attachment. The same object is
// reused verbatim for the 200 whole-file path, the HEAD path, and the 206
// Range path, so a non-safe attachment gets identical download-forcing
// protection regardless of which of those three is requested.
function buildMediaHeaders(attachment) {
  if (isSafeInlineAttachment(attachment)) {
    return {
      'Content-Type': attachment.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes'
    };
  }
  // The filename is built only from attachmentId (already restricted to
  // `att-[A-Za-z0-9-]{1,120}` by viewer-core's ATTACHMENT_ID contract) plus a
  // fixed ".bin" suffix — never from request input, the original filename,
  // or any patient/clinic field.
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="' + attachment.attachmentId + '.bin"',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': FORCED_DOWNLOAD_CSP,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes'
  };
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
  const baseHeaders = buildMediaHeaders(attachment);
  if (range) {
    const headers = Object.assign({}, baseHeaders, {
      'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + stat.size,
      'Content-Length': range.end - range.start + 1
    });
    res.writeHead(206, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fsSync.createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  const headers = Object.assign({}, baseHeaders, { 'Content-Length': stat.size });
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fsSync.createReadStream(filePath).pipe(res);
}

async function handleRequest(req, res, inboxRoot, clientScript, indexHtml, boundPortState) {
  if (!enforceLoopbackGuard(req, res, boundPortState.port)) return;

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
  // The real bound port is only known after listen() resolves (startViewer
  // may be asked for an ephemeral port 0). boundPortState is a mutable box
  // shared with the request handler so the loopback guard above always
  // compares against this process's actual bound endpoint, never a
  // caller-supplied or request-supplied value.
  const boundPortState = { port: null };

  const server = http.createServer((req, res) => {
    handleRequest(req, res, inboxRoot, clientScript, indexHtml, boundPortState).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'VIEWER_INTERNAL_ERROR' });
      else res.destroy();
    });
  });
  server.__phase8BoundPortState = boundPortState;
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
  server.__phase8BoundPortState.port = server.address().port;
  return server;
}

export const constants = Object.freeze({ LOOPBACK_HOST });

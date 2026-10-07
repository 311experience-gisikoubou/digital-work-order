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
import { createRelatedMediaService } from './related-media-core.mjs';

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

async function readSmallJson(req, maxBytes = 2048) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw viewerServerError('RELATED_MEDIA_INVALID_DROP');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw viewerServerError('RELATED_MEDIA_INVALID_DROP');
  }
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
// Every route is guarded before it ever reads the inbox. Only an exact,
// single match against this connection's own accepted 127.0.0.1:<port> is
// trusted — never "localhost" or any other alias.
//
// rawHeaders (not req.headers) is checked so a duplicate Host/Origin line
// cannot slip through a "first value wins" normalization upstream.
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

// Only origin-form request targets ("/path...") are ever used by a browser
// navigating or fetching this direct origin. Checking this strictly before
// any URL parsing rejects absolute-form ("GET http://host/path HTTP/1.1",
// a Host-header-only bypass vector) and network-path-reference ("//host/path")
// targets alike, without needing a second authority parser.
function isOriginFormRequestTarget(rawUrl) {
  return typeof rawUrl === 'string' && rawUrl.startsWith('/') && !rawUrl.startsWith('//');
}

function denyForbidden(res) {
  sendJson(res, 403, { error: 'VIEWER_FORBIDDEN' });
}

// Returns true if the request may proceed. On false it has already written
// a generic 403 response; callers must return immediately without reading
// the inbox. expectedPort is the actual local port of the accepted socket
// for this request (req.socket.localPort), never a value from the request.
function enforceLoopbackGuard(req, res, expectedPort) {
  if (!Number.isSafeInteger(expectedPort)) {
    denyForbidden(res);
    return false;
  }
  if (!isOriginFormRequestTarget(req.url)) {
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
  // Origin is optional (ordinary same-origin GET does not send one); when
  // present it must exactly match, which also rejects "null" and any
  // malformed/foreign value.
  if (originValues.length === 1 && !isExactLoopbackOrigin(originValues[0], expectedPort)) {
    denyForbidden(res);
    return false;
  }
  return true;
}

// --- PHASE8-SEC-02: never serve an arbitrary manifest MIME inline ----------
// Only this explicit allowlist (matching the kind/mime pairs local-store.mjs
// writes) is served with its real Content-Type inline. Everything else
// (generic "file" kind, HTML, SVG, JS, XML, unknown, or a kind/mime
// mismatch) is forced to download: a manifest hash proves bytes weren't
// altered in transit, not that they're safe to render/execute.
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

// Same headers for 200, HEAD, and 206 Range paths, so a non-safe attachment
// always gets identical download-forcing protection.
function buildMediaHeaders(attachment) {
  if (isSafeInlineAttachment(attachment)) {
    return {
      'Content-Type': attachment.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes'
    };
  }
  // filename built only from the opaque attachmentId + fixed ".bin", never
  // from request input or any patient/clinic field.
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
    '.related-pdf { width: min(100%, 900px); height: 600px; border: 1px solid #ccc; }\n' +
    '.related-video { max-width: 640px; width: 100%; margin-bottom: 1rem; }\n' +
    '#related-pdf-list { list-style: none; padding: 0; }\n' +
    '.related-pdf-card { border: 2px dashed #999; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.5rem; cursor: pointer; }\n' +
    '.related-pdf-card.drop-active { background: #e9f5ff; border-color: #1677c8; }\n' +
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
    '<section id="related-media-section"><h2>手動受信PDF</h2><p>動画をPDFカードへドロップすると関連付けます。元ファイルは変更されません。</p><ul id="related-pdf-list"></ul><section id="related-detail-panel"></section></section>\n' +
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

async function handleRelatedMedia(req, res, relatedMedia, pathname) {
  if (!relatedMedia) {
    sendJson(res, 404, { error: 'RELATED_MEDIA_DISABLED' });
    return;
  }

  if (pathname === '/api/related-media/pdfs') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
      return;
    }
    sendJson(res, 200, { pdfs: await relatedMedia.listPdfs() });
    return;
  }

  let match = pathname.match(/^\/api\/related-media\/pdfs\/([^/]+)$/);
  if (match) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
      return;
    }
    const token = decodeSegment(match[1]);
    if (token === null) {
      sendJson(res, 400, { error: 'RELATED_MEDIA_PDF_NOT_FOUND' });
      return;
    }
    try {
      sendJson(res, 200, await relatedMedia.detail(token));
    } catch (error) {
      sendJson(res, 404, { error: (error && error.code) || 'RELATED_MEDIA_PDF_NOT_FOUND' });
    }
    return;
  }

  if (pathname === '/api/related-media/associate') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      sendJson(res, 200, await relatedMedia.associate(await readSmallJson(req)));
    } catch (error) {
      const code = (error && error.code) || 'RELATED_MEDIA_ASSOCIATION_FAILED';
      const status = code === 'RELATED_MEDIA_PDF_NOT_FOUND' || code === 'RELATED_MEDIA_DROP_NOT_FOUND' ? 404 : 422;
      sendJson(res, status, { error: code });
    }
    return;
  }

  match = pathname.match(/^\/manual-media\/([^/]+)$/);
  if (match) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
      return;
    }
    const token = decodeSegment(match[1]);
    if (token === null) {
      sendJson(res, 400, { error: 'RELATED_MEDIA_FILE_NOT_FOUND' });
      return;
    }
    try {
      const media = await relatedMedia.resolveMedia(token);
      const stat = await fs.lstat(media.absolutePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== media.size) {
        throw viewerServerError('RELATED_MEDIA_FILE_NOT_FOUND');
      }

      const range = parseRange(req.headers.range, stat.size);
      const baseHeaders = {
        'Content-Type': media.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes'
      };
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
        fsSync.createReadStream(media.absolutePath, { start: range.start, end: range.end }).pipe(res);
        return;
      }

      res.writeHead(200, Object.assign({}, baseHeaders, { 'Content-Length': stat.size }));
      if (req.method === 'HEAD') res.end();
      else fsSync.createReadStream(media.absolutePath).pipe(res);
    } catch (error) {
      sendJson(res, 404, { error: (error && error.code) || 'RELATED_MEDIA_FILE_NOT_FOUND' });
    }
    return;
  }

  sendJson(res, 404, { error: 'VIEWER_NOT_FOUND' });
}

async function handleRequest(req, res, inboxRoot, relatedMedia, clientScript, indexHtml) {
  if (!enforceLoopbackGuard(req, res, req.socket && req.socket.localPort)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
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

  if (pathname.startsWith('/api/related-media/') || pathname.startsWith('/manual-media/')) {
    await handleRelatedMedia(req, res, relatedMedia, pathname);
    return;
  }

  if (req.method === 'POST') {
    sendJson(res, 405, { error: 'VIEWER_METHOD_NOT_ALLOWED' });
    return;
  }

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
export async function createViewerServer({ inboxRoot, manualRoot = null, associationStorePath = null }) {
  if (typeof inboxRoot !== 'string' || !path.isAbsolute(inboxRoot)) {
    throw viewerServerError('VIEWER_INVALID_INBOX_ROOT');
  }
  const relatedMedia = manualRoot
    ? await createRelatedMediaService({ manualRoot, associationStorePath, inboxRoot })
    : null;
  const clientScript = await fs.readFile(CLIENT_SCRIPT_PATH, 'utf8');
  const indexHtml = buildIndexHtml();

  const server = http.createServer((req, res) => {
    handleRequest(req, res, inboxRoot, relatedMedia, clientScript, indexHtml).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'VIEWER_INTERNAL_ERROR' });
      else res.destroy();
    });
  });
  return server;
}

// Starts listening. The host is hardcoded to the loopback address and is not
// a parameter of this function, so no caller can make the viewer reachable
// from outside the lab PC.
export async function startViewer({ inboxRoot, port, manualRoot = null, associationStorePath = null }) {
  const server = await createViewerServer({ inboxRoot, manualRoot, associationStorePath });
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

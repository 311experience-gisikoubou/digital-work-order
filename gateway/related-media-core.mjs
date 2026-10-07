// Local-only PDF/video association support for the Gateway viewer.
//
// manualRoot is read-only: files are never copied, renamed, modified, or
// deleted. Only the separate associationStorePath is written, atomically.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const CASE_ID_RE = /K\d{6}-\d{2}/i;
const VIDEO_MIME_BY_EXTENSION = Object.freeze({
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4'
});
const STORE_VERSION = 'dwo-related-media-associations-v1';
const MAX_STORE_BYTES = 1024 * 1024;
const MAX_DROP_BYTES = 2048;
const HEX64 = /^[0-9a-f]{64}$/;

function error(code) {
  const value = new Error(code);
  value.code = code;
  return value;
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

export function caseIdForFilename(filename) {
  if (typeof filename !== 'string') return null;
  const match = filename.match(CASE_ID_RE);
  return match ? match[0].toUpperCase() : null;
}

async function hashFile(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function publicToken(file) {
  return sha256Text(file.kind + '\u0000' + file.sha256 + '\u0000' + file.basename).slice(0, 32);
}

function isSafeBasename(name) {
  return typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 255 &&
    name === path.basename(name) &&
    !/[\\/\u0000-\u001f\u007f]/u.test(name);
}

// Direct children only. No recursion and no symlink following.
export async function scanManualRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw error('RELATED_MEDIA_INVALID_ROOT');
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') throw error('RELATED_MEDIA_ROOT_NOT_FOUND');
    throw error('RELATED_MEDIA_ROOT_READ_FAILED');
  }

  const pdfs = [];
  const videos = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    const caseId = caseIdForFilename(entry.name);
    const kind = extension === '.pdf' && caseId
      ? 'pdf'
      : (VIDEO_MIME_BY_EXTENSION[extension] ? 'video' : null);
    if (!kind) continue;

    const absolutePath = path.resolve(root, entry.name);
    if (path.dirname(absolutePath) !== path.resolve(root)) continue;
    let stat;
    try {
      stat = await fs.lstat(absolutePath);
    } catch (_) {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) continue;

    const sha256 = await hashFile(absolutePath);
    const file = {
      basename: entry.name,
      absolutePath,
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      kind,
      mime: kind === 'pdf' ? 'application/pdf' : VIDEO_MIME_BY_EXTENSION[extension],
      caseId,
      sha256
    };
    file.token = publicToken(file);
    if (kind === 'pdf') pdfs.push(file);
    else videos.push(file);
  }

  pdfs.sort((a, b) => a.basename.localeCompare(b.basename, 'ja'));

  // Same bytes count as one video even when Explorer created "(1)" copies.
  videos.sort((a, b) => a.basename.localeCompare(b.basename, 'ja'));
  const allVideos = videos.slice();
  const uniqueVideos = [];
  const seenVideoHashes = new Set();
  for (const video of videos) {
    if (seenVideoHashes.has(video.sha256)) continue;
    seenVideoHashes.add(video.sha256);
    uniqueVideos.push(video);
  }
  return { pdfs, videos: uniqueVideos, allVideos };
}

function emptyStore() {
  return { version: STORE_VERSION, links: [] };
}

function validLink(link) {
  return !!link &&
    typeof link === 'object' &&
    !Array.isArray(link) &&
    Object.keys(link).length === 4 &&
    Object.keys(link).every(key => ['pdfSha256', 'videoSha256', 'caseId', 'createdAt'].includes(key)) &&
    HEX64.test(link.pdfSha256 || '') &&
    HEX64.test(link.videoSha256 || '') &&
    typeof link.caseId === 'string' &&
    caseIdForFilename(link.caseId) === link.caseId &&
    Number.isSafeInteger(link.createdAt) &&
    link.createdAt >= 0;
}

export async function readAssociationStore(storePath) {
  let bytes;
  try {
    bytes = await fs.readFile(storePath);
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') return emptyStore();
    throw error('RELATED_MEDIA_STORE_READ_FAILED');
  }
  if (bytes.length > MAX_STORE_BYTES) throw error('RELATED_MEDIA_STORE_INVALID');
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (_) {
    throw error('RELATED_MEDIA_STORE_INVALID');
  }
  if (!parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 2 ||
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.links) ||
      !parsed.links.every(validLink)) {
    throw error('RELATED_MEDIA_STORE_INVALID');
  }
  return parsed;
}

export async function writeAssociationStoreAtomic(storePath, store) {
  if (!store ||
      store.version !== STORE_VERSION ||
      !Array.isArray(store.links) ||
      !store.links.every(validLink)) {
    throw error('RELATED_MEDIA_STORE_INVALID');
  }
  const directory = path.dirname(storePath);
  await fs.mkdir(directory, { recursive: true });
  const temp = path.join(
    directory,
    '.' + path.basename(storePath) + '.' + process.pid + '.' + randomBytes(8).toString('hex') + '.tmp'
  );
  try {
    await fs.writeFile(temp, JSON.stringify(store, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, storePath);
  } catch (cause) {
    await fs.unlink(temp).catch(() => {});
    throw error('RELATED_MEDIA_STORE_WRITE_FAILED');
  }
}

function relatedForPdf(pdf, videos, store) {
  const hashes = new Set();
  for (const video of videos) {
    if (video.caseId && video.caseId === pdf.caseId) hashes.add(video.sha256);
  }
  for (const link of store.links) {
    if (link.pdfSha256 === pdf.sha256 && link.caseId === pdf.caseId) hashes.add(link.videoSha256);
  }
  return videos.filter(video => hashes.has(video.sha256));
}

function resolveDroppedVideo(videos, metadata) {
  if (!metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      !isSafeBasename(metadata.basename) ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 ||
      (metadata.lastModified !== undefined &&
       metadata.lastModified !== null &&
       (!Number.isSafeInteger(metadata.lastModified) || metadata.lastModified < 0))) {
    throw error('RELATED_MEDIA_INVALID_DROP');
  }
  // scanManualRoot has already restricted candidates to direct regular files
  // in manualRoot. Browser-supplied paths are never accepted.
  const matches = videos.filter(video =>
    video.basename === metadata.basename && video.size === metadata.size
  );
  if (matches.length !== 1) {
    throw error(matches.length ? 'RELATED_MEDIA_AMBIGUOUS_DROP' : 'RELATED_MEDIA_DROP_NOT_FOUND');
  }
  return matches[0];
}

function publicFile(file) {
  return {
    token: file.token,
    basename: file.basename,
    size: file.size,
    kind: file.kind,
    mime: file.mime,
    caseId: file.caseId,
    url: '/manual-media/' + encodeURIComponent(file.token)
  };
}

export async function createRelatedMediaService({ manualRoot = null, associationStorePath, inboxRoot }) {
  if (!manualRoot) return null;
  if (typeof associationStorePath !== 'string' ||
      !path.isAbsolute(manualRoot) ||
      !path.isAbsolute(associationStorePath) ||
      !path.isAbsolute(inboxRoot)) {
    throw error('RELATED_MEDIA_INVALID_ROOT');
  }
  if (isInside(manualRoot, associationStorePath) || isInside(inboxRoot, associationStorePath)) {
    throw error('RELATED_MEDIA_STORE_INSIDE_PROTECTED_ROOT');
  }

  const root = path.resolve(manualRoot);
  const storePath = path.resolve(associationStorePath);

  async function snapshot() {
    return await scanManualRoot(root);
  }

  async function listPdfs() {
    const [{ pdfs, videos }, store] = await Promise.all([
      snapshot(),
      readAssociationStore(storePath)
    ]);
    return pdfs.map(pdf => ({
      ...publicFile(pdf),
      relatedVideoCount: relatedForPdf(pdf, videos, store).length
    }));
  }

  async function detail(pdfToken) {
    const [{ pdfs, videos }, store] = await Promise.all([
      snapshot(),
      readAssociationStore(storePath)
    ]);
    const pdf = pdfs.find(file => file.token === pdfToken);
    if (!pdf) throw error('RELATED_MEDIA_PDF_NOT_FOUND');
    return {
      pdf: publicFile(pdf),
      videos: relatedForPdf(pdf, videos, store).map(publicFile)
    };
  }

  async function associate(drop) {
    if (!drop ||
        typeof drop !== 'object' ||
        Array.isArray(drop) ||
        JSON.stringify(drop).length > MAX_DROP_BYTES ||
        typeof drop.pdfToken !== 'string') {
      throw error('RELATED_MEDIA_INVALID_DROP');
    }
    const { pdfs, allVideos } = await snapshot();
    const pdf = pdfs.find(file => file.token === drop.pdfToken);
    if (!pdf) throw error('RELATED_MEDIA_PDF_NOT_FOUND');
    const video = resolveDroppedVideo(allVideos, drop.video);

    const store = await readAssociationStore(storePath);
    const exists = store.links.some(link =>
      link.pdfSha256 === pdf.sha256 &&
      link.videoSha256 === video.sha256 &&
      link.caseId === pdf.caseId
    );
    if (!exists) {
      store.links.push({
        pdfSha256: pdf.sha256,
        videoSha256: video.sha256,
        caseId: pdf.caseId,
        createdAt: Date.now()
      });
      await writeAssociationStoreAtomic(storePath, store);
    }
    return await detail(pdf.token);
  }

  async function resolveMedia(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
      throw error('RELATED_MEDIA_FILE_NOT_FOUND');
    }
    const { pdfs, videos } = await snapshot();
    const file = [...pdfs, ...videos].find(item => item.token === token);
    if (!file) throw error('RELATED_MEDIA_FILE_NOT_FOUND');
    return file;
  }

  return { listPdfs, detail, associate, resolveMedia };
}

export const constants = Object.freeze({
  STORE_VERSION,
  MAX_DROP_BYTES,
  CASE_ID_RE,
  VIDEO_MIME_BY_EXTENSION
});

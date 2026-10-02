// ============================================================
//  参考資料メディアの転送パッケージ（Phase 3: package / 完全性 / チャンク再開）
//  ローカルのみで完結する。外部通信・暗号化・署名・鍵・クラウドは一切扱わない。
//  Web Crypto (SHA-256) と Blob/ArrayBuffer API のみを使う。依存は追加しない。
//  manifest.json の設計は docs/design.md 15.6-15.10 に従う。
// ============================================================
(function(global) {
  'use strict';

  const SCHEMA_VERSION = 'dwo-media-transfer-v1';
  // 安全側のデフォルトチャンクサイズ（4MiB）。テストではoptions.chunkSizeで小さくできる。
  const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
  const KINDS = ['image', 'video', 'audio', 'file'];
  const WORK_ORDER_REF_RE = /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;

  const MANIFEST_KEYS = ['schemaVersion', 'workOrderRef', 'createdAt', 'workOrder', 'attachments'];
  const WORK_ORDER_FILE_KEYS = ['size', 'sha256'];
  const ATTACHMENT_KEYS = ['attachmentId', 'kind', 'mime', 'size', 'sha256', 'chunks'];
  const CHUNK_KEYS = ['index', 'size', 'sha256'];

  function transferError(code, detail) {
    const error = new Error(detail ? code + ': ' + detail : code);
    error.code = code;
    return error;
  }

  function isValidWorkOrderRef(ref) { return typeof ref === 'string' && WORK_ORDER_REF_RE.test(ref); }
  function isHex64(value) { return typeof value === 'string' && HEX64_RE.test(value); }

  // keyの集合だけを比較する（順序に依存しない。壊れたmanifestのkey不足/余剰を確実に検出する）。
  function sameKeySet(obj, expectedKeys) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const actual = Object.keys(obj).slice().sort();
    const expected = expectedKeys.slice().sort();
    if (actual.length !== expected.length) return false;
    return actual.every((key, index) => key === expected[index]);
  }

  function assertCryptoAvailable(cryptoApi) {
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function') {
      throw transferError('TRANSFER_CRYPTO_UNAVAILABLE');
    }
  }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256OfBlob(blob, cryptoApi) {
    const buffer = await blob.arrayBuffer();
    const digest = await cryptoApi.subtle.digest('SHA-256', buffer);
    return toHex(digest);
  }

  function encodeJson(value) {
    return new TextEncoder().encode(JSON.stringify(value));
  }

  function makeBlob(parts, mime) {
    return new Blob(parts, mime ? { type: mime } : undefined);
  }

  // 決定的なチャンク分割。サイズ0でも必ず1つ（空）のチャンクを作る。
  function sliceChunks(blob, chunkSize) {
    const size = blob.size;
    if (size === 0) return [blob.slice(0, 0)];
    const chunks = [];
    let offset = 0;
    while (offset < size) {
      const end = Math.min(offset + chunkSize, size);
      chunks.push(blob.slice(offset, end));
      offset = end;
    }
    return chunks;
  }

  async function buildAttachmentEntry(attachmentId, kind, mime, blob, chunkSize, cryptoApi) {
    const chunkBlobs = sliceChunks(blob, chunkSize);
    const chunkMeta = [];
    for (let i = 0; i < chunkBlobs.length; i += 1) {
      const chunk = chunkBlobs[i];
      const sha256 = await sha256OfBlob(chunk, cryptoApi);
      chunkMeta.push({ index: i, size: chunk.size, sha256 });
    }
    const fullSha256 = await sha256OfBlob(blob, cryptoApi);
    return {
      manifestEntry: { attachmentId, kind, mime, size: blob.size, sha256: fullSha256, chunks: chunkMeta },
      chunkBlobs
    };
  }

  // ---------- manifest構築 ----------
  // workOrder: プレーンなwork-orderスナップショット（患者名・医院名の有無は呼び出し側の責務）。
  // attachments: persistence.restoreOwner() と同じ形 [{ meta, blob }]。
  // 患者名・医院名は、object識別子・保存パス・転送オブジェクト名に使わない
  // （manifestにはattachmentId/kind/mime/size/sha256/chunksだけを載せ、nameは載せない）。
  async function buildPackage(workOrderRef, workOrder, attachments, options) {
    const opts = options || {};
    const cryptoApi = opts.crypto || global.crypto;
    assertCryptoAvailable(cryptoApi);
    if (!isValidWorkOrderRef(workOrderRef)) throw transferError('TRANSFER_INVALID_WORK_ORDER_REF');
    if (!workOrder || typeof workOrder !== 'object' || Array.isArray(workOrder)) throw transferError('TRANSFER_INVALID_WORK_ORDER');
    const chunkSize = Number.isInteger(opts.chunkSize) && opts.chunkSize > 0 ? opts.chunkSize : DEFAULT_CHUNK_SIZE;
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const list = Array.isArray(attachments) ? attachments : [];

    const seenIds = new Set();
    const normalized = [];
    for (const entry of list) {
      const meta = entry && entry.meta;
      const blob = entry && entry.blob;
      if (!meta || typeof meta !== 'object') throw transferError('TRANSFER_INVALID_ATTACHMENT');
      if (!blob || typeof blob.size !== 'number' || typeof blob.slice !== 'function' || typeof blob.arrayBuffer !== 'function') {
        throw transferError('TRANSFER_INVALID_ATTACHMENT');
      }
      const attachmentId = meta.attachmentId;
      if (typeof attachmentId !== 'string' || !attachmentId) throw transferError('TRANSFER_INVALID_ATTACHMENT');
      if (seenIds.has(attachmentId)) throw transferError('TRANSFER_DUPLICATE_ATTACHMENT');
      seenIds.add(attachmentId);
      if (!KINDS.includes(meta.kind)) throw transferError('TRANSFER_INVALID_ATTACHMENT');
      const mime = typeof meta.mime === 'string' ? meta.mime : '';
      if (!Number.isSafeInteger(meta.size) || meta.size !== blob.size) throw transferError('TRANSFER_INVALID_ATTACHMENT');
      normalized.push({ attachmentId, kind: meta.kind, mime, blob });
    }

    const workOrderBytes = encodeJson(workOrder);
    const workOrderBlob = makeBlob([workOrderBytes], 'application/json');
    const workOrderSha256 = await sha256OfBlob(workOrderBlob, cryptoApi);

    const attachmentsManifest = [];
    const attachmentPayload = {};
    for (const item of normalized) {
      const built = await buildAttachmentEntry(item.attachmentId, item.kind, item.mime, item.blob, chunkSize, cryptoApi);
      attachmentsManifest.push(built.manifestEntry);
      attachmentPayload[item.attachmentId] = { chunks: built.chunkBlobs };
    }

    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      workOrderRef,
      createdAt: now(),
      workOrder: { size: workOrderBytes.byteLength, sha256: workOrderSha256 },
      attachments: attachmentsManifest
    };

    return {
      manifest,
      workOrder: { blob: workOrderBlob },
      attachments: attachmentPayload
    };
  }

  // ---------- manifest構造検証（fail closed） ----------
  function malformed() { return transferError('TRANSFER_MALFORMED_MANIFEST'); }

  function validateManifestShape(manifest) {
    if (!sameKeySet(manifest, MANIFEST_KEYS)) throw malformed();
    if (manifest.schemaVersion !== SCHEMA_VERSION) throw malformed();
    if (!isValidWorkOrderRef(manifest.workOrderRef)) throw malformed();
    if (!Number.isSafeInteger(manifest.createdAt) || manifest.createdAt < 0) throw malformed();
    if (!sameKeySet(manifest.workOrder, WORK_ORDER_FILE_KEYS)) throw malformed();
    if (!Number.isSafeInteger(manifest.workOrder.size) || manifest.workOrder.size < 0) throw malformed();
    if (!isHex64(manifest.workOrder.sha256)) throw malformed();
    if (!Array.isArray(manifest.attachments)) throw malformed();

    const seenIds = new Set();
    manifest.attachments.forEach(entry => {
      if (!sameKeySet(entry, ATTACHMENT_KEYS)) throw malformed();
      if (typeof entry.attachmentId !== 'string' || !entry.attachmentId) throw malformed();
      if (seenIds.has(entry.attachmentId)) throw malformed(); // 重複attachmentId
      seenIds.add(entry.attachmentId);
      if (!KINDS.includes(entry.kind)) throw malformed();
      if (typeof entry.mime !== 'string') throw malformed();
      if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw malformed();
      if (!isHex64(entry.sha256)) throw malformed();
      if (!Array.isArray(entry.chunks) || entry.chunks.length === 0) throw malformed();
      let total = 0;
      entry.chunks.forEach((chunk, index) => {
        if (!sameKeySet(chunk, CHUNK_KEYS)) throw malformed();
        if (chunk.index !== index) throw malformed(); // 欠落・順序入替をmanifest構造の時点で検出
        if (!Number.isSafeInteger(chunk.size) || chunk.size < 0) throw malformed();
        if (!isHex64(chunk.sha256)) throw malformed();
        total += chunk.size;
      });
      if (total !== entry.size) throw malformed();
    });
  }

  // ---------- 完全性検証（fail closed） ----------
  // 改ざん・欠落・チャンクの順序入替や差替え・ハッシュ不一致・未登録の添付のいずれかを検出したら拒否する。
  async function verifyPackage(pkg, options) {
    const opts = options || {};
    const cryptoApi = opts.crypto || global.crypto;
    assertCryptoAvailable(cryptoApi);
    if (!pkg || typeof pkg !== 'object') throw transferError('TRANSFER_INVALID_PACKAGE');

    validateManifestShape(pkg.manifest);
    const manifest = pkg.manifest;

    const workOrderBlob = pkg.workOrder && pkg.workOrder.blob;
    if (!workOrderBlob || typeof workOrderBlob.arrayBuffer !== 'function') throw transferError('TRANSFER_MISSING_FILE', 'work-order.json');
    if (workOrderBlob.size !== manifest.workOrder.size) throw transferError('TRANSFER_TAMPERED', 'work-order.json size');
    const workOrderSha256 = await sha256OfBlob(workOrderBlob, cryptoApi);
    if (workOrderSha256 !== manifest.workOrder.sha256) throw transferError('TRANSFER_TAMPERED', 'work-order.json hash');

    const payloadAttachments = (pkg.attachments && typeof pkg.attachments === 'object' && !Array.isArray(pkg.attachments))
      ? pkg.attachments : {};
    const manifestIds = new Set(manifest.attachments.map(entry => entry.attachmentId));
    Object.keys(payloadAttachments).forEach(id => {
      if (!manifestIds.has(id)) throw transferError('TRANSFER_FOREIGN_ATTACHMENT', id);
    });

    for (const entry of manifest.attachments) {
      const payload = payloadAttachments[entry.attachmentId];
      if (!payload || !Array.isArray(payload.chunks)) throw transferError('TRANSFER_MISSING_FILE', entry.attachmentId);
      if (payload.chunks.length !== entry.chunks.length) throw transferError('TRANSFER_CHUNK_COUNT_MISMATCH', entry.attachmentId);

      let totalSize = 0;
      const verifiedChunks = [];
      for (let i = 0; i < entry.chunks.length; i += 1) {
        const expected = entry.chunks[i];
        const actual = payload.chunks[i];
        if (!actual || typeof actual.arrayBuffer !== 'function' || typeof actual.size !== 'number') {
          throw transferError('TRANSFER_MISSING_CHUNK', entry.attachmentId + '#' + i);
        }
        if (actual.size !== expected.size) throw transferError('TRANSFER_TAMPERED', entry.attachmentId + '#' + i + ' size');
        const sha256 = await sha256OfBlob(actual, cryptoApi);
        if (sha256 !== expected.sha256) throw transferError('TRANSFER_TAMPERED', entry.attachmentId + '#' + i + ' hash');
        totalSize += actual.size;
        verifiedChunks.push(actual);
      }
      if (totalSize !== entry.size) throw transferError('TRANSFER_TAMPERED', entry.attachmentId + ' size');
      const concatenated = makeBlob(verifiedChunks, entry.mime);
      const fullSha256 = await sha256OfBlob(concatenated, cryptoApi);
      if (fullSha256 !== entry.sha256) throw transferError('TRANSFER_TAMPERED', entry.attachmentId + ' hash');
    }

    return { ok: true, workOrderRef: manifest.workOrderRef, attachmentCount: manifest.attachments.length };
  }

  // ---------- 順次確認・再開 ----------
  // 呼び出し側は、未確認の最初のチャンク（nextChunkIndex）から再開できる。
  // 取りこぼし・順序入替の確認やmanifestとの不整合はfail closedで拒否する。
  function createProgress(manifest, savedState) {
    validateManifestShape(manifest);
    const totals = new Map();
    const counts = new Map();
    manifest.attachments.forEach(entry => {
      totals.set(entry.attachmentId, entry.chunks.length);
      counts.set(entry.attachmentId, 0);
    });

    if (savedState !== undefined && savedState !== null) {
      if (typeof savedState !== 'object' || Array.isArray(savedState)) throw transferError('TRANSFER_PROGRESS_MISMATCH');
      Object.keys(savedState).forEach(id => {
        if (!counts.has(id)) throw transferError('TRANSFER_PROGRESS_MISMATCH', id);
        const value = savedState[id];
        const total = totals.get(id);
        if (!Number.isSafeInteger(value) || value < 0 || value > total) throw transferError('TRANSFER_PROGRESS_MISMATCH', id);
        counts.set(id, value);
      });
    }

    function requireKnown(attachmentId) {
      if (!counts.has(attachmentId)) throw transferError('TRANSFER_UNKNOWN_ATTACHMENT', attachmentId);
    }

    return {
      nextChunkIndex(attachmentId) {
        requireKnown(attachmentId);
        return counts.get(attachmentId);
      },
      totalChunks(attachmentId) {
        requireKnown(attachmentId);
        return totals.get(attachmentId);
      },
      // indexは必ず「次に確認すべきチャンク」でなければならない。欠番・やり直し・完了後の確認はfail closed。
      confirmChunk(attachmentId, index) {
        requireKnown(attachmentId);
        const expected = counts.get(attachmentId);
        const total = totals.get(attachmentId);
        if (expected >= total) throw transferError('TRANSFER_PROGRESS_MISMATCH', attachmentId);
        if (!Number.isSafeInteger(index) || index !== expected) throw transferError('TRANSFER_PROGRESS_MISMATCH', attachmentId);
        counts.set(attachmentId, expected + 1);
        return { attachmentId, confirmed: expected + 1, total };
      },
      isAttachmentComplete(attachmentId) {
        requireKnown(attachmentId);
        return counts.get(attachmentId) === totals.get(attachmentId);
      },
      isComplete() {
        return manifest.attachments.every(entry => counts.get(entry.attachmentId) === totals.get(entry.attachmentId));
      },
      snapshot() {
        const out = {};
        counts.forEach((value, key) => { out[key] = value; });
        return out;
      }
    };
  }

  const api = {
    SCHEMA_VERSION,
    DEFAULT_CHUNK_SIZE,
    isValidWorkOrderRef,
    buildPackage,
    verifyPackage,
    createProgress
  };

  global.MediaTransferPackage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

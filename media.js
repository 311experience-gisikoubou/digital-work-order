// ============================================================
//  参考資料メディア（UI・録音・Object URL）
//  Object URL は表示専用で永続化しない。Blob/metadataの保存・復元・owner管理は
//  media-storage.js（ReferenceMediaStorage）が担当する。暗号・送信は扱わない。
// ============================================================
(function(global) {
  'use strict';

  const KINDS = ['image', 'video', 'audio', 'file'];
  const KIND_LABELS = { image: '写真', video: '動画', audio: '音声', file: 'ファイル' };
  const SEND_NOTICE_TEXT = '送信完了までこの画面を閉じないでください';
  const MAX_NAME_CHARS = 100;
  const FALLBACK_NAME = '無題ファイル';
  const UNSUPPORTED_MESSAGE = 'このブラウザでは添付を安全に保存できないため受注へ反映できません';
  const EXT_KIND = {
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image',
    mp4: 'video', mov: 'video', m4v: 'video', webm: 'video',
    m4a: 'audio', mp3: 'audio', wav: 'audio', aac: 'audio', ogg: 'audio'
  };
  const AUDIO_EXT = {
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav'
  };

  let idCounter = 0;

  function classifyKind(mime, name) {
    const type = typeof mime === 'string' ? mime.trim().toLowerCase() : '';
    if (type) {
      if (type.startsWith('image/')) return 'image';
      if (type.startsWith('video/')) return 'video';
      if (type.startsWith('audio/')) return 'audio';
      return 'file';
    }
    // MIMEが空の場合だけ拡張子で補助判定する。
    const match = /\.([A-Za-z0-9]+)$/.exec(typeof name === 'string' ? name : '');
    return (match && EXT_KIND[match[1].toLowerCase()]) || 'file';
  }

  function formatFileSize(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  // 表示専用の名前整形。パス区切り・制御文字を除き、長すぎる名前は拡張子を残して切る。
  function sanitizeDisplayName(name) {
    let text = typeof name === 'string' ? name : '';
    text = text.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/]+/g, '_').trim();
    if (!text || /^\.+$/.test(text)) return FALLBACK_NAME;
    const chars = Array.from(text);
    if (chars.length <= MAX_NAME_CHARS) return text;
    const dot = text.lastIndexOf('.');
    const ext = dot > 0 && text.length - dot <= 10 ? text.slice(dot) : '';
    return chars.slice(0, MAX_NAME_CHARS - Array.from(ext).length).join('') + ext;
  }

  function audioExtensionFromMime(mime) {
    const base = typeof mime === 'string' ? mime.split(';')[0].trim().toLowerCase() : '';
    return AUDIO_EXT[base] || '';
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  // 患者名・医院名は使わず、日時と実際のMIME由来の拡張子だけで作る。
  function buildRecordingName(date, mime) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate())
      + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    const ext = audioExtensionFromMime(mime);
    return '音声録音_' + stamp + (ext ? '.' + ext : '');
  }

  function generateAttachmentId() {
    idCounter += 1;
    let rand = '';
    try {
      const bytes = new Uint8Array(4);
      global.crypto.getRandomValues(bytes);
      rand = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    }
    return 'media-' + Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + rand;
  }

  // 一時添付ストア。URL生成/破棄関数を注入できるのでDOMなしでテストできる。
  function createAttachmentStore(urlApi) {
    const api = urlApi || (global.URL || {});
    const attachments = [];

    function add(blob, options) {
      const opts = options || {};
      if (!blob || typeof blob.size !== 'number') return null;
      const mime = typeof blob.type === 'string' ? blob.type : '';
      const rawName = opts.name || blob.name || '';
      let objectUrl;
      try {
        objectUrl = api.createObjectURL(blob);
      } catch (_) {
        return null;
      }
      if (!objectUrl) return null;
      const item = {
        id: typeof opts.id === 'string' && opts.id ? opts.id : generateAttachmentId(),
        source: opts.source || 'file-picker',
        kind: opts.kind && KINDS.includes(opts.kind) ? opts.kind : classifyKind(mime, rawName),
        name: sanitizeDisplayName(rawName),
        mime,
        size: blob.size,
        blob,
        objectUrl,
        createdAt: Number.isSafeInteger(opts.createdAt) ? opts.createdAt : Date.now()
      };
      attachments.push(item);
      return item;
    }

    function revokeUrl(item) {
      if (!item.objectUrl) return;
      try { api.revokeObjectURL(item.objectUrl); } catch (_) { /* 破棄失敗でも一覧処理は続ける */ }
      item.objectUrl = null;
    }

    function remove(id) {
      const index = attachments.findIndex(item => item.id === id);
      if (index < 0) return false;
      revokeUrl(attachments[index]);
      attachments.splice(index, 1);
      return true;
    }

    function clear() {
      attachments.forEach(revokeUrl);
      attachments.length = 0;
    }

    return {
      add,
      remove,
      clear,
      list: () => attachments.slice(),
      revocableUrls: () => attachments.map(item => item.objectUrl).filter(Boolean)
    };
  }

  const helpers = {
    KINDS,
    KIND_LABELS,
    SEND_NOTICE_TEXT,
    classifyKind,
    formatFileSize,
    sanitizeDisplayName,
    audioExtensionFromMime,
    buildRecordingName,
    generateAttachmentId,
    createAttachmentStore
  };
  // UI統合API。DOMがある環境では init() が実体へ差し替える。
  helpers.hasAttachments = () => false;
  helpers.commitCurrentDraft = async () => ({ committed: 0 });
  global.ReferenceMediaManager = helpers;
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;

  // ---------- DOM（documentがある場合のみ） ----------
  if (typeof document === 'undefined') return;

  function init() {
    const root = document.getElementById('media-attachments');
    if (!root) return;
    const $ = sel => root.querySelector(sel);
    const listEl = $('#media-list');
    const emptyEl = $('#media-empty');
    const errorEl = $('#media-error');
    const recordBtn = $('#media-record-btn');
    const recordingEl = $('#media-recording-indicator');
    const noticeEl = $('#media-send-notice');
    const store = createAttachmentStore();

    // ---- 永続化（media-storage.js）。非対応・初期化失敗時はPhase 1同様のメモリ内添付だけ使う。 ----
    const storageApi = global.ReferenceMediaStorage;
    let persistence = null;
    try { persistence = storageApi ? storageApi.createBrowserPersistence(global) : null; } catch (_) { persistence = null; }
    let persistenceReady = !!(persistence && persistence.available);
    const persistedIds = new Set();
    let pendingAdds = 0;
    let queue = Promise.resolve();
    // 追加・削除・復元・受注確定を直列化し、受注確定が未完了の追加を追い越さないようにする。
    function enqueue(task) {
      const run = queue.then(task);
      queue = run.catch(() => {});
      return run;
    }
    function storageError(code, message) {
      const error = new Error(code);
      error.code = code;
      error.userMessage = message;
      return error;
    }

    let recorder = null;
    let recorderStream = null;
    let recorderChunks = [];
    let recorderFinalized = false;
    let recorderStopping = false;
    let starting = false;
    let startToken = 0;

    function showError(message) {
      errorEl.textContent = message || '';
      errorEl.hidden = !message;
    }

    function makePreview(item) {
      let el;
      if (item.kind === 'image') {
        el = document.createElement('img');
        el.alt = item.name;
      } else if (item.kind === 'video') {
        el = document.createElement('video');
        el.controls = true;
        el.playsInline = true;
        el.preload = 'metadata';
      } else if (item.kind === 'audio') {
        el = document.createElement('audio');
        el.controls = true;
        el.preload = 'metadata';
      } else {
        el = document.createElement('div');
        el.className = 'media-file-card';
        el.textContent = 'FILE';
        return el;
      }
      el.className = 'media-preview media-preview-' + item.kind;
      el.src = item.objectUrl;
      return el;
    }

    function render() {
      listEl.textContent = '';
      const items = store.list();
      emptyEl.hidden = items.length > 0;
      items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'media-item';
        li.dataset.mediaId = item.id;
        li.appendChild(makePreview(item));

        const meta = document.createElement('div');
        meta.className = 'media-meta';
        const title = document.createElement('div');
        title.className = 'media-name';
        title.textContent = item.name;
        const detail = document.createElement('div');
        detail.className = 'media-detail';
        detail.textContent = KIND_LABELS[item.kind] + ' / ' + formatFileSize(item.size) + ' / ' + (item.mime || '形式不明');
        meta.append(title, detail);
        li.appendChild(meta);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn-secondary media-delete';
        del.textContent = '削除';
        del.setAttribute('aria-label', item.name + ' を削除');
        del.addEventListener('click', () => {
          if (!persistedIds.has(item.id)) {
            store.remove(item.id);
            render();
            return;
          }
          // metadata削除 -> OPFSファイルbest-effort削除。失敗時は一覧に残す。
          del.disabled = true;
          enqueue(async () => {
            try {
              await persistence.removeAttachment(item.id);
              persistedIds.delete(item.id);
              store.remove(item.id);
            } catch (error) {
              showError((error && error.userMessage) || '添付を削除できませんでした。もう一度お試しください');
            }
            render();
          });
        });
        li.appendChild(del);
        listEl.appendChild(li);
      });
    }

    function addBlob(blob, options) {
      const item = store.add(blob, options);
      if (!item) {
        showError('この資料を一覧に追加できませんでした。別のファイルでお試しください。');
        return null;
      }
      return item;
    }

    // 保存に成功してから一覧へ出す。非対応時はメモリ内だけ（受注確定時にfail closed）。
    function addAttachment(blob, options) {
      if (!persistenceReady) {
        addBlob(blob, options);
        render();
        return;
      }
      const rawName = options.name || blob.name || '';
      const kind = options.kind && KINDS.includes(options.kind) ? options.kind : classifyKind(blob.type, rawName);
      const name = sanitizeDisplayName(rawName);
      pendingAdds += 1;
      enqueue(async () => {
        try {
          const meta = await persistence.persistAttachment({
            blob, attachmentId: persistence.newAttachmentId(), source: options.source || 'file-picker', kind, name
          });
          const item = store.add(blob, { id: meta.attachmentId, source: meta.source, kind: meta.kind, name: meta.name, createdAt: meta.createdAt });
          if (!item) {
            try { await persistence.removeAttachment(meta.attachmentId); } catch (_) { /* 送信対象ではないorphanとして残るだけ */ }
            showError('この資料を一覧に追加できませんでした。別のファイルでお試しください。');
            return;
          }
          persistedIds.add(item.id);
        } catch (error) {
          showError((error && error.userMessage) || '添付を端末内に保存できませんでした。もう一度お試しください');
        } finally {
          pendingAdds -= 1;
          render();
        }
      });
    }

    function bindFileInput(id, source) {
      const input = $(id);
      const trigger = $(id + '-btn');
      trigger.addEventListener('click', () => input.click());
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        if (!files.length) { input.value = ''; return; }
        showError('');
        files.forEach(file => addAttachment(file, { source }));
        input.value = '';
      });
    }

    function stopTracks() {
      if (recorderStream) {
        try { recorderStream.getTracks().forEach(track => track.stop()); } catch (_) { /* 既に停止済み */ }
        recorderStream = null;
      }
    }

    function setRecordingUi(active) {
      recordingEl.hidden = !active;
      recordBtn.textContent = active ? '録音を停止' : '音声を録音';
      recordBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    function finalizeRecording(discard) {
      if (recorderFinalized) return;
      recorderFinalized = true;
      const chunks = recorderChunks;
      const rec = recorder;
      recorder = null;
      recorderChunks = [];
      recorderStopping = false;
      stopTracks();
      setRecordingUi(false);
      if (discard || !chunks.length) return;
      const type = (chunks[0] && chunks[0].type) || (rec && rec.mimeType) || '';
      const blob = new Blob(chunks, type ? { type } : undefined);
      if (!blob.size) return;
      addAttachment(blob, { source: 'recording', kind: 'audio', name: buildRecordingName(new Date(), blob.type) });
    }

    function stopRecording() {
      if (!recorder || recorderStopping) return;
      recorderStopping = true;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        else finalizeRecording(false);
      } catch (_) {
        finalizeRecording(false);
      }
    }

    async function startRecording() {
      if (recorder || starting) return;
      if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || typeof global.MediaRecorder === 'undefined') {
        showError('この端末・ブラウザでは音声録音を利用できません。「ファイルから追加」で録音済みの音声を追加してください。');
        return;
      }
      showError('');
      starting = true;
      const token = ++startToken;
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (token !== startToken) { stream.getTracks().forEach(t => t.stop()); return; }
        const rec = new global.MediaRecorder(stream);
        recorder = rec;
        recorderStream = stream;
        recorderChunks = [];
        recorderFinalized = false;
        recorderStopping = false;
        rec.addEventListener('dataavailable', event => {
          if (event.data && event.data.size > 0) recorderChunks.push(event.data);
        });
        rec.addEventListener('stop', () => finalizeRecording(false));
        rec.addEventListener('error', () => {
          showError('録音中にエラーが発生しました。録音を中止しました。');
          finalizeRecording(true);
        });
        rec.start();
        setRecordingUi(true);
      } catch (error) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        recorder = null;
        recorderStream = null;
        const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
        showError(denied
          ? 'マイクの使用が許可されていません。Safariの設定でマイクを許可してから、もう一度お試しください。'
          : '録音を開始できませんでした。マイクの接続を確認してください。');
        setRecordingUi(false);
      } finally {
        starting = false;
      }
    }

    recordBtn.addEventListener('click', () => {
      if (recorder) stopRecording();
      else startRecording();
    });

    bindFileInput('#media-photo-input', 'camera-photo');
    bindFileInput('#media-video-input', 'camera-video');
    bindFileInput('#media-file-input', 'file-picker');

    function releaseAll() {
      startToken += 1;
      if (recorder) {
        recorderStopping = true;
        try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) { /* 無視 */ }
        finalizeRecording(true);
      }
      stopTracks();
      store.clear();
      persistedIds.clear();
      render();
    }
    // beforeunloadは離脱確認でキャンセルされ得るため、確定後に必ず発火するpagehideで解放する。
    global.addEventListener('pagehide', releaseAll);

    // Phase 5の送信中状態で使う共通文言。通常時は非表示のまま。
    noticeEl.textContent = SEND_NOTICE_TEXT;
    noticeEl.hidden = true;
    helpers.setSendingNoticeVisible = visible => { noticeEl.hidden = !visible; };

    // 受注確定時: 現在のdraft添付を workOrderRef へ紐付ける。失敗時は例外（呼び出し側が受注反映を中止する）。
    helpers.hasAttachments = () => store.list().length + pendingAdds > 0;
    helpers.commitCurrentDraft = workOrderRef => enqueue(async () => {
      const items = store.list();
      if (!items.length) return { committed: 0 };
      if (!persistenceReady || items.some(item => !persistedIds.has(item.id))) {
        const error = storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
        showError(error.userMessage);
        throw error;
      }
      let receipt;
      try {
        receipt = await persistence.commitDraftToWorkOrder(workOrderRef);
      } catch (error) {
        showError((error && error.userMessage) || UNSUPPORTED_MESSAGE);
        throw error;
      }
      // 紐付け成功後は画面上の一覧とObject URLだけ空にする（OPFSファイルとmetadataは保持）。
      persistedIds.clear();
      store.clear();
      showError('');
      render();
      return { committed: receipt.count };
    });

    render();
    if (persistenceReady) {
      enqueue(async () => {
        const draft = await persistence.getOrCreateActiveDraft();
        const restored = await persistence.restoreOwner(draft);
        restored.items.forEach(({ meta, blob }) => {
          const item = store.add(blob, { id: meta.attachmentId, source: meta.source, kind: meta.kind, name: meta.name, createdAt: meta.createdAt });
          if (item) persistedIds.add(item.id);
        });
        render();
      }).catch(error => {
        // 復元に失敗してもアプリは壊さない。以後の添付はメモリ内のみとし、受注確定時にfail closedする。
        persistenceReady = false;
        showError((error && error.userMessage) || '端末内に保存された添付を読み込めませんでした');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(globalThis);

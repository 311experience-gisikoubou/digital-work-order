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
  const UNPERSISTED_MESSAGE = '端末内に保存できていない添付があるため受注へ反映できません。その添付を削除するか、もう一度追加してください';
  const UNRENDERED_MESSAGE = '端末内の添付を画面に表示できなかったため受注へ反映できません。ページを再読み込みしてからもう一度お試しください';
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
  // 受注確定時の判定（純関数）。'fail' | 'skip' | 'commit'。
  // 未保存の添付が1件でもあれば fail。永続化不可で添付0件なら従来フロー(skip)。永続化可なら0件でも commit（active draft更新・不正行の検出）。
  function decideCommit(state) {
    const items = state.items || [];
    // 添付が画面の一覧へ出せなかった場合は、可視項目が0件でも再読込まで確定させない。
    if (state.hiddenAttachmentBlock) return 'fail';
    if (!state.persistenceReady) return items.length ? 'fail' : 'skip';
    if (items.some(item => !state.persistedIds.has(item.id))) return 'fail';
    return 'commit';
  }
  helpers.decideCommit = decideCommit;
  helpers.hasAttachments = () => false;
  helpers.commitCurrentDraft = async () => ({ committed: 0 });
  helpers.rollbackCommittedDraft = async () => ({ rolledBack: 0 });
  helpers.discardCurrentDraft = async () => ({ removed: 0 });
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
    // 添付を一覧(in-memory store)へ出せなかった件数。セッション限定で、再読込で0に戻り、永続済み分は復元を再試行する。
    let materializationFailureCount = 0;
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

    // canonicalなdraftRefはFormDraftManager（唯一のdraft authority）から取得する。
    // 有効な下書きが無い場合はFormDraftManager経由で確保する。media-storage.js自身は
    // 独立したactive draftを生成・ローテーションしない。確保できない場合はfail closed。
    function requireFormDraftRef() {
      const manager = global.FormDraftManager;
      if (!manager || typeof manager.getCurrentDraftRef !== 'function' || typeof manager.ensureCurrentDraftRef !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      const current = manager.getCurrentDraftRef();
      if (current) return current;
      const ensured = manager.ensureCurrentDraftRef();
      if (!ensured || !ensured.ok || !ensured.draftRef) throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      return ensured.draftRef;
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
          const draftRef = requireFormDraftRef();
          const meta = await persistence.persistAttachment({
            blob, attachmentId: persistence.newAttachmentId(), source: options.source || 'file-picker', kind, name, draftRef
          });
          const item = store.add(blob, { id: meta.attachmentId, source: meta.source, kind: meta.kind, name: meta.name, createdAt: meta.createdAt });
          if (!item) {
            // 永続化は成功済み。OPFS/metadataは消さず、再読込で復元を再試行する。このセッションでは受注確定を止める。
            materializationFailureCount += 1;
            showError(UNRENDERED_MESSAGE);
            return;
          }
          persistedIds.add(item.id);
        } catch (error) {
          // 保存に失敗した添付は未保存項目として一覧に残す（persistedIdsへは入れない）。受注確定はfail closedし、削除か再追加を促す。
          if (!store.add(blob, { source: options.source || 'file-picker', kind, name })) materializationFailureCount += 1;
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

    // 受注確定時（将来の正式発行フロー用API）: 現在の canonical form draftRef 配下の添付を
    // workOrderRef へ紐付ける。media-storage側のactive draftはローテーションしない。
    // 失敗時は例外（呼び出し側が受注反映を中止する）。
    helpers.hasAttachments = () => store.list().length + pendingAdds > 0;
    helpers.commitCurrentDraft = workOrderRef => enqueue(async () => {
      const decision = decideCommit({ items: store.list(), persistedIds, persistenceReady, hiddenAttachmentBlock: materializationFailureCount > 0 });
      if (decision === 'skip') return { committed: 0 };
      if (decision === 'fail') {
        const error = storageError('MEDIA_STORAGE_UNAVAILABLE', materializationFailureCount > 0 ? UNRENDERED_MESSAGE : persistenceReady ? UNPERSISTED_MESSAGE : UNSUPPORTED_MESSAGE);
        showError(error.userMessage);
        throw error;
      }
      let draftRef;
      try {
        draftRef = requireFormDraftRef();
      } catch (error) {
        showError(error.userMessage || UNSUPPORTED_MESSAGE);
        throw error;
      }
      let receipt;
      try {
        receipt = await persistence.commitDraftToWorkOrder(draftRef, workOrderRef);
      } catch (error) {
        showError((error && error.userMessage) || UNSUPPORTED_MESSAGE);
        throw error;
      }
      // 紐付け成功後は画面上の一覧とObject URLだけ空にする（OPFSファイルとmetadataは保持）。
      persistedIds.clear();
      store.clear();
      showError('');
      render();
      return { committed: receipt.count, draftRef: receipt.draftRef };
    });

    // 発行後工程が失敗した場合の補償処理。workOrderRefへ移した添付を元draftRefへ戻し、
    // 画面一覧も同じdraftから再構成する。通常の取消・削除操作には使わない。
    helpers.rollbackCommittedDraft = (workOrderRef, draftRef) => enqueue(async () => {
      if (!persistenceReady || !persistence || typeof persistence.rollbackWorkOrderToDraft !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      let receipt;
      try {
        receipt = await persistence.rollbackWorkOrderToDraft(workOrderRef, draftRef);
        const restored = await persistence.restoreOwner(draftRef);
        persistedIds.clear();
        store.clear();
        materializationFailureCount = 0;
        restored.items.forEach(({ meta, blob }) => {
          const item = store.add(blob, {
            id: meta.attachmentId,
            source: meta.source,
            kind: meta.kind,
            name: meta.name,
            createdAt: meta.createdAt
          });
          if (item) persistedIds.add(item.id);
          else materializationFailureCount += 1;
        });
        if (restored.missing > 0 || restored.invalid > 0 || restored.corrupt > 0 || materializationFailureCount > 0) {
          throw storageError('MEDIA_STORAGE_RESTORE_FAILED', UNRENDERED_MESSAGE);
        }
        showError('');
        render();
        return { rolledBack: receipt.count };
      } catch (error) {
        showError((error && error.userMessage) || UNSUPPORTED_MESSAGE);
        throw error;
      }
    });

    // 明示的な下書き破棄専用: 指定draftRef配下の添付metadata/OPFSを削除する。
    // metadata削除が完了できない場合は例外（呼び出し側=下書き破棄処理が下書き自体を保持する）。
    helpers.discardCurrentDraft = draftRef => enqueue(async () => {
      if (!persistenceReady) {
        persistedIds.clear();
        store.clear();
        materializationFailureCount = 0;
        showError('');
        render();
        return { removed: 0 };
      }
      try {
        const result = await persistence.removeOwner(draftRef);
        persistedIds.clear();
        store.clear();
        materializationFailureCount = 0;
        showError('');
        render();
        return result;
      } catch (error) {
        showError((error && error.userMessage) || '添付を削除できませんでした。もう一度お試しください');
        throw error;
      }
    });

    // Phase 3: 非UIの転送パッケージ作成ヘルパー。ボタン・自動実行・送信は持たない。
    // 既存キュー・persistence.restoreOwner(workOrderRef) を再利用し、MediaTransferPackageへ委譲する。
    // persistence不可／restoreが欠落・不正・破損を報告した場合はfail closed（部分的なパッケージを作らない）。
    helpers.prepareTransferPackage = (workOrder, options) => enqueue(async () => {
      if (!persistenceReady || !persistence || typeof persistence.restoreOwner !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      const transferApi = global.MediaTransferPackage;
      if (!transferApi || typeof transferApi.buildPackage !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      const workOrderRef = workOrder && workOrder.workOrderRef;
      let restored;
      try {
        restored = await persistence.restoreOwner(workOrderRef);
      } catch (error) {
        throw storageError('MEDIA_STORAGE_RESTORE_FAILED', (error && error.userMessage) || UNRENDERED_MESSAGE);
      }
      if (restored.missing > 0 || restored.invalid > 0 || restored.corrupt > 0) {
        throw storageError('MEDIA_STORAGE_RESTORE_FAILED', UNRENDERED_MESSAGE);
      }
      return transferApi.buildPackage(workOrderRef, workOrder, restored.items, options);
    });

    // Phase 4: 非UIの暗号化転送エンベロープ作成ヘルパー。ボタン・自動実行・送信・鍵の永続化は持たない。
    // 既存の prepareTransferPackage（直列化キューを内部で使う）をそのまま呼び、
    // 得られたPhase 3パッケージを MediaTransferCrypto.encryptPackage へ委譲するだけ。
    helpers.prepareEncryptedTransferEnvelope = async (workOrder, senderIdentity, recipientPublicInfo, options) => {
      const cryptoApi = global.MediaTransferCrypto;
      if (!cryptoApi || typeof cryptoApi.encryptPackage !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      const opts = options || {};
      const pkg = await helpers.prepareTransferPackage(workOrder, opts.packageOptions);
      return cryptoApi.encryptPackage(pkg, senderIdentity, recipientPublicInfo, opts.cryptoOptions);
    };

    // Phase 5: 暗号Envelopeだけを明示的なrelay endpointへ送る非UIヘルパー。
    // 自動送信・endpoint固定・credential保持は行わず、呼び出し側が明示したoptionsだけを使う。
    helpers.uploadEncryptedTransferEnvelope = async (workOrder, senderIdentity, recipientPublicInfo, options) => {
      const relayApi = global.MediaRelayTransport;
      if (!relayApi || typeof relayApi.uploadEnvelope !== 'function') {
        throw storageError('MEDIA_STORAGE_UNAVAILABLE', UNSUPPORTED_MESSAGE);
      }
      const opts = options || {};
      const envelope = await helpers.prepareEncryptedTransferEnvelope(
        workOrder,
        senderIdentity,
        recipientPublicInfo,
        {
          packageOptions: opts.packageOptions,
          cryptoOptions: opts.cryptoOptions
        }
      );
      const relayOptions = Object.assign({}, opts.relayOptions || {}, { recipientPublicInfo });
      return relayApi.uploadEnvelope(envelope, senderIdentity, relayOptions);
    };

    render();
    if (persistenceReady) {
      enqueue(async () => {
        const draftRef = requireFormDraftRef();
        const restored = await persistence.restoreOwner(draftRef);
        if (restored.missing > 0 || restored.invalid > 0 || restored.corrupt > 0) showError('保存できなかった添付を除外しました。必要な資料は再追加してください。');
        restored.items.forEach(({ meta, blob }) => {
          const item = store.add(blob, { id: meta.attachmentId, source: meta.source, kind: meta.kind, name: meta.name, createdAt: meta.createdAt });
          if (item) persistedIds.add(item.id);
          else materializationFailureCount += 1;
        });
        if (materializationFailureCount > 0) showError(UNRENDERED_MESSAGE);
        render();
      }).catch(error => {
        // 復元に失敗してもアプリは壊さない。以後の添付はメモリ内のみとし、受注確定時にfail closedする。
        persistenceReady = false;
        materializationFailureCount += 1; // 永続済みの添付が非表示のまま残り得るため、再読込まで確定させない
        showError((error && error.userMessage) || '端末内に保存された添付を読み込めませんでした');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(globalThis);

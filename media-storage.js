// ============================================================
//  参考資料メディアのローカル永続化（Phase 2）
//  Blob本体: OPFS（dwo-media-v1/blobs/<attachmentId>）
//  metadata : IndexedDB（dwo_media_v1）
//  外部通信・暗号化・送信は扱わない。UI/録音/Object URLは media.js が担当する。
// ============================================================
(function(global) {
  'use strict';

  const SCHEMA_VERSION = 'dwo-media-meta-v1';
  const DB_NAME = 'dwo_media_v1';
  const DB_VERSION = 1;
  const STORE_ATTACHMENTS = 'attachments';
  const STORE_SETTINGS = 'settings';
  const ACTIVE_DRAFT_KEY = 'activeDraft';
  const OPFS_ROOT_DIR = 'dwo-media-v1';
  const OPFS_BLOB_DIR = 'blobs';
  const OPFS_PATH_PREFIX = OPFS_ROOT_DIR + '/' + OPFS_BLOB_DIR + '/';

  // 将来分まで厳格に定義する。Phase 2で作るのは unsent のみ。
  const STATUSES = Object.freeze(['unsent', 'sending', 'cloud_uploaded', 'lab_receipt_pending', 'lab_received', 'deletable']);
  const INITIAL_STATUS = 'unsent';
  const STATUS_LABELS = Object.freeze({
    unsent: '未送信', sending: '送信中', cloud_uploaded: 'クラウド送信済み',
    lab_receipt_pending: '技工所受領待ち', lab_received: '技工所受領済み', deletable: '削除可能'
  });
  const KINDS = Object.freeze(['image', 'video', 'audio', 'file']);
  const SOURCES = Object.freeze(['camera-photo', 'camera-video', 'recording', 'file-picker']);
  const OWNER_TYPES = Object.freeze(['draft', 'work-order']);
  const META_KEYS = Object.freeze([
    'schemaVersion', 'attachmentId', 'ownerType', 'ownerRef', 'status', 'source',
    'kind', 'name', 'mime', 'size', 'createdAt', 'opfsName'
  ]);

  const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
  const ATTACHMENT_ID_RE = new RegExp('^att-' + UUID_V4 + '$');
  const DRAFT_REF_RE = new RegExp('^draft:' + UUID_V4 + '$');
  const WORK_ORDER_REF_RE = new RegExp('^dwo:' + UUID_V4 + '$');
  const MAX_NAME_CHARS = 100;
  const MAX_MIME_CHARS = 255;

  const MESSAGES = Object.freeze({
    MEDIA_STORAGE_UNAVAILABLE: 'このブラウザでは添付を安全に保存できないため受注へ反映できません',
    MEDIA_STORAGE_QUOTA: '端末の空き容量が不足しているため、添付を保存できませんでした',
    MEDIA_STORAGE_WRITE_FAILED: '添付を端末内に保存できませんでした。もう一度お試しください',
    MEDIA_STORAGE_DELETE_FAILED: '添付を削除できませんでした。もう一度お試しください',
    MEDIA_STORAGE_RESTORE_FAILED: '端末内に保存された添付を読み込めませんでした',
    MEDIA_STORAGE_FILE_MISSING: '端末内の添付が見つからないため受注へ反映できません。添付を確認してください',
    MEDIA_STORAGE_COMMIT_FAILED: '添付を受注へ紐付けできなかったため、受注へ反映しませんでした。もう一度お試しください',
    MEDIA_STORAGE_INVALID: '添付の保存情報が不正なため受注へ反映できません'
  });

  function makeError(code, cause) {
    const error = new Error(code);
    error.code = code;
    error.userMessage = MESSAGES[code] || MESSAGES.MEDIA_STORAGE_WRITE_FAILED;
    if (cause !== undefined) error.cause = cause;
    return error;
  }

  function isQuotaError(error) {
    return !!error && (error.name === 'QuotaExceededError' || error.code === 22);
  }

  // ---------- 純粋validation ----------
  function hasControlChars(text) { return /[\u0000-\u001f\u007f]/.test(text); }

  function isValidStatus(status) { return typeof status === 'string' && STATUSES.includes(status); }
  function isValidAttachmentId(id) { return typeof id === 'string' && ATTACHMENT_ID_RE.test(id); }
  function isValidDraftRef(ref) { return typeof ref === 'string' && DRAFT_REF_RE.test(ref); }
  function isValidWorkOrderRef(ref) { return typeof ref === 'string' && WORK_ORDER_REF_RE.test(ref); }

  function randomUuidV4(cryptoApi) {
    const api = cryptoApi === undefined ? global.crypto : cryptoApi;
    if (!api) throw makeError('MEDIA_STORAGE_UNAVAILABLE');
    let uuid;
    if (typeof api.randomUUID === 'function') {
      uuid = String(api.randomUUID()).toLowerCase();
    } else if (typeof api.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      api.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
      uuid = hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' + hex.slice(6, 8).join('')
        + '-' + hex.slice(8, 10).join('') + '-' + hex.slice(10, 16).join('');
    } else {
      throw makeError('MEDIA_STORAGE_UNAVAILABLE');
    }
    if (!new RegExp('^' + UUID_V4 + '$').test(uuid)) throw makeError('MEDIA_STORAGE_UNAVAILABLE');
    return uuid;
  }

  function newAttachmentId(cryptoApi) { return 'att-' + randomUuidV4(cryptoApi); }
  function newDraftRef(cryptoApi) { return 'draft:' + randomUuidV4(cryptoApi); }

  // 物理パスは固定形式。元ファイル名・患者・医院・workOrderRefは含めない。
  function opfsPathFor(attachmentId) {
    if (!isValidAttachmentId(attachmentId)) throw makeError('MEDIA_STORAGE_INVALID');
    return OPFS_PATH_PREFIX + attachmentId;
  }

  // 戻り値: null（妥当）または理由コード文字列。未知/禁止プロパティはすべて不正（fail closed）。
  function metadataProblem(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'not-object';
    if (Object.getPrototypeOf(meta) !== Object.prototype) return 'not-plain-object';
    const keys = Object.keys(meta);
    if (keys.some(key => !META_KEYS.includes(key))) return 'unknown-property';
    if (META_KEYS.some(key => !keys.includes(key))) return 'missing-property';
    if (meta.schemaVersion !== SCHEMA_VERSION) return 'schema-version';
    if (!isValidAttachmentId(meta.attachmentId)) return 'attachment-id';
    if (!OWNER_TYPES.includes(meta.ownerType)) return 'owner-type';
    if (meta.ownerType === 'draft' ? !isValidDraftRef(meta.ownerRef) : !isValidWorkOrderRef(meta.ownerRef)) return 'owner-ref';
    if (!isValidStatus(meta.status)) return 'status';
    if (!SOURCES.includes(meta.source)) return 'source';
    if (!KINDS.includes(meta.kind)) return 'kind';
    if (typeof meta.name !== 'string' || !meta.name || Array.from(meta.name).length > MAX_NAME_CHARS
      || hasControlChars(meta.name) || /[\\/]/.test(meta.name)) return 'name';
    if (typeof meta.mime !== 'string' || meta.mime.length > MAX_MIME_CHARS || hasControlChars(meta.mime)) return 'mime';
    if (!Number.isSafeInteger(meta.size) || meta.size < 0) return 'size';
    if (!Number.isSafeInteger(meta.createdAt) || meta.createdAt < 0) return 'created-at';
    if (meta.opfsName !== meta.attachmentId) return 'opfs-name';
    return null;
  }

  function isValidMetadata(meta) { return metadataProblem(meta) === null; }

  function buildMetadata(fields) {
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      attachmentId: fields.attachmentId,
      ownerType: 'draft',
      ownerRef: fields.ownerRef,
      status: INITIAL_STATUS,
      source: fields.source,
      kind: fields.kind,
      name: fields.name,
      mime: fields.mime,
      size: fields.size,
      createdAt: fields.createdAt,
      opfsName: fields.attachmentId
    };
    if (metadataProblem(meta)) throw makeError('MEDIA_STORAGE_INVALID');
    return meta;
  }

  // draft所有のmetadataを work-order所有へ付け替える（Blobの物理パスは変えない）。
  function rebindMetadata(meta, workOrderRef) {
    if (!isValidWorkOrderRef(workOrderRef)) throw makeError('MEDIA_STORAGE_INVALID');
    if (metadataProblem(meta) || meta.ownerType !== 'draft') return null;
    return Object.assign({}, meta, { ownerType: 'work-order', ownerRef: workOrderRef });
  }

  // ---------- テスト用メモリadapter ----------
  // failOn: { put, get, exists, delete, putAttachment, deleteAttachment, listByOwner, commit }
  function createMemoryBlobStore(options) {
    const failOn = (options && options.failOn) || {};
    const files = new Map();
    const guard = op => { if (failOn[op]) throw (typeof failOn[op] === 'object' ? failOn[op] : new Error('memory-blob-' + op)); };
    return {
      files,
      failOn,
      async put(name, blob) { guard('put'); files.set(name, blob); },
      async get(name) { guard('get'); return files.has(name) ? files.get(name) : null; },
      async exists(name) { guard('exists'); return files.has(name); },
      async delete(name) { guard('delete'); files.delete(name); }
    };
  }

  function createMemoryMetaStore(options) {
    const failOn = (options && options.failOn) || {};
    const records = new Map();
    const settings = new Map();
    const guard = op => { if (failOn[op]) throw (typeof failOn[op] === 'object' ? failOn[op] : new Error('memory-meta-' + op)); };
    const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    return {
      records,
      settings,
      failOn,
      async putAttachment(meta) { guard('putAttachment'); records.set(meta.attachmentId, clone(meta)); },
      async getAttachment(id) { return clone(records.get(id)); },
      async deleteAttachment(id) { guard('deleteAttachment'); records.delete(id); },
      async listByOwner(ownerRef) { guard('listByOwner'); return Array.from(records.values()).filter(r => r && r.ownerRef === ownerRef).map(clone); },
      async getActiveDraft() { return clone(settings.get(ACTIVE_DRAFT_KEY)); },
      async putActiveDraft(ref) { settings.set(ACTIVE_DRAFT_KEY, { key: ACTIVE_DRAFT_KEY, value: ref }); },
      // 全件変換に成功した場合だけ反映する（atomic）。
      async commitDraft(args) {
        guard('commit');
        const current = settings.get(ACTIVE_DRAFT_KEY);
        if (!current || current.value !== args.fromDraft) throw new Error('active-draft-mismatch');
        const next = [];
        records.forEach(record => {
          if (record && record.ownerRef === args.fromDraft) {
            const updated = args.rebind(clone(record));
            if (updated) next.push(updated);
          }
        });
        next.forEach(updated => records.set(updated.attachmentId, clone(updated)));
        settings.set(ACTIVE_DRAFT_KEY, { key: ACTIVE_DRAFT_KEY, value: args.newDraft });
        return next.length;
      }
    };
  }

  // ---------- 永続化本体（adapter注入） ----------
  function createPersistence(deps) {
    const blobStore = deps.blobStore;
    const metaStore = deps.metaStore;
    const cryptoApi = deps.crypto;
    const now = deps.now || (() => Date.now());

    async function getOrCreateActiveDraft() {
      let record;
      try { record = await metaStore.getActiveDraft(); } catch (error) { throw makeError('MEDIA_STORAGE_UNAVAILABLE', error); }
      if (record && record.key === ACTIVE_DRAFT_KEY && isValidDraftRef(record.value)) return record.value;
      // 未作成または不正なrecordは新しいdraftへ置き換える（不正recordが指すmetadataは復元・送信の対象にならない）。
      const ref = newDraftRef(cryptoApi);
      try { await metaStore.putActiveDraft(ref); } catch (error) { throw makeError('MEDIA_STORAGE_UNAVAILABLE', error); }
      return ref;
    }

    async function persistAttachment(input) {
      const blob = input && input.blob;
      if (!blob || typeof blob.size !== 'number') throw makeError('MEDIA_STORAGE_INVALID');
      const ownerRef = await getOrCreateActiveDraft();
      const attachmentId = input.attachmentId || newAttachmentId(cryptoApi);
      const meta = buildMetadata({
        attachmentId,
        ownerRef,
        source: input.source,
        kind: input.kind,
        name: input.name,
        mime: typeof blob.type === 'string' ? blob.type : '',
        size: blob.size,
        createdAt: now()
      });
      // 1) OPFS -> 2) metadata の順。OPFS失敗時はmetadataを作らない。
      try {
        await blobStore.put(meta.opfsName, blob);
      } catch (error) {
        throw makeError(isQuotaError(error) ? 'MEDIA_STORAGE_QUOTA' : 'MEDIA_STORAGE_WRITE_FAILED', error);
      }
      try {
        await metaStore.putAttachment(meta);
      } catch (error) {
        try { await blobStore.delete(meta.opfsName); } catch (_) { /* best-effort rollback */ }
        throw makeError(isQuotaError(error) ? 'MEDIA_STORAGE_QUOTA' : 'MEDIA_STORAGE_WRITE_FAILED', error);
      }
      return meta;
    }

    // 戻り値: { items, missing, invalid, corrupt }。
    // 不正metadata・size不一致は「見えない受注ブロッカー」にならないよう、metadataを先に削除し、OPFSファイルはbest-effortで消す。
    // metadataを削除できない場合は掃除成功を装わず MEDIA_STORAGE_RESTORE_FAILED で失敗（fail closed）。
    async function restoreOwner(ownerRef) {
      if (!isValidDraftRef(ownerRef) && !isValidWorkOrderRef(ownerRef)) throw makeError('MEDIA_STORAGE_INVALID');
      let rows;
      try { rows = await metaStore.listByOwner(ownerRef); } catch (error) { throw makeError('MEDIA_STORAGE_RESTORE_FAILED', error); }
      const items = [];
      let missing = 0;
      let invalid = 0;
      let corrupt = 0;
      async function cleanMetadata(attachmentId) {
        try { await metaStore.deleteAttachment(attachmentId); } catch (error) { throw makeError('MEDIA_STORAGE_RESTORE_FAILED', error); }
      }
      async function cleanFile(attachmentId) {
        if (!isValidAttachmentId(attachmentId)) return;
        try { await blobStore.delete(attachmentId); } catch (_) { /* orphanは送信対象ではない */ }
      }
      for (const meta of rows) {
        // 別ownerの行を誤って消さない（indexが返す行は常にownerRef一致のはず）。
        if (meta && meta.ownerRef !== ownerRef) throw makeError('MEDIA_STORAGE_INVALID');
        if (metadataProblem(meta)) {
          const rawId = meta && typeof meta === 'object' ? meta.attachmentId : undefined;
          if (rawId === undefined || rawId === null) throw makeError('MEDIA_STORAGE_RESTORE_FAILED');
          await cleanMetadata(rawId);
          await cleanFile(rawId);
          invalid += 1;
          continue;
        }
        let file;
        try { file = await blobStore.get(meta.opfsName); } catch (error) { throw makeError('MEDIA_STORAGE_RESTORE_FAILED', error); }
        if (!file) {
          await cleanMetadata(meta.attachmentId);
          missing += 1;
          continue;
        }
        if (file.size !== meta.size) {
          await cleanMetadata(meta.attachmentId);
          await cleanFile(meta.attachmentId);
          corrupt += 1;
          continue;
        }
        const blob = new Blob([file], meta.mime ? { type: meta.mime } : undefined);
        items.push({ meta, blob });
      }
      items.sort((a, b) => a.meta.createdAt - b.meta.createdAt);
      return { items, missing, invalid, corrupt };
    }

    // metadataを先に削除して復元・送信の対象から外し、その後OPFSファイルをbest-effortで消す。
    async function removeAttachment(attachmentId) {
      if (!isValidAttachmentId(attachmentId)) throw makeError('MEDIA_STORAGE_INVALID');
      try { await metaStore.deleteAttachment(attachmentId); } catch (error) { throw makeError('MEDIA_STORAGE_DELETE_FAILED', error); }
      let fileDeleted = true;
      try { await blobStore.delete(attachmentId); } catch (_) { fileDeleted = false; /* orphanとして残り得るが送信対象ではない */ }
      return { metadataDeleted: true, fileDeleted };
    }

    // active draftの全metadataを work-order 所有へ付け替え、active draftを新規draftへ更新する（1 transaction）。
    async function commitDraftToWorkOrder(workOrderRef) {
      if (!isValidWorkOrderRef(workOrderRef)) throw makeError('MEDIA_STORAGE_INVALID');
      const previousDraft = await getOrCreateActiveDraft();
      const nextDraft = newDraftRef(cryptoApi);
      try {
        const rows = await metaStore.listByOwner(previousDraft);
        // 1行でも不正・owner不一致・size不一致・欠落なら、metadata transactionの前に全体を中止する。
        for (const meta of rows) {
          if (metadataProblem(meta) || meta.ownerRef !== previousDraft || meta.ownerType !== 'draft') throw makeError('MEDIA_STORAGE_INVALID');
        }
        for (const meta of rows) {
          const file = await blobStore.get(meta.opfsName);
          if (!file) throw makeError('MEDIA_STORAGE_FILE_MISSING');
          if (file.size !== meta.size) throw makeError('MEDIA_STORAGE_INVALID');
        }
        const count = await metaStore.commitDraft({
          fromDraft: previousDraft,
          newDraft: nextDraft,
          rebind: meta => rebindMetadata(meta, workOrderRef)
        });
        return { workOrderRef, previousDraft, activeDraft: nextDraft, count };
      } catch (error) {
        if (error && (error.code === 'MEDIA_STORAGE_FILE_MISSING' || error.code === 'MEDIA_STORAGE_INVALID')) throw error;
        throw makeError('MEDIA_STORAGE_COMMIT_FAILED', error);
      }
    }

    return {
      available: true,
      newAttachmentId: () => newAttachmentId(cryptoApi),
      getOrCreateActiveDraft,
      persistAttachment,
      restoreOwner,
      removeAttachment,
      commitDraftToWorkOrder
    };
  }

  function createUnavailablePersistence(reason) {
    const fail = async () => { throw makeError('MEDIA_STORAGE_UNAVAILABLE'); };
    return {
      available: false,
      reason: reason || 'unsupported',
      newAttachmentId: () => null,
      getOrCreateActiveDraft: fail,
      persistAttachment: fail,
      restoreOwner: fail,
      removeAttachment: fail,
      commitDraftToWorkOrder: fail
    };
  }

  // ---------- ブラウザadapter（OPFS / IndexedDB） ----------
  function supportsOpfs(env) {
    const storage = env && env.navigator && env.navigator.storage;
    const handleProto = env && env.FileSystemFileHandle && env.FileSystemFileHandle.prototype;
    // iPad Safariの古い版はメインスレッドのcreateWritableが無い。無ければ非対応として安全側に倒す。
    return !!(storage && typeof storage.getDirectory === 'function' && handleProto && typeof handleProto.createWritable === 'function');
  }

  function createOpfsBlobStore(env) {
    let dirPromise = null;
    function blobDir() {
      if (!dirPromise) {
        dirPromise = env.navigator.storage.getDirectory()
          .then(root => root.getDirectoryHandle(OPFS_ROOT_DIR, { create: true }))
          .then(dir => dir.getDirectoryHandle(OPFS_BLOB_DIR, { create: true }));
        dirPromise.catch(() => { dirPromise = null; });
      }
      return dirPromise;
    }
    function checkName(name) { if (!isValidAttachmentId(name)) throw makeError('MEDIA_STORAGE_INVALID'); }
    async function handleOf(name, create) {
      const dir = await blobDir();
      try {
        return await dir.getFileHandle(name, create ? { create: true } : undefined);
      } catch (error) {
        if (!create && error && error.name === 'NotFoundError') return null;
        throw error;
      }
    }
    return {
      async put(name, blob) {
        checkName(name);
        const handle = await handleOf(name, true);
        const writable = await handle.createWritable();
        try {
          await writable.write(blob);
          await writable.close();
        } catch (error) {
          try { await writable.abort(); } catch (_) { /* 既に閉じている */ }
          throw error;
        }
      },
      async get(name) {
        checkName(name);
        const handle = await handleOf(name, false);
        return handle ? handle.getFile() : null;
      },
      async exists(name) {
        checkName(name);
        return (await handleOf(name, false)) !== null;
      },
      async delete(name) {
        checkName(name);
        const dir = await blobDir();
        try { await dir.removeEntry(name); } catch (error) { if (!error || error.name !== 'NotFoundError') throw error; }
      }
    };
  }

  function createIndexedDbMetaStore(env) {
    let dbPromise = null;

    function open() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const request = env.indexedDB.open(DB_NAME, DB_VERSION);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
              db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'attachmentId' }).createIndex('ownerRef', 'ownerRef', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error('idb-open-failed'));
          request.onblocked = () => reject(new Error('idb-open-blocked'));
        });
        dbPromise.catch(() => { dbPromise = null; });
      }
      return dbPromise;
    }

    // 1 transaction内の処理を実行し、transaction完了で解決する。
    async function run(storeNames, mode, work) {
      const db = await open();
      return new Promise((resolve, reject) => {
        let tx;
        let result;
        try {
          tx = db.transaction(storeNames, mode);
        } catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('idb-tx-error'));
        tx.onabort = () => reject(tx.error || new Error('idb-tx-abort'));
        try {
          work(tx, value => { result = value; }, error => { try { tx.abort(); } catch (_) { /* 既に終了 */ } reject(error); });
        } catch (error) {
          try { tx.abort(); } catch (_) { /* 既に終了 */ }
          reject(error);
        }
      });
    }

    return {
      putAttachment(meta) {
        return run([STORE_ATTACHMENTS], 'readwrite', tx => { tx.objectStore(STORE_ATTACHMENTS).put(meta); });
      },
      getAttachment(id) {
        return run([STORE_ATTACHMENTS], 'readonly', (tx, set) => {
          tx.objectStore(STORE_ATTACHMENTS).get(id).onsuccess = event => set(event.target.result);
        });
      },
      deleteAttachment(id) {
        return run([STORE_ATTACHMENTS], 'readwrite', tx => { tx.objectStore(STORE_ATTACHMENTS).delete(id); });
      },
      listByOwner(ownerRef) {
        return run([STORE_ATTACHMENTS], 'readonly', (tx, set) => {
          tx.objectStore(STORE_ATTACHMENTS).index('ownerRef').getAll(ownerRef).onsuccess = event => set(event.target.result || []);
        });
      },
      getActiveDraft() {
        return run([STORE_SETTINGS], 'readonly', (tx, set) => {
          tx.objectStore(STORE_SETTINGS).get(ACTIVE_DRAFT_KEY).onsuccess = event => set(event.target.result);
        });
      },
      putActiveDraft(ref) {
        return run([STORE_SETTINGS], 'readwrite', tx => { tx.objectStore(STORE_SETTINGS).put({ key: ACTIVE_DRAFT_KEY, value: ref }); });
      },
      // metadata付け替えとactive draft更新を同一transactionで行う。途中失敗はabortで全体を戻す。
      commitDraft(args) {
        return run([STORE_ATTACHMENTS, STORE_SETTINGS], 'readwrite', (tx, set, fail) => {
          const settings = tx.objectStore(STORE_SETTINGS);
          const attachments = tx.objectStore(STORE_ATTACHMENTS);
          settings.get(ACTIVE_DRAFT_KEY).onsuccess = event => {
            const current = event.target.result;
            if (!current || current.value !== args.fromDraft) { fail(new Error('active-draft-mismatch')); return; }
            attachments.index('ownerRef').getAll(args.fromDraft).onsuccess = listEvent => {
              try {
                let moved = 0;
                (listEvent.target.result || []).forEach(record => {
                  const updated = args.rebind(record);
                  if (updated) { attachments.put(updated); moved += 1; }
                });
                settings.put({ key: ACTIVE_DRAFT_KEY, value: args.newDraft });
                set(moved);
              } catch (error) { fail(error); }
            };
          };
        });
      }
    };
  }

  function createBrowserPersistence(env) {
    const scope = env || global;
    if (!scope.indexedDB) return createUnavailablePersistence('indexeddb-unsupported');
    if (!supportsOpfs(scope)) return createUnavailablePersistence('opfs-unsupported');
    try {
      return createPersistence({
        blobStore: createOpfsBlobStore(scope),
        metaStore: createIndexedDbMetaStore(scope),
        crypto: scope.crypto
      });
    } catch (_) {
      return createUnavailablePersistence('init-failed');
    }
  }

  const api = {
    SCHEMA_VERSION, DB_NAME, DB_VERSION, STORE_ATTACHMENTS, STORE_SETTINGS, ACTIVE_DRAFT_KEY,
    OPFS_ROOT_DIR, OPFS_BLOB_DIR, OPFS_PATH_PREFIX,
    STATUSES, INITIAL_STATUS, STATUS_LABELS, KINDS, SOURCES, OWNER_TYPES, META_KEYS, MESSAGES,
    isValidStatus, isValidAttachmentId, isValidDraftRef, isValidWorkOrderRef,
    isValidMetadata, metadataProblem, buildMetadata, rebindMetadata,
    newAttachmentId, newDraftRef, opfsPathFor,
    createMemoryBlobStore, createMemoryMetaStore, createPersistence, createUnavailablePersistence,
    supportsOpfs, createBrowserPersistence
  };
  global.ReferenceMediaStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

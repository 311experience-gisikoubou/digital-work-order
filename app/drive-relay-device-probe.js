(() => {
  'use strict';

  const DB_NAME = 'dwo_drive_relay_device_probe_v1';
  const DB_VERSION = 1;
  const STORE = 'credentials';
  const RECORD_ID = 'synthetic-device-state';
  const PROBE_VERSION = 'dwo-device-probe-v1';

  const ui = {
    badge: () => document.getElementById('probe-badge'),
    status: () => document.getElementById('probe-status'),
    details: () => document.getElementById('probe-details'),
    init: () => document.getElementById('probe-init'),
    verify: () => document.getElementById('probe-verify'),
    copy: () => document.getElementById('probe-copy'),
    clear: () => document.getElementById('probe-clear')
  };

  let lastSummary = null;

  function bytesToBase64url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function hex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  }

  function randomToken(byteLength) {
    const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
    return bytesToBase64url(bytes);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('INDEXEDDB_OPEN_FAILED'));
    });
  }

  async function putRecord(record, addOnly = false) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        if (addOnly) tx.objectStore(STORE).add(record);
        else tx.objectStore(STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_WRITE_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('INDEXEDDB_WRITE_ABORTED'));
      });
    } finally {
      db.close();
    }
  }

  async function getRecord(id = RECORD_ID) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('INDEXEDDB_READ_FAILED'));
      });
    } finally {
      db.close();
    }
  }

  async function clearRecord() {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(RECORD_ID);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_DELETE_FAILED'));
      });
    } finally {
      db.close();
    }
  }

  function environment() {
    return {
      secureContext: window.isSecureContext === true,
      cryptoSubtle: !!(window.crypto && window.crypto.subtle),
      indexedDb: typeof indexedDB !== 'undefined',
      origin: location.origin
    };
  }

  function setStatus(kind, title, message, details) {
    const badge = ui.badge();
    const status = ui.status();
    const detailBox = ui.details();

    badge.dataset.state = kind;
    badge.textContent = kind === 'pass' ? 'PASS' : kind === 'fail' ? 'FAIL' : '未実行';
    status.textContent = title + (message ? ' — ' + message : '');
    detailBox.textContent = details ? JSON.stringify(details, null, 2) : '';
    ui.copy().disabled = !lastSummary;
  }

  function syntheticMessage(record) {
    return [
      PROBE_VERSION,
      record.probeId,
      String(record.createdAt),
      'synthetic-only'
    ].join('|');
  }

  async function initialize() {
    const env = environment();
    if (!env.secureContext || !env.cryptoSubtle || !env.indexedDb) {
      throw new Error('REQUIRED_BROWSER_CAPABILITY_MISSING');
    }

    // No silent credential rotation: if a record exists, initialization refuses.
    const existing = await getRecord();
    if (existing) throw new Error('PROBE_ALREADY_INITIALIZED');

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const bearerToken = randomToken(32);
    const bearerSha256 = await sha256Hex(bearerToken);
    const record = {
      id: RECORD_ID,
      version: PROBE_VERSION,
      probeId: 'probe_' + randomToken(16),
      createdAt: Date.now(),
      privateKey: keyPair.privateKey,
      publicJwk,
      bearerToken,
      bearerSha256
    };
    await putRecord(record);

    const summary = await verify();
    summary.phase = 'initialized';
    lastSummary = summary;
    renderSummary(summary);
    return summary;
  }

  async function verify() {
    const env = environment();
    const record = await getRecord();
    if (!record) {
      const missing = {
        schemaVersion: 1,
        result: 'FAIL_CLOSED',
        code: 'PAIRING_STATE_MISSING',
        origin: env.origin,
        secureContext: env.secureContext,
        cryptoSubtle: env.cryptoSubtle,
        indexedDb: env.indexedDb
      };
      lastSummary = missing;
      renderSummary(missing);
      return missing;
    }

    let exportBlocked = false;
    try {
      await crypto.subtle.exportKey('jwk', record.privateKey);
    } catch (_) {
      exportBlocked = true;
    }

    const messageBytes = new TextEncoder().encode(syntheticMessage(record));
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      record.privateKey,
      messageBytes
    );
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      record.publicJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const signatureVerified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signature,
      messageBytes
    );
    const bearerDigest = await sha256Hex(record.bearerToken);

    const checks = {
      secureContext: env.secureContext,
      cryptoSubtle: env.cryptoSubtle,
      indexedDb: env.indexedDb,
      ecdsaPrivateRestored: !!record.privateKey && record.privateKey.type === 'private',
      ecdsaPrivateNonExtractable: !!record.privateKey && record.privateKey.extractable === false,
      ecdsaPrivateExportBlocked: exportBlocked,
      ecdsaSignatureVerified: signatureVerified === true,
      bearerRestored: typeof record.bearerToken === 'string' && record.bearerToken.length >= 40,
      bearerDigestStable: bearerDigest === record.bearerSha256
    };
    const ok = Object.values(checks).every(Boolean);
    const summary = {
      schemaVersion: 1,
      result: ok ? 'PASS' : 'FAIL',
      code: ok ? 'PERSISTENCE_VERIFIED' : 'CHECK_FAILED',
      origin: env.origin,
      createdAt: record.createdAt,
      checkedAt: Date.now(),
      checks
    };
    lastSummary = summary;
    renderSummary(summary);
    return summary;
  }

  async function clear() {
    await clearRecord();
    lastSummary = {
      schemaVersion: 1,
      result: 'CLEARED',
      code: 'SYNTHETIC_STATE_REMOVED',
      origin: location.origin
    };
    setStatus('idle', '架空テストデータを削除しました', '本番データには触れていません', lastSummary);
    return lastSummary;
  }

  function renderSummary(summary) {
    if (summary.result === 'PASS') {
      setStatus('pass', '保存・復元テスト PASS', 'ECDSA秘密鍵とbearerを再利用できます', summary);
    } else if (summary.result === 'FAIL_CLOSED' && summary.code === 'PAIRING_STATE_MISSING') {
      setStatus('idle', 'まだテストを作成していません', '初回は「① 架空テストを作成」を押してください', summary);
    } else if (summary.result === 'CLEARED') {
      setStatus('idle', '架空テストデータを削除しました', '', summary);
    } else {
      setStatus('fail', '保存・復元テスト FAIL', '送信へ進まず再ペアリングが必要です', summary);
    }
  }

  async function copySummary() {
    if (!lastSummary) return;
    const text = JSON.stringify(lastSummary);
    await navigator.clipboard.writeText(text);
    ui.copy().textContent = 'コピーしました';
    setTimeout(() => { ui.copy().textContent = '結果をコピー'; }, 1200);
  }

  async function safeAction(action) {
    [ui.init(), ui.verify(), ui.clear()].forEach(button => { button.disabled = true; });
    try {
      return await action();
    } catch (error) {
      lastSummary = {
        schemaVersion: 1,
        result: 'FAIL',
        code: String(error && error.message ? error.message : error),
        origin: location.origin
      };
      renderSummary(lastSummary);
      return lastSummary;
    } finally {
      [ui.init(), ui.verify(), ui.clear()].forEach(button => { button.disabled = false; });
      ui.copy().disabled = !lastSummary;
    }
  }

  // DWO_SIGNED_OUTBOX_DEVICE_PROBE_V2: existing unlinked, no-network
  // synthetic page. Keep prior v1 evidence intact; never open dwo_media_v1.
  const OUTBOX_DB = 'dwo_synthetic_signed_outbox_device_probe_v2';
  const OUTBOX_META = 'synthetic-signed-outbox-metadata-v2';
  const OUTBOX_REF = 'dwo:123e4567-e89b-42d3-a456-426614174010';
  let documentToken;
  let outboxBusy = false;
  function outboxStorage() {
    const api = window.ReferenceMediaStorage;
    if (!window.isSecureContext || !api || !window.MediaRelayTransport || !window.crypto?.subtle) {
      throw new Error('OUTBOX_PROBE_UNAVAILABLE');
    }
    return api.createDriveOutboxTrial({
      crypto: window.crypto, MediaRelayTransport: window.MediaRelayTransport,
      MediaTransferCrypto: window.MediaTransferCrypto, IDBKeyRange: window.IDBKeyRange,
      indexedDB: { open(name, version) {
        if (name !== api.DB_NAME) throw new Error('OUTBOX_PROBE_DB_INVALID');
        return indexedDB.open(OUTBOX_DB, version);
      } }
    });
  }
  async function initializeOutbox() {
    if (await getRecord(OUTBOX_META)) throw new Error('OUTBOX_PROBE_EXISTS');
    const opts = {crypto: window.crypto, transferApi: window.MediaTransferPackage};
    const sender = await window.MediaTransferCrypto.generateSenderIdentity(opts);
    const recipient = await window.MediaTransferCrypto.generateRecipientIdentity('synthetic-outbox-device-probe', opts);
    const pkg = await window.MediaTransferPackage.buildPackage(OUTBOX_REF,
      {workOrderRef: OUTBOX_REF, trial: 'SYNTHETIC_OUTBOX_DEVICE_PROBE'}, [],
      {...opts, issuedB5Pdf: new Blob(['%PDF-1.7\nsynthetic'], {type:'application/pdf'})});
    const envelope = await window.MediaTransferCrypto.encryptPackage(pkg, sender, recipient, opts);
    const body = await window.MediaRelayTransport.buildDriveRelayBody(envelope, sender, recipient,
      {...opts, bootstrapApi: window.MediaReceiverBootstrap});
    const binding = await sha256Hex('synthetic-signed-outbox-device-probe-v2');
    const digest = await sha256Hex(window.MediaRelayTransport.canonicalJson(body));
    const pairing = {
      sender:{clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,publicJwk:sender.publicJwk},
      recipient:{recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk}
    };
    // Independently stored synthetic public pairing, not extracted from the outbox.
    // A failed claim leaves an incomplete fixture and cannot produce a false PASS.
    await putRecord({id:OUTBOX_META,digest,jobId:body.jobId,pairing,documentToken}, true);
    const saved = await outboxStorage().claimSignedRecovery(OUTBOX_REF,binding,sender,recipient,body);
    if (saved.status !== 'RECOVERY_PENDING_ONLY' || saved.jobId !== body.jobId ||
        saved.wireSha256 !== digest) throw new Error('OUTBOX_PROBE_MISMATCH');
    return '保存成功。Safariを閉じ、同じURLを開いて②を押してください。';
  }
  async function verifyOutbox() {
    const record = await getRecord(OUTBOX_META);
    if (!record || record.id !== OUTBOX_META ||
        Object.keys(record).sort().join('|') !== 'digest|documentToken|id|jobId|pairing' ||
        !/^[0-9a-f]{64}$/.test(record.digest || '') ||
        !/^job_[0-9a-f]{64}$/.test(record.jobId || '') ||
        !record.pairing ||
        !/^[A-Za-z0-9_-]{22}$/.test(record.documentToken || '')) throw new Error('OUTBOX_PROBE_MISSING');
    // Discover without providing the previous work-order reference or a session.
    const list = await outboxStorage().listSignedRecovery(record.pairing);
    const entry = list.entries?.[0];
    if (list.status !== 'RECOVERY_PENDING_LIST' || list.unverifiedCount !== 0 ||
        list.entries?.length !== 1 || !entry ||
        entry.status !== 'RECOVERY_PENDING_ONLY' || entry.workOrderRef !== OUTBOX_REF ||
        entry.jobId !== record.jobId || entry.wireSha256 !== record.digest ||
        Object.keys(entry).sort().join('|') !== 'jobId|status|wireSha256|workOrderRef') {
      throw new Error('OUTBOX_PROBE_MISMATCH');
    }
    return record.documentToken === documentToken
      ? '保存内容は一致。Safariを閉じてから②を押してください。'
      : 'PASS：新しいページで署名付き暗号化データを再発見し、完全一致しました。';
  }
  async function outboxAction(action) {
    if (outboxBusy) return;
    outboxBusy = true;
    const buttons = ['probe-outbox-init','probe-outbox-verify'].map(id=>document.getElementById(id));
    const status = document.getElementById('probe-outbox-status');
    buttons.forEach(b=>{b.disabled=true;});
    try {
      if (!documentToken) documentToken = randomToken(16);
      status.textContent = await action();
    } catch (error) {
      const code = error?.code || error?.message;
      const messages = {
        OUTBOX_PROBE_EXISTS:'保存済みです。②で確認してください。',
        OUTBOX_PROBE_MISSING:'保存記録が見つかりません。復元は未確認です。',
        DRIVE_OUTBOX_STRICT_UNAVAILABLE:'FAIL：安全な保存方式に未対応です。',
        DRIVE_OUTBOX_MISSING:'FAIL：暗号化データが見つかりません。'
      };
      status.textContent = Object.hasOwn(messages,code) ? messages[code] : 'FAIL：保存または復元を確認できません。';
    } finally {
      buttons.forEach(b=>{b.disabled=false;});
      outboxBusy=false;
    }
  }

  function wireUi() {
    document.getElementById('probe-outbox-init').addEventListener('click',()=>outboxAction(initializeOutbox));
    document.getElementById('probe-outbox-verify').addEventListener('click',()=>outboxAction(verifyOutbox));
    ui.init().addEventListener('click', () => safeAction(initialize));
    ui.verify().addEventListener('click', () => safeAction(verify));
    ui.copy().addEventListener('click', () => safeAction(copySummary));
    ui.clear().addEventListener('click', () => safeAction(clear));

    const env = environment();
    document.getElementById('probe-origin').textContent = env.origin;
    document.getElementById('probe-secure').textContent = env.secureContext ? 'はい' : 'いいえ';

    safeAction(verify);
  }

  window.DwoDriveDeviceProbe = {
    initialize,
    verify,
    clear,
    getLastSummary: () => lastSummary
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUi, { once: true });
  } else {
    wireUi();
  }
})();

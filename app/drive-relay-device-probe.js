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

  async function putRecord(record) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_WRITE_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('INDEXEDDB_WRITE_ABORTED'));
      });
    } finally {
      db.close();
    }
  }

  async function getRecord() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD_ID);
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

  function wireUi() {
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

(() => {
  'use strict';

  // Normal clinic credential authority. This is deliberately separate from
  // every D1/D2/probe database and stores one add-only paired record containing
  // both the existing non-extractable sender key and the provisional bearer.
  // It never selects an endpoint, pairs, sends, rotates, revokes, or deletes.
  const DB_NAME = 'dwo_drive_relay_session_v1';
  const DB_VERSION = 1;
  const STORE = 'credentials';
  const RECORD_ID = 'current';
  const RECORD_VERSION = 1;
  const DEV = /^dev_[A-Za-z0-9_-]{1,156}$/;
  const SK = /^sk_[A-Za-z0-9_-]{43}$/;
  const RK = /^rk_[A-Za-z0-9_-]{43}$/;
  const BEARER = /^[A-Za-z0-9_-]{43}$/;
  const JWK_KEYS = ['crv', 'kty', 'x', 'y'];
  const RECORD_KEYS = ['clinicDeviceId', 'id', 'recipientKeyId', 'recipientPublicJwk',
    'signingKeyId', 'signingPrivateKey', 'signingPublicJwk', 'uploadBearer', 'version'];

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function exactKeys(value, expected) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  }

  function normalizeJwk(value) {
    if (!exactKeys(value, JWK_KEYS) || value.kty !== 'EC' || value.crv !== 'P-256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(value.y || '')) {
      throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
    }
    return { crv: 'P-256', kty: 'EC', x: value.x, y: value.y };
  }

  function cryptoApi() {
    if (!globalThis.crypto || !globalThis.crypto.subtle || typeof globalThis.indexedDB === 'undefined' ||
        !globalThis.MediaTransferCrypto || typeof globalThis.MediaTransferCrypto.canonicalJson !== 'function' ||
        typeof globalThis.MediaTransferCrypto.base64urlEncode !== 'function') {
      throw fail('DRIVE_SESSION_CAPABILITY_MISSING');
    }
    return globalThis.crypto;
  }

  async function fingerprint(jwk, prefix, crypto) {
    const text = globalThis.MediaTransferCrypto.canonicalJson(normalizeJwk(jwk));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return prefix + globalThis.MediaTransferCrypto.base64urlEncode(new Uint8Array(digest));
  }

  function privateKeyShape(key) {
    return !!key && key.type === 'private' && key.extractable === false &&
      key.algorithm && key.algorithm.name === 'ECDSA' && key.algorithm.namedCurve === 'P-256' &&
      Array.isArray(key.usages) && key.usages.length === 1 && key.usages[0] === 'sign';
  }

  async function validateRecord(record) {
    const crypto = cryptoApi();
    if (!exactKeys(record, RECORD_KEYS) || record.id !== RECORD_ID || record.version !== RECORD_VERSION ||
        !DEV.test(record.clinicDeviceId || '') || !SK.test(record.signingKeyId || '') ||
        !RK.test(record.recipientKeyId || '') || !BEARER.test(record.uploadBearer || '') ||
        !privateKeyShape(record.signingPrivateKey)) throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
    const signingPublicJwk = normalizeJwk(record.signingPublicJwk);
    const recipientPublicJwk = normalizeJwk(record.recipientPublicJwk);
    if (record.signingKeyId !== await fingerprint(signingPublicJwk, 'sk_', crypto) ||
        record.recipientKeyId !== await fingerprint(recipientPublicJwk, 'rk_', crypto)) {
      throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
    }
    try {
      const publicKey = await crypto.subtle.importKey('jwk', signingPublicJwk,
        { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
      const challenge = new TextEncoder().encode('dwo-drive-session-key-proof-v1');
      const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' },
        record.signingPrivateKey, challenge);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge)) {
        throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
      }
    } catch (error) {
      if (error && error.code === 'DRIVE_SESSION_CREDENTIAL_INVALID') throw error;
      throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
    }
    return record;
  }

  function candidateRecord(input) {
    if (!exactKeys(input, ['recipientPublicInfo', 'senderIdentity', 'uploadBearer']) ||
        !exactKeys(input.senderIdentity, ['clinicDeviceId', 'privateKey', 'publicJwk', 'signingKeyId']) ||
        !exactKeys(input.recipientPublicInfo, ['publicJwk', 'recipientKeyId'])) {
      throw fail('DRIVE_SESSION_CREDENTIAL_INVALID');
    }
    return {
      id: RECORD_ID,
      version: RECORD_VERSION,
      clinicDeviceId: input.senderIdentity.clinicDeviceId,
      signingKeyId: input.senderIdentity.signingKeyId,
      signingPrivateKey: input.senderIdentity.privateKey,
      signingPublicJwk: normalizeJwk(input.senderIdentity.publicJwk),
      recipientKeyId: input.recipientPublicInfo.recipientKeyId,
      recipientPublicJwk: normalizeJwk(input.recipientPublicInfo.publicJwk),
      uploadBearer: input.uploadBearer
    };
  }

  function samePublicCredential(a, b) {
    const publicView = value => globalThis.MediaTransferCrypto.canonicalJson({
      clinicDeviceId: value.clinicDeviceId,
      signingKeyId: value.signingKeyId,
      signingPublicJwk: normalizeJwk(value.signingPublicJwk),
      recipientKeyId: value.recipientKeyId,
      recipientPublicJwk: normalizeJwk(value.recipientPublicJwk),
      uploadBearer: value.uploadBearer
    });
    try { return publicView(a) === publicView(b); } catch (_) { return false; }
  }

  function openDb() {
    cryptoApi();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(fail('DRIVE_SESSION_STORAGE_UNAVAILABLE'));
    });
  }

  async function readRecord() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD_ID);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(fail('DRIVE_SESSION_STORAGE_UNAVAILABLE'));
      });
    } finally { db.close(); }
  }

  async function claimPairedCredential(input) {
    const candidate = candidateRecord(input);
    await validateRecord(candidate);
    const db = await openDb();
    let selected;
    try {
      selected = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const request = store.get(RECORD_ID);
        let result;
        request.onsuccess = () => {
          const existing = request.result || null;
          if (existing) {
            if (!samePublicCredential(existing, candidate)) {
              reject(fail('DRIVE_SESSION_CREDENTIAL_CONFLICT'));
              try { tx.abort(); } catch (_) {}
              return;
            }
            result = existing;
          } else {
            result = candidate;
            store.add(candidate);
          }
        };
        request.onerror = () => reject(fail('DRIVE_SESSION_STORAGE_UNAVAILABLE'));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(fail('DRIVE_SESSION_STORAGE_UNAVAILABLE'));
        tx.onabort = () => reject(fail('DRIVE_SESSION_STORAGE_UNAVAILABLE'));
      });
    } finally { db.close(); }
    return validateRecord(selected);
  }

  async function restorePairedCredential() {
    const record = await readRecord();
    if (!record) throw fail('DRIVE_SESSION_CREDENTIAL_MISSING');
    return validateRecord(record);
  }

  function createSessionProvider(bridgeCall) {
    if (typeof bridgeCall !== 'function') throw fail('DRIVE_SESSION_BRIDGE_INVALID');
    let cached = null;
    let expected = null;
    return async function provideSession() {
      const record = await restorePairedCredential();
      const identity = globalThis.MediaTransferCrypto.canonicalJson({
        clinicDeviceId: record.clinicDeviceId,
        signingKeyId: record.signingKeyId,
        signingPublicJwk: normalizeJwk(record.signingPublicJwk),
        recipientKeyId: record.recipientKeyId,
        recipientPublicJwk: normalizeJwk(record.recipientPublicJwk),
        uploadBearer: record.uploadBearer
      });
      if (expected !== null && identity !== expected) throw fail('DRIVE_SESSION_CREDENTIAL_CHANGED');
      if (!cached) {
        expected = identity;
        const senderIdentity = Object.freeze({
          clinicDeviceId: record.clinicDeviceId,
          signingKeyId: record.signingKeyId,
          publicJwk: Object.freeze(normalizeJwk(record.signingPublicJwk)),
          privateKey: record.signingPrivateKey
        });
        const recipientPublicInfo = Object.freeze({
          recipientKeyId: record.recipientKeyId,
          publicJwk: Object.freeze(normalizeJwk(record.recipientPublicJwk))
        });
        cached = Object.freeze({ senderIdentity, recipientPublicInfo,
          uploadBearer: record.uploadBearer, bridgeCall });
      }
      return cached;
    };
  }

  globalThis.DriveRelaySessionStore = Object.freeze({
    claimPairedCredential,
    restorePairedCredential,
    createSessionProvider
  });
})();

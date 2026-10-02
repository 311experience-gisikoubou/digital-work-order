// ============================================================
//  参考資料メディアの転送プロトコル中核（Phase 4: ペアリング / 暗号 / 署名 / 失効 / 鍵更新）
//  ローカルのみで完結する。通信・常駐サーバ呼び出し・外部暗号ライブラリ・実データは一切扱わない。
//  Web Crypto (ECDSA P-256 / ECDH P-256 / HKDF-SHA-256 / AES-256-GCM / PBKDF2-HMAC-SHA256)
//  と Blob/TextEncoder/TextDecoder だけを使う。依存は追加しない。
//  設計は docs/design.md 15.2-15.10 に従う。Phase 3 の MediaTransferPackage の上に積む。
// ============================================================
(function(global) {
  'use strict';

  // ---------- バージョン / 定数 ----------
  const PROTOCOL_VERSION = 'dwo-crypto-protocol-v1';
  const ENVELOPE_VERSION = 'dwo-media-envelope-v1';
  const DESCRIPTOR_VERSION = 'dwo-media-envelope-descriptor-v1';
  const BACKUP_VERSION = 'dwo-recipient-backup-v1';
  const PAIRING_OFFER_VERSION = 'dwo-pairing-offer-v1';
  const PAIRING_RESPONSE_VERSION = 'dwo-pairing-response-v1';
  const ROTATION_VERSION = 'dwo-sender-key-rotation-v1';
  const REGISTRY_VERSION = 'dwo-sender-registry-v1';
  const RING_VERSION = 'dwo-recipient-keyring-v1';
  const PAIRING_PAYLOAD_PREFIX = 'DWOQR1.';

  const MIN_PBKDF2_ITERATIONS = 600000;
  const DEFAULT_PBKDF2_ITERATIONS = 600000;
  const DEFAULT_PAIRING_EXPIRY_MS = 10 * 60 * 1000;
  const IV_BYTE_LENGTH = 12;

  const HEX64_RE = /^[0-9a-f]{64}$/;
  const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;

  const ALGORITHMS = Object.freeze({
    senderSignature: 'ECDSA-P256-SHA256',
    recipientKeyAgreement: 'ECDH-P256',
    contentKeyDerivation: 'ECDH-P256 -> HKDF-SHA256 -> AES-256-GCM',
    aesGcmIvBytes: IV_BYTE_LENGTH,
    pbkdf2: Object.freeze({ hash: 'SHA-256', minIterations: MIN_PBKDF2_ITERATIONS })
  });

  const SCHEMA_VERSIONS = Object.freeze({
    protocolVersion: PROTOCOL_VERSION,
    envelope: ENVELOPE_VERSION,
    descriptor: DESCRIPTOR_VERSION,
    backup: BACKUP_VERSION,
    pairingOffer: PAIRING_OFFER_VERSION,
    pairingResponse: PAIRING_RESPONSE_VERSION,
    rotation: ROTATION_VERSION,
    registry: REGISTRY_VERSION,
    keyRing: RING_VERSION
  });

  const DESCRIPTOR_KEYS = [
    'v', 'protocolVersion', 'workOrderRef', 'senderClinicDeviceId', 'senderSigningKeyId',
    'recipientKeyId', 'createdAt', 'ephemeralPublicJwk', 'hkdfSalt', 'manifestSha256',
    'workOrderSha256', 'attachments'
  ];
  const OFFER_KEYS = ['v', 'type', 'pairingId', 'protocolVersion', 'recipientKeyId', 'publicJwk', 'createdAt', 'expiresAt'];
  const RESPONSE_KEYS = ['v', 'type', 'pairingId', 'recipientKeyId', 'clinicDeviceId', 'signingKeyId', 'signingPublicJwk', 'createdAt', 'signature'];
  const ROTATION_KEYS = ['v', 'type', 'clinicDeviceId', 'pairedRecipientKeyId', 'oldSigningKeyId', 'newSigningKeyId', 'newSigningPublicJwk', 'createdAt', 'signature'];
  const REGISTRY_BASE_KEYS = ['version', 'clinicDeviceId', 'status', 'pairedRecipientKeyId', 'activeSigningKey', 'retiredSigningKeys', 'pairingId', 'createdAt', 'updatedAt'];
  const REGISTRY_OPTIONAL_KEYS = ['revokedAt', 'revokedReason'];
  const RING_KEYS = ['version', 'active', 'decryptOnly'];
  const RING_ENTRY_KEYS = ['recipientKeyId', 'publicJwk', 'privateKey'];
  const BACKUP_KEYS = ['version', 'recipientKeyId', 'publicJwk', 'kdf', 'cipher'];
  const BACKUP_KDF_KEYS = ['name', 'hash', 'iterations', 'salt'];
  const BACKUP_CIPHER_KEYS = ['name', 'iv', 'ciphertext'];

  // ---------- エラー ----------
  function cryptoError(code, detail) {
    const error = new Error(detail ? code + ': ' + detail : code);
    error.code = code;
    return error;
  }

  // ---------- 小さな汎用helper ----------
  function sameKeySet(obj, expectedKeys) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const actual = Object.keys(obj).slice().sort();
    const expected = expectedKeys.slice().sort();
    if (actual.length !== expected.length) return false;
    return actual.every((key, index) => key === expected[index]);
  }

  function isHex64(value) { return typeof value === 'string' && HEX64_RE.test(value); }
  function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0; }

  function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
  }

  function assertCryptoAvailable(cryptoApi) {
    if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== 'function' || typeof cryptoApi.getRandomValues !== 'function') {
      throw cryptoError('CRYPTO_UNAVAILABLE');
    }
  }

  function resolveCrypto(options) {
    const cryptoApi = (options && options.crypto) || global.crypto;
    assertCryptoAvailable(cryptoApi);
    return cryptoApi;
  }

  function resolveNow(options) {
    return (options && typeof options.now === 'function') ? options.now : () => Date.now();
  }

  function resolveTransferApi(options) {
    const transferApi = (options && options.transferApi) || global.MediaTransferPackage;
    if (!transferApi || typeof transferApi.verifyPackage !== 'function') {
      throw cryptoError('CRYPTO_DEPENDENCY_UNAVAILABLE');
    }
    return transferApi;
  }

  // ---------- canonical JSON（署名/AADの安定表現。objectのkeyを再帰的に並べ替える） ----------
  function canonicalJSONValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(canonicalJSONValue);
    const sorted = Object.keys(value).sort();
    const out = {};
    sorted.forEach(key => { out[key] = canonicalJSONValue(value[key]); });
    return out;
  }
  function canonicalJSONStringify(value) { return JSON.stringify(canonicalJSONValue(value)); }
  function canonicalJSONBytes(value) { return new TextEncoder().encode(canonicalJSONStringify(value)); }
  function encodeJsonBytes(value) { return new TextEncoder().encode(JSON.stringify(value)); }

  async function sha256Hex(bytes, cryptoApi) {
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return toHex(digest);
  }

  // ---------- base64url（厳格・往復可能） ----------
  function bytesFromBinaryString(bin) {
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  function binaryStringFromBytes(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return bin;
  }
  function base64Encode(bytes) {
    if (typeof btoa === 'function') return btoa(binaryStringFromBytes(bytes));
    return Buffer.from(bytes).toString('base64');
  }
  function base64Decode(b64) {
    if (typeof atob === 'function') return bytesFromBinaryString(atob(b64));
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  function base64urlEncode(bytesLike) {
    const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
    return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function base64urlDecode(str) {
    if (typeof str !== 'string') throw cryptoError('CRYPTO_INVALID_BASE64URL');
    if (str === '') return new Uint8Array(0);
    if (!BASE64URL_RE.test(str) || str.length % 4 === 1) throw cryptoError('CRYPTO_INVALID_BASE64URL');
    const padLen = (4 - (str.length % 4)) % 4;
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
    try {
      return base64Decode(b64);
    } catch (_) {
      throw cryptoError('CRYPTO_INVALID_BASE64URL');
    }
  }

  // ---------- JWK schema（公開鍵・秘密鍵とも、定義された鍵集合以外は拒否する） ----------
  function normalizePublicJwk(jwk) {
    if (!sameKeySet(jwk, ['crv', 'kty', 'x', 'y'])) throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (!isNonEmptyString(jwk.x) || !isNonEmptyString(jwk.y)) throw cryptoError('CRYPTO_MALFORMED_KEY');
    return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  }
  function normalizePrivateJwk(jwk) {
    if (!sameKeySet(jwk, ['crv', 'd', 'kty', 'x', 'y'])) throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (!isNonEmptyString(jwk.x) || !isNonEmptyString(jwk.y) || !isNonEmptyString(jwk.d)) throw cryptoError('CRYPTO_MALFORMED_KEY');
    return { crv: jwk.crv, d: jwk.d, kty: jwk.kty, x: jwk.x, y: jwk.y };
  }

  // WebCryptoのexportKey('jwk', ...)は常にext/key_opsも含めて返す。
  // そのため「exportした直後」だけは、この緩い抽出を使って最小形へ落としてから以後は
  // 常に最小形（normalizePublicJwk/normalizePrivateJwkが通る形）として扱う。
  // 外部から受け取るJWK（ワイヤ形式）はnormalizePublicJwk/normalizePrivateJwkで厳格に検証する。
  function extractPublicJwkFields(jwk) {
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !isNonEmptyString(jwk.x) || !isNonEmptyString(jwk.y)) throw cryptoError('CRYPTO_MALFORMED_KEY');
    return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  }
  function extractPrivateJwkFields(jwk) {
    if (!jwk || typeof jwk !== 'object' || Array.isArray(jwk)) throw cryptoError('CRYPTO_MALFORMED_KEY');
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !isNonEmptyString(jwk.x) || !isNonEmptyString(jwk.y) || !isNonEmptyString(jwk.d)) {
      throw cryptoError('CRYPTO_MALFORMED_KEY');
    }
    return { crv: jwk.crv, d: jwk.d, kty: jwk.kty, x: jwk.x, y: jwk.y };
  }

  async function publicJwkFingerprint(jwk, prefix, cryptoApi) {
    const normalized = normalizePublicJwk(jwk);
    const digest = await cryptoApi.subtle.digest('SHA-256', canonicalJSONBytes(normalized));
    return prefix + base64urlEncode(new Uint8Array(digest));
  }

  async function exportNormalizedPublicJwk(publicKey, cryptoApi) {
    const raw = await cryptoApi.subtle.exportKey('jwk', publicKey);
    return extractPublicJwkFields(raw);
  }

  async function importEcdhPublicKey(jwk, cryptoApi) {
    const normalized = normalizePublicJwk(jwk);
    try {
      return await cryptoApi.subtle.importKey('jwk', normalized, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
    } catch (_) {
      throw cryptoError('CRYPTO_MALFORMED_KEY');
    }
  }
  async function importEcdsaPublicKey(jwk, cryptoApi) {
    const normalized = normalizePublicJwk(jwk);
    try {
      return await cryptoApi.subtle.importKey('jwk', normalized, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
    } catch (_) {
      throw cryptoError('CRYPTO_MALFORMED_KEY');
    }
  }

  async function signCanonical(body, privateKey, cryptoApi) {
    const sig = await cryptoApi.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, canonicalJSONBytes(body));
    return base64urlEncode(new Uint8Array(sig));
  }
  async function verifyCanonicalSignature(body, signatureB64, publicJwk, cryptoApi) {
    const publicKey = await importEcdsaPublicKey(publicJwk, cryptoApi);
    const sigBytes = base64urlDecode(signatureB64);
    return cryptoApi.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, sigBytes, canonicalJSONBytes(body));
  }

  // ---------- AES-GCM ----------
  function randomBytes(len, cryptoApi) {
    const out = new Uint8Array(len);
    cryptoApi.getRandomValues(out);
    return out;
  }
  function randomIv(cryptoApi, usedIvSet) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = randomBytes(IV_BYTE_LENGTH, cryptoApi);
      const key = base64urlEncode(bytes);
      if (!usedIvSet.has(key)) {
        usedIvSet.add(key);
        return bytes;
      }
    }
    throw cryptoError('CRYPTO_IV_GENERATION_FAILED');
  }
  async function aesEncrypt(key, ivBytes, aadBytes, plaintextBytes, cryptoApi) {
    const ct = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes }, key, plaintextBytes);
    return new Uint8Array(ct);
  }
  async function aesDecrypt(key, ivBytes, aadBytes, ciphertextBytes, cryptoApi) {
    try {
      const pt = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes }, key, ciphertextBytes);
      return new Uint8Array(pt);
    } catch (_) {
      throw cryptoError('CRYPTO_DECRYPT_FAILED');
    }
  }
  async function derivePbkdf2AesKey(passphrase, saltBytes, iterations, usages, cryptoApi) {
    const keyMaterial = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      usages
    );
  }

  function buildPart(ivBytes, ciphertextBytes) {
    return { iv: base64urlEncode(ivBytes), ciphertext: new Blob([ciphertextBytes], { type: 'application/octet-stream' }) };
  }

  // ============================================================
  //  鍵の抽出可否（CryptoKey.extractable をそのまま見るだけ。独自判定は作らない）
  // ============================================================
  function isKeyExtractable(key) {
    return !!(key && key.extractable === true);
  }

  // ============================================================
  //  技工所（受信側）: ECDH P-256 鍵と暗号化オフラインバックアップ
  // ============================================================
  function validateBackupShape(backup) {
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (!sameKeySet(backup, BACKUP_KEYS)) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (backup.version !== BACKUP_VERSION) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (!isNonEmptyString(backup.recipientKeyId) || !backup.recipientKeyId.startsWith('rk_')) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    normalizePublicJwk(backup.publicJwk);
    if (!sameKeySet(backup.kdf, BACKUP_KDF_KEYS)) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (backup.kdf.name !== 'PBKDF2' || backup.kdf.hash !== 'SHA-256') throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (!Number.isInteger(backup.kdf.iterations)) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (backup.kdf.iterations < MIN_PBKDF2_ITERATIONS) throw cryptoError('CRYPTO_WEAK_KDF');
    const saltBytes = base64urlDecode(backup.kdf.salt);
    if (saltBytes.length < 16) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (!sameKeySet(backup.cipher, BACKUP_CIPHER_KEYS)) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    if (backup.cipher.name !== 'AES-GCM') throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    const ivBytes = base64urlDecode(backup.cipher.iv);
    if (ivBytes.length !== IV_BYTE_LENGTH) throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    base64urlDecode(backup.cipher.ciphertext);
  }

  async function generateRecipientIdentity(passphrase, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    if (!isNonEmptyString(passphrase)) throw cryptoError('CRYPTO_INVALID_PASSPHRASE');
    const iterations = Number.isInteger(opts.pbkdf2Iterations) ? opts.pbkdf2Iterations : DEFAULT_PBKDF2_ITERATIONS;
    if (iterations < MIN_PBKDF2_ITERATIONS) throw cryptoError('CRYPTO_WEAK_KDF');

    // 秘密鍵JWKをバックアップ作成のためだけに短時間だけ抽出する。
    const keyPair = await cryptoApi.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const publicJwk = await exportNormalizedPublicJwk(keyPair.publicKey, cryptoApi);
    const recipientKeyId = await publicJwkFingerprint(publicJwk, 'rk_', cryptoApi);

    let privateJwk = extractPrivateJwkFields(await cryptoApi.subtle.exportKey('jwk', keyPair.privateKey));
    try {
      const saltBytes = randomBytes(16, cryptoApi);
      const ivBytes = randomBytes(IV_BYTE_LENGTH, cryptoApi);
      const aesKey = await derivePbkdf2AesKey(passphrase, saltBytes, iterations, ['encrypt'], cryptoApi);
      const aad = canonicalJSONBytes({ version: BACKUP_VERSION, recipientKeyId, publicJwk });
      const ciphertext = await aesEncrypt(aesKey, ivBytes, aad, encodeJsonBytes(privateJwk), cryptoApi);

      const backup = {
        version: BACKUP_VERSION,
        recipientKeyId,
        publicJwk,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: base64urlEncode(saltBytes) },
        cipher: { name: 'AES-GCM', iv: base64urlEncode(ivBytes), ciphertext: base64urlEncode(ciphertext) }
      };

      // 通常利用は非抽出可能な秘密鍵として再import（生成時のextractableな鍵は保持しない）。
      const privateKey = await cryptoApi.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      return { recipientKeyId, publicJwk, privateKey, backup };
    } finally {
      privateJwk = null;
    }
  }

  async function restoreRecipientIdentity(backup, passphrase, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    validateBackupShape(backup);
    if (!isNonEmptyString(passphrase)) throw cryptoError('CRYPTO_INVALID_PASSPHRASE');

    const expectedFingerprint = await publicJwkFingerprint(backup.publicJwk, 'rk_', cryptoApi);
    if (expectedFingerprint !== backup.recipientKeyId) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const saltBytes = base64urlDecode(backup.kdf.salt);
    const ivBytes = base64urlDecode(backup.cipher.iv);
    const ciphertextBytes = base64urlDecode(backup.cipher.ciphertext);
    const aesKey = await derivePbkdf2AesKey(passphrase, saltBytes, backup.kdf.iterations, ['decrypt'], cryptoApi);
    const aad = canonicalJSONBytes({ version: backup.version, recipientKeyId: backup.recipientKeyId, publicJwk: backup.publicJwk });

    // 誤ったパスフレーズと改ざんされた暗号文/タグを区別しない（fail-closed）。
    // どちらの原因でもAES-GCMの認証/復号失敗は同一の安定したエラーコードにまとめる。
    let privateJwkBytes;
    try {
      privateJwkBytes = await aesDecrypt(aesKey, ivBytes, aad, ciphertextBytes, cryptoApi);
    } catch (_) {
      throw cryptoError('CRYPTO_BACKUP_AUTH_FAILED');
    }
    let privateJwk;
    try {
      privateJwk = normalizePrivateJwk(JSON.parse(new TextDecoder().decode(privateJwkBytes)));
    } catch (_) {
      throw cryptoError('CRYPTO_MALFORMED_BACKUP');
    }
    if (privateJwk.x !== backup.publicJwk.x || privateJwk.y !== backup.publicJwk.y) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const privateKey = await cryptoApi.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return { recipientKeyId: backup.recipientKeyId, publicJwk: backup.publicJwk, privateKey };
  }

  // ============================================================
  //  医院（送信側）: ECDSA P-256 署名鍵
  // ============================================================
  async function generateSenderIdentity(options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const keyPair = await cryptoApi.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const publicJwk = await exportNormalizedPublicJwk(keyPair.publicKey, cryptoApi);
    const signingKeyId = await publicJwkFingerprint(publicJwk, 'sk_', cryptoApi);
    const clinicDeviceId = 'dev_' + base64urlEncode(randomBytes(16, cryptoApi));
    return { clinicDeviceId, signingKeyId, publicJwk, privateKey: keyPair.privateKey };
  }

  // ============================================================
  //  ペアリング（QRへ載せるペイロードのプロトコルのみ。QR描画/カメラは扱わない）
  // ============================================================
  function validateOfferShape(offer) {
    if (!sameKeySet(offer, OFFER_KEYS)) throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    if (offer.v !== PAIRING_OFFER_VERSION || offer.type !== 'dwo-pairing-offer') throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    if (!isNonEmptyString(offer.pairingId)) throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    if (offer.protocolVersion !== PROTOCOL_VERSION) throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    if (!isNonEmptyString(offer.recipientKeyId)) throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    normalizePublicJwk(offer.publicJwk);
    if (!Number.isSafeInteger(offer.createdAt) || !Number.isSafeInteger(offer.expiresAt) || offer.expiresAt <= offer.createdAt) {
      throw cryptoError('CRYPTO_INVALID_PAIRING_OFFER');
    }
  }
  function validateResponseShape(response) {
    if (!sameKeySet(response, RESPONSE_KEYS)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (response.v !== PAIRING_RESPONSE_VERSION || response.type !== 'dwo-pairing-response') throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (!isNonEmptyString(response.pairingId)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (!isNonEmptyString(response.recipientKeyId)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (!isNonEmptyString(response.clinicDeviceId)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (!isNonEmptyString(response.signingKeyId)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    normalizePublicJwk(response.signingPublicJwk);
    if (!Number.isSafeInteger(response.createdAt)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
    if (!isNonEmptyString(response.signature)) throw cryptoError('CRYPTO_INVALID_PAIRING_RESPONSE');
  }

  async function createPairingOffer(recipientPublicInfo, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const now = resolveNow(opts);
    if (!recipientPublicInfo) throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'recipientPublicInfo');
    const publicJwk = normalizePublicJwk(recipientPublicInfo.publicJwk);
    if (!isNonEmptyString(recipientPublicInfo.recipientKeyId)) throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'recipientKeyId');
    const expected = await publicJwkFingerprint(publicJwk, 'rk_', cryptoApi);
    if (expected !== recipientPublicInfo.recipientKeyId) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const expiresInMs = Number.isInteger(opts.expiresInMs) && opts.expiresInMs > 0 ? opts.expiresInMs : DEFAULT_PAIRING_EXPIRY_MS;
    const createdAt = now();
    const pairingId = isNonEmptyString(opts.pairingId) ? opts.pairingId : 'pr_' + base64urlEncode(randomBytes(16, cryptoApi));

    const offer = {
      v: PAIRING_OFFER_VERSION,
      type: 'dwo-pairing-offer',
      pairingId,
      protocolVersion: PROTOCOL_VERSION,
      recipientKeyId: recipientPublicInfo.recipientKeyId,
      publicJwk,
      createdAt,
      expiresAt: createdAt + expiresInMs
    };
    validateOfferShape(offer);
    return offer;
  }

  function encodePairingPayload(payload) {
    if (!payload || typeof payload !== 'object') throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    if (payload.type === 'dwo-pairing-offer') validateOfferShape(payload);
    else if (payload.type === 'dwo-pairing-response') validateResponseShape(payload);
    else throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    return PAIRING_PAYLOAD_PREFIX + base64urlEncode(canonicalJSONBytes(payload));
  }

  function decodePairingPayload(text) {
    if (typeof text !== 'string' || !text.startsWith(PAIRING_PAYLOAD_PREFIX)) throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    const body = text.slice(PAIRING_PAYLOAD_PREFIX.length);
    let payload;
    try {
      const bytes = base64urlDecode(body);
      payload = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    }
    if (!payload || typeof payload !== 'object') throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    if (payload.type === 'dwo-pairing-offer') validateOfferShape(payload);
    else if (payload.type === 'dwo-pairing-response') validateResponseShape(payload);
    else throw cryptoError('CRYPTO_INVALID_PAIRING_PAYLOAD');
    return payload;
  }

  async function createPairingResponse(offer, senderIdentity, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const now = resolveNow(opts);
    validateOfferShape(offer);
    if (!senderIdentity || !isNonEmptyString(senderIdentity.clinicDeviceId) || !isNonEmptyString(senderIdentity.signingKeyId) || !senderIdentity.privateKey) {
      throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'senderIdentity');
    }
    const signingPublicJwk = normalizePublicJwk(senderIdentity.publicJwk);
    const body = {
      v: PAIRING_RESPONSE_VERSION,
      type: 'dwo-pairing-response',
      pairingId: offer.pairingId,
      recipientKeyId: offer.recipientKeyId,
      clinicDeviceId: senderIdentity.clinicDeviceId,
      signingKeyId: senderIdentity.signingKeyId,
      signingPublicJwk,
      createdAt: now()
    };
    const signature = await signCanonical(body, senderIdentity.privateKey, cryptoApi);
    const response = Object.assign({}, body, { signature });
    validateResponseShape(response);
    return response;
  }

  async function verifyPairingResponse(offer, response, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const now = resolveNow(opts);
    validateOfferShape(offer);
    validateResponseShape(response);

    if (now() > offer.expiresAt) throw cryptoError('CRYPTO_PAIRING_EXPIRED');
    if (response.pairingId !== offer.pairingId) throw cryptoError('CRYPTO_PAIRING_MISMATCH');
    if (response.recipientKeyId !== offer.recipientKeyId) throw cryptoError('CRYPTO_RECIPIENT_MISMATCH');

    const expectedSigningKeyId = await publicJwkFingerprint(response.signingPublicJwk, 'sk_', cryptoApi);
    if (expectedSigningKeyId !== response.signingKeyId) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const body = {
      v: response.v, type: response.type, pairingId: response.pairingId, recipientKeyId: response.recipientKeyId,
      clinicDeviceId: response.clinicDeviceId, signingKeyId: response.signingKeyId,
      signingPublicJwk: response.signingPublicJwk, createdAt: response.createdAt
    };
    const ok = await verifyCanonicalSignature(body, response.signature, response.signingPublicJwk, cryptoApi);
    if (!ok) throw cryptoError('CRYPTO_INVALID_SIGNATURE');

    const nowVal = now();
    return {
      version: REGISTRY_VERSION,
      clinicDeviceId: response.clinicDeviceId,
      status: 'active',
      pairedRecipientKeyId: response.recipientKeyId,
      activeSigningKey: { signingKeyId: response.signingKeyId, publicJwk: response.signingPublicJwk, activatedAt: nowVal },
      retiredSigningKeys: [],
      pairingId: response.pairingId,
      createdAt: nowVal,
      updatedAt: nowVal
    };
  }

  // ============================================================
  //  送信元レジストリ: 失効 / 鍵ローテーション
  // ============================================================
  function validateRegistryShape(registry) {
    if (registry === null || registry === undefined) throw cryptoError('CRYPTO_SENDER_UNKNOWN');
    if (typeof registry !== 'object' || Array.isArray(registry)) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    const allowed = new Set(REGISTRY_BASE_KEYS.concat(REGISTRY_OPTIONAL_KEYS));
    const keys = Object.keys(registry);
    if (!keys.every(k => allowed.has(k))) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (!REGISTRY_BASE_KEYS.every(k => Object.prototype.hasOwnProperty.call(registry, k))) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (registry.version !== REGISTRY_VERSION) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (registry.status !== 'active' && registry.status !== 'revoked') throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (!isNonEmptyString(registry.clinicDeviceId)) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (!isNonEmptyString(registry.pairedRecipientKeyId)) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    if (!registry.activeSigningKey || !isNonEmptyString(registry.activeSigningKey.signingKeyId)) throw cryptoError('CRYPTO_INVALID_REGISTRY');
    normalizePublicJwk(registry.activeSigningKey.publicJwk);
    if (!Array.isArray(registry.retiredSigningKeys)) throw cryptoError('CRYPTO_INVALID_REGISTRY');
  }

  function revokeSender(registry, reason, options) {
    const opts = options || {};
    const now = resolveNow(opts);
    validateRegistryShape(registry);
    return Object.assign({}, registry, {
      status: 'revoked',
      revokedAt: now(),
      revokedReason: typeof reason === 'string' ? reason : ''
    });
  }

  function validateRotationShape(rotation) {
    if (!sameKeySet(rotation, ROTATION_KEYS)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (rotation.v !== ROTATION_VERSION || rotation.type !== 'dwo-sender-key-rotation') throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (!isNonEmptyString(rotation.clinicDeviceId)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (!isNonEmptyString(rotation.pairedRecipientKeyId)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (!isNonEmptyString(rotation.oldSigningKeyId)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (!isNonEmptyString(rotation.newSigningKeyId)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    normalizePublicJwk(rotation.newSigningPublicJwk);
    if (!Number.isSafeInteger(rotation.createdAt)) throw cryptoError('CRYPTO_INVALID_ROTATION');
    if (!isNonEmptyString(rotation.signature)) throw cryptoError('CRYPTO_INVALID_ROTATION');
  }

  async function createSenderKeyRotation(registry, oldSenderIdentity, newSenderIdentity, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const now = resolveNow(opts);
    validateRegistryShape(registry);
    if (!oldSenderIdentity || !isNonEmptyString(oldSenderIdentity.signingKeyId) || !oldSenderIdentity.privateKey) {
      throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'oldSenderIdentity');
    }
    if (!newSenderIdentity || !isNonEmptyString(newSenderIdentity.signingKeyId) || !newSenderIdentity.publicJwk) {
      throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'newSenderIdentity');
    }
    const newSigningPublicJwk = normalizePublicJwk(newSenderIdentity.publicJwk);
    const body = {
      v: ROTATION_VERSION,
      type: 'dwo-sender-key-rotation',
      clinicDeviceId: registry.clinicDeviceId,
      pairedRecipientKeyId: registry.pairedRecipientKeyId,
      oldSigningKeyId: oldSenderIdentity.signingKeyId,
      newSigningKeyId: newSenderIdentity.signingKeyId,
      newSigningPublicJwk,
      createdAt: now()
    };
    const signature = await signCanonical(body, oldSenderIdentity.privateKey, cryptoApi);
    const rotation = Object.assign({}, body, { signature });
    validateRotationShape(rotation);
    return rotation;
  }

  async function applySenderKeyRotation(registry, rotation, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const now = resolveNow(opts);
    validateRegistryShape(registry);
    validateRotationShape(rotation);

    if (registry.status !== 'active') throw cryptoError('CRYPTO_SENDER_REVOKED');
    if (rotation.clinicDeviceId !== registry.clinicDeviceId) throw cryptoError('CRYPTO_DEVICE_MISMATCH');
    if (rotation.pairedRecipientKeyId !== registry.pairedRecipientKeyId) throw cryptoError('CRYPTO_RECIPIENT_MISMATCH');
    if (rotation.oldSigningKeyId !== registry.activeSigningKey.signingKeyId) throw cryptoError('CRYPTO_SENDER_KEY_NOT_ACTIVE');

    const body = {
      v: rotation.v, type: rotation.type, clinicDeviceId: rotation.clinicDeviceId, pairedRecipientKeyId: rotation.pairedRecipientKeyId,
      oldSigningKeyId: rotation.oldSigningKeyId, newSigningKeyId: rotation.newSigningKeyId,
      newSigningPublicJwk: rotation.newSigningPublicJwk, createdAt: rotation.createdAt
    };
    const ok = await verifyCanonicalSignature(body, rotation.signature, registry.activeSigningKey.publicJwk, cryptoApi);
    if (!ok) throw cryptoError('CRYPTO_INVALID_SIGNATURE');

    const expectedNewId = await publicJwkFingerprint(rotation.newSigningPublicJwk, 'sk_', cryptoApi);
    if (expectedNewId !== rotation.newSigningKeyId) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const nowVal = now();
    return Object.assign({}, registry, {
      activeSigningKey: { signingKeyId: rotation.newSigningKeyId, publicJwk: rotation.newSigningPublicJwk, activatedAt: nowVal },
      retiredSigningKeys: registry.retiredSigningKeys.concat([Object.assign({}, registry.activeSigningKey, { retiredAt: nowVal })]),
      updatedAt: nowVal
    });
  }

  // ============================================================
  //  技工所側 鍵リング（現行鍵 + 復号専用の過去鍵集合）
  // ============================================================
  function validateRingEntry(entry) {
    if (!sameKeySet(entry, RING_ENTRY_KEYS)) throw cryptoError('CRYPTO_INVALID_KEYRING');
    if (!isNonEmptyString(entry.recipientKeyId)) throw cryptoError('CRYPTO_INVALID_KEYRING');
    normalizePublicJwk(entry.publicJwk);
    if (!entry.privateKey || typeof entry.privateKey !== 'object') throw cryptoError('CRYPTO_INVALID_KEYRING');
  }
  function validateRingShape(ring) {
    if (!sameKeySet(ring, RING_KEYS)) throw cryptoError('CRYPTO_INVALID_KEYRING');
    if (ring.version !== RING_VERSION) throw cryptoError('CRYPTO_INVALID_KEYRING');
    validateRingEntry(ring.active);
    if (!Array.isArray(ring.decryptOnly)) throw cryptoError('CRYPTO_INVALID_KEYRING');
    ring.decryptOnly.forEach(validateRingEntry);
  }
  function identityToRingEntry(identity) {
    if (!identity || !isNonEmptyString(identity.recipientKeyId) || !identity.privateKey) throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'identity');
    const publicJwk = normalizePublicJwk(identity.publicJwk);
    return { recipientKeyId: identity.recipientKeyId, publicJwk, privateKey: identity.privateKey };
  }

  function createRecipientKeyRing(identity, options) {
    const active = identityToRingEntry(identity);
    const ring = { version: RING_VERSION, active, decryptOnly: [] };
    validateRingShape(ring);
    return ring;
  }

  function rotateRecipientKeyRing(ring, newIdentity, options) {
    validateRingShape(ring);
    const newActive = identityToRingEntry(newIdentity);
    const exists = ring.active.recipientKeyId === newActive.recipientKeyId ||
      ring.decryptOnly.some(k => k.recipientKeyId === newActive.recipientKeyId);
    if (exists) throw cryptoError('CRYPTO_DUPLICATE_KEY_ID');
    const next = { version: ring.version, active: newActive, decryptOnly: ring.decryptOnly.concat([ring.active]) };
    validateRingShape(next);
    return next;
  }

  function retireDecryptOnlyRecipient(ring, keyId, options) {
    validateRingShape(ring);
    const opts = options || {};
    if (opts.inFlightCount !== 0) throw cryptoError('CRYPTO_RETIRE_BLOCKED');
    if (keyId === ring.active.recipientKeyId) throw cryptoError('CRYPTO_RETIRE_BLOCKED');
    const idx = ring.decryptOnly.findIndex(k => k.recipientKeyId === keyId);
    if (idx < 0) throw cryptoError('CRYPTO_UNKNOWN_RECIPIENT_KEY');
    const copy = ring.decryptOnly.slice();
    copy.splice(idx, 1);
    const next = Object.assign({}, ring, { decryptOnly: copy });
    validateRingShape(next);
    return next;
  }

  function selectRecipientKey(input, recipientKeyId) {
    if (!input || typeof input !== 'object') throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'recipientKeyRingOrIdentity');
    let active;
    let decryptOnly;
    if (input.active && input.active.recipientKeyId) {
      active = input.active;
      decryptOnly = Array.isArray(input.decryptOnly) ? input.decryptOnly : [];
    } else if (input.recipientKeyId && input.privateKey) {
      active = input;
      decryptOnly = [];
    } else {
      throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'recipientKeyRingOrIdentity');
    }
    if (active.recipientKeyId === recipientKeyId) return active.privateKey;
    const found = decryptOnly.find(k => k && k.recipientKeyId === recipientKeyId);
    if (found) return found.privateKey;
    throw cryptoError('CRYPTO_UNKNOWN_RECIPIENT_KEY');
  }

  // ============================================================
  //  暗号化転送エンベロープ
  // ============================================================
  function validateDescriptorShape(descriptor) {
    if (!sameKeySet(descriptor, DESCRIPTOR_KEYS)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (descriptor.v !== DESCRIPTOR_VERSION) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (descriptor.protocolVersion !== PROTOCOL_VERSION) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isNonEmptyString(descriptor.workOrderRef)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isNonEmptyString(descriptor.senderClinicDeviceId)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isNonEmptyString(descriptor.senderSigningKeyId)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isNonEmptyString(descriptor.recipientKeyId)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!Number.isSafeInteger(descriptor.createdAt)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    normalizePublicJwk(descriptor.ephemeralPublicJwk);
    const saltBytes = base64urlDecode(descriptor.hkdfSalt);
    if (saltBytes.length < 16) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isHex64(descriptor.manifestSha256) || !isHex64(descriptor.workOrderSha256)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!Array.isArray(descriptor.attachments)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    descriptor.attachments.forEach(entry => {
      if (!sameKeySet(entry, ['attachmentId', 'sha256', 'chunks'])) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
      if (!isNonEmptyString(entry.attachmentId) || !isHex64(entry.sha256)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
      if (!Array.isArray(entry.chunks) || entry.chunks.length === 0) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
      entry.chunks.forEach((chunk, index) => {
        if (!sameKeySet(chunk, ['index', 'sha256'])) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
        if (chunk.index !== index || !isHex64(chunk.sha256)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
      });
    });
  }

  function validatePartShape(part) {
    if (!part || typeof part !== 'object') throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (typeof part.iv !== 'string') throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    const ivBytes = base64urlDecode(part.iv);
    if (ivBytes.length !== IV_BYTE_LENGTH) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!part.ciphertext || typeof part.ciphertext.arrayBuffer !== 'function' || typeof part.ciphertext.size !== 'number') {
      throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    }
  }

  function validatePartsShape(parts, descriptor) {
    if (!sameKeySet(parts, ['manifest', 'workOrder', 'attachments'])) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    validatePartShape(parts.manifest);
    validatePartShape(parts.workOrder);
    if (!parts.attachments || typeof parts.attachments !== 'object' || Array.isArray(parts.attachments)) {
      throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    }
    const descIds = descriptor.attachments.map(a => a.attachmentId);
    const partIds = Object.keys(parts.attachments);
    if (partIds.length !== descIds.length || !descIds.every(id => partIds.includes(id))) throw cryptoError('CRYPTO_PART_MISMATCH');

    descriptor.attachments.forEach(entry => {
      const partEntry = parts.attachments[entry.attachmentId];
      if (!partEntry || !Array.isArray(partEntry.chunks) || partEntry.chunks.length !== entry.chunks.length) {
        throw cryptoError('CRYPTO_PART_MISMATCH');
      }
      const seenIdx = new Set();
      partEntry.chunks.forEach(chunkPart => {
        if (!Number.isInteger(chunkPart.index)) throw cryptoError('CRYPTO_PART_MISMATCH');
        if (seenIdx.has(chunkPart.index)) throw cryptoError('CRYPTO_PART_MISMATCH');
        seenIdx.add(chunkPart.index);
        validatePartShape(chunkPart);
      });
      for (let i = 0; i < entry.chunks.length; i += 1) {
        if (!seenIdx.has(i)) throw cryptoError('CRYPTO_PART_MISMATCH');
      }
    });
  }

  function collectAllIvs(envelope) {
    const ivs = [envelope.parts.manifest.iv, envelope.parts.workOrder.iv];
    Object.keys(envelope.parts.attachments).forEach(id => {
      envelope.parts.attachments[id].chunks.forEach(c => ivs.push(c.iv));
    });
    return ivs;
  }
  function assertUniqueIvs(envelope) {
    const ivs = collectAllIvs(envelope);
    if (new Set(ivs).size !== ivs.length) throw cryptoError('CRYPTO_DUPLICATE_IV');
  }

  function validateEnvelopeStructure(envelope) {
    if (!envelope || typeof envelope !== 'object') throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!sameKeySet(envelope, ['version', 'header', 'descriptor', 'signature', 'parts'])) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (envelope.version !== ENVELOPE_VERSION) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!sameKeySet(envelope.header, ['version', 'descriptorSha256'])) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (envelope.header.version !== ENVELOPE_VERSION) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    if (!isHex64(envelope.header.descriptorSha256)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    validateDescriptorShape(envelope.descriptor);
    if (!isNonEmptyString(envelope.signature)) throw cryptoError('CRYPTO_MALFORMED_ENVELOPE');
    validatePartsShape(envelope.parts, envelope.descriptor);
  }

  async function buildHkdfInfo(protocolVersion, workOrderRef, senderSigningKeyId, recipientKeyId) {
    return canonicalJSONBytes({ protocolVersion, workOrderRef, senderSigningKeyId, recipientKeyId });
  }

  async function encryptPackage(pkg, senderIdentity, recipientPublicInfo, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const transferApi = resolveTransferApi(opts);
    const now = resolveNow(opts);

    // 1) Phase3の完全性検証を先に行う。不正な平文パッケージは暗号化しない。
    await transferApi.verifyPackage(pkg, { crypto: cryptoApi });

    if (!senderIdentity || !isNonEmptyString(senderIdentity.clinicDeviceId) || !isNonEmptyString(senderIdentity.signingKeyId) || !senderIdentity.privateKey) {
      throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'senderIdentity');
    }
    const recipientPublicJwk = normalizePublicJwk(recipientPublicInfo && recipientPublicInfo.publicJwk);
    const recipientKeyId = recipientPublicInfo && recipientPublicInfo.recipientKeyId;
    if (!isNonEmptyString(recipientKeyId)) throw cryptoError('CRYPTO_INVALID_ARGUMENT', 'recipientKeyId');
    const expectedRecipientKeyId = await publicJwkFingerprint(recipientPublicJwk, 'rk_', cryptoApi);
    if (expectedRecipientKeyId !== recipientKeyId) throw cryptoError('CRYPTO_KEY_MISMATCH');

    const manifest = pkg.manifest;

    // 2) 一時ECDH鍵 + HKDF salt
    const ephemeralKeyPair = await cryptoApi.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const ephemeralPublicJwk = await exportNormalizedPublicJwk(ephemeralKeyPair.publicKey, cryptoApi);
    const saltBytes = randomBytes(32, cryptoApi);

    // 3) ECDH -> HKDF-SHA-256 -> AES-256-GCM
    const recipientPublicKey = await importEcdhPublicKey(recipientPublicJwk, cryptoApi);
    const sharedBits = await cryptoApi.subtle.deriveBits({ name: 'ECDH', public: recipientPublicKey }, ephemeralKeyPair.privateKey, 256);
    const hkdfKeyMaterial = await cryptoApi.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const infoBytes = await buildHkdfInfo(PROTOCOL_VERSION, manifest.workOrderRef, senderIdentity.signingKeyId, recipientKeyId);
    const contentKey = await cryptoApi.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
      hkdfKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    // 4) 署名対象の非機微な記述子（暗号化の前に構築する）
    const manifestBytes = encodeJsonBytes(manifest);
    const manifestSha256 = await sha256Hex(manifestBytes, cryptoApi);

    const descriptor = {
      v: DESCRIPTOR_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      workOrderRef: manifest.workOrderRef,
      senderClinicDeviceId: senderIdentity.clinicDeviceId,
      senderSigningKeyId: senderIdentity.signingKeyId,
      recipientKeyId,
      createdAt: now(),
      ephemeralPublicJwk,
      hkdfSalt: base64urlEncode(saltBytes),
      manifestSha256,
      workOrderSha256: manifest.workOrder.sha256,
      attachments: manifest.attachments.map(a => ({
        attachmentId: a.attachmentId,
        sha256: a.sha256,
        chunks: a.chunks.map(c => ({ index: c.index, sha256: c.sha256 }))
      }))
    };
    validateDescriptorShape(descriptor);

    // 5) 記述子へ署名する
    const descriptorBytes = canonicalJSONBytes(descriptor);
    const descriptorSha256 = await sha256Hex(descriptorBytes, cryptoApi);
    const signature = await signCanonical(descriptor, senderIdentity.privateKey, cryptoApi);

    // 6) manifest / work-order / 添付チャンクを個別に暗号化する。IVは封筒内で一意。
    const usedIvs = new Set();

    const manifestIv = randomIv(cryptoApi, usedIvs);
    const manifestAad = canonicalJSONBytes({ descriptorSha256, partType: 'manifest' });
    const manifestCiphertext = await aesEncrypt(contentKey, manifestIv, manifestAad, manifestBytes, cryptoApi);
    const manifestPart = buildPart(manifestIv, manifestCiphertext);

    const workOrderBytes = new Uint8Array(await pkg.workOrder.blob.arrayBuffer());
    const workOrderIv = randomIv(cryptoApi, usedIvs);
    const workOrderAad = canonicalJSONBytes({ descriptorSha256, partType: 'work-order' });
    const workOrderCiphertext = await aesEncrypt(contentKey, workOrderIv, workOrderAad, workOrderBytes, cryptoApi);
    const workOrderPart = buildPart(workOrderIv, workOrderCiphertext);

    const attachmentsParts = {};
    for (const entry of manifest.attachments) {
      const chunkBlobs = (pkg.attachments[entry.attachmentId] && pkg.attachments[entry.attachmentId].chunks) || [];
      const chunkParts = [];
      for (let i = 0; i < entry.chunks.length; i += 1) {
        const chunkMeta = entry.chunks[i];
        const plaintext = new Uint8Array(await chunkBlobs[i].arrayBuffer());
        const iv = randomIv(cryptoApi, usedIvs);
        const aad = canonicalJSONBytes({
          descriptorSha256, partType: 'attachment-chunk',
          attachmentId: entry.attachmentId, index: chunkMeta.index, sha256: chunkMeta.sha256
        });
        const ciphertext = await aesEncrypt(contentKey, iv, aad, plaintext, cryptoApi);
        chunkParts.push(Object.assign({ index: chunkMeta.index }, buildPart(iv, ciphertext)));
      }
      attachmentsParts[entry.attachmentId] = { chunks: chunkParts };
    }

    // 7) 封筒を返す。アップロード・永続化は行わない。
    const envelope = {
      version: ENVELOPE_VERSION,
      header: { version: ENVELOPE_VERSION, descriptorSha256 },
      descriptor,
      signature,
      parts: { manifest: manifestPart, workOrder: workOrderPart, attachments: attachmentsParts }
    };
    validateEnvelopeStructure(envelope);
    return envelope;
  }

  async function verifyEnvelopeSignature(envelope, senderRegistry, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);

    validateEnvelopeStructure(envelope);
    assertUniqueIvs(envelope);

    const descriptorBytes = canonicalJSONBytes(envelope.descriptor);
    const recomputedDescriptorSha256 = await sha256Hex(descriptorBytes, cryptoApi);
    if (recomputedDescriptorSha256 !== envelope.header.descriptorSha256) throw cryptoError('CRYPTO_HEADER_MISMATCH');

    validateRegistryShape(senderRegistry);
    if (senderRegistry.status !== 'active') throw cryptoError('CRYPTO_SENDER_REVOKED');
    if (envelope.descriptor.senderClinicDeviceId !== senderRegistry.clinicDeviceId) throw cryptoError('CRYPTO_DEVICE_MISMATCH');
    if (envelope.descriptor.recipientKeyId !== senderRegistry.pairedRecipientKeyId) throw cryptoError('CRYPTO_RECIPIENT_MISMATCH');
    if (envelope.descriptor.senderSigningKeyId !== senderRegistry.activeSigningKey.signingKeyId) throw cryptoError('CRYPTO_SENDER_KEY_NOT_ACTIVE');

    const publicKey = await importEcdsaPublicKey(senderRegistry.activeSigningKey.publicJwk, cryptoApi);
    const ok = await cryptoApi.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64urlDecode(envelope.signature), descriptorBytes);
    if (!ok) throw cryptoError('CRYPTO_INVALID_SIGNATURE');

    return canonicalJSONValue(envelope.descriptor);
  }

  function crossCheckManifestAgainstDescriptor(manifest, descriptor) {
    if (!Array.isArray(manifest.attachments) || manifest.attachments.length !== descriptor.attachments.length) {
      throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');
    }
    const descMap = new Map(descriptor.attachments.map(a => [a.attachmentId, a]));
    manifest.attachments.forEach(entry => {
      const d = descMap.get(entry.attachmentId);
      if (!d || d.sha256 !== entry.sha256) throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');
      if (!Array.isArray(entry.chunks) || entry.chunks.length !== d.chunks.length) throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');
      entry.chunks.forEach((c, i) => {
        if (c.index !== i || c.index !== d.chunks[i].index || c.sha256 !== d.chunks[i].sha256) {
          throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');
        }
      });
    });
  }

  async function decryptEnvelope(envelope, recipientKeyRingOrIdentity, senderRegistry, options) {
    const opts = options || {};
    const cryptoApi = resolveCrypto(opts);
    const transferApi = resolveTransferApi(opts);

    // 1) まず送信元署名を検証する（復号前）。
    const descriptor = await verifyEnvelopeSignature(envelope, senderRegistry, options);

    // 2) recipientKeyIdで受信側鍵を選ぶ。
    const recipientPrivateKey = selectRecipientKey(recipientKeyRingOrIdentity, descriptor.recipientKeyId);

    // 3) 一時公開鍵 + 署名済みHKDF saltからコンテンツ鍵を導出する。
    const ephemeralPublicKey = await importEcdhPublicKey(descriptor.ephemeralPublicJwk, cryptoApi);
    const sharedBits = await cryptoApi.subtle.deriveBits({ name: 'ECDH', public: ephemeralPublicKey }, recipientPrivateKey, 256);
    const hkdfKeyMaterial = await cryptoApi.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const saltBytes = base64urlDecode(descriptor.hkdfSalt);
    const infoBytes = await buildHkdfInfo(descriptor.protocolVersion, descriptor.workOrderRef, descriptor.senderSigningKeyId, descriptor.recipientKeyId);
    const contentKey = await cryptoApi.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
      hkdfKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const descriptorSha256 = envelope.header.descriptorSha256;

    // 4) 各部をAADで検証しつつ復号する。
    const manifestAad = canonicalJSONBytes({ descriptorSha256, partType: 'manifest' });
    const manifestIv = base64urlDecode(envelope.parts.manifest.iv);
    const manifestCiphertext = new Uint8Array(await envelope.parts.manifest.ciphertext.arrayBuffer());
    const manifestBytes = await aesDecrypt(contentKey, manifestIv, manifestAad, manifestCiphertext, cryptoApi);
    const manifestSha256Actual = await sha256Hex(manifestBytes, cryptoApi);
    if (manifestSha256Actual !== descriptor.manifestSha256) throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');

    let manifest;
    try {
      manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    } catch (_) {
      throw cryptoError('CRYPTO_DECRYPT_FAILED');
    }
    crossCheckManifestAgainstDescriptor(manifest, descriptor);

    const workOrderAad = canonicalJSONBytes({ descriptorSha256, partType: 'work-order' });
    const workOrderIv = base64urlDecode(envelope.parts.workOrder.iv);
    const workOrderCiphertext = new Uint8Array(await envelope.parts.workOrder.ciphertext.arrayBuffer());
    const workOrderBytes = await aesDecrypt(contentKey, workOrderIv, workOrderAad, workOrderCiphertext, cryptoApi);
    const workOrderBlob = new Blob([workOrderBytes], { type: 'application/json' });
    if (manifest.workOrder.sha256 !== descriptor.workOrderSha256) throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');

    const attachmentsPayload = {};
    for (const entry of manifest.attachments) {
      const partEntry = envelope.parts.attachments[entry.attachmentId];
      if (!partEntry) throw cryptoError('CRYPTO_PART_MISMATCH');
      const chunkBlobs = new Array(entry.chunks.length);
      for (const chunkPart of partEntry.chunks) {
        const chunkMeta = entry.chunks[chunkPart.index];
        if (!chunkMeta) throw cryptoError('CRYPTO_PART_MISMATCH');
        const aad = canonicalJSONBytes({
          descriptorSha256, partType: 'attachment-chunk',
          attachmentId: entry.attachmentId, index: chunkPart.index, sha256: chunkMeta.sha256
        });
        const iv = base64urlDecode(chunkPart.iv);
        const ciphertext = new Uint8Array(await chunkPart.ciphertext.arrayBuffer());
        const plaintext = await aesDecrypt(contentKey, iv, aad, ciphertext, cryptoApi);
        const actualSha256 = await sha256Hex(plaintext, cryptoApi);
        if (actualSha256 !== chunkMeta.sha256) throw cryptoError('CRYPTO_DESCRIPTOR_MISMATCH');
        chunkBlobs[chunkPart.index] = new Blob([plaintext]);
      }
      if (chunkBlobs.some(b => !b)) throw cryptoError('CRYPTO_PART_MISMATCH');
      attachmentsPayload[entry.attachmentId] = { chunks: chunkBlobs };
    }

    // 5)-6) Phase3のパッケージへ戻し、Phase3自身の完全性検証と記述子の相互確認を通す。
    const rebuiltPackage = { manifest, workOrder: { blob: workOrderBlob }, attachments: attachmentsPayload };
    await transferApi.verifyPackage(rebuiltPackage, { crypto: cryptoApi });

    return { workOrderRef: manifest.workOrderRef, package: rebuiltPackage };
  }

  // ============================================================
  //  公開API
  // ============================================================
  const api = {
    ALGORITHMS,
    SCHEMA_VERSIONS,
    PROTOCOL_VERSION,

    // base64url / canonical JSON
    base64urlEncode,
    base64urlDecode,
    canonicalJson: canonicalJSONStringify,

    // 鍵の抽出可否
    isKeyExtractable,

    // 技工所（受信側）識別
    generateRecipientIdentity,
    restoreRecipientIdentity,

    // 医院（送信側）識別
    generateSenderIdentity,

    // ペアリング
    createPairingOffer,
    encodePairingPayload,
    decodePairingPayload,
    createPairingResponse,
    verifyPairingResponse,

    // 送信元レジストリ
    revokeSender,
    createSenderKeyRotation,
    applySenderKeyRotation,

    // 受信側鍵リング
    createRecipientKeyRing,
    rotateRecipientKeyRing,
    retireDecryptOnlyRecipient,

    // 暗号化転送エンベロープ
    encryptPackage,
    verifyEnvelopeSignature,
    decryptEnvelope
  };

  global.MediaTransferCrypto = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

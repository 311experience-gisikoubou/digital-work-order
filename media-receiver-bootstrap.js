(function (global) {
  'use strict';

  const BOOTSTRAP_VERSION = 'dwo-receiver-bootstrap-v1';
  const PLAINTEXT_VERSION = 'dwo-receiver-bootstrap-plaintext-v1';
  const IV_BYTES = 12;
  const SALT_BYTES = 16;
  const HEX64 = /^[0-9a-f]{64}$/;
  const BASE64URL = /^[A-Za-z0-9_-]+$/;

  function receiverError(code, detail) {
    const error = new Error(detail ? code + ': ' + detail : code);
    error.code = code;
    return error;
  }

  function resolveCrypto(options) {
    const api = options && options.crypto ? options.crypto : global.crypto;
    if (!api || !api.subtle || typeof api.getRandomValues !== 'function') {
      throw receiverError('RECEIVER_CRYPTO_UNAVAILABLE');
    }
    return api;
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    if (!isObject(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
  }

  function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw receiverError('RECEIVER_NON_JSON_VALUE');
      return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isObject(value)) {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        const entry = value[key];
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
          throw receiverError('RECEIVER_NON_JSON_VALUE');
        }
        out[key] = canonicalize(entry);
      });
      return out;
    }
    throw receiverError('RECEIVER_NON_JSON_VALUE');
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function randomBytes(length, cryptoApi) {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  function base64urlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = typeof btoa === 'function'
      ? btoa(binary)
      : (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : null);
    if (!encoded) throw receiverError('RECEIVER_BASE64_UNAVAILABLE');
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64urlDecode(value) {
    if (typeof value !== 'string' || !BASE64URL.test(value)) throw receiverError('RECEIVER_INVALID_BASE64URL');
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    try {
      if (typeof atob === 'function') {
        const binary = atob(base64);
        return Uint8Array.from(binary, ch => ch.charCodeAt(0));
      }
      if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'));
    } catch (_) {
      throw receiverError('RECEIVER_INVALID_BASE64URL');
    }
    throw receiverError('RECEIVER_BASE64_UNAVAILABLE');
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(bytes, cryptoApi) {
    return bytesToHex(new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes)));
  }

  function normalizePublicJwk(jwk) {
    if (!isObject(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' ||
        typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
      throw receiverError('RECEIVER_INVALID_PUBLIC_KEY');
    }
    return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  }

  function assertRecipientId(value) {
    if (typeof value !== 'string' || !value.startsWith('rk_') || value.length > 160) {
      throw receiverError('RECEIVER_INVALID_RECIPIENT');
    }
  }

  function validateEnvelopeMetadata(envelope) {
    if (!isObject(envelope) || !isObject(envelope.header) || !isObject(envelope.descriptor) ||
        typeof envelope.signature !== 'string' || !isObject(envelope.parts)) {
      throw receiverError('RECEIVER_INVALID_ENVELOPE');
    }
    if (!exactKeys(envelope.header, ['version', 'descriptorSha256']) || !HEX64.test(envelope.header.descriptorSha256)) {
      throw receiverError('RECEIVER_INVALID_ENVELOPE');
    }
    assertRecipientId(envelope.descriptor.recipientKeyId);
    if (!isObject(envelope.parts.manifest) || typeof envelope.parts.manifest.iv !== 'string' ||
        !isObject(envelope.parts.workOrder) || typeof envelope.parts.workOrder.iv !== 'string' ||
        !isObject(envelope.parts.attachments)) {
      throw receiverError('RECEIVER_INVALID_ENVELOPE');
    }
  }

  function buildPartMetadata(envelope) {
    const attachments = {};
    const ids = Array.isArray(envelope.descriptor.attachments)
      ? envelope.descriptor.attachments.map(entry => entry.attachmentId)
      : [];
    ids.forEach(id => {
      const source = envelope.parts.attachments[id];
      if (!source || !Array.isArray(source.chunks)) throw receiverError('RECEIVER_INVALID_ENVELOPE');
      attachments[id] = {
        chunks: source.chunks.map((chunk, index) => {
          if (chunk.index !== index || typeof chunk.iv !== 'string') throw receiverError('RECEIVER_INVALID_ENVELOPE');
          return { index, iv: chunk.iv };
        })
      };
    });
    return {
      manifest: { iv: envelope.parts.manifest.iv },
      workOrder: { iv: envelope.parts.workOrder.iv },
      attachments
    };
  }

  function selectRecipientPrivateKey(input, recipientKeyId) {
    if (!input || typeof input !== 'object') throw receiverError('RECEIVER_INVALID_KEYRING');
    if (input.recipientKeyId && input.privateKey) {
      if (input.recipientKeyId !== recipientKeyId) throw receiverError('RECEIVER_UNKNOWN_RECIPIENT_KEY');
      return input.privateKey;
    }
    if (input.active && input.active.recipientKeyId) {
      if (input.active.recipientKeyId === recipientKeyId) return input.active.privateKey;
      const found = Array.isArray(input.decryptOnly)
        ? input.decryptOnly.find(entry => entry && entry.recipientKeyId === recipientKeyId)
        : null;
      if (found) return found.privateKey;
    }
    throw receiverError('RECEIVER_UNKNOWN_RECIPIENT_KEY');
  }

  function publicHeaderCore(header) {
    return {
      version: header.version,
      recipientKeyId: header.recipientKeyId,
      ephemeralPublicJwk: header.ephemeralPublicJwk,
      hkdfSalt: header.hkdfSalt,
      iv: header.iv
    };
  }

  function validateHeader(header) {
    const keys = [
      'version', 'recipientKeyId', 'ephemeralPublicJwk', 'hkdfSalt', 'iv',
      'ciphertextSha256', 'ciphertextSize'
    ];
    if (!exactKeys(header, keys) || header.version !== BOOTSTRAP_VERSION) throw receiverError('RECEIVER_INVALID_BOOTSTRAP');
    assertRecipientId(header.recipientKeyId);
    normalizePublicJwk(header.ephemeralPublicJwk);
    const salt = base64urlDecode(header.hkdfSalt);
    const iv = base64urlDecode(header.iv);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES ||
        !HEX64.test(header.ciphertextSha256) ||
        !Number.isSafeInteger(header.ciphertextSize) || header.ciphertextSize <= 0) {
      throw receiverError('RECEIVER_INVALID_BOOTSTRAP');
    }
  }

  async function deriveBootstrapKey(privateKey, publicKeyJwk, saltBytes, recipientKeyId, cryptoApi) {
    const publicKey = await cryptoApi.subtle.importKey(
      'jwk',
      normalizePublicJwk(publicKeyJwk),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    const bits = await cryptoApi.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
    const material = await cryptoApi.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    const info = new TextEncoder().encode(canonicalJson({ version: BOOTSTRAP_VERSION, recipientKeyId }));
    return cryptoApi.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function createReceiverBootstrap(envelope, recipientPublicInfo, options) {
    const cryptoApi = resolveCrypto(options);
    validateEnvelopeMetadata(envelope);
    if (!recipientPublicInfo || recipientPublicInfo.recipientKeyId !== envelope.descriptor.recipientKeyId) {
      throw receiverError('RECEIVER_RECIPIENT_MISMATCH');
    }
    assertRecipientId(recipientPublicInfo.recipientKeyId);
    const recipientPublicJwk = normalizePublicJwk(recipientPublicInfo.publicJwk);

    const ephemeral = await cryptoApi.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const ephemeralPublicJwkRaw = await cryptoApi.subtle.exportKey('jwk', ephemeral.publicKey);
    const ephemeralPublicJwk = normalizePublicJwk(ephemeralPublicJwkRaw);
    const saltBytes = randomBytes(SALT_BYTES, cryptoApi);
    const ivBytes = randomBytes(IV_BYTES, cryptoApi);

    const sharedBits = await cryptoApi.subtle.deriveBits(
      { name: 'ECDH', public: await cryptoApi.subtle.importKey('jwk', recipientPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []) },
      ephemeral.privateKey,
      256
    );
    const material = await cryptoApi.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
    const info = new TextEncoder().encode(canonicalJson({ version: BOOTSTRAP_VERSION, recipientKeyId: recipientPublicInfo.recipientKeyId }));
    const aesKey = await cryptoApi.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const core = {
      version: BOOTSTRAP_VERSION,
      recipientKeyId: recipientPublicInfo.recipientKeyId,
      ephemeralPublicJwk,
      hkdfSalt: base64urlEncode(saltBytes),
      iv: base64urlEncode(ivBytes)
    };
    const plaintext = {
      version: PLAINTEXT_VERSION,
      envelopeHeader: envelope.header,
      descriptor: envelope.descriptor,
      signature: envelope.signature,
      partMetadata: buildPartMetadata(envelope)
    };
    const plaintextBytes = new TextEncoder().encode(canonicalJson(plaintext));
    const aad = new TextEncoder().encode(canonicalJson(core));
    const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: aad, tagLength: 128 },
      aesKey,
      plaintextBytes
    ));
    const header = {
      ...core,
      ciphertextSha256: await sha256Hex(encrypted, cryptoApi),
      ciphertextSize: encrypted.byteLength
    };
    return { header, ciphertext: new Blob([encrypted], { type: 'application/octet-stream' }) };
  }

  function validatePlaintext(value) {
    if (!exactKeys(value, ['version', 'envelopeHeader', 'descriptor', 'signature', 'partMetadata']) ||
        value.version !== PLAINTEXT_VERSION || !isObject(value.envelopeHeader) ||
        !isObject(value.descriptor) || typeof value.signature !== 'string' || !isObject(value.partMetadata)) {
      throw receiverError('RECEIVER_INVALID_BOOTSTRAP_PLAINTEXT');
    }
    if (value.descriptor.recipientKeyId === undefined) throw receiverError('RECEIVER_INVALID_BOOTSTRAP_PLAINTEXT');
    return value;
  }

  async function decryptReceiverBootstrap(header, ciphertext, recipientKeyRingOrIdentity, options) {
    const cryptoApi = resolveCrypto(options);
    validateHeader(header);
    if (!(ciphertext instanceof Blob) || ciphertext.size !== header.ciphertextSize) {
      throw receiverError('RECEIVER_BOOTSTRAP_SIZE_MISMATCH');
    }
    const encrypted = new Uint8Array(await ciphertext.arrayBuffer());
    if (await sha256Hex(encrypted, cryptoApi) !== header.ciphertextSha256) {
      throw receiverError('RECEIVER_BOOTSTRAP_HASH_MISMATCH');
    }
    const privateKey = selectRecipientPrivateKey(recipientKeyRingOrIdentity, header.recipientKeyId);
    const saltBytes = base64urlDecode(header.hkdfSalt);
    const ivBytes = base64urlDecode(header.iv);
    const aesKey = await deriveBootstrapKey(privateKey, header.ephemeralPublicJwk, saltBytes, header.recipientKeyId, cryptoApi);
    const aad = new TextEncoder().encode(canonicalJson(publicHeaderCore(header)));
    let plaintextBytes;
    try {
      plaintextBytes = new Uint8Array(await cryptoApi.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes, additionalData: aad, tagLength: 128 },
        aesKey,
        encrypted
      ));
    } catch (_) {
      throw receiverError('RECEIVER_BOOTSTRAP_AUTH_FAILED');
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
    } catch (_) {
      throw receiverError('RECEIVER_INVALID_BOOTSTRAP_PLAINTEXT');
    }
    const plaintext = validatePlaintext(parsed);
    if (plaintext.descriptor.recipientKeyId !== header.recipientKeyId) {
      throw receiverError('RECEIVER_RECIPIENT_MISMATCH');
    }
    return plaintext;
  }

  const api = {
    BOOTSTRAP_VERSION,
    PLAINTEXT_VERSION,
    createReceiverBootstrap,
    decryptReceiverBootstrap,
    validateHeader
  };

  global.MediaReceiverBootstrap = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

(function (global) {
  'use strict';

  const RELAY_PROTOCOL_VERSION = 'dwo-relay-v1';
  const PLAN_VERSION = 'dwo-relay-plan-v1';
  const AUTH_VERSION = 'dwo-relay-auth-v1';
  const DEFAULT_AUTH_TTL_MS = 10 * 60 * 1000;
  const DEFAULT_MAX_ATTEMPTS = 3;
  const HEX64 = /^[0-9a-f]{64}$/;
  const BASE64URL = /^[A-Za-z0-9_-]+$/;

  function relayError(code, detail) {
    const error = new Error(detail ? code + ': ' + detail : code);
    error.code = code;
    return error;
  }

  function resolveCrypto(options) {
    const api = options && options.crypto ? options.crypto : global.crypto;
    if (!api || !api.subtle || typeof api.getRandomValues !== 'function') {
      throw relayError('RELAY_CRYPTO_UNAVAILABLE');
    }
    return api;
  }

  function resolveNow(options) {
    if (options && typeof options.now === 'function') return options.now;
    return () => Date.now();
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, i) => key === expected[i]);
  }

  function canonicalize(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw relayError('RELAY_NON_JSON_VALUE');
      return value;
    }
    if (Array.isArray(value)) return value.map(canonicalize);
    if (isPlainObject(value)) {
      const out = {};
      Object.keys(value).sort().forEach(key => {
        const entry = value[key];
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol' || typeof entry === 'bigint') {
          throw relayError('RELAY_NON_JSON_VALUE');
        }
        out[key] = canonicalize(entry);
      });
      return out;
    }
    throw relayError('RELAY_NON_JSON_VALUE');
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function base64urlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = typeof btoa === 'function'
      ? btoa(binary)
      : (typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64') : null);
    if (!encoded) throw relayError('RELAY_BASE64_UNAVAILABLE');
    return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Bytes(bytes, cryptoApi) {
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return new Uint8Array(digest);
  }

  async function sha256Hex(bytes, cryptoApi) {
    return bytesToHex(await sha256Bytes(bytes, cryptoApi));
  }

  async function sha256Json(value, cryptoApi) {
    return sha256Hex(new TextEncoder().encode(canonicalJson(value)), cryptoApi);
  }

  function assertOpaqueId(value, prefix) {
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > 160) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
  }

  function assertIv(value) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 64 || !BASE64URL.test(value)) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
  }

  function validateDescriptor(descriptor) {
    const keys = [
      'v', 'protocolVersion', 'workOrderRef', 'senderClinicDeviceId', 'senderSigningKeyId',
      'recipientKeyId', 'createdAt', 'ephemeralPublicJwk', 'hkdfSalt', 'manifestSha256',
      'workOrderSha256', 'attachments'
    ];
    if (!exactKeys(descriptor, keys)) throw relayError('RELAY_INVALID_ENVELOPE');
    if (typeof descriptor.v !== 'string' || typeof descriptor.protocolVersion !== 'string') throw relayError('RELAY_INVALID_ENVELOPE');
    if (typeof descriptor.workOrderRef !== 'string' || !descriptor.workOrderRef.startsWith('dwo:')) throw relayError('RELAY_INVALID_ENVELOPE');
    assertOpaqueId(descriptor.senderClinicDeviceId, 'dev_');
    assertOpaqueId(descriptor.senderSigningKeyId, 'sk_');
    assertOpaqueId(descriptor.recipientKeyId, 'rk_');
    if (!Number.isSafeInteger(descriptor.createdAt)) throw relayError('RELAY_INVALID_ENVELOPE');
    if (!isPlainObject(descriptor.ephemeralPublicJwk) || typeof descriptor.hkdfSalt !== 'string') throw relayError('RELAY_INVALID_ENVELOPE');
    if (!HEX64.test(descriptor.manifestSha256) || !HEX64.test(descriptor.workOrderSha256)) throw relayError('RELAY_INVALID_ENVELOPE');
    if (!Array.isArray(descriptor.attachments)) throw relayError('RELAY_INVALID_ENVELOPE');
    const seen = new Set();
    descriptor.attachments.forEach(entry => {
      if (!exactKeys(entry, ['attachmentId', 'sha256', 'chunks'])) throw relayError('RELAY_INVALID_ENVELOPE');
      assertOpaqueId(entry.attachmentId, 'att-');
      if (seen.has(entry.attachmentId) || !HEX64.test(entry.sha256) || !Array.isArray(entry.chunks)) throw relayError('RELAY_INVALID_ENVELOPE');
      seen.add(entry.attachmentId);
      entry.chunks.forEach((chunk, index) => {
        if (!exactKeys(chunk, ['index', 'sha256']) || chunk.index !== index || !HEX64.test(chunk.sha256)) {
          throw relayError('RELAY_INVALID_ENVELOPE');
        }
      });
    });
  }

  function validateCipherPart(part) {
    if (!exactKeys(part, ['iv', 'ciphertext'])) throw relayError('RELAY_INVALID_ENVELOPE');
    assertIv(part.iv);
    if (!(part.ciphertext instanceof Blob) || part.ciphertext.size <= 0) throw relayError('RELAY_INVALID_ENVELOPE');
  }

  function validateEnvelope(envelope) {
    if (!exactKeys(envelope, ['version', 'header', 'descriptor', 'signature', 'parts'])) throw relayError('RELAY_INVALID_ENVELOPE');
    if (!exactKeys(envelope.header, ['version', 'descriptorSha256']) || !HEX64.test(envelope.header.descriptorSha256)) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
    if (envelope.version !== envelope.header.version || typeof envelope.signature !== 'string' || !BASE64URL.test(envelope.signature)) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
    validateDescriptor(envelope.descriptor);
    if (!exactKeys(envelope.parts, ['manifest', 'workOrder', 'attachments']) || !isPlainObject(envelope.parts.attachments)) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
    validateCipherPart(envelope.parts.manifest);
    validateCipherPart(envelope.parts.workOrder);
    const expectedIds = envelope.descriptor.attachments.map(entry => entry.attachmentId).sort();
    const actualIds = Object.keys(envelope.parts.attachments).sort();
    if (expectedIds.length !== actualIds.length || expectedIds.some((id, i) => id !== actualIds[i])) {
      throw relayError('RELAY_INVALID_ENVELOPE');
    }
    envelope.descriptor.attachments.forEach(entry => {
      const attachment = envelope.parts.attachments[entry.attachmentId];
      if (!exactKeys(attachment, ['chunks']) || !Array.isArray(attachment.chunks) || attachment.chunks.length !== entry.chunks.length) {
        throw relayError('RELAY_INVALID_ENVELOPE');
      }
      attachment.chunks.forEach((chunk, index) => {
        if (!exactKeys(chunk, ['index', 'iv', 'ciphertext']) || chunk.index !== index) throw relayError('RELAY_INVALID_ENVELOPE');
        validateCipherPart({ iv: chunk.iv, ciphertext: chunk.ciphertext });
      });
    });
    return envelope;
  }

  function enumerateCipherParts(envelope) {
    validateEnvelope(envelope);
    const parts = [
      { slot: 'manifest', kind: 'manifest', iv: envelope.parts.manifest.iv, blob: envelope.parts.manifest.ciphertext },
      { slot: 'work-order', kind: 'work-order', iv: envelope.parts.workOrder.iv, blob: envelope.parts.workOrder.ciphertext }
    ];
    envelope.descriptor.attachments.forEach(entry => {
      const source = envelope.parts.attachments[entry.attachmentId];
      source.chunks.forEach(chunk => {
        parts.push({
          slot: `attachment:${entry.attachmentId}:${chunk.index}`,
          kind: 'attachment',
          attachmentId: entry.attachmentId,
          index: chunk.index,
          iv: chunk.iv,
          blob: chunk.ciphertext
        });
      });
    });
    return parts;
  }

  async function buildTransportPlan(envelope, options) {
    const cryptoApi = resolveCrypto(options);
    const parts = enumerateCipherParts(envelope);
    const entries = [];
    let totalBytes = 0;
    for (const part of parts) {
      const bytes = new Uint8Array(await part.blob.arrayBuffer());
      const entry = {
        slot: part.slot,
        kind: part.kind,
        iv: part.iv,
        size: bytes.byteLength,
        ciphertextSha256: await sha256Hex(bytes, cryptoApi)
      };
      if (part.kind === 'attachment') {
        entry.attachmentId = part.attachmentId;
        entry.index = part.index;
      }
      entries.push(entry);
      totalBytes += bytes.byteLength;
    }
    return { version: PLAN_VERSION, totalBytes, entries };
  }

  async function buildRelayAuthorization(envelope, plan, senderIdentity, options) {
    const cryptoApi = resolveCrypto(options);
    const now = resolveNow(options);
    validateEnvelope(envelope);
    if (!senderIdentity || !senderIdentity.privateKey || senderIdentity.privateKey.type !== 'private') {
      throw relayError('RELAY_INVALID_SENDER');
    }
    if (senderIdentity.clinicDeviceId !== envelope.descriptor.senderClinicDeviceId ||
        senderIdentity.signingKeyId !== envelope.descriptor.senderSigningKeyId) {
      throw relayError('RELAY_SENDER_MISMATCH');
    }
    const ttlMs = Number.isSafeInteger(options && options.authTtlMs) ? options.authTtlMs : DEFAULT_AUTH_TTL_MS;
    if (ttlMs <= 0 || ttlMs > 60 * 60 * 1000) throw relayError('RELAY_INVALID_AUTH_TTL');
    const planSha256 = await sha256Json(plan, cryptoApi);
    const createdAt = now();
    const body = {
      version: AUTH_VERSION,
      relayProtocolVersion: RELAY_PROTOCOL_VERSION,
      descriptorSha256: envelope.header.descriptorSha256,
      planSha256,
      senderClinicDeviceId: envelope.descriptor.senderClinicDeviceId,
      senderSigningKeyId: envelope.descriptor.senderSigningKeyId,
      recipientKeyId: envelope.descriptor.recipientKeyId,
      totalBytes: plan.totalBytes,
      createdAt,
      expiresAt: createdAt + ttlMs
    };
    const signature = await cryptoApi.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      senderIdentity.privateKey,
      new TextEncoder().encode(canonicalJson(body))
    );
    return { body, signature: base64urlEncode(new Uint8Array(signature)) };
  }

  async function buildCreateRequest(envelope, senderIdentity, options) {
    const cryptoApi = resolveCrypto(options);
    validateEnvelope(envelope);
    const descriptorSha256 = await sha256Json(envelope.descriptor, cryptoApi);
    if (descriptorSha256 !== envelope.header.descriptorSha256) throw relayError('RELAY_DESCRIPTOR_HASH_MISMATCH');
    const plan = await buildTransportPlan(envelope, options);
    const authorization = await buildRelayAuthorization(envelope, plan, senderIdentity, options);
    return {
      request: {
        version: RELAY_PROTOCOL_VERSION,
        envelopeHeader: envelope.header,
        descriptor: envelope.descriptor,
        envelopeSignature: envelope.signature,
        plan,
        authorization: authorization.body,
        authorizationSignature: authorization.signature
      },
      parts: enumerateCipherParts(envelope)
    };
  }

  function normalizeEndpoint(value) {
    if (typeof value !== 'string' || !/^https:\/\/[^\s]+$/.test(value)) throw relayError('RELAY_INVALID_ENDPOINT');
    return value.replace(/\/+$/, '');
  }

  async function readJsonResponse(response, code) {
    if (!response || typeof response.ok !== 'boolean') throw relayError(code);
    if (!response.ok) throw relayError(code, String(response.status || 'HTTP_ERROR'));
    try {
      return await response.json();
    } catch (_) {
      throw relayError(code, 'INVALID_JSON');
    }
  }

  function validateCreateResponse(value, expectedSlots) {
    if (!isPlainObject(value) || typeof value.jobId !== 'string' ||
        (value.status !== 'uploading' && value.status !== 'ready') || !Array.isArray(value.uploads)) {
      throw relayError('RELAY_INVALID_CREATE_RESPONSE');
    }
    if (value.status === 'uploading' && typeof value.uploadCapability !== 'string') {
      throw relayError('RELAY_INVALID_CREATE_RESPONSE');
    }
    const map = new Map();
    value.uploads.forEach(item => {
      if (!isPlainObject(item) || typeof item.slot !== 'string' || typeof item.uploadUrl !== 'string' || !/^https:\/\//.test(item.uploadUrl)) {
        throw relayError('RELAY_INVALID_CREATE_RESPONSE');
      }
      if (map.has(item.slot)) throw relayError('RELAY_INVALID_CREATE_RESPONSE');
      map.set(item.slot, item.uploadUrl);
    });
    if (value.status === 'ready') {
      if (map.size !== 0) throw relayError('RELAY_INVALID_CREATE_RESPONSE');
    } else if (map.size !== expectedSlots.length || expectedSlots.some(slot => !map.has(slot))) {
      throw relayError('RELAY_INVALID_CREATE_RESPONSE');
    }
    return { jobId: value.jobId, status: value.status, uploadCapability: value.uploadCapability, uploadMap: map };
  }

  async function putCiphertext(fetchApi, url, blob, maxAttempts) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchApi(url, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes 0-${blob.size - 1}/${blob.size}`
          },
          body: blob
        });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (response && response.ok) return;
      lastError = relayError('RELAY_UPLOAD_FAILED', String(response && response.status));
      if (response && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) break;
    }
    throw lastError || relayError('RELAY_UPLOAD_FAILED');
  }

  async function uploadEnvelope(envelope, senderIdentity, options) {
    const opts = options || {};
    const endpoint = normalizeEndpoint(opts.endpoint);
    const fetchApi = opts.fetch || global.fetch;
    if (typeof fetchApi !== 'function') throw relayError('RELAY_FETCH_UNAVAILABLE');
    const maxAttempts = Number.isSafeInteger(opts.maxAttempts) ? opts.maxAttempts : DEFAULT_MAX_ATTEMPTS;
    if (maxAttempts < 1 || maxAttempts > 5) throw relayError('RELAY_INVALID_RETRY_POLICY');

    const built = await buildCreateRequest(envelope, senderIdentity, opts);
    const createResponse = await fetchApi(endpoint + '/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(built.request)
    });
    const created = validateCreateResponse(
      await readJsonResponse(createResponse, 'RELAY_CREATE_FAILED'),
      built.parts.map(part => part.slot)
    );
    if (created.status === 'ready') return { jobId: created.jobId, status: 'ready' };

    for (const part of built.parts) {
      await putCiphertext(fetchApi, created.uploadMap.get(part.slot), part.blob, maxAttempts);
    }

    const completeResponse = await fetchApi(endpoint + '/v1/jobs/' + encodeURIComponent(created.jobId) + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: RELAY_PROTOCOL_VERSION, uploadCapability: created.uploadCapability })
    });
    const completed = await readJsonResponse(completeResponse, 'RELAY_COMPLETE_FAILED');
    if (!isPlainObject(completed) || completed.jobId !== created.jobId || completed.status !== 'ready') {
      throw relayError('RELAY_INVALID_COMPLETE_RESPONSE');
    }
    return completed;
  }

  const api = {
    RELAY_PROTOCOL_VERSION,
    PLAN_VERSION,
    AUTH_VERSION,
    canonicalJson,
    validateEnvelope,
    enumerateCipherParts,
    buildTransportPlan,
    buildRelayAuthorization,
    buildCreateRequest,
    uploadEnvelope
  };

  global.MediaRelayTransport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

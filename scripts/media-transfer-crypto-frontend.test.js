const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const test = require('node:test');

const T = require('../media-transfer-package.js');
const C = require('../media-transfer-crypto.js');

const CRYPTO_OPTS = { crypto: webcrypto };

// 架空サンプルのみ。実在の患者名・医院名は使わない。
const WORK_ORDER_REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const SAMPLE_PATIENT_NAME = '山田サンプル太郎';
const SAMPLE_CLINIC_NAME = 'サンプル歯科医院';
const ATT_1 = 'att-123e4567-e89b-42d3-a456-426614174001';
const ATT_2 = 'att-223e4567-e89b-42d3-a456-426614174002';

function blobFromSize(size, seed, mime) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (seed + i) % 256;
  return new Blob([bytes], mime ? { type: mime } : undefined);
}

function sampleWorkOrder(overrides) {
  return Object.assign({
    workOrderRef: WORK_ORDER_REF,
    issueDate: '2026-10-02',
    orderTypes: ['crown'],
    patientName: SAMPLE_PATIENT_NAME,
    clinicName: SAMPLE_CLINIC_NAME
  }, overrides || {});
}

function attachment(attachmentId, kind, mime, size, fill) {
  return {
    meta: { attachmentId, kind, mime, size, name: 'ignored-sample-name.bin' },
    blob: blobFromSize(size, fill, mime)
  };
}

async function buildSamplePackage() {
  const items = [
    attachment(ATT_1, 'video', 'video/mp4', 10, 7),
    attachment(ATT_2, 'file', 'application/pdf', 4, 3)
  ];
  return T.buildPackage(WORK_ORDER_REF, sampleWorkOrder(), items, Object.assign({ chunkSize: 4 }, CRYPTO_OPTS));
}

async function fingerprintOf(jwk, prefix) {
  const normalized = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
  const bytes = new TextEncoder().encode(C.canonicalJson(normalized));
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return prefix + C.base64urlEncode(new Uint8Array(digest));
}

function clockFrom(start) {
  let now = start;
  return {
    now: () => now,
    advance: ms => { now += ms; }
  };
}

async function sha256HexOf(bytes) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function recomputeHeaderHash(descriptor) {
  return sha256HexOf(new TextEncoder().encode(C.canonicalJson(descriptor)));
}

function cloneEnvelope(env) {
  return {
    version: env.version,
    header: Object.assign({}, env.header),
    descriptor: JSON.parse(JSON.stringify(env.descriptor)),
    signature: env.signature,
    parts: {
      manifest: Object.assign({}, env.parts.manifest),
      workOrder: Object.assign({}, env.parts.workOrder),
      attachments: Object.fromEntries(Object.entries(env.parts.attachments).map(
        ([id, v]) => [id, { chunks: v.chunks.map(c => Object.assign({}, c)) }]
      ))
    }
  };
}

async function buildRegistry(now) {
  const recipient = await C.generateRecipientIdentity('sample-passphrase-01', CRYPTO_OPTS);
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipient, Object.assign({ now }, CRYPTO_OPTS));
  const response = await C.createPairingResponse(offer, sender, Object.assign({ now }, CRYPTO_OPTS));
  const registry = await C.verifyPairingResponse(offer, response, Object.assign({ now }, CRYPTO_OPTS));
  return { recipient, sender, offer, response, registry };
}

// ---------- モジュール読込 / 定数 ----------

test('module loads without DOM/network and exposes fixed algorithm constants', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(C.ALGORITHMS.senderSignature, 'ECDSA-P256-SHA256');
  assert.equal(C.ALGORITHMS.recipientKeyAgreement, 'ECDH-P256');
  assert.match(C.ALGORITHMS.contentKeyDerivation, /HKDF-SHA256/);
  assert.match(C.ALGORITHMS.contentKeyDerivation, /AES-256-GCM/);
  assert.equal(C.ALGORITHMS.aesGcmIvBytes, 12);
  assert.equal(C.ALGORITHMS.pbkdf2.hash, 'SHA-256');
  assert.equal(C.ALGORITHMS.pbkdf2.minIterations, 600000);
  assert.equal(typeof C.encryptPackage, 'function');
  assert.equal(typeof C.decryptEnvelope, 'function');
});

// ---------- 技工所（受信側）識別 ----------

test('generateRecipientIdentity returns a non-extractable private key and a valid encrypted backup', async () => {
  const identity = await C.generateRecipientIdentity('correct-passphrase-01', CRYPTO_OPTS);
  assert.equal(identity.privateKey.extractable, false);
  assert.equal(C.isKeyExtractable(identity.privateKey), false);
  assert.ok(identity.recipientKeyId.startsWith('rk_'));
  assert.equal(identity.recipientKeyId, await fingerprintOf(identity.publicJwk, 'rk_'));
  assert.equal(identity.backup.version, 'dwo-recipient-backup-v1');
  assert.equal(identity.backup.recipientKeyId, identity.recipientKeyId);
  assert.ok(identity.backup.kdf.iterations >= 600000);
  assert.equal(identity.backup.kdf.name, 'PBKDF2');
  assert.equal(identity.backup.cipher.name, 'AES-GCM');
  assert.ok(!('privateJwk' in identity.backup));
  assert.ok(!('d' in identity.backup));
});

test('restoreRecipientIdentity round-trips a valid backup', async () => {
  const identity = await C.generateRecipientIdentity('correct-passphrase-02', CRYPTO_OPTS);
  const restored = await C.restoreRecipientIdentity(identity.backup, 'correct-passphrase-02', CRYPTO_OPTS);
  assert.equal(restored.recipientKeyId, identity.recipientKeyId);
  assert.deepEqual(restored.publicJwk, identity.publicJwk);
  assert.equal(restored.privateKey.extractable, false);
});

test('restoreRecipientIdentity rejects wrong passphrase, tampered backup, weak iterations, public/private mismatch', async () => {
  const identity = await C.generateRecipientIdentity('correct-passphrase-03', CRYPTO_OPTS);

  await assert.rejects(
    () => C.restoreRecipientIdentity(identity.backup, 'wrong-passphrase', CRYPTO_OPTS),
    { code: 'CRYPTO_BACKUP_AUTH_FAILED' }
  );

  const tamperedCiphertext = Object.assign({}, identity.backup, {
    cipher: Object.assign({}, identity.backup.cipher, {
      ciphertext: C.base64urlEncode(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]))
    })
  });
  await assert.rejects(
    () => C.restoreRecipientIdentity(tamperedCiphertext, 'correct-passphrase-03', CRYPTO_OPTS),
    { code: 'CRYPTO_BACKUP_AUTH_FAILED' }
  );

  const weakBackup = Object.assign({}, identity.backup, { kdf: Object.assign({}, identity.backup.kdf, { iterations: 1000 }) });
  await assert.rejects(
    () => C.restoreRecipientIdentity(weakBackup, 'correct-passphrase-03', CRYPTO_OPTS),
    { code: 'CRYPTO_WEAK_KDF' }
  );

  // 公開鍵と秘密鍵の不整合: 別の正規バックアップのpublicJwk/recipientKeyIdへ外側だけ差し替える。
  const otherIdentity = await C.generateRecipientIdentity('other-passphrase-03', CRYPTO_OPTS);
  const mismatched = Object.assign({}, identity.backup, {
    recipientKeyId: otherIdentity.recipientKeyId,
    publicJwk: otherIdentity.publicJwk
  });
  await assert.rejects(
    () => C.restoreRecipientIdentity(mismatched, 'correct-passphrase-03', CRYPTO_OPTS),
    err => err.code === 'CRYPTO_KEY_MISMATCH' || err.code === 'CRYPTO_BACKUP_AUTH_FAILED'
  );
});

// ---------- 医院（送信側）識別 ----------

test('generateSenderIdentity returns a non-extractable private key with no private-key export and deterministic keyId with no supplied names', async () => {
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  assert.equal(sender.privateKey.extractable, false);
  assert.equal(C.isKeyExtractable(sender.privateKey), false);
  assert.equal(typeof C.exportSenderPrivateKey, 'undefined');
  assert.ok(sender.signingKeyId.startsWith('sk_'));
  assert.equal(sender.signingKeyId, await fingerprintOf(sender.publicJwk, 'sk_'));
  assert.ok(sender.clinicDeviceId.startsWith('dev_'));
  assert.ok(!sender.clinicDeviceId.toLowerCase().includes('clinic'));
  assert.ok(!sender.signingKeyId.includes(SAMPLE_CLINIC_NAME));

  const sender2 = await C.generateSenderIdentity(CRYPTO_OPTS);
  assert.notEqual(sender.signingKeyId, sender2.signingKeyId);
  assert.notEqual(sender.clinicDeviceId, sender2.clinicDeviceId);
});

// ---------- ペアリング ----------

test('pairing payload encode/decode round-trips and rejects foreign prefixes', async () => {
  const clock = clockFrom(1000);
  const recipient = await C.generateRecipientIdentity('pairing-passphrase-01', CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const text = C.encodePairingPayload(offer);
  assert.equal(typeof text, 'string');
  assert.match(text, /^DWOQR1\./);
  const decoded = C.decodePairingPayload(text);
  assert.deepEqual(decoded, offer);
  assert.throws(() => C.decodePairingPayload('NOT-A-PAYLOAD'), { code: 'CRYPTO_INVALID_PAIRING_PAYLOAD' });
});

test('verifyPairingResponse accepts a valid proof-of-possession and builds a registry', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  assert.equal(registry.version, 'dwo-sender-registry-v1');
  assert.equal(registry.status, 'active');
  assert.equal(registry.clinicDeviceId, sender.clinicDeviceId);
  assert.equal(registry.pairedRecipientKeyId, recipient.recipientKeyId);
  assert.equal(registry.activeSigningKey.signingKeyId, sender.signingKeyId);
  assert.deepEqual(registry.retiredSigningKeys, []);
});

test('verifyPairingResponse rejects an expired offer', async () => {
  const clock = clockFrom(1000);
  const recipient = await C.generateRecipientIdentity('pairing-passphrase-02', CRYPTO_OPTS);
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipient, Object.assign({ now: clock.now, expiresInMs: 1000 }, CRYPTO_OPTS));
  const response = await C.createPairingResponse(offer, sender, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  clock.advance(5000);
  await assert.rejects(
    () => C.verifyPairingResponse(offer, response, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_PAIRING_EXPIRED' }
  );
});

test('verifyPairingResponse rejects pairingId mismatch and recipientKeyId mismatch', async () => {
  const clock = clockFrom(1000);
  const recipient = await C.generateRecipientIdentity('pairing-passphrase-03', CRYPTO_OPTS);
  const otherRecipient = await C.generateRecipientIdentity('pairing-passphrase-04', CRYPTO_OPTS);
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const response = await C.createPairingResponse(offer, sender, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const wrongPairing = Object.assign({}, response, { pairingId: 'pr_not-the-real-one' });
  await assert.rejects(
    () => C.verifyPairingResponse(offer, wrongPairing, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_PAIRING_MISMATCH' }
  );

  const wrongRecipient = Object.assign({}, response, { recipientKeyId: otherRecipient.recipientKeyId });
  await assert.rejects(
    () => C.verifyPairingResponse(offer, wrongRecipient, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_RECIPIENT_MISMATCH' }
  );
});

test('verifyPairingResponse rejects a bad proof-of-possession signature', async () => {
  const clock = clockFrom(1000);
  const recipient = await C.generateRecipientIdentity('pairing-passphrase-05', CRYPTO_OPTS);
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const response = await C.createPairingResponse(offer, sender, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const tampered = Object.assign({}, response, { signature: response.signature.slice(0, -4) + 'AAAA' });
  await assert.rejects(
    () => C.verifyPairingResponse(offer, tampered, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_INVALID_SIGNATURE' }
  );
});

// ---------- 失効 / 鍵ローテーション ----------

test('revokeSender marks the registry revoked and a revoked registry fails envelope verification', async () => {
  const clock = clockFrom(1000);
  const { registry } = await buildRegistry(clock.now);
  const revoked = C.revokeSender(registry, 'lost-device', Object.assign({ now: clock.now }, CRYPTO_OPTS));
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedReason, 'lost-device');
  assert.equal(registry.status, 'active'); // 元のregistryは変更されない（copy-style）
});

test('sender key rotation succeeds and preserves clinicDeviceId; wrong old key, bad signature, revoked registry reject', async () => {
  const clock = clockFrom(1000);
  const { registry, sender } = await buildRegistry(clock.now);
  const newSender = await C.generateSenderIdentity(CRYPTO_OPTS);

  const rotation = await C.createSenderKeyRotation(registry, sender, newSender, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const rotated = await C.applySenderKeyRotation(registry, rotation, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  assert.equal(rotated.clinicDeviceId, registry.clinicDeviceId);
  assert.equal(rotated.activeSigningKey.signingKeyId, newSender.signingKeyId);
  assert.equal(rotated.retiredSigningKeys.length, 1);
  assert.equal(rotated.retiredSigningKeys[0].signingKeyId, sender.signingKeyId);

  // 間違った旧鍵（登録されていない鍵）で作ったローテーション statement は拒否される。
  const impostor = await C.generateSenderIdentity(CRYPTO_OPTS);
  const badOldRotation = await C.createSenderKeyRotation(registry, impostor, newSender, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  await assert.rejects(
    () => C.applySenderKeyRotation(registry, badOldRotation, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_SENDER_KEY_NOT_ACTIVE' }
  );

  // 署名が壊れている場合は拒否される。
  const tamperedRotation = Object.assign({}, rotation, { signature: rotation.signature.slice(0, -4) + 'AAAA' });
  await assert.rejects(
    () => C.applySenderKeyRotation(registry, tamperedRotation, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_INVALID_SIGNATURE' }
  );

  // 失効済みregistryはローテーションできない。
  const revokedRegistry = C.revokeSender(registry, 'lost', Object.assign({ now: clock.now }, CRYPTO_OPTS));
  await assert.rejects(
    () => C.applySenderKeyRotation(revokedRegistry, rotation, Object.assign({ now: clock.now }, CRYPTO_OPTS)),
    { code: 'CRYPTO_SENDER_REVOKED' }
  );
});

// ---------- 受信側鍵リング ----------

test('recipient key-ring rotation moves the previous active key to decrypt-only and rejects duplicate key IDs', async () => {
  const identityA = await C.generateRecipientIdentity('ring-passphrase-a', CRYPTO_OPTS);
  const identityB = await C.generateRecipientIdentity('ring-passphrase-b', CRYPTO_OPTS);
  const ring1 = C.createRecipientKeyRing(identityA, CRYPTO_OPTS);
  assert.equal(ring1.active.recipientKeyId, identityA.recipientKeyId);
  assert.deepEqual(ring1.decryptOnly, []);

  const ring2 = C.rotateRecipientKeyRing(ring1, identityB, CRYPTO_OPTS);
  assert.equal(ring2.active.recipientKeyId, identityB.recipientKeyId);
  assert.equal(ring2.decryptOnly.length, 1);
  assert.equal(ring2.decryptOnly[0].recipientKeyId, identityA.recipientKeyId);

  assert.throws(() => C.rotateRecipientKeyRing(ring2, identityB, CRYPTO_OPTS), { code: 'CRYPTO_DUPLICATE_KEY_ID' });
  assert.throws(() => C.rotateRecipientKeyRing(ring2, identityA, CRYPTO_OPTS), { code: 'CRYPTO_DUPLICATE_KEY_ID' });
});

test('retireDecryptOnlyRecipient fails closed unless inFlightCount===0 and never retires the active key', async () => {
  const identityA = await C.generateRecipientIdentity('ring-passphrase-c', CRYPTO_OPTS);
  const identityB = await C.generateRecipientIdentity('ring-passphrase-d', CRYPTO_OPTS);
  const ring1 = C.createRecipientKeyRing(identityA, CRYPTO_OPTS);
  const ring2 = C.rotateRecipientKeyRing(ring1, identityB, CRYPTO_OPTS);

  assert.throws(() => C.retireDecryptOnlyRecipient(ring2, identityA.recipientKeyId, {}), { code: 'CRYPTO_RETIRE_BLOCKED' });
  assert.throws(() => C.retireDecryptOnlyRecipient(ring2, identityA.recipientKeyId, { inFlightCount: 1 }), { code: 'CRYPTO_RETIRE_BLOCKED' });
  assert.throws(() => C.retireDecryptOnlyRecipient(ring2, identityB.recipientKeyId, { inFlightCount: 0 }), { code: 'CRYPTO_RETIRE_BLOCKED' });

  const ring3 = C.retireDecryptOnlyRecipient(ring2, identityA.recipientKeyId, { inFlightCount: 0 });
  assert.deepEqual(ring3.decryptOnly, []);
});

// ---------- 暗号化転送エンベロープ: ラウンドトリップ ----------

test('encrypt -> verify signature (before decrypt) -> decrypt -> Phase 3 verify round trip; descriptor has no patient/clinic names', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  const pkg = await buildSamplePackage();

  const envelope = await C.encryptPackage(pkg, sender, recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const descriptorText = JSON.stringify(envelope.descriptor);
  assert.equal(descriptorText.includes(SAMPLE_PATIENT_NAME), false);
  assert.equal(descriptorText.includes(SAMPLE_CLINIC_NAME), false);

  const verifiedDescriptor = await C.verifyEnvelopeSignature(envelope, registry, CRYPTO_OPTS);
  assert.equal(verifiedDescriptor.workOrderRef, WORK_ORDER_REF);
  assert.equal(verifiedDescriptor.recipientKeyId, recipient.recipientKeyId);

  const result = await C.decryptEnvelope(envelope, recipient, registry, CRYPTO_OPTS);
  assert.equal(result.workOrderRef, WORK_ORDER_REF);
  const verifyAgain = await T.verifyPackage(result.package, CRYPTO_OPTS);
  assert.equal(verifyAgain.ok, true);
  const decodedWorkOrder = JSON.parse(await result.package.workOrder.blob.text());
  assert.deepEqual(decodedWorkOrder, sampleWorkOrder());
});

test('decryptEnvelope selects a decrypt-only recipient key by recipientKeyId after rotation', async () => {
  const clock = clockFrom(1000);
  const recipientA = await C.generateRecipientIdentity('ring-decrypt-a', CRYPTO_OPTS);
  const recipientB = await C.generateRecipientIdentity('ring-decrypt-b', CRYPTO_OPTS);
  const sender = await C.generateSenderIdentity(CRYPTO_OPTS);
  const offer = await C.createPairingOffer(recipientA, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const response = await C.createPairingResponse(offer, sender, Object.assign({ now: clock.now }, CRYPTO_OPTS));
  const registry = await C.verifyPairingResponse(offer, response, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const pkg = await buildSamplePackage();
  const envelope = await C.encryptPackage(pkg, sender, recipientA, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const ring1 = C.createRecipientKeyRing(recipientA, CRYPTO_OPTS);
  const ring2 = C.rotateRecipientKeyRing(ring1, recipientB, CRYPTO_OPTS);

  const result = await C.decryptEnvelope(envelope, ring2, registry, CRYPTO_OPTS);
  assert.equal(result.workOrderRef, WORK_ORDER_REF);

  const ring3 = C.retireDecryptOnlyRecipient(ring2, recipientA.recipientKeyId, { inFlightCount: 0 });
  await assert.rejects(
    () => C.decryptEnvelope(envelope, ring3, registry, CRYPTO_OPTS),
    { code: 'CRYPTO_UNKNOWN_RECIPIENT_KEY' }
  );
});

// ---------- 改ざん / fail closed ----------

test('invalid Phase 3 plaintext package is rejected before encryption', async () => {
  const clock = clockFrom(1000);
  const { sender, recipient } = await buildRegistry(clock.now);
  const pkg = await buildSamplePackage();
  pkg.workOrder.blob = new Blob(['{"workOrderRef":"dwo:tampered"}'], { type: 'application/json' });
  await assert.rejects(
    () => C.encryptPackage(pkg, sender, recipient, CRYPTO_OPTS),
    err => typeof err.code === 'string' && err.code.startsWith('TRANSFER_')
  );
});

test('tampered signature, descriptor fields, and header/descriptor mismatch are rejected without decrypting', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  const pkg = await buildSamplePackage();
  const envelope = await C.encryptPackage(pkg, sender, recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const badSignature = cloneEnvelope(envelope);
  badSignature.signature = badSignature.signature.slice(0, -4) + 'AAAA';
  await assert.rejects(() => C.verifyEnvelopeSignature(badSignature, registry, CRYPTO_OPTS), { code: 'CRYPTO_INVALID_SIGNATURE' });

  // 記述子を改ざんした上でheaderのハッシュだけ再計算する（header/descriptor整合性では検出できず、
  // 署名検証でだけ検出できることを確認する）。
  const badEphemeral = cloneEnvelope(envelope);
  badEphemeral.descriptor.ephemeralPublicJwk.x = badEphemeral.descriptor.ephemeralPublicJwk.x.slice(0, -2) + 'zz';
  badEphemeral.header.descriptorSha256 = await recomputeHeaderHash(badEphemeral.descriptor);
  await assert.rejects(() => C.verifyEnvelopeSignature(badEphemeral, registry, CRYPTO_OPTS), { code: 'CRYPTO_INVALID_SIGNATURE' });

  const badSalt = cloneEnvelope(envelope);
  badSalt.descriptor.hkdfSalt = C.base64urlEncode(new Uint8Array(32));
  badSalt.header.descriptorSha256 = await recomputeHeaderHash(badSalt.descriptor);
  await assert.rejects(() => C.verifyEnvelopeSignature(badSalt, registry, CRYPTO_OPTS), { code: 'CRYPTO_INVALID_SIGNATURE' });

  const badHeader = cloneEnvelope(envelope);
  badHeader.header.descriptorSha256 = badHeader.header.descriptorSha256.replace(/^./, badHeader.header.descriptorSha256[0] === '0' ? '1' : '0');
  await assert.rejects(() => C.verifyEnvelopeSignature(badHeader, registry, CRYPTO_OPTS), { code: 'CRYPTO_HEADER_MISMATCH' });
});

test('tampered ciphertext, AAD-binding fields, and missing/extra/reordered chunks are rejected', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  const pkg = await buildSamplePackage();
  const envelope = await C.encryptPackage(pkg, sender, recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  // ciphertext改ざん: manifest part のバイトを1つ変える。
  {
    const tampered = cloneEnvelope(envelope);
    const bytes = new Uint8Array(await envelope.parts.manifest.ciphertext.arrayBuffer());
    bytes[0] ^= 0xff;
    tampered.parts.manifest.ciphertext = new Blob([bytes]);
    await assert.rejects(() => C.decryptEnvelope(tampered, recipient, registry, CRYPTO_OPTS), { code: 'CRYPTO_DECRYPT_FAILED' });
  }

  // 欠落チャンク
  {
    const tampered = cloneEnvelope(envelope);
    tampered.parts.attachments[ATT_1].chunks.pop();
    await assert.rejects(() => C.decryptEnvelope(tampered, recipient, registry, CRYPTO_OPTS), { code: 'CRYPTO_PART_MISMATCH' });
  }

  // 余分チャンク（既存indexと重複させて追加）
  {
    const tampered = cloneEnvelope(envelope);
    const extra = Object.assign({}, tampered.parts.attachments[ATT_1].chunks[0]);
    tampered.parts.attachments[ATT_1].chunks.push(extra);
    await assert.rejects(() => C.decryptEnvelope(tampered, recipient, registry, CRYPTO_OPTS), { code: 'CRYPTO_PART_MISMATCH' });
  }

  // 入替: 2つのチャンクのiv/ciphertextだけを交換し、index欄はそのままにする -> AAD不一致でdecryptが失敗する。
  {
    const tampered = cloneEnvelope(envelope);
    const chunks = tampered.parts.attachments[ATT_1].chunks;
    assert.ok(chunks.length >= 2);
    const ivA = chunks[0].iv; const ctA = chunks[0].ciphertext;
    chunks[0].iv = chunks[1].iv; chunks[0].ciphertext = chunks[1].ciphertext;
    chunks[1].iv = ivA; chunks[1].ciphertext = ctA;
    await assert.rejects(() => C.decryptEnvelope(tampered, recipient, registry, CRYPTO_OPTS), { code: 'CRYPTO_DECRYPT_FAILED' });
  }
});

test('duplicate IVs across parts are rejected even before decrypting', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  const pkg = await buildSamplePackage();
  const envelope = await C.encryptPackage(pkg, sender, recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  const tampered = cloneEnvelope(envelope);
  tampered.parts.workOrder.iv = tampered.parts.manifest.iv;
  await assert.rejects(() => C.verifyEnvelopeSignature(tampered, registry, CRYPTO_OPTS), { code: 'CRYPTO_DUPLICATE_IV' });
  await assert.rejects(() => C.decryptEnvelope(tampered, recipient, registry, CRYPTO_OPTS), { code: 'CRYPTO_DUPLICATE_IV' });
});

test('wrong recipient key, unknown sender, and revoked sender are rejected', async () => {
  const clock = clockFrom(1000);
  const { registry, sender, recipient } = await buildRegistry(clock.now);
  const otherRecipient = await C.generateRecipientIdentity('wrong-recipient-01', CRYPTO_OPTS);
  const pkg = await buildSamplePackage();
  const envelope = await C.encryptPackage(pkg, sender, recipient, Object.assign({ now: clock.now }, CRYPTO_OPTS));

  await assert.rejects(
    () => C.decryptEnvelope(envelope, otherRecipient, registry, CRYPTO_OPTS),
    { code: 'CRYPTO_UNKNOWN_RECIPIENT_KEY' }
  );

  await assert.rejects(
    () => C.verifyEnvelopeSignature(envelope, null, CRYPTO_OPTS),
    { code: 'CRYPTO_SENDER_UNKNOWN' }
  );

  const revoked = C.revokeSender(registry, 'lost-device', Object.assign({ now: clock.now }, CRYPTO_OPTS));
  await assert.rejects(
    () => C.verifyEnvelopeSignature(envelope, revoked, CRYPTO_OPTS),
    { code: 'CRYPTO_SENDER_REVOKED' }
  );
});

// ---------- ソース監査 ----------

test('source audit: no network/persistence APIs appear in media-transfer-crypto.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'media-transfer-crypto.js'), 'utf8');
  const forbidden = [
    /fetch\s*\(/i,
    /XMLHttpRequest/i,
    /WebSocket/i,
    /EventSource/i,
    /firebase/i,
    /firestore/i,
    /localStorage/i,
    /sessionStorage/i,
    /indexedDB/i,
    /caches\.open/i,
    /navigator\.serviceWorker/i
  ];
  forbidden.forEach(re => {
    assert.equal(re.test(source), false, 'forbidden pattern found: ' + re);
  });
});

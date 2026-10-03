const assert = require('node:assert/strict');
const test = require('node:test');
const { webcrypto } = require('node:crypto');

const T = require('../media-transfer-package.js');
const C = require('../media-transfer-crypto.js');
const B = require('../media-receiver-bootstrap.js');

const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const ATT = 'att-123e4567-e89b-42d3-a456-426614174001';
const PATIENT = '架空患者Bootstrap';
const CLINIC = '架空医院Bootstrap';

async function fixture() {
  const recipient = await C.generateRecipientIdentity('bootstrap-test-passphrase', { crypto: webcrypto });
  const sender = await C.generateSenderIdentity({ crypto: webcrypto });
  const pkg = await T.buildPackage(
    REF,
    { workOrderRef: REF, patientName: PATIENT, clinicName: CLINIC },
    [{
      meta: { attachmentId: ATT, kind: 'image', mime: 'image/jpeg', size: 6, name: 'secret-name.jpg' },
      blob: new Blob([Uint8Array.from([1,2,3,4,5,6])], { type: 'image/jpeg' })
    }],
    { crypto: webcrypto, chunkSize: 3 }
  );
  const envelope = await C.encryptPackage(pkg, sender, recipient, { crypto: webcrypto });
  return { recipient, sender, envelope };
}

test('receiver bootstrap header is routing-only and plaintext metadata round-trips only with recipient key', async () => {
  const { recipient, envelope } = await fixture();
  const bootstrap = await B.createReceiverBootstrap(envelope, recipient, { crypto: webcrypto });
  const visible = JSON.stringify(bootstrap.header);
  for (const secret of [REF, ATT, PATIENT, CLINIC, 'secret-name.jpg']) {
    assert.equal(visible.includes(secret), false);
  }
  assert.equal(bootstrap.header.recipientKeyId, recipient.recipientKeyId);
  assert.equal(bootstrap.ciphertext.size, bootstrap.header.ciphertextSize);

  const plaintext = await B.decryptReceiverBootstrap(bootstrap.header, bootstrap.ciphertext, recipient, { crypto: webcrypto });
  assert.deepEqual(plaintext.envelopeHeader, envelope.header);
  assert.deepEqual(plaintext.descriptor, envelope.descriptor);
  assert.equal(plaintext.signature, envelope.signature);
  assert.equal(plaintext.partMetadata.manifest.iv, envelope.parts.manifest.iv);
  assert.equal(plaintext.partMetadata.workOrder.iv, envelope.parts.workOrder.iv);
  assert.equal(plaintext.partMetadata.attachments[ATT].chunks.length, 2);
  assert.equal(plaintext.partMetadata.attachments[ATT].chunks[1].iv, envelope.parts.attachments[ATT].chunks[1].iv);
});

test('bootstrap rejects ciphertext tamper, header tamper and wrong recipient key', async () => {
  const { recipient, envelope } = await fixture();
  const bootstrap = await B.createReceiverBootstrap(envelope, recipient, { crypto: webcrypto });
  const bytes = new Uint8Array(await bootstrap.ciphertext.arrayBuffer());
  bytes[0] ^= 1;
  await assert.rejects(
    () => B.decryptReceiverBootstrap(bootstrap.header, new Blob([bytes]), recipient, { crypto: webcrypto }),
    { code: 'RECEIVER_BOOTSTRAP_HASH_MISMATCH' }
  );

  const tamperedHeader = { ...bootstrap.header, iv: bootstrap.header.iv.slice(0, -1) + (bootstrap.header.iv.endsWith('A') ? 'B' : 'A') };
  await assert.rejects(
    () => B.decryptReceiverBootstrap(tamperedHeader, bootstrap.ciphertext, recipient, { crypto: webcrypto }),
    error => ['RECEIVER_BOOTSTRAP_AUTH_FAILED', 'RECEIVER_INVALID_BOOTSTRAP'].includes(error.code)
  );

  const other = await C.generateRecipientIdentity('other-bootstrap-passphrase', { crypto: webcrypto });
  await assert.rejects(
    () => B.decryptReceiverBootstrap(bootstrap.header, bootstrap.ciphertext, other, { crypto: webcrypto }),
    { code: 'RECEIVER_UNKNOWN_RECIPIENT_KEY' }
  );
});

test('bootstrap supports decrypt-only key ring entry after recipient rotation', async () => {
  const { recipient, envelope } = await fixture();
  const bootstrap = await B.createReceiverBootstrap(envelope, recipient, { crypto: webcrypto });
  const newer = await C.generateRecipientIdentity('newer-bootstrap-passphrase', { crypto: webcrypto });
  let ring = C.createRecipientKeyRing(recipient);
  ring = C.rotateRecipientKeyRing(ring, newer);
  const plaintext = await B.decryptReceiverBootstrap(bootstrap.header, bootstrap.ciphertext, ring, { crypto: webcrypto });
  assert.equal(plaintext.descriptor.recipientKeyId, recipient.recipientKeyId);
});

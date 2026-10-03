const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { webcrypto } = require('node:crypto');

const T = require('../media-transfer-package.js');
const C = require('../media-transfer-crypto.js');
const R = require('../media-relay.js');

const OPTS = { crypto: webcrypto };
const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const PATIENT = '架空患者カナリア';
const CLINIC = '架空医院カナリア';
const ATT = 'att-123e4567-e89b-42d3-a456-426614174001';

function bytesBlob(values, type) {
  return new Blob([Uint8Array.from(values)], { type: type || 'application/octet-stream' });
}

async function fixture() {
  const recipient = await C.generateRecipientIdentity('phase5-test-passphrase', OPTS);
  const sender = await C.generateSenderIdentity(OPTS);
  const workOrder = {
    workOrderRef: REF,
    patientName: PATIENT,
    clinicName: CLINIC,
    issueDate: '2026-10-03',
    orderTypes: ['synthetic']
  };
  const attachments = [{
    meta: {
      attachmentId: ATT,
      kind: 'video',
      mime: 'video/mp4',
      size: 10,
      name: 'patient-file-name.mp4'
    },
    blob: bytesBlob([1,2,3,4,5,6,7,8,9,10], 'video/mp4')
  }];
  const pkg = await T.buildPackage(REF, workOrder, attachments, { crypto: webcrypto, chunkSize: 4 });
  const envelope = await C.encryptPackage(pkg, sender, recipient, OPTS);
  return { recipient, sender, envelope };
}

async function blobHash(blob) {
  const digest = await webcrypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Buffer.from(digest).toString('hex');
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

test('buildCreateRequest contains only encrypted transport metadata and covers every ciphertext part', async () => {
  const { sender, envelope } = await fixture();
  const built = await R.buildCreateRequest(envelope, sender, {
    crypto: webcrypto,
    now: () => 1000
  });
  const text = JSON.stringify(built.request);
  assert.equal(text.includes(PATIENT), false);
  assert.equal(text.includes(CLINIC), false);
  assert.equal(text.includes('patient-file-name.mp4'), false);

  const parts = R.enumerateCipherParts(envelope);
  assert.equal(built.parts.length, parts.length);
  assert.equal(built.request.plan.entries.length, parts.length);
  assert.deepEqual(
    built.request.plan.entries.map(x => x.slot),
    parts.map(x => x.slot)
  );
  for (let i = 0; i < parts.length; i += 1) {
    assert.equal(built.request.plan.entries[i].ciphertextSha256, await blobHash(parts[i].blob));
    assert.equal(built.request.plan.entries[i].size, parts[i].blob.size);
  }
});

test('uploadEnvelope uploads ciphertext only, retries a transient PUT, then completes', async () => {
  const { sender, envelope } = await fixture();
  const expected = new Map();
  for (const part of R.enumerateCipherParts(envelope)) expected.set(part.slot, await blobHash(part.blob));

  const calls = [];
  const attempts = new Map();
  let createBody;
  const fakeFetch = async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers });
    if (url === 'https://relay.test/v1/jobs') {
      createBody = JSON.parse(options.body);
      return jsonResponse({
        jobId: 'job_test',
        status: 'uploading',
        uploadCapability: 'capability_test',
        uploads: createBody.plan.entries.map((entry, index) => ({
          slot: entry.slot,
          uploadUrl: 'https://storage.test/upload/' + index
        }))
      });
    }
    if (url.startsWith('https://storage.test/upload/')) {
      const index = Number(url.split('/').pop());
      const slot = createBody.plan.entries[index].slot;
      const count = (attempts.get(slot) || 0) + 1;
      attempts.set(slot, count);
      if (slot === 'work-order' && count === 1) return jsonResponse({}, 503);
      assert.ok(options.body instanceof Blob);
      assert.equal(await blobHash(options.body), expected.get(slot));
      assert.equal(options.headers['Content-Type'], 'application/octet-stream');
      assert.equal(options.headers['Content-Range'], `bytes 0-${options.body.size - 1}/${options.body.size}`);
      return jsonResponse({});
    }
    if (url === 'https://relay.test/v1/jobs/job_test/complete') {
      const body = JSON.parse(options.body);
      assert.equal(body.uploadCapability, 'capability_test');
      return jsonResponse({ jobId: 'job_test', status: 'ready' });
    }
    throw new Error('unexpected URL: ' + url);
  };

  const result = await R.uploadEnvelope(envelope, sender, {
    endpoint: 'https://relay.test',
    fetch: fakeFetch,
    crypto: webcrypto,
    now: () => 1000,
    maxAttempts: 3
  });
  assert.deepEqual(result, { jobId: 'job_test', status: 'ready' });
  assert.equal(attempts.get('work-order'), 2);
  assert.equal(JSON.stringify(createBody).includes(PATIENT), false);
  assert.equal(JSON.stringify(createBody).includes(CLINIC), false);
  assert.equal(calls.some(call => call.url.includes(REF) || call.url.includes(ATT)), false);
});

test('uploadEnvelope fails closed on invalid endpoint, incomplete create response and permanent PUT failure', async () => {
  const { sender, envelope } = await fixture();
  await assert.rejects(
    () => R.uploadEnvelope(envelope, sender, { endpoint: 'http://relay.test', fetch: async () => jsonResponse({}), crypto: webcrypto }),
    { code: 'RELAY_INVALID_ENDPOINT' }
  );

  await assert.rejects(
    () => R.uploadEnvelope(envelope, sender, {
      endpoint: 'https://relay.test',
      crypto: webcrypto,
      fetch: async () => jsonResponse({ jobId: 'job_x', uploadCapability: 'cap', uploads: [] })
    }),
    { code: 'RELAY_INVALID_CREATE_RESPONSE' }
  );

  let putCalls = 0;
  await assert.rejects(
    () => R.uploadEnvelope(envelope, sender, {
      endpoint: 'https://relay.test',
      crypto: webcrypto,
      maxAttempts: 2,
      fetch: async (url, options) => {
        if (url.endsWith('/v1/jobs')) {
          const req = JSON.parse(options.body);
          return jsonResponse({
            jobId: 'job_x',
            status: 'uploading',
            uploadCapability: 'cap',
            uploads: req.plan.entries.map((entry, i) => ({ slot: entry.slot, uploadUrl: 'https://storage.test/' + i }))
          });
        }
        if (url.startsWith('https://storage.test/')) {
          putCalls += 1;
          return jsonResponse({}, 403);
        }
        return jsonResponse({ jobId: 'job_x', status: 'ready' });
      }
    }),
    { code: 'RELAY_UPLOAD_FAILED' }
  );
  assert.equal(putCalls, 1);
});

test('already-ready create response is idempotent and performs no PUT or completion POST', async () => {
  const { sender, envelope } = await fixture();
  const calls = [];
  const result = await R.uploadEnvelope(envelope, sender, {
    endpoint: 'https://relay.test',
    crypto: webcrypto,
    fetch: async (url) => {
      calls.push(url);
      if (url === 'https://relay.test/v1/jobs') {
        return jsonResponse({
          jobId: 'job_ready',
          status: 'ready',
          uploads: []
        });
      }
      throw new Error('unexpected retry network call: ' + url);
    }
  });
  assert.deepEqual(result, { jobId: 'job_ready', status: 'ready' });
  assert.deepEqual(calls, ['https://relay.test/v1/jobs']);
});

test('tampered descriptor and sender mismatch are rejected before network', async () => {
  const { sender, envelope } = await fixture();
  const tampered = {
    ...envelope,
    descriptor: { ...envelope.descriptor, recipientKeyId: envelope.descriptor.recipientKeyId + 'x' }
  };
  await assert.rejects(
    () => R.buildCreateRequest(tampered, sender, OPTS),
    { code: 'RELAY_DESCRIPTOR_HASH_MISMATCH' }
  );

  const wrongSender = { ...sender, signingKeyId: sender.signingKeyId + 'x' };
  await assert.rejects(
    () => R.buildCreateRequest(envelope, wrongSender, OPTS),
    { code: 'RELAY_SENDER_MISMATCH' }
  );
});

test('index load order and media helper are wired without automatic sending', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const media = fs.readFileSync(path.join(__dirname, '..', 'media.js'), 'utf8');
  const cryptoIndex = index.indexOf('<script src="media-transfer-crypto.js"></script>');
  const relayIndex = index.indexOf('<script src="media-relay.js"></script>');
  const mediaIndex = index.indexOf('<script src="media.js"></script>');
  assert.ok(cryptoIndex >= 0 && cryptoIndex < relayIndex && relayIndex < mediaIndex);
  assert.match(media, /helpers\.uploadEncryptedTransferEnvelope\s*=/);
  assert.match(media, /relayApi\.uploadEnvelope\(envelope, senderIdentity, opts\.relayOptions\)/);
  assert.equal(index.includes('DWO_RELAY_ENDPOINT'), false);
});

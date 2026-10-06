// Synthetic-only comparison of bearer vs HMAC upload anti-abuse credentials.
// No external network, no Drive writes, no patient/clinic data.
// Reuses the dependency-free headless Chrome/CDP pattern already present in this repo.
import { spawn } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = path.join(root, 'tools', 'drive-relay-credential-probe.html');
const CHROME_CANDIDATES = [
  process.argv[2],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);

function fail(message) {
  console.log('DRIVE_RELAY_CREDENTIAL_PROBE=UNKNOWN');
  console.log('reason=' + message);
  process.exit(2);
}

function b64urlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalRequest(fields) {
  const keys = [
    'version', 'action', 'senderClinicDeviceId', 'jobId',
    'objectSlot', 'ciphertextSha256', 'byteLength', 'timestamp', 'nonce'
  ];
  return keys.map(key => key + '=' + String(fields[key])).join('\n');
}

function constantEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a || '') || !/^[0-9a-f]{64}$/.test(b || '')) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function makeServer(nowMs) {
  const bearerRegistry = new Map();
  const hmacRegistry = new Map();
  const bearerNonces = new Set();
  const hmacNonces = new Set();
  const maxSkewMs = 5 * 60 * 1000;

  function commonGate(body, nonceSet) {
    if (!body || body.version !== 'dwo-drive-auth-probe-v1') return 'VERSION';
    if (!/^dev_[A-Za-z0-9_-]{8,80}$/.test(body.senderClinicDeviceId || '')) return 'DEVICE';
    if (!/^job_[A-Za-z0-9_-]{8,80}$/.test(body.jobId || '')) return 'JOB';
    if (!/^slot_[A-Za-z0-9_-]{4,80}$/.test(body.objectSlot || '')) return 'SLOT';
    if (!/^[0-9a-f]{64}$/.test(body.ciphertextSha256 || '')) return 'HASH';
    if (!Number.isSafeInteger(body.byteLength) || body.byteLength < 1 || body.byteLength > 5 * 1024 * 1024) return 'SIZE';
    if (!Number.isSafeInteger(body.timestamp) || Math.abs(nowMs - body.timestamp) > maxSkewMs) return 'STALE';
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(body.nonce || '')) return 'NONCE';
    const replayKey = body.senderClinicDeviceId + ':' + body.nonce;
    if (nonceSet.has(replayKey)) return 'REPLAY';
    return null;
  }

  function acceptNonce(body, nonceSet) {
    nonceSet.add(body.senderClinicDeviceId + ':' + body.nonce);
  }

  return {
    registerBearer(deviceId, token) {
      bearerRegistry.set(deviceId, { status: 'active', verifier: sha256Hex(token) });
    },
    revokeBearer(deviceId) {
      const entry = bearerRegistry.get(deviceId);
      if (entry) entry.status = 'revoked';
    },
    registerHmac(deviceId, rawSecret) {
      hmacRegistry.set(deviceId, { status: 'active', secret: Buffer.from(rawSecret) });
    },
    revokeHmac(deviceId) {
      const entry = hmacRegistry.get(deviceId);
      if (entry) entry.status = 'revoked';
    },
    verifyBearer(body, token) {
      const common = commonGate(body, bearerNonces);
      if (common) return { ok: false, error: common };
      const entry = bearerRegistry.get(body.senderClinicDeviceId);
      if (!entry || entry.status !== 'active') return { ok: false, error: 'UNKNOWN_OR_REVOKED' };
      const actual = sha256Hex(token || '');
      if (!constantEqualHex(actual, entry.verifier)) return { ok: false, error: 'AUTH' };
      acceptNonce(body, bearerNonces);
      return { ok: true };
    },
    verifyHmac(body, signature) {
      const common = commonGate(body, hmacNonces);
      if (common) return { ok: false, error: common };
      const entry = hmacRegistry.get(body.senderClinicDeviceId);
      if (!entry || entry.status !== 'active') return { ok: false, error: 'UNKNOWN_OR_REVOKED' };
      const expected = createHmac('sha256', entry.secret).update(canonicalRequest(body)).digest();
      const actual = b64urlDecode(signature || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, error: 'AUTH' };
      acceptNonce(body, hmacNonces);
      return { ok: true };
    },
    snapshot(deviceId) {
      const b = bearerRegistry.get(deviceId);
      const h = hmacRegistry.get(deviceId);
      return {
        bearerServerStoresOnlyVerifier: !!(b && /^[0-9a-f]{64}$/.test(b.verifier) && !('token' in b)),
        hmacServerStoresRawVerificationSecret: !!(h && Buffer.isBuffer(h.secret) && h.secret.length === 32)
      };
    }
  };
}

const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chromePath) fail('chrome-not-found');
if (!fs.existsSync(pagePath)) fail('probe-page-missing');
if (typeof WebSocket === 'undefined') fail('websocket-unavailable');

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname !== '/probe.html') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(pagePath).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/probe.html';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dwo-drive-auth-probe-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--user-data-dir=' + profile,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  'about:blank'
], { stdio: 'ignore' });

async function cleanup() {
  try { chrome.kill(); } catch (_) {}
  server.close();
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}

async function run() {
  let port = null;
  for (let i = 0; i < 100 && !port; i += 1) {
    await new Promise(r => setTimeout(r, 100));
    try {
      port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    } catch (_) {}
  }
  if (!port) throw new Error('devtools-port-unavailable');

  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('page-target-unavailable');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('ws-failed'));
  });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params) => new Promise(resolve => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.result.exceptionDetails) {
      throw new Error('page-error: ' + JSON.stringify(result.result.exceptionDetails.exception && result.result.exceptionDetails.exception.description));
    }
    return result.result.result.value;
  };
  const load = async () => {
    await send('Page.enable');
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i += 1) {
      await new Promise(r => setTimeout(r, 100));
      if (await evaluate('document.readyState === "complete" && !!window.DwoRelayCredentialProbe')) return;
    }
    throw new Error('page-load-timeout');
  };

  const checks = [];
  const check = (label, ok, detail = undefined) => {
    checks.push({ label, ok: !!ok, detail });
    console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)));
  };

  await load();
  const provisioned = await evaluate('DwoRelayCredentialProbe.provision()');
  check('HMAC key is non-extractable at provision', provisioned.hmacExtractableAtProvision === false);
  check('ECDSA private key is non-extractable at provision', provisioned.ecdsaPrivateExtractableAtProvision === false);

  // Reload proves structured-clone persistence rather than relying on the original JS object references.
  await load();

  const now = Date.now();
  const base = {
    version: 'dwo-drive-auth-probe-v1',
    action: 'put',
    senderClinicDeviceId: 'dev_synthetic_001',
    jobId: 'job_synthetic_001',
    objectSlot: 'slot_manifest',
    ciphertextSha256: 'a'.repeat(64),
    byteLength: 65536,
    timestamp: now,
    nonce: 'nonce_synthetic_000000000001'
  };
  const canonical = canonicalRequest(base);
  const restored = await evaluate('DwoRelayCredentialProbe.signAfterRestore(' + JSON.stringify(canonical) + ')');

  check('HMAC CryptoKey restored after reload remains non-extractable', restored.hmacExtractableAfterRestore === false);
  check('ECDSA private CryptoKey restored after reload remains non-extractable', restored.ecdsaPrivateExtractableAfterRestore === false);
  check('HMAC raw export is blocked after restore', restored.hmacExportBlocked === true);
  check('ECDSA private export is blocked after restore', restored.ecdsaExportBlocked === true);
  check('restored HMAC key can still sign', restored.restoredHmacUsages.includes('sign'));
  check('restored ECDSA private key can still sign', restored.restoredEcdsaUsages.includes('sign'));
  check('bearer token persists as readable browser data', restored.bearerToken === provisioned.bearerToken);

  // Verify the existing ECDSA key still works after IndexedDB restore.
  const publicKey = await webcrypto.subtle.importKey(
    'jwk',
    provisioned.ecdsaPublicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const ecdsaOk = await webcrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    b64urlDecode(restored.ecdsaSignature),
    new TextEncoder().encode(canonical)
  );
  check('restored ECDSA signature verifies outside browser', ecdsaOk === true);

  const authServer = makeServer(now);
  const hmacSecret = b64urlDecode(provisioned.hmacServerSecret);
  authServer.registerBearer(base.senderClinicDeviceId, provisioned.bearerToken);
  authServer.registerHmac(base.senderClinicDeviceId, hmacSecret);

  const storage = authServer.snapshot(base.senderClinicDeviceId);
  check('bearer server stores hash-only verifier', storage.bearerServerStoresOnlyVerifier === true);
  check('HMAC server must retain raw verification secret', storage.hmacServerStoresRawVerificationSecret === true);

  check('bearer valid request accepted', authServer.verifyBearer(base, provisioned.bearerToken).ok === true);
  check('HMAC valid request accepted', authServer.verifyHmac(base, restored.hmacSignature).ok === true);

  check('bearer replay nonce rejected', authServer.verifyBearer(base, provisioned.bearerToken).error === 'REPLAY');
  check('HMAC replay nonce rejected', authServer.verifyHmac(base, restored.hmacSignature).error === 'REPLAY');

  const retry = { ...base, nonce: 'nonce_synthetic_000000000002' };
  const retryCanonical = canonicalRequest(retry);
  const retrySigned = await evaluate('DwoRelayCredentialProbe.signAfterRestore(' + JSON.stringify(retryCanonical) + ')');
  check('bearer identical-object retry with fresh nonce accepted', authServer.verifyBearer(retry, provisioned.bearerToken).ok === true);
  check('HMAC identical-object retry with fresh nonce accepted', authServer.verifyHmac(retry, retrySigned.hmacSignature).ok === true);

  const stale = { ...base, timestamp: now - 10 * 60 * 1000, nonce: 'nonce_synthetic_000000000003' };
  const staleCanonical = canonicalRequest(stale);
  const staleSigned = await evaluate('DwoRelayCredentialProbe.signAfterRestore(' + JSON.stringify(staleCanonical) + ')');
  check('bearer stale request rejected', authServer.verifyBearer(stale, provisioned.bearerToken).error === 'STALE');
  check('HMAC stale request rejected', authServer.verifyHmac(stale, staleSigned.hmacSignature).error === 'STALE');

  const wrongBearer = { ...base, nonce: 'nonce_synthetic_000000000004' };
  check('wrong bearer rejected', authServer.verifyBearer(wrongBearer, 'wrong-token').error === 'AUTH');

  const wrongHmac = { ...base, nonce: 'nonce_synthetic_000000000005' };
  check('wrong HMAC rejected', authServer.verifyHmac(wrongHmac, 'AAAA').error === 'AUTH');

  authServer.revokeBearer(base.senderClinicDeviceId);
  authServer.revokeHmac(base.senderClinicDeviceId);
  const revoked = { ...base, nonce: 'nonce_synthetic_000000000006' };
  const revokedCanonical = canonicalRequest(revoked);
  const revokedSigned = await evaluate('DwoRelayCredentialProbe.signAfterRestore(' + JSON.stringify(revokedCanonical) + ')');
  check('revoked bearer rejected', authServer.verifyBearer(revoked, provisioned.bearerToken).error === 'UNKNOWN_OR_REVOKED');
  check('revoked HMAC rejected', authServer.verifyHmac(revoked, revokedSigned.hmacSignature).error === 'UNKNOWN_OR_REVOKED');

  // Security interpretation from measured properties, not preference:
  // both enforce the same request gate; HMAC reduces raw client export but still remains usable
  // by same-origin code, while requiring the server to retain a raw shared secret.
  const allPassed = checks.every(item => item.ok);
  const recommendation = allPassed ? 'BEARER_PROVISIONAL' : 'NO_SELECTION';
  console.log('DRIVE_RELAY_CREDENTIAL_PROBE=' + (allPassed ? 'PASS' : 'FAIL'));
  console.log('RECOMMENDATION=' + recommendation);
  console.log('reason=' + (allPassed
    ? 'Both gates passed equivalent replay/stale/revocation checks; bearer is simpler and hash-only server-side, while HMAC is non-extractable client-side but requires a raw server secret and remains usable by same-origin code.'
    : 'One or more synthetic checks failed.'));
  if (!allPassed) process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  console.log('DRIVE_RELAY_CREDENTIAL_PROBE=UNKNOWN');
  process.exitCode = 2;
} finally {
  await cleanup();
}

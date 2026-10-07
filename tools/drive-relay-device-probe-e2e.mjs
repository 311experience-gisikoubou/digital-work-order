// Local synthetic E2E for drive-relay-device-probe.html.
// No external network, no Drive, no protected data.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.argv[2],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find(p => fs.existsSync(p));
if (!chromePath) {
  console.log('DRIVE_RELAY_DEVICE_PROBE_E2E=UNKNOWN');
  console.log('reason=chrome-not-found');
  process.exit(2);
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'drive-relay-device-probe.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/drive-relay-device-probe.html';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dwo-device-probe-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', 'about:blank'
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
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (_) {}
  }
  if (!port) throw new Error('devtools-port-unavailable');

  const targets = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws-failed')); });

  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const out = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (out.result.exceptionDetails) throw new Error('page-error:' + JSON.stringify(out.result.exceptionDetails));
    return out.result.result.value;
  };
  const load = async () => {
    await send('Page.enable');
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i += 1) {
      await new Promise(r => setTimeout(r, 100));
      if (await evaluate('document.readyState === "complete" && !!window.DwoDriveDeviceProbe')) return;
    }
    throw new Error('page-load-timeout');
  };

  const checks = [];
  const check = (label, ok) => {
    checks.push({ label, ok: !!ok });
    console.log((ok ? 'PASS ' : 'FAIL ') + label);
  };

  await load();
  const initial = await evaluate('DwoDriveDeviceProbe.verify()');
  check('missing credential state fails closed', initial.result === 'FAIL_CLOSED' && initial.code === 'PAIRING_STATE_MISSING');

  const initialized = await evaluate('DwoDriveDeviceProbe.initialize()');
  check('synthetic credentials initialize', initialized.result === 'PASS');
  check('initial ECDSA private key is non-extractable', initialized.checks.ecdsaPrivateNonExtractable === true);
  check('initial ECDSA private export is blocked', initialized.checks.ecdsaPrivateExportBlocked === true);
  check('initial ECDSA signature verifies', initialized.checks.ecdsaSignatureVerified === true);
  check('initial bearer digest is stable', initialized.checks.bearerDigestStable === true);

  // Full document reload with the same browser profile proves IndexedDB persistence rather than object reuse.
  await load();
  const restored = await evaluate('DwoDriveDeviceProbe.verify()');
  check('credentials restore after full page reload', restored.result === 'PASS');
  check('restored ECDSA private key remains non-extractable', restored.checks.ecdsaPrivateNonExtractable === true);
  check('restored ECDSA private export remains blocked', restored.checks.ecdsaPrivateExportBlocked === true);
  check('restored ECDSA private key can sign and verify', restored.checks.ecdsaSignatureVerified === true);
  check('restored bearer is present', restored.checks.bearerRestored === true);
  check('restored bearer digest remains stable', restored.checks.bearerDigestStable === true);
  check('page is a secure context on localhost', restored.checks.secureContext === true);

  const cleared = await evaluate('DwoDriveDeviceProbe.clear()');
  check('synthetic state can be explicitly cleared', cleared.result === 'CLEARED');
  const afterClear = await evaluate('DwoDriveDeviceProbe.verify()');
  check('cleared state fails closed instead of silently rotating', afterClear.result === 'FAIL_CLOSED' && afterClear.code === 'PAIRING_STATE_MISSING');

  const allPassed = checks.every(c => c.ok);
  console.log('DRIVE_RELAY_DEVICE_PROBE_E2E=' + (allPassed ? 'PASS' : 'FAIL'));
  console.log('CHECK_COUNT=' + checks.length);
  if (!allPassed) process.exitCode = 1;
}

try {
  await run();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  console.log('DRIVE_RELAY_DEVICE_PROBE_E2E=UNKNOWN');
  process.exitCode = 2;
} finally {
  await cleanup();
}

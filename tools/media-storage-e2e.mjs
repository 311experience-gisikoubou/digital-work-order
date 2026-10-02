// headless Chrome で OPFS + IndexedDB のメディア永続化を確認する（依存なし・外部通信なし）。
// 使い方: node tools/media-storage-e2e.mjs [chrome-path]
// 架空データのみ。localhost（127.0.0.1）のstatic serverとheadless Chromeだけを使う。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME_CANDIDATES = [
  process.argv[2],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function fail(message) { console.log('MEDIA_STORAGE_E2E=UNKNOWN'); console.log('reason=' + message); process.exit(2); }

const chromePath = CHROME_CANDIDATES.find(p => fs.existsSync(p));
if (!chromePath) fail('chrome-not-found');
if (typeof WebSocket === 'undefined') fail('websocket-unavailable');

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/index.html';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dwo-e2e-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', 'about:blank'
], { stdio: 'ignore' });

async function cleanup() {
  try { chrome.kill(); } catch (_) { /* 終了済み */ }
  server.close();
  await new Promise(r => setTimeout(r, 500));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* 使用中でも無視 */ }
}

async function main() {
  let port = null;
  for (let i = 0; i < 100 && !port; i += 1) {
    await new Promise(r => setTimeout(r, 100));
    try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch (_) { /* 起動待ち */ }
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
  const send = (method, params) => new Promise(resolve => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error('page-error: ' + JSON.stringify(res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description));
    return res.result.result.value;
  };
  const load = async () => {
    await send('Page.enable');
    await send('Page.navigate', { url });
    for (let i = 0; i < 100; i += 1) {
      await new Promise(r => setTimeout(r, 100));
      if (await evaluate('document.readyState === "complete" && !!window.ReferenceMediaStorage && !!document.getElementById("media-list")')) return;
    }
    throw new Error('page-load-timeout');
  };
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 100; i += 1) {
      if (await evaluate(expression)) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('timeout: ' + label);
  };
  const names = 'Array.from(document.querySelectorAll("#media-list .media-name")).map(e => e.textContent)';
  const inspect = `(async () => {
    const dbs = await new Promise((res, rej) => { const r = indexedDB.open('dwo_media_v1'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = store => new Promise(res => { const r = dbs.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
    const attachments = await all('attachments');
    const settings = await all('settings');
    dbs.close();
    const root = await navigator.storage.getDirectory();
    const files = [];
    try { const blobs = await (await root.getDirectoryHandle('dwo-media-v1')).getDirectoryHandle('blobs'); for await (const [name] of blobs.entries()) files.push(name); } catch (_) {}
    return { attachments, settings, files };
  })()`;

  const checks = [];
  const check = (label, ok) => { checks.push({ label, ok: !!ok }); };
  const draftRefNow = () => evaluate('window.FormDraftManager && window.FormDraftManager.getCurrentDraftRef()');

  await load();
  check('OPFS+IndexedDB persistence available', await evaluate('ReferenceMediaStorage.createBrowserPersistence(window).available === true'));

  // dwo_form_draft_v1.draftRef が唯一のdraft authority。初回表示でFormDraftManagerが確保する。
  const initialDraftRef = await draftRefNow();
  check('a canonical form draftRef (dwo_form_draft_v1) is ensured on first load', typeof initialDraftRef === 'string' && initialDraftRef.startsWith('draft:'));

  // 1) 架空ファイルをUI経由（file input change）で追加
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(2048)], 'photo-sample.jpg', { type: 'image/jpeg' }));
    dt.items.add(new File([new Uint8Array(4096)], 'note-sample.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('media-file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor(`${names}.length === 2`, 'two attachments listed');
  let state = await evaluate(inspect);
  check('metadata x2 stored as unsent draft', state.attachments.length === 2 && state.attachments.every(a => a.status === 'unsent' && a.ownerType === 'draft'));
  check('OPFS files x2 with safe names', state.files.length === 2 && state.files.every(f => /^att-[0-9a-f-]{36}$/.test(f)));
  check('metadata has no blob/objectUrl', state.attachments.every(a => !('blob' in a) && !('objectUrl' in a) && Object.keys(a).length === 12));
  check('repeated persistence reuses the same canonical form draftRef', await draftRefNow() === initialDraftRef);
  check('metadata ownerRef equals the form draftRef (form draftRef === media ownerRef)', state.attachments.every(a => a.ownerRef === initialDraftRef));

  // 2) reload -> 復元（同じform draftRefで復元する）
  await load();
  await waitFor(`${names}.length === 2`, 'restored after reload');
  check('restored after reload with same names', JSON.stringify((await evaluate(names)).sort()) === JSON.stringify(['note-sample.pdf', 'photo-sample.jpg']));
  check('restored item has Object URL preview', await evaluate('document.querySelectorAll("#media-list img").length === 1'));
  check('reload restores by the same canonical form draftRef', await draftRefNow() === initialDraftRef);

  // 3) 削除
  await evaluate('document.querySelector("#media-list .media-delete").click()');
  await waitFor(`${names}.length === 1`, 'one attachment after delete');
  state = await evaluate(inspect);
  check('delete removed metadata and OPFS file', state.attachments.length === 1 && state.files.length === 1);
  await load();
  await waitFor(`${names}.length === 1`, 'one attachment after reload');

  // 4) 受注確定相当（将来の正式発行フロー用API）: canonical form draftRef を明示的に
  //    workOrderRef へ紐付ける。media-storageは独立したactive draftを生成・ローテーションしない。
  const draftBeforeCommit = await draftRefNow();
  const before = await evaluate(inspect);
  const ref = 'dwo:123e4567-e89b-42d3-a456-426614174000';
  const committed = await evaluate(`ReferenceMediaManager.commitCurrentDraft('${ref}')`);
  check('commit reports 1 attachment', committed && committed.committed === 1);
  await waitFor(`${names}.length === 0`, 'list emptied after commit');
  const after = await evaluate(inspect);
  check('owner rebound to workOrderRef', after.attachments.length === 1 && after.attachments[0].ownerType === 'work-order' && after.attachments[0].ownerRef === ref);
  check('commit does not rotate the canonical form draftRef', await draftRefNow() === draftBeforeCommit);
  check('media-storage settings store stays empty (no independent active-draft authority)', before.settings.length === 0 && after.settings.length === 0);
  check('OPFS file not moved', JSON.stringify(after.files) === JSON.stringify(before.files));
  await load();
  await waitFor('document.getElementById("media-empty").hidden === false', 'empty after reload');
  check('committed attachment is not restored into new draft', (await evaluate(names)).length === 0);
  check('reload after commit still uses the same unrotated form draftRef', await draftRefNow() === draftBeforeCommit);

  // 5) OPFSファイルのsize不一致 -> 復元時に掃除され、警告が出て、以後のcommitを塞がない
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(1024)], 'corrupt-sample.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('media-file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor(`${names}.length === 1`, 'attachment before corruption');
  const victim = (await evaluate(inspect)).files.find(f => !after.files.includes(f));
  await evaluate(`(async () => {
    const root = await navigator.storage.getDirectory();
    const blobs = await (await root.getDirectoryHandle('dwo-media-v1')).getDirectoryHandle('blobs');
    const w = await (await blobs.getFileHandle('${victim}')).createWritable();
    await w.write(new Uint8Array(7));
    await w.close();
  })()`);
  await load();
  await waitFor('document.getElementById("media-error").hidden === false', 'cleanup warning shown');
  const warning = await evaluate('document.getElementById("media-error").textContent');
  check('size-mismatch cleanup shows generic warning without file name', warning.includes('保存できなかった添付を除外しました') && !warning.includes('corrupt-sample'));
  check('corrupt attachment is not listed', (await evaluate(names)).length === 0);
  const cleaned = await evaluate(inspect);
  check('corrupt metadata and OPFS file removed', cleaned.attachments.length === 1 && !cleaned.files.includes(victim));
  const recommitted = await evaluate(`ReferenceMediaManager.commitCurrentDraft('dwo:123e4567-e89b-42d3-a456-426614174001')`);
  check('later commit is not blocked by the cleaned row', recommitted && recommitted.committed === 0);

  // 6) 明示的な下書き破棄: 「下書きを破棄」はReferenceMediaManager.discardCurrentDraftで
  //    添付を先に削除してから dwo_form_draft_v1 を削除する。
  await evaluate(`(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(512)], 'discard-sample.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('media-file-input');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor(`${names}.length === 1`, 'attachment before discard');
  const draftRefBeforeDiscard = await draftRefNow();
  await evaluate(`document.getElementById('draft-discard-btn').click()`);
  await waitFor(`${names}.length === 0`, 'list emptied after discard');
  await waitFor(`window.localStorage.getItem('dwo_form_draft_v1') === null`, 'form draft removed after discard');
  const afterDiscard = await evaluate(inspect);
  check('explicit discard removes the draft-owned attachment metadata and OPFS file', afterDiscard.attachments.every(a => a.ownerRef !== draftRefBeforeDiscard));
  check('explicit discard removes the form draft only after media cleanup succeeds', await evaluate("window.localStorage.getItem('dwo_form_draft_v1') === null"));

  ws.close();
  return checks;
}

let checks = [];
try {
  checks = await main();
} catch (error) {
  await cleanup();
  fail(String(error && error.message));
}
await cleanup();
checks.forEach(c => console.log((c.ok ? 'PASS ' : 'FAIL ') + c.label));
const ok = checks.every(c => c.ok);
console.log('MEDIA_STORAGE_E2E=' + (ok ? 'PASS' : 'FAIL'));
process.exit(ok ? 0 : 1);

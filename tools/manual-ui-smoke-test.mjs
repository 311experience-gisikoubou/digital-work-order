import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runGate } from './real-device-preview-gate.mjs';

export const SMOKE_MARKER = 'MANUAL_UI_SMOKE_TEST_V1';

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
});

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Invalid arguments near: ${key ?? '<end>'}`);
    out[key.slice(2)] = value;
  }
  return out;
}
function requireArg(args, name) {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function git(worktree, args) {
  return execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
}

export function getSmokeChecklist() {
  return [
    'PDF: B5 PDFが1ページで開く',
    'PDF: 上顎7-7欠損が左図と欠損歯式欄で一致する',
    '紙指示書: 架空画像が取り込み済みで表示される',
    'OCR: 端末内OCRで候補を確認・承認できる',
    '紙指示書: 承認反映成功後、一時画像だけが自動破棄される',
    '手動: Apple Pencil描画、指操作、2本指移動/ピンチズームを確認する',
  ];
}

function banner(text) {
  return `const b=document.createElement('div');b.textContent=${JSON.stringify(text)};b.style.cssText='position:sticky;top:0;z-index:9999;padding:10px;text-align:center;font-weight:700;background:#fff;border-bottom:2px solid #999';document.body.prepend(b);`;
}
const PDF_SAMPLE_SCRIPT = `// ${SMOKE_MARKER}:PDF
window.addEventListener('load', async () => {
  const $ = id => document.getElementById(id);
  const set = (id, value) => { const el = $(id); if (el) el.value = value; };
  const click = selector => { const el = document.querySelector(selector); if (el && !el.checked && !el.classList.contains('active')) el.click(); };
  set('clinic-name','架空テスト歯科'); set('doctor-name','架空テスト医師'); set('patient-name','架空テスト患者');
  set('patient-age','70'); set('patient-gender','male'); set('issue-date','2026-09-12');
  if ($('btn-insurance') && !$('btn-insurance').classList.contains('active')) $('btn-insurance').click();
  click('#order-type-group input[value="完成"]'); click('#bed-insurance button[data-val="レジン床"]');
  [17,16,15,14,13,12,11,21,22,23,24,25,26,27].forEach(num => { const el=document.querySelector('.tooth[data-num="'+num+'"]'); if (el && !el.classList.contains('selected')) el.click(); });
  click('button[data-group="tooth-ant-ins"][data-val="硬レ歯"]'); click('button[data-group="tooth-post-ins"][data-val="硬レ歯"]');
  click('#chk-shade'); click('button[data-group="shade"][data-val="A3"]');
  click('#chk-taigoha'); click('#chk-bite'); click('#chk-goa-opt'); click('#chk-articulator');
  set('articulator-type','SSマルチ咬合器'); set('articulator-detail','半調節性・架空テスト');
  set('remarks','manual UI smoke test用の架空データです。実患者情報ではありません。');
  set('shipping-date','2026-09-12'); if (typeof onShippingDateChange === 'function') await onShippingDateChange();
  ${banner('架空PDF smokeデータ自動入力済み｜実患者情報は使用しないでください')}
});`;
const PAPER_SAMPLE_SCRIPT = `// ${SMOKE_MARKER}:PAPER
window.addEventListener('load', async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const labTab = document.querySelector('.tab-btn[data-tab="lab"]');
  if (labTab && !labTab.classList.contains('active')) labTab.click();
  await sleep(100);
  const input = document.getElementById('paper-work-order-import');
  const status = document.getElementById('paper-work-order-status');
  if (!input) return;
  try {
    const response = await fetch('/tests/fixtures/paper-order-synthetic.png', { cache:'no-store' });
    if (!response.ok) throw new Error('fixture fetch failed');
    const blob = await response.blob();
    const file = new File([blob], 'paper-order-synthetic.png', { type:'image/png' });
    const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles:true }));
    if (status) status.dataset.syntheticSample = 'PASS';
    ${banner('架空紙指示書smokeデータ自動投入済み｜実患者情報は使用しないでください')}
  } catch (_) {
    if (status) status.textContent = '架空サンプルの自動投入に失敗しました。';
  }
});`;
const ORDER_LOSS_SAMPLE_SCRIPT = `// ${SMOKE_MARKER}:ORDER_LOSS
window.addEventListener('load', () => {
  const $ = id => document.getElementById(id);
  const set = (id, value) => { const el = $(id); if (el) el.value = value; };
  const click = selector => { const el = document.querySelector(selector); if (el && !el.checked && !el.classList.contains('active')) el.click(); };
  set('clinic-name','SAMPLE-CLINIC');
  set('doctor-name','SAMPLE-DOCTOR');
  set('patient-name','SAMPLE-PATIENT');
  set('patient-age','65');
  set('patient-gender','female');
  set('issue-date','2026-09-13');
  set('shipping-date','2026-09-13');
  if (typeof onShippingDateChange === 'function') onShippingDateChange();
  set('delivery-date','2026-09-30');
  if ($('btn-insurance') && !$('btn-insurance').classList.contains('active')) $('btn-insurance').click();
  click('#order-type-group input[value="\u5b8c\u6210"]');
  click('#bed-insurance button[data-val="\u30ec\u30b8\u30f3\u5e8a"]');
  ${banner('SYNTHETIC SAMPLE LOADED - do not use real patient data. Tap the order-list reflection button.')}
  setTimeout(() => $('submit-btn')?.scrollIntoView({ block:'center', behavior:'smooth' }), 150);
});`;
function injectSmokeScript(html, kind) {
  const src = kind === 'paper'
    ? '/__manual-smoke-paper.js'
    : kind === 'order-loss'
      ? '/__manual-smoke-order-loss.js'
      : '/__manual-smoke-pdf.js';
  return html.replace('</body>', `<script src="${src}"></script></body>`);
}

function safeFile(root, pathname) {
  const rel = pathname.replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedFile = file.toLowerCase();
  if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(`${normalizedRoot}${path.sep}`)) return null;
  return file;
}

export async function createSmokeServer({ worktree, host = '127.0.0.1', port = 0 }) {
  const root = path.resolve(worktree);
  const indexHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === '/__manual-smoke-pdf.js') return send(res, 200, 'text/javascript; charset=utf-8', PDF_SAMPLE_SCRIPT);
      if (url.pathname === '/__manual-smoke-paper.js') return send(res, 200, 'text/javascript; charset=utf-8', PAPER_SAMPLE_SCRIPT);
      if (url.pathname === '/__manual-smoke-order-loss.js') return send(res, 200, 'text/javascript; charset=utf-8', ORDER_LOSS_SAMPLE_SCRIPT);
      if (url.pathname === '/' && ['pdf','paper','order-loss'].includes(url.searchParams.get('smoke'))) {
        const body = injectSmokeScript(indexHtml, url.searchParams.get('smoke'));
        return send(res, 200, 'text/html; charset=utf-8', body);
      }
      const file = safeFile(root, url.pathname);
      if (!file) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
      const data = await fs.readFile(file);
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      send(res, 200, type, data);
    } catch (error) {
      if (error?.code === 'ENOENT') return send(res, 404, 'text/plain; charset=utf-8', 'not found');
      send(res, 500, 'text/plain; charset=utf-8', 'smoke server error');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return { server, host, port: actualPort, base: `http://${host}:${actualPort}` };
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function buildUrls(base) {
  return { root: base, pdf: `${base}/?smoke=pdf`, paper: `${base}/?smoke=paper`, orderLoss: `${base}/?smoke=order-loss` };
}
export async function runSmoke(args) {
  const worktree = path.resolve(requireArg(args, 'worktree'));
  const host = args.host || '127.0.0.1';
  const port = args.port ? Number(args.port) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port');
  const head = git(worktree, ['rev-parse', 'HEAD']).toLowerCase();
  const dirty = git(worktree, ['status', '--porcelain']).length > 0;
  const fixture = path.join(worktree, 'tests', 'fixtures', 'paper-order-synthetic.png');
  await fs.access(fixture);
  const preview = await createSmokeServer({ worktree, host, port });
  const localUrls = buildUrls(preview.base);
  let gate = null;

  if (args.public || args.pr) {
    if (!args.public || !args.pr) throw new Error('--public and --pr must be supplied together');
    if (dirty) throw new Error('Public exact-HEAD gate requires a clean worktree');
    gate = await runGate({
      worktree, pr: args.pr, purpose: 'manual-ui-smoke', local: preview.base, public: args.public,
      'marker-path': 'tools/manual-ui-smoke-test.mjs', marker: SMOKE_MARKER,
    });
    if (!gate.pass) throw new Error('REAL_DEVICE_PREVIEW_GATE failed');
  }

  return { preview, head, dirty, localUrls, publicUrls: args.public ? buildUrls(args.public) : null, gate, checklist: getSmokeChecklist() };
}
async function main() {
  try {
    const result = await runSmoke(parseArgs(process.argv.slice(2)));
    console.log(`MANUAL_UI_SMOKE=READY`);
    console.log(`HEAD=${result.head}`);
    console.log(`WORKTREE_CLEAN=${String(!result.dirty)}`);
    console.log(`LOCAL_PDF_SMOKE=${result.localUrls.pdf}`);
    console.log(`LOCAL_PAPER_SMOKE=${result.localUrls.paper}`);
    console.log(`LOCAL_ORDER_LOSS_SMOKE=${result.localUrls.orderLoss}`);
    if (result.publicUrls) {
      console.log(`PUBLIC_PDF_SMOKE=${result.publicUrls.pdf}`);
      console.log(`PUBLIC_PAPER_SMOKE=${result.publicUrls.paper}`);
      console.log(`PUBLIC_ORDER_LOSS_SMOKE=${result.publicUrls.orderLoss}`);
      console.log(`EXACT_HEAD_GATE=${result.gate?.pass ? 'PASS' : 'FAIL'}`);
    }
    console.log('SYNTHETIC_DATA_ONLY=true');
    result.checklist.forEach((item, index) => console.log(`CHECK_${index + 1}=${item}`));
    console.log('Press Ctrl+C to stop the smoke preview server.');
    process.on('SIGINT', () => result.preview.server.close(() => process.exit(0)));
    process.on('SIGTERM', () => result.preview.server.close(() => process.exit(0)));
  } catch (error) {
    console.error('MANUAL_UI_SMOKE=FAIL');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) await main();

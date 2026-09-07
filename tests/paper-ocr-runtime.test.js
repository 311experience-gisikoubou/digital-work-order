// Executes the actual shipped browser worker/core/model in an isolated VM.
// This is not a Safari/browser compatibility test. No server or network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
require('../paper-ocr.js');
test('shipped browser worker recognizes synthetic PNG with local-only assets and zero storage', async (t) => {
  const origin = 'http://localhost/app/';
  const fetched = [], imported = [], jobs = new Map();
  let handler, missingModel = false;
  const scope = { URL, Blob, Response, TextDecoder, TextEncoder, WebAssembly, WorkerGlobalScope: class {},
    setTimeout, clearTimeout, performance, console: { log() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Synthetic VM verification' },
    location: { href: origin + 'paper-ocr-worker.js' },
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    fetch: async (url, options) => {
      fetched.push({ url, options });
      assert.equal(url, origin + 'vendor/ocr/jpn.traineddata.gz');
      if (missingModel) return new Response('', { status: 404 });
      return new Response(fs.readFileSync('vendor/ocr/jpn.traineddata.gz'));
    },
    addEventListener: (name, callback) => { if (name === 'message') handler = callback; },
    postMessage: packet => {
      const job = jobs.get(packet.jobId);
      if (packet.status === 'resolve') job.resolve(packet.data);
      if (packet.status === 'reject') job.reject(new Error(String(packet.data)));
    }
  };
  for (const key of ['indexedDB', 'localStorage', 'sessionStorage', 'caches']) {
    Object.defineProperty(scope, key, { get() { throw new Error('Storage accessed: ' + key); } });
  }
  scope.self = scope;
  const context = vm.createContext(scope);
  scope.importScripts = url => {
    imported.push(url);
    const name = url.slice(origin.length);
    assert.ok(['vendor/ocr/worker.min.js', 'vendor/ocr/tesseract-core-lstm.wasm.js'].includes(name));
    vm.runInContext(fs.readFileSync(name, 'utf8'), context, { filename: path.basename(name) });
  };
  vm.runInContext(fs.readFileSync('paper-ocr-worker.js', 'utf8'), context);
  let sequence = 0;
  const send = (action, payload) => new Promise((resolve, reject) => {
    const jobId = String(++sequence);
    jobs.set(jobId, { resolve, reject });
    handler({ data: { workerId: 'synthetic', jobId, action, payload } });
  });
  const options = globalThis.PaperOCR.localOptions(origin);
  await send('load', { options: { corePath: options.corePath, lstmOnly: true, logging: false } });
  await send('loadLanguage', { langs: 'jpn', options: { ...options, lstmOnly: true } });
  await send('initialize', { langs: 'jpn', oem: 1, config: {} });
  const result = await send('recognize', { image: new Uint8Array(fs.readFileSync('tests/fixtures/paper-order-synthetic.png')),
    options: {}, output: { text: true, blocks: true } });
  assert.ok(result.text.includes('2026'));
  assert.ok(result.blocks.length > 0);
  const lines = result.blocks.flatMap(b => b.paragraphs).flatMap(p => p.lines);
  const candidates = globalThis.PaperOCR.parseCandidates(lines.filter(line => line.confidence >= 80).map(line => line.text).join('\n'));
  assert.equal(candidates.deliveryDate, '2026-10-20');
  t.diagnostic('Non-empty candidate fields: ' + Object.keys(candidates).filter(key => candidates[key]).join(', '));
  for (const variant of ['dim', 'tilted']) {
    await t.test('camera derivative: ' + variant, async () => {
      const data = await send('recognize', { image: new Uint8Array(fs.readFileSync(`tests/fixtures/paper-order-camera-${variant}.png`)),
        options: {}, output: { text: true, blocks: true } });
      const recognized = data.blocks.flatMap(b => b.paragraphs).flatMap(p => p.lines);
      const values = globalThis.PaperOCR.parseCandidates(recognized.filter(line => line.confidence >= 80).map(line => line.text).join('\n'));
      assert.equal(values.clinicName, '架空テスト歯科');
      assert.equal(values.deliveryDate, '2026-10-20');
      assert.ok(['', '架空医師'].includes(values.doctorName));
      assert.ok(['', '架空患者'].includes(values.patientName));
    });
  }
  assert.equal(fetched.length, 1); assert.equal(fetched[0].options.cache, 'no-store');
  assert.deepEqual(imported, [origin + 'vendor/ocr/worker.min.js', origin + 'vendor/ocr/tesseract-core-lstm.wasm.js']);
  missingModel = true;
  await assert.rejects(send('loadLanguage', { langs: 'jpn', options: { ...options, lstmOnly: true } }), /404/);
  assert.equal(fetched.length, 2); // The failed retry still requested only the local model.
});

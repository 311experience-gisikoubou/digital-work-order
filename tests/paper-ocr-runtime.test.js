// Executes the actual shipped browser worker/core/model in an isolated VM.
// This is not a Safari/browser compatibility test. No server or network is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
require('../paper-ocr.js');

// Node has no browser image APIs. This fixture-only adapter decodes the existing
// RGBA PNGs and encodes BMP using built-ins; it does NOT verify browser resampling.
function fixturePixels(bytes) {
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height);
  const pixels = new Uint8ClampedArray(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x, a = x >= 4 ? pixels[i - 4] : 0;
      const b = y ? pixels[i - stride] : 0, c = y && x >= 4 ? pixels[i - stride - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const prediction = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[i] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  return { width, height, pixels };
}
function bitmapBytes(width, height, pixels) {
  const stride = Math.ceil(width * 3 / 4) * 4, bytes = Buffer.alloc(54 + stride * height);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, to = 54 + (height - 1 - y) * stride + x * 3;
    bytes[to] = pixels[from + 2]; bytes[to + 1] = pixels[from + 1]; bytes[to + 2] = pixels[from];
  }
  return bytes;
}
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
      t.diagnostic(variant + ' original non-empty fields: ' + Object.keys(values).filter(key => values[key]).join(', '));
    });
    await t.test('production preprocessing + shipped OCR: ' + variant, async () => {
      const bytes = fs.readFileSync(`tests/fixtures/paper-order-camera-${variant}.png`);
      const fixture = fixturePixels(bytes);
      let closed = 0, terminated = 0, recognized = 0;
      const pixels = fixture.pixels;
      const canvas = { width: 0, height: 0,
        getContext: () => ({ drawImage(bitmap, x, y, width, height) {
          assert.equal(width, fixture.width); assert.equal(height, fixture.height);
        }, getImageData: () => ({ data: pixels }), putImageData() {} }),
        toBlob: callback => callback(new Blob([bitmapBytes(fixture.width, fixture.height, pixels)], { type: 'image/bmp' })) };
      const browser = { Blob, URL, AbortController,
        createImageBitmap: async () => ({ width: fixture.width, height: fixture.height, close() { closed++; } }),
        document: { createElement: () => canvas },
        Tesseract: { createWorker: async () => ({
          recognize: async (blob, options, output) => {
            recognized++;
            return { data: await send('recognize', { image: new Uint8Array(await blob.arrayBuffer()), options, output }) };
          }, terminate: async () => { terminated++; }
        }) }
      };
      for (const key of ['indexedDB', 'localStorage', 'sessionStorage', 'caches', 'fetch', 'XMLHttpRequest']) {
        Object.defineProperty(browser, key, { get() { throw new Error('Forbidden API: ' + key); } });
      }
      vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), browser);
      const values = await browser.PaperOCR.recognize(new Blob([bytes], { type: 'image/png' }), origin, () => {});
      assert.equal(values.clinicName, '架空テスト歯科');
      assert.equal(values.deliveryDate, '2026-10-20');
      assert.equal(values.doctorName, '架空医師');
      assert.equal(values.patientName, '架空患者');
      assert.equal(recognized, 1); assert.equal(terminated, 1); assert.equal(closed, 1);
      assert.equal(canvas.width, 0); assert.equal(canvas.height, 0);
      assert.ok(pixels.every(value => value === 0));
      t.diagnostic(variant + ' preprocessed non-empty fields: ' + Object.keys(values).filter(key => values[key]).join(', '));
    });
  }
  assert.equal(fetched.length, 1); assert.equal(fetched[0].options.cache, 'no-store');
  assert.deepEqual(imported, [origin + 'vendor/ocr/worker.min.js', origin + 'vendor/ocr/tesseract-core-lstm.wasm.js']);
  missingModel = true;
  await assert.rejects(send('loadLanguage', { langs: 'jpn', options: { ...options, lstmOnly: true } }), /404/);
  assert.equal(fetched.length, 2); // The failed retry still requested only the local model.
});

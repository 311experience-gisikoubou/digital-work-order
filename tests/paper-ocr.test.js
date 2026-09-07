const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
require('../paper-ocr.js');
const { parseCandidates, copyApproved, dateValue, localOptions } = globalThis.PaperOCR;
const sample = '歯科医院名：架空テスト歯科\n担当歯科医師：架空医師\n患者名：架空患者\n納期：2026年10月20日';
test('extracts only four explicitly labeled fictional candidates', () => {
  assert.deepEqual(parseCandidates(sample), { clinicName: '架空テスト歯科', doctorName: '架空医師', patientName: '架空患者', deliveryDate: '2026-10-20' });
});
test('unresolved, ambiguous, multiple-column and unlabeled fields remain blank', () => {
  for (const text of ['', '架空患者', '患者名：', '患者名：架空一\n患者名：架空二', '患者名：架空 納期：2026/10/20', '患者名：�']) {
    assert.equal(parseCandidates(text).patientName, '');
  }
});
test('known labels tolerate horizontal OCR spacing without repairing values', () => {
  assert.deepEqual(parseCandidates('歯 科 医 院 名 ：架空テスト歯科\n担 当 歯 科 医 師:架空 医師\n患\t者 名:架空 患者\n納 期:2026/10/20'),
    { clinicName: '架空テスト歯科', doctorName: '架空 医師', patientName: '架空 患者', deliveryDate: '2026-10-20' });
});
test('CR, CRLF and Unicode line separators preserve field boundaries', () => {
  for (const separator of ['\r', '\r\n', '\n', '\u2028', '\u2029']) {
    assert.deepEqual(parseCandidates(sample.replaceAll('\n', separator)), parseCandidates(sample));
  }
});
test('spacing tolerance retains missing-label, missing-colon and duplicate rejection', () => {
  for (const value of ['患者 名 架空患者', '患考名:架空患者', '患\n者名:架空患者',
    '患者名:架空患者\n患 者 名:', '患者名:架空患者\r患者名:架空患者',
    '患 者 名:架空患者 納 期:2026/10/20', '患者名:\n架空患者']) {
    assert.equal(parseCandidates(value).patientName, '');
  }
});
test('dates require a complete explicit valid calendar date without inference', () => {
  for (const value of ['10/20', '2026/2/29', '2026/13/01', '明日', '2026/10/20 午後']) assert.equal(dateValue(value), '');
  assert.equal(dateValue('2028/2/29'), '2028-02-29');
  assert.equal(parseCandidates('納期：２０２６年１０月２０日').deliveryDate, '2026-10-20');
});
function form() {
  const controls = Object.fromEntries(['clinic-name', 'doctor-name', 'patient-name', 'delivery-date'].map(id => [id, { value: 'before' }]));
  return { controls, getElementById: id => controls[id] };
}
test('approval required; copy current selected values only', () => {
  const doc = form(), candidates = parseCandidates(sample);
  assert.throws(() => copyApproved(doc, candidates, {}));
  assert.equal(doc.controls['clinic-name'].value, 'before');
  candidates.patientName = '編集済み架空患者';
  assert.deepEqual(copyApproved(doc, candidates, { patientName: true }), ['patientName']);
  assert.equal(doc.controls['patient-name'].value, candidates.patientName);
  assert.equal(doc.controls['clinic-name'].value, 'before');
});
test('blank, invalid date or missing destination fails before any copy', () => {
  for (const candidates of [{ clinicName: '架空', deliveryDate: '' }, { clinicName: '架空', deliveryDate: '2026-02-29' }]) {
    const doc = form();
    assert.throws(() => copyApproved(doc, candidates, { clinicName: true, deliveryDate: true }));
    assert.equal(doc.controls['clinic-name'].value, 'before');
  }
  const doc = form(); delete doc.controls['patient-name'];
  assert.throws(() => copyApproved(doc, parseCandidates(sample), { clinicName: true, patientName: true }));
  assert.equal(doc.controls['clinic-name'].value, 'before');
});
test('readback mismatch and setter exceptions fail and restore earlier copies', () => {
  for (const setter of [() => {}, () => { throw new Error('write failed'); }]) {
    const doc = form();
    Object.defineProperty(doc.controls['patient-name'], 'value', { get: () => 'before', set: setter });
    assert.throws(() => copyApproved(doc, parseCandidates(sample), { clinicName: true, patientName: true }));
    assert.equal(doc.controls['clinic-name'].value, 'before');
  }
});
test('runtime paths are explicit app-local under subdirectory deployment; cache disabled', () => {
  const options = localOptions('http://localhost:1234/app/index.html');
  assert.equal(options.corePath, 'http://localhost:1234/app/vendor/ocr/tesseract-core-lstm.wasm.js');
  assert.equal(options.workerPath, 'http://localhost:1234/app/paper-ocr-worker.js');
  assert.equal(options.langPath, 'http://localhost:1234/app/vendor/ocr');
  assert.equal(options.cacheMethod, 'none'); assert.equal(options.workerBlobURL, false);
  assert.throws(() => localOptions('file:///index.html'));
});
test('candidate module has no persistence, upload, telemetry or application state path', () => {
  const source = fs.readFileSync('paper-ocr.js', 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|\bcaches\b|state\.orders|fetch\(|XMLHttpRequest|sendBeacon|https?:\/\//);
});
test('worker blocks external and unknown fetches, non-GET bodies and unexpected scripts', async () => {
  const calls = [];
  const self = { location: { href: 'http://localhost/app/paper-ocr-worker.js' },
    fetch: async (...args) => { calls.push(args); return {}; }, importScripts: () => {} };
  vm.runInNewContext(fs.readFileSync('paper-ocr-worker.js', 'utf8'), { self, URL });
  await assert.rejects(self.fetch('https://example.invalid/data'));
  await assert.rejects(self.fetch('http://localhost/app/unknown'));
  await assert.rejects(self.fetch('http://localhost/app/vendor/ocr/jpn.traineddata.gz', { method: 'POST', body: 'fictional' }));
  assert.throws(() => self.importScripts('https://example.invalid/core.js'));
  assert.throws(() => new self.XMLHttpRequest());
  await self.fetch('http://localhost/app/vendor/ocr/jpn.traineddata.gz');
  assert.equal(calls.length, 1); assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].cache, 'no-store');
});
test('recognition filters low-confidence lines and always terminates after recognition failure', async (t) => {
  const browser = fakeBrowser();
  globalThis.createImageBitmap = browser.createImageBitmap;
  globalThis.document = browser.document;
  t.after(() => { delete globalThis.createImageBitmap; delete globalThis.document; delete globalThis.Tesseract; });
  let terminated = 0;
  const worker = { recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
    { text: '患者名：架空患者', confidence: 80 }, { text: '医院名：不確実', confidence: 79.99 }, { text: '納期：2026/10/20', confidence: 80 }
  ] }] }] } }), terminate: async () => { terminated++; } };
  globalThis.Tesseract = { createWorker: async () => worker };
  const file = new Blob(['fictional'], { type: 'image/png' });
  const result = await globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {});
  assert.equal(result.patientName, '架空患者'); assert.equal(result.clinicName, '');
  assert.equal(result.deliveryDate, '2026-10-20');
  worker.recognize = async () => { throw new Error('synthetic failure'); };
  await assert.rejects(globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {}));
  assert.equal(terminated, 2);
  delete globalThis.Tesseract;
});

test('diagnostics are opt-in, aggregate-only and never change candidate output', async (t) => {
  const browser = fakeBrowser();
  globalThis.createImageBitmap = browser.createImageBitmap;
  globalThis.document = browser.document;
  t.after(() => { delete globalThis.createImageBitmap; delete globalThis.document; delete globalThis.Tesseract; });
  const lines = [
    { text: '患者名：架空患者', confidence: 80 },
    { text: '医院名：不確実', confidence: 79.99 },
    { text: '納期：2026/10/20', confidence: 80 }
  ];
  globalThis.Tesseract = { createWorker: async () => ({
    recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines }] }] } }), terminate: async () => {}
  }) };
  const file = new Blob(['fictional'], { type: 'image/png' });
  const withoutDiagnostics = await globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {});
  const outcome = await globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {}, { diagnostics: true });
  assert.deepEqual(outcome.candidates, withoutDiagnostics);
  assert.deepEqual(outcome.diagnostics, {
    rawLineCount: 3, confidentLineCount: 2, labelHitsBeforeFilter: 3, labelHitsAfterFilter: 2,
    candidateCount: 2, fields: { clinicName: false, doctorName: false, patientName: true, deliveryDate: true }
  });
  const serialized = JSON.stringify(outcome.diagnostics);
  assert.doesNotMatch(serialized, /架空患者|不確実|2026-10-20|2026\/10\/20/);
  delete globalThis.Tesseract;
});

test('dynamic markup wires every OCR review control uniquely with accessible status', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const lab = fs.readFileSync('consumer-rules.js', 'utf8');
  const ids = ['paper-work-order-import', 'paper-work-order-preview', 'paper-work-order-filename', 'paper-work-order-import-button', 'paper-work-order-discard', 'paper-ocr-start', 'paper-ocr-status', 'paper-review', 'paper-cancel', 'paper-copy'];
  ids.push(...['clinicName', 'doctorName', 'patientName', 'deliveryDate'].flatMap(key => [`paper-${key}`, `paper-approve-${key}`]));
  for (const id of ids) {
    assert.equal(lab.split(`id="${id}"`).length - 1, 1, id);
    assert.ok(lab.includes(`id="${id}"`), id + ' must be in lab');
  }
  assert.match(lab, /id="paper-review" hidden/);
  assert.match(lab, /id="paper-ocr-status" role="status"/);
  assert.ok(html.indexOf('src="vendor/ocr/tesseract.min.js"') < html.indexOf('src="paper-ocr.js"'));
});

test('all fields reject fuzzy labels and ambiguous repeated values', () => {
  const empty = { clinicName: '', doctorName: '', patientName: '', deliveryDate: '' };
  assert.deepEqual(parseCandidates('歯科医阮名:架空テスト歯科\n担当歯科医帥:架空医師\n患考名:架空患者\n納旗:2026/10/20'), empty);
  assert.deepEqual(parseCandidates('架空テスト歯科\n架空医師\n架空患者\n2026/10/20'), empty);
  for (const line of sample.split('\n')) {
    const label = line.split('：')[0];
    for (const second of [line, label + '：', label + '：別の架空値']) {
      assert.deepEqual(parseCandidates(line + '\u2028' + second), empty);
    }
  }
});

function fakeBrowser() {
  const pixels = new Uint8ClampedArray([40, 40, 40, 255, 200, 200, 200, 255]);
  const bitmap = { width: 3200, height: 1600, closed: 0, close() { this.closed++; } };
  const context = { drawImage(...args) { this.draw = args; }, getImageData: () => ({ data: pixels }), putImageData() {} };
  const canvas = { getContext: () => context, toBlob: callback => callback(new Blob(['processed'], { type: 'image/png' })) };
  return { bitmap, canvas, pixels, context, createImageBitmap: async () => bitmap, document: { createElement(name) { assert.equal(name, 'canvas'); return canvas; } } };
}

test('OCR working dimensions are bounded without upscaling or losing aspect ratio', () => {
  const size = globalThis.PaperOCR.workingSize;
  assert.deepEqual(size(4032, 3024), { width: 2400, height: 1800 });
  assert.deepEqual(size(3024, 4032), { width: 1800, height: 2400 });
  assert.deepEqual(size(1050, 525), { width: 1050, height: 525 });
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => size(value, 1));
});

test('grayscale normalization is deterministic, conservative and composites transparency on white', () => {
  const normalize = globalThis.PaperOCR.normalizePixels;
  const pixels = new Uint8ClampedArray([40,40,40,255, 200,200,200,255]);
  normalize(pixels);
  assert.deepEqual([...pixels], [15,15,15,255, 255,255,255,255]);
  const flat = new Uint8ClampedArray([100,100,100,255, 110,110,110,255]);
  normalize(flat); assert.deepEqual([...flat], [100,100,100,255, 110,110,110,255]);
  const transparent = new Uint8ClampedArray([0,0,0,0]);
  normalize(transparent); assert.deepEqual([...transparent], [255,255,255,255]);
  const color = new Uint8ClampedArray([255,0,0,255]);
  normalize(color); assert.deepEqual([...color], [76,76,76,255]);
});

test('preprocessing uses smoothed bounded canvas and releases bitmap, pixels and canvas', async () => {
  const browser = fakeBrowser();
  vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), browser);
  const blob = await browser.PaperOCR.preprocess(new Blob());
  assert.equal(await blob.text(), 'processed');
  assert.deepEqual(browser.context.draw.slice(1), [0, 0, 2400, 1200]);
  assert.equal(browser.context.imageSmoothingEnabled, true);
  assert.equal(browser.context.imageSmoothingQuality, 'high');
  assert.equal(browser.bitmap.closed, 1);
  assert.equal(browser.canvas.width, 0); assert.equal(browser.canvas.height, 0);
  assert.ok(browser.pixels.every(value => value === 0));
});

test('decode, canvas and encoding failures reject without an original-image fallback', async () => {
  for (const failure of ['decode', 'canvas', 'encode']) {
    const browser = fakeBrowser();
    if (failure === 'decode') browser.createImageBitmap = async () => { throw new Error('decode'); };
    if (failure === 'canvas') browser.canvas.getContext = () => null;
    if (failure === 'encode') browser.canvas.toBlob = callback => callback(null);
    vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), browser);
    await assert.rejects(browser.PaperOCR.preprocess(new Blob()));
    if (failure !== 'decode') { assert.equal(browser.bitmap.closed, 1); assert.equal(browser.canvas.width, 0); }
    if (failure === 'encode') assert.ok(browser.pixels.every(value => value === 0));
  }
});

test('cancellation releases pending encoding artifacts and late decoded bitmaps', async () => {
  for (const stage of ['decode', 'encode']) {
    const browser = fakeBrowser(), controller = new AbortController();
    let finish;
    if (stage === 'decode') browser.createImageBitmap = () => new Promise(resolve => { finish = resolve; });
    else browser.canvas.toBlob = callback => { finish = callback; };
    vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), browser);
    const result = browser.PaperOCR.preprocess(new Blob(), controller.signal);
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
    assert.ok(finish);
    controller.abort(); await assert.rejects(result, /ocr-cancelled/);
    finish(stage === 'decode' ? browser.bitmap : new Blob());
    await Promise.resolve();
    assert.equal(browser.bitmap.closed, 1);
    if (stage === 'encode') { assert.equal(browser.canvas.width, 0); assert.ok(browser.pixels.every(value => value === 0)); }
  }
});

test('worker termination cancels pending preprocessing and prevents any late OCR pass', async () => {
  const browser = fakeBrowser();
  let active, finish, terminated = 0, recognized = 0;
  Object.assign(browser, { Blob, URL, AbortController,
    createImageBitmap: () => new Promise(resolve => { finish = resolve; }),
    Tesseract: { createWorker: async () => ({ recognize: async () => { recognized++; }, terminate: async () => { terminated++; } }) }
  });
  vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), browser);
  const result = browser.PaperOCR.recognize(new Blob(['fictional'], { type: 'image/png' }), 'http://localhost/app/', worker => { active = worker; });
  await new Promise(setImmediate);
  await active.terminate();
  await assert.rejects(result, /ocr-cancelled/);
  finish(browser.bitmap); await Promise.resolve();
  assert.equal(recognized, 0); assert.ok(terminated >= 1); assert.equal(browser.bitmap.closed, 1);
});

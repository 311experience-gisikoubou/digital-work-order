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
test('recognition filters low-confidence lines and always terminates after recognition failure', async () => {
  let terminated = 0;
  const worker = { recognize: async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
    { text: '患者名：架空患者', confidence: 90 }, { text: '医院名：不確実', confidence: 20 }
  ] }] }] } }), terminate: async () => { terminated++; } };
  globalThis.Tesseract = { createWorker: async () => worker };
  const file = new Blob(['fictional'], { type: 'image/png' });
  const result = await globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {});
  assert.equal(result.patientName, '架空患者'); assert.equal(result.clinicName, '');
  worker.recognize = async () => { throw new Error('synthetic failure'); };
  await assert.rejects(globalThis.PaperOCR.recognize(file, 'http://localhost/app/', () => {}));
  assert.equal(terminated, 2);
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

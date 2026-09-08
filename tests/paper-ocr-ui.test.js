const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const keys = ['clinicName', 'doctorName', 'patientName', 'deliveryDate'];
function setup() {
  const nodes = new Map(), events = {}, revoked = [], created = [];
  class Element {
    constructor() {
      this.value = ''; this.checked = false; this.hidden = false; this.files = []; this.listeners = {}; this.textContent = ''; this.dataset = {}; this.clickCount = 0;
      const classes = new Set();
      this.classList = { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name), toggle: (name, force) => { const next = force === undefined ? !classes.has(name) : Boolean(force); if (next) classes.add(name); else classes.delete(name); return next; } };
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    fire(name) { return this.listeners[name]?.(); }
    click() { this.clickCount++; return this.fire('click'); }
    setAttribute(name, value) { this[name] = value; }
    insertBefore(node) { assert.equal(nodes.has(node.id), false); nodes.set(node.id, node); }
    set innerHTML(html) {
      for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
        assert.equal(nodes.has(match[1]), false, 'duplicate dynamic ID');
        const el = new Element(); el.hidden = /\bhidden\b/.test(match[0]); el.disabled = /\bdisabled\b/.test(match[0]); nodes.set(match[1], el);
      }
    }
    removeAttribute(name) { delete this[name]; }
  }
  const ids = ['view-lab', 'view-clinic', 'paper-work-order-reference', 'paper-work-order-reference-image', 'paper-reference-body', 'paper-reference-toggle', 'clinic-name', 'doctor-name', 'patient-name', 'delivery-date'];
  ids.forEach(id => nodes.set(id, new Element()));
  nodes.get('paper-work-order-reference').hidden = true;
  const clinicTab = new Element();
  clinicTab.addEventListener('click', () => { nodes.get('view-clinic').classList.add('active'); nodes.get('view-lab').classList.remove('active'); });
  let terminateCount = 0, recognizeResult = async () => ({ data: { blocks: [{ paragraphs: [{ lines: [
    { text: '患者名：架空患者', confidence: 99 }, { text: '納期：2026/10/20', confidence: 99 }
  ] }] }] } });
  const scope = { Blob, URL: class extends URL { static createObjectURL(file) { created.push(file); return 'blob:synthetic-' + created.length; } static revokeObjectURL(url) { revoked.push(url); } },
    document: { baseURI: 'http://localhost/app/index.html', getElementById: id => nodes.get(id), createElement: () => new Element(), querySelector: selector => selector === '.tab-btn[data-tab="clinic"]' ? clinicTab : null },
    addEventListener: (name, callback) => { events[name] = callback; },
    setTimeout: callback => { events.timeout = callback; return 1; }, clearTimeout() {},
    Tesseract: { createWorker: async () => ({ recognize: () => recognizeResult(), terminate: async () => { terminateCount++; } }) } };
  for (const key of ['localStorage', 'indexedDB', 'caches', 'state']) Object.defineProperty(scope, key, { get() { throw new Error('Protected access'); } });
  vm.runInNewContext(fs.readFileSync('paper-ocr.js', 'utf8'), scope);
  vm.runInNewContext(fs.readFileSync('consumer-rules.js', 'utf8'), scope);
  const get = id => nodes.get(id);
  const select = () => {
    const file = new Blob(['synthetic'], { type: 'image/png' }); file.name = 'synthetic.png';
    get('paper-work-order-import').files = [file]; get('paper-work-order-import').fire('change');
  };
  return { get, select, events, revoked, created, clinicTab, init: scope.ConsumerRuleConsumer.init, setRecognition: fn => { recognizeResult = fn; }, terminated: () => terminateCount };
}
test('one Phase 1 intake mounts once with original camera, preview and discard IDs', () => {
  const ui = setup(); const panel = ui.get('paper-work-order-import-panel'); ui.init();
  assert.equal(ui.get('paper-work-order-import-panel'), panel);
  const html = fs.readFileSync('index.html', 'utf8'), consumer = fs.readFileSync('consumer-rules.js', 'utf8');
  assert.doesNotMatch(html, /paper-image-input|paper-title|paper-work-order-import-panel/);
  assert.equal((consumer.match(/type="file"/g) || []).length, 1);
  assert.match(consumer, /id="paper-work-order-import" accept="image\/\*" capture="environment"/);
  assert.doesNotMatch(fs.readFileSync('paper-ocr.js', 'utf8'), /createObjectURL|revokeObjectURL|function mount/);
  assert.ok(html.indexOf('paper-ocr.js') < html.indexOf('consumer-rules.js'));
  ui.select(); assert.equal(ui.created.length, 1);
  assert.equal(ui.get('paper-work-order-preview').src, 'blob:synthetic-1');
  assert.equal(ui.get('paper-work-order-filename').textContent, 'synthetic.png');
  assert.equal(ui.get('paper-work-order-import').value, '');
  ui.select(); assert.deepEqual(ui.revoked, ['blob:synthetic-1']);
  ui.get('paper-work-order-discard').click();
  assert.deepEqual(ui.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
  assert.equal(ui.get('paper-ocr-start').disabled, true);
  assert.equal(ui.get('paper-work-order-preview').src, undefined);
});
test('review does not write destinations; editing revokes approval; selected copy verifies current value', async () => {
  const ui = setup(); ui.select();
  await ui.get('paper-ocr-start').click();
  assert.equal(ui.get('patient-name').value, '');
  assert.equal(ui.get('paper-patientName').value, '架空患者');
  assert.equal(ui.get('paper-approve-patientName').checked, false);
  ui.get('paper-copy').click();
  assert.match(ui.get('paper-ocr-status').textContent, /失敗/);
  ui.get('paper-approve-patientName').checked = true;
  ui.get('paper-patientName').value = '編集済み架空患者'; ui.get('paper-patientName').fire('input');
  assert.equal(ui.get('paper-approve-patientName').checked, false);
  ui.get('paper-approve-patientName').checked = true; ui.get('paper-copy').click();
  assert.equal(ui.get('patient-name').value, '編集済み架空患者');
  assert.equal(ui.get('delivery-date').value, '');
  assert.match(ui.get('paper-ocr-status').textContent, /反映・照合済み/);
  assert.equal(ui.get('paper-work-order-preview-wrap').hidden, false);
  assert.equal(ui.revoked.length, 0);
});
test('cancel preserves preview, clears candidates and cannot copy', async () => {
  const ui = setup(); ui.select(); await ui.get('paper-ocr-start').click();
  ui.get('paper-approve-patientName').checked = true; ui.get('paper-cancel').click(); ui.get('paper-copy').click();
  assert.equal(ui.get('patient-name').value, ''); assert.equal(ui.get('paper-patientName').value, '');
  assert.equal(ui.get('paper-work-order-preview-wrap').hidden, false); assert.equal(ui.revoked.length, 0);
});
test('OCR failure keeps image, leaves form untouched and permits retry', async () => {
  const ui = setup(); ui.select(); ui.setRecognition(async () => { throw new Error('synthetic'); });
  await ui.get('paper-ocr-start').click();
  assert.match(ui.get('paper-ocr-status').textContent, /失敗/);
  assert.equal(ui.get('paper-ocr-start').disabled, false); assert.equal(ui.get('paper-work-order-preview-wrap').hidden, false);
  assert.equal(ui.get('patient-name').value, ''); assert.equal(ui.terminated(), 1);
});
test('copy mismatch preserves image and never reports success', async () => {
  const ui = setup(); ui.select(); await ui.get('paper-ocr-start').click();
  Object.defineProperty(ui.get('patient-name'), 'value', { get: () => '', set() {} });
  ui.get('paper-approve-patientName').checked = true; ui.get('paper-copy').click();
  assert.match(ui.get('paper-ocr-status').textContent, /失敗/); assert.equal(ui.get('paper-work-order-preview-wrap').hidden, false);
});
test('replacement invalidates in-flight OCR so late results cannot populate new review', async () => {
  const ui = setup(); let resolve;
  ui.setRecognition(() => new Promise(done => { resolve = done; })); ui.select();
  const pending = ui.get('paper-ocr-start').click(); await new Promise(setImmediate);
  ui.select(); resolve({ data: { blocks: [] } }); await pending;
  assert.equal(ui.get('paper-review').hidden, true); assert.equal(ui.get('paper-ocr-start').disabled, false);
  assert.equal(ui.revoked.length, 1); assert.equal(ui.get('patient-name').value, '');
});
test('timeout invalidates results and retains image; explicit discard and pagehide release image', async () => {
  const ui = setup(); let resolve;
  ui.setRecognition(() => new Promise(done => { resolve = done; })); ui.select();
  const pending = ui.get('paper-ocr-start').click(); await new Promise(setImmediate);
  ui.events.timeout(); resolve({ data: { blocks: [] } }); await pending;
  assert.match(ui.get('paper-ocr-status').textContent, /時間内/); assert.equal(ui.get('paper-review').hidden, true);
  assert.equal(ui.get('paper-work-order-preview-wrap').hidden, false);
  ui.get('paper-work-order-discard').click(); assert.equal(ui.get('paper-work-order-preview-wrap').hidden, true); assert.equal(ui.revoked.length, 1);
  ui.select(); ui.events.pagehide(); assert.equal(ui.revoked.length, 2); assert.equal(ui.get('paper-work-order-import').value, '');
});
test('invalid image selection preserves Phase 1 clearing semantics', async () => {
  const ui = setup(); ui.select(); await ui.get('paper-ocr-start').click();
  ui.get('paper-work-order-import').files = [new Blob(['synthetic'], { type: 'text/plain' })];
  ui.get('paper-work-order-import').fire('change');
  assert.equal(ui.get('paper-work-order-preview-wrap').hidden, true); assert.equal(ui.get('paper-patientName').value, '');
});


test('paper reference reuses the intake Object URL and navigates through the existing clinic tab', () => {
  const ui = setup();
  assert.equal(ui.get('paper-work-order-reference').hidden, true);
  ui.select();
  assert.equal(ui.created.length, 1);
  assert.equal(ui.get('paper-work-order-preview').src, 'blob:synthetic-1');
  assert.equal(ui.get('paper-work-order-reference-image').src, 'blob:synthetic-1');
  assert.equal(ui.get('paper-work-order-reference').hidden, false);
  assert.equal(ui.get('view-clinic').classList.contains('paper-reference-active'), true);
  ui.get('paper-work-order-open-clinic').click();
  assert.equal(ui.clinicTab.clickCount, 1);
  assert.equal(ui.get('view-clinic').classList.contains('active'), true);
  assert.equal(ui.get('paper-reference-body').hidden, false);
});

test('paper reference follows replacement and clears on discard and pagehide', () => {
  const ui = setup(); ui.select(); ui.select();
  assert.deepEqual(ui.revoked, ['blob:synthetic-1']);
  assert.equal(ui.get('paper-work-order-reference-image').src, 'blob:synthetic-2');
  ui.get('paper-work-order-discard').click();
  assert.equal(ui.get('paper-work-order-reference').hidden, true);
  assert.equal(ui.get('paper-work-order-reference-image').src, undefined);
  assert.equal(ui.get('view-clinic').classList.contains('paper-reference-active'), false);
  ui.select(); ui.events.pagehide();
  assert.equal(ui.get('paper-work-order-reference').hidden, true);
  assert.equal(ui.get('paper-work-order-reference-image').src, undefined);
});

test('paper reference can be collapsed without changing the stored image source', () => {
  const ui = setup(); ui.select();
  ui.get('paper-reference-toggle').click();
  assert.equal(ui.get('paper-reference-body').hidden, true);
  assert.equal(ui.get('paper-work-order-reference-image').src, 'blob:synthetic-1');
  assert.equal(ui.get('paper-reference-toggle').textContent, '画像を表示');
  ui.get('paper-reference-toggle').click();
  assert.equal(ui.get('paper-reference-body').hidden, false);
  assert.equal(ui.get('paper-reference-toggle').textContent, '画像を隠す');
});

test('clinic markup keeps one existing form and responsive reference layout', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const css = fs.readFileSync('style.css', 'utf8');
  assert.equal((html.match(/id="clinic-name"/g) || []).length, 1);
  assert.equal((html.match(/class="clinic-form-content"/g) || []).length, 1);
  assert.equal((html.match(/id="paper-work-order-reference-image"/g) || []).length, 1);
  assert.match(css, /#view-clinic.active.paper-reference-active[^}]*grid-template-columns/);
  assert.ok(css.includes('@media (max-width: 900px) {'));
  assert.ok(css.includes('#view-clinic.active.paper-reference-active { display:block; max-width:900px; }'));
});

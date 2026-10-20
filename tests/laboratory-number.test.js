'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const settingSource = fs.readFileSync(path.join(root, 'app/laboratory-number.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');

function makeStorage() {
  const saved = new Map();
  return {
    getItem(key) { return saved.has(key) ? saved.get(key) : null; },
    setItem(key, value) { saved.set(key, String(value)); },
    removeItem(key) { saved.delete(key); }
  };
}
function setup(storage) {
  function el() {
    const listeners = new Map();
    return {
      value: '', textContent: '',
      addEventListener(type, fn) { listeners.set(type, fn); },
      trigger(type) { assert.ok(listeners.has(type)); listeners.get(type)(); }
    };
  }
  const input = el(), button = el(), status = el();
  const elems = {
    'laboratory-registration-number': input,
    'laboratory-registration-number-save': button,
    'laboratory-registration-number-status': status
  };
  const sandbox = {
    console, document: { getElementById(id) { return elems[id] ?? null; } },
    localStorage: storage
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(settingSource, sandbox, { filename: 'laboratory-number.js' });
  return { setting: sandbox.LaboratoryNumberSettings, input, button, status };
}
test('input and explicit save button are clinic-side and loaded before app.js', () => {
  assert.match(htmlSource, /<label for="laboratory-registration-number">歯科技工所番号<\/label>/);
  assert.match(htmlSource, /id="laboratory-registration-number-save"/);
  assert.match(htmlSource, /id="laboratory-registration-number-status" role="status"/);
  assert.ok(htmlSource.indexOf('app/laboratory-number.js') < htmlSource.indexOf('<script src="app.js"'));
});
test('number normalization keeps leading zeros and accepts formatted or fullwidth nine digits', () => {
  const { setting } = setup(makeStorage());
  assert.equal(setting.normalizeNumber('012300045'), '01-23-00045');
  assert.equal(setting.normalizeNumber('01-23-00045'), '01-23-00045');
  assert.equal(setting.normalizeNumber('０１－２３－０００４５'), '01-23-00045');
  assert.equal(setting.normalizeNumber(' 01-23-00045 '), '01-23-00045');
  assert.equal(setting.normalizeNumber('12345678'), '');
  assert.equal(setting.normalizeNumber('01-23-0004<script>'), '');
});
test('explicit save persists locally across reload; unsaved changes are not issued', () => {
  const store = makeStorage();
  const a = setup(store);
  a.input.value = '012300045';
  assert.equal(a.setting.getSavedNumber(), '');
  a.input.trigger('input');
  assert.match(a.status.textContent, /未保存/);
  a.button.trigger('click');
  assert.equal(a.setting.getSavedNumber(), '01-23-00045');
  assert.equal(store.getItem(a.setting.STORAGE_KEY), '01-23-00045');
  assert.match(a.status.textContent, /保存しました/);
  const b = setup(store);
  assert.equal(b.input.value, '01-23-00045');
  b.input.value = '999999999';
  assert.equal(b.setting.getSavedNumber(), '01-23-00045');
});
test('invalid input cannot overwrite valid saved number', () => {
  const store = makeStorage();
  const { setting, input, button, status } = setup(store);
  assert.equal(setting.saveNumber('012300045').status, 'saved');
  input.value = 'wrong';
  button.trigger('click');
  assert.match(status.textContent, /以前の保存値は変更されません/);
  assert.equal(setting.getSavedNumber(), '01-23-00045');
});
test('storage errors are surfaced and never treated as success', () => {
  const throwing = {
    getItem() { throw new Error('Storage disabled'); },
    setItem() { throw new Error('Storage disabled'); }
  };
  const { setting, button, input, status } = setup(throwing);
  assert.equal(setting.getSavedNumber(), '');
  input.value = '012300045';
  button.trigger('click');
  assert.equal(setting.saveNumber('012300045').status, 'storage-error');
  assert.match(status.textContent, /保存できませんでした/);
});
test('issue data snapshots only the saved setting; old draft schema is untouched', () => {
  assert.match(appSource, /laboratoryRegistrationNumber:\s*globalThis\.LaboratoryNumberSettings\?\.getSavedNumber\(\)\s*\?\?\s*''/);
  const draftSource = fs.readFileSync(path.join(root, 'app/draft-persistence.js'), 'utf8');
  assert.match(draftSource, /dwo_form_draft_v1/);
  assert.doesNotMatch(draftSource, /laboratoryRegistrationNumber/);
});
function render(order1, order2) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    window: { addEventListener() {} },
    formatJapaneseEraDate(value) { return value; },
    document: {}
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pdfSource, sandbox, { filename: 'pdf.js' });
  return sandbox._buildPrintHTML(order1, '', order2 ?? null, '', '', '');
}
function order(number, registration) {
  const o = {
    clinicName: '架空歯科医院', doctorName: '架空医師', patientName: 'サンプル患者',
    issueDate: '2026-10-20', selectedTeeth: [], devices: [],
    orderTypes: [], insuranceType: 'insurance', remarks: '', priority: 'normal'
  };
  if (registration !== undefined) o.laboratoryRegistrationNumber = registration;
  return o;
}
test('PDF shows fixed issue-time number by the existing studio name and two slips stay independent', () => {
  const html = render(order(1, '01-23-00045'), order(2, '02-34-00056'));
  assert.ok(html.includes('咬み合わせ医療会　こよし技工房'));
  assert.equal((html.match(/歯科技工所番号：/g) ?? []).length, 2);
  assert.match(html, /01-23-00045/);
  assert.match(html, /02-34-00056/);
  assert.match(html, /header-studio-number/);
});
test('historical order without number is rendered without the new row', () => {
  const html = render(order(1));
  assert.doesNotMatch(html, /歯科技工所番号：/);
});
test('malformed legacy property is not inserted into PDF markup', () => {
  const html = render(order(1, '<img src=x onerror=alert(1)>'));
  assert.doesNotMatch(html, /onerror=/);
  assert.doesNotMatch(html, /歯科技工所番号：/);
});

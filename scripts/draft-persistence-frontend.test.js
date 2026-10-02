const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const draftSource = fs.readFileSync(path.join(root, 'app', 'draft-persistence.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const draftStart = draftSource.indexOf('//  Phase 2 Stage 1: form draft persistence');
const collectStart = draftSource.indexOf('function collectDraftFormData()', draftStart);
assert.ok(draftStart >= 0 && collectStart > draftStart);

const draftBlock = draftSource;
const pureDraftBlock = draftSource.slice(0, collectStart);

function classList(initial = []) {
  const values = new Set(initial);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    toggle(value, force) {
      if (force === true) values.add(value);
      else if (force === false) values.delete(value);
      else if (values.has(value)) values.delete(value);
      else values.add(value);
    },
    contains(value) { return values.has(value); }
  };
}

function element(value = '') {
  return {
    value,
    checked: false,
    dataset: {},
    textContent: '',
    style: {},
    classList: classList(),
    addEventListener() {},
    querySelector() { return null; }
  };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    snapshot() { return Object.fromEntries(data); }
  };
}

function syntheticForm(overrides = {}) {
  return {
    clinicName: 'SAMPLE-CLINIC',
    doctorName: 'SAMPLE-DOCTOR',
    patientName: 'SAMPLE-PATIENT',
    patientAge: '70',
    patientGender: 'female',
    issueDate: '2026-10-02',
    insuranceType: 'insurance',
    orderTypes: [],
    repairDetail: '',
    bedType: null,
    devices: [],
    claspType: null,
    claspTypes: [],
    barType: null,
    barTypes: [],
    castBarJaws: { upper: false, lower: false },
    castBarCounts: { upper: 0, lower: 0 },
    reinforcementWireCount: 0,
    hasRimount: false,
    rimountJaws: { upper: false, lower: false },
    rimountCount: 0,
    hasMetalup: false,
    metalupDetail: '',
    hasKyoko: false,
    kyokoDetail: '',
    toothAnterior: null,
    toothPosterior: null,
    shadeGuide: '',
    shadeNumber: '',
    taigoha: false,
    bite: false,
    goaFlag: false,
    hasArticulator: false,
    articulatorType: '',
    articulatorDetail: '',
    deliveryDate: '2026-10-16',
    nextAppointment: '',
    priority: 'normal',
    remarks: 'SAMPLE-REMARKS',
    shippingDate: '2026-10-03',
    standardDeliveryDate: '2026-10-20',
    businessDaysFromShipping: 11,
    expediteFeeYen: 0,
    ...overrides
  };
}

function bootPure() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(pureDraftBlock, context);
  return context;
}

function fakeUuidCrypto(values) {
  let index = 0;
  return {
    randomUUID() {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      return value;
    },
    calls() { return index; }
  };
}

test('valid save uses one versioned envelope and keeps draftRef stable across saves', () => {
  const context = bootPure();
  const storage = memoryStorage();
  const crypto = fakeUuidCrypto([
    '123e4567-e89b-42d3-a456-426614174000',
    '223e4567-e89b-42d3-a456-426614174000'
  ]);

  const first = context.saveFormDraftEnvelope(syntheticForm(), storage, crypto);
  const second = context.saveFormDraftEnvelope(syntheticForm({ remarks: 'UPDATED' }), storage, crypto);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.draft.draftRef, 'draft:123e4567-e89b-42d3-a456-426614174000');
  assert.equal(second.draft.draftRef, first.draft.draftRef);
  assert.equal(second.draft.mediaOwnerRef, second.draft.draftRef);
  assert.equal(second.draft.schemaVersion, 'dwo-form-draft-v1');
  assert.equal(JSON.stringify(second.draft.visualSnapshot), '{}');
  assert.equal(JSON.stringify(second.draft.form.claspTypes), '[]');
  assert.equal(JSON.stringify(second.draft.form.barTypes), '[]');
  assert.equal(second.draft.form.standardDeliveryDate, '2026-10-20');
  assert.equal(second.draft.form.businessDaysFromShipping, 11);
  assert.equal(second.draft.form.expediteFeeYen, 0);
  assert.equal(crypto.calls(), 1);
  assert.equal(Object.keys(storage.snapshot()).length, 1);
});

test('secure getRandomValues fallback produces UUID v4 and missing crypto fails closed', () => {
  const context = bootPure();
  const fake = {
    getRandomValues(bytes) {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = i;
      return bytes;
    }
  };
  const ref = context.generateDraftRef(fake);
  assert.match(ref, /^draft:[0-9a-f-]{36}$/);
  assert.equal(ref.split(':')[1][14], '4');
  assert.match(ref.split(':')[1][19], /[89ab]/);
  assert.throws(() => context.generateDraftRef({}), /SECURE_DRAFT_REF_UNAVAILABLE/);
});

test('valid draft survives a simulated browser restart', () => {
  const storage = memoryStorage();
  const firstContext = bootPure();
  const saved = firstContext.saveFormDraftEnvelope(
    syntheticForm({ patientName: 'RESTART-SAMPLE' }),
    storage,
    fakeUuidCrypto(['323e4567-e89b-42d3-a456-426614174000'])
  );
  assert.equal(saved.ok, true);
  const reloadedContext = bootPure();
  const restored = reloadedContext.readStoredFormDraft(storage);
  assert.equal(restored.status, 'valid');
  assert.equal(restored.draft.form.patientName, 'RESTART-SAMPLE');
  assert.equal(restored.draft.draftRef, saved.draft.draftRef);
});

test('malformed, unknown-version, and invalid-field drafts fail closed and remain stored', () => {
  const context = bootPure();
  const valid = context.buildFormDraftEnvelope(
    syntheticForm(),
    { cryptoApi: fakeUuidCrypto(['423e4567-e89b-42d3-a456-426614174000']) }
  );
  const cases = [
    '{bad-json',
    JSON.stringify({ ...valid, schemaVersion: 'unknown' }),
    JSON.stringify({ ...valid, savedAt: '2026-10-02' }),
    JSON.stringify({ ...valid, form: { ...valid.form, patientName: 123 } })
  ];

  for (const raw of cases) {
    const storage = memoryStorage({ dwo_form_draft_v1: raw });
    const result = context.readStoredFormDraft(storage);
    assert.equal(result.status, 'invalid');
    assert.equal(storage.snapshot().dwo_form_draft_v1, raw);
  }
});

test('setItem failure returns failure without mutating the source form', () => {
  const context = bootPure();
  const form = syntheticForm();
  const before = JSON.stringify(form);
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); },
    removeItem() {}
  };
  const result = context.saveFormDraftEnvelope(
    form,
    storage,
    fakeUuidCrypto(['523e4567-e89b-42d3-a456-426614174000'])
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(form), before);
});

test('silent storage write loss is not reported as saved', () => {
  const context = bootPure();
  const storage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  };
  const result = context.saveFormDraftEnvelope(
    syntheticForm(),
    storage,
    fakeUuidCrypto(['533e4567-e89b-42d3-a456-426614174000'])
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DRAFT_SAVE_FAILED');
});

test('remove failure is fail-closed and successful remove deletes only the form draft key', () => {
  const context = bootPure();
  const throwing = {
    removeItem() { throw new Error('blocked'); },
    getItem() { return 'still-there'; }
  };
  assert.equal(context.removeStoredFormDraft(throwing), false);

  const storage = memoryStorage({
    dwo_form_draft_v1: 'draft',
    dwo_drawing_v1: 'drawing',
    dwo_clasp_v1: 'clasp'
  });
  assert.equal(context.removeStoredFormDraft(storage), true);
  assert.deepEqual(storage.snapshot(), {
    dwo_drawing_v1: 'drawing',
    dwo_clasp_v1: 'clasp'
  });
});

function bootDraftUi(storage) {
  const ids = new Map();
  const get = id => {
    if (!ids.has(id)) ids.set(id, element());
    return ids.get(id);
  };
  const priorities = [
    { dataset: { val: 'normal' }, classList: classList(['active']) },
    { dataset: { val: 'urgent' }, classList: classList() }
  ];
  const containers = new Map([
    ['order-type-group', []],
    ['device-insurance', []],
    ['device-jishi', []]
  ]);
  let resetCount = 0;
  const toasts = [];
  const state = { priority: 'normal' };
  const document = {
    getElementById: get,
    querySelectorAll(selector) {
      if (selector === '.priority-btn') return priorities;
      const containerMatch = /^#(.+) input\[type="checkbox"\]$/.exec(selector);
      if (containerMatch) return containers.get(containerMatch[1]) || [];
      if (selector.startsWith('.toggle-btn[data-group=')) return [];
      return [];
    },
    querySelector() { return null; }
  };
  const context = {
    window: {
      localStorage: storage,
      addEventListener() {}
    },
    document,
    state,
    showToast(message, type) { toasts.push({ message, type }); },
    resetForm() { resetCount += 1; },
    collectFormData() { throw new Error('not used'); },
    setInsurance(type) { state.insuranceType = type; },
    syncNextAppointmentFromValue() {}
  };
  vm.createContext(context);
  vm.runInContext(draftBlock, context);
  return { context, get, state, toasts, getResetCount: () => resetCount };
}

test('startup restore applies a valid stored draft to the current form', async () => {
  const pure = bootPure();
  const storage = memoryStorage();
  pure.saveFormDraftEnvelope(
    syntheticForm({ patientName: 'RESTORED', priority: 'urgent', shippingDate: '2026-10-05' }),
    storage,
    fakeUuidCrypto(['623e4567-e89b-42d3-a456-426614174000'])
  );
  const ui = bootDraftUi(storage);
  assert.equal(await ui.context.restoreFormDraftOnStartup(storage), true);
  assert.equal(ui.get('patient-name').value, 'RESTORED');
  assert.equal(ui.get('shipping-date').value, '2026-10-05');
  assert.equal(ui.state.priority, 'urgent');
  assert.match(ui.toasts.at(-1).message, /復元/);
});

test('invalid stored draft does not partially mutate the current form', async () => {
  const storage = memoryStorage({ dwo_form_draft_v1: '{bad-json' });
  const ui = bootDraftUi(storage);
  ui.get('patient-name').value = 'CURRENT';
  assert.equal(await ui.context.restoreFormDraftOnStartup(storage), false);
  assert.equal(ui.get('patient-name').value, 'CURRENT');
  assert.equal(storage.snapshot().dwo_form_draft_v1, '{bad-json');
  assert.equal(ui.toasts.at(-1).type, 'error');
});

test('discard resets only after storage removal succeeds', () => {
  const failStorage = {
    getItem() { return 'draft'; },
    removeItem() { throw new Error('blocked'); }
  };
  const failed = bootDraftUi(failStorage);
  assert.equal(failed.context.discardCurrentFormDraft(), false);
  assert.equal(failed.getResetCount(), 0);

  const okStorage = memoryStorage({ dwo_form_draft_v1: 'draft' });
  const succeeded = bootDraftUi(okStorage);
  assert.equal(succeeded.context.discardCurrentFormDraft(), true);
  assert.equal(succeeded.getResetCount(), 1);
  assert.equal(okStorage.getItem('dwo_form_draft_v1'), null);
});

test('current list-reflection submit preserves the saved draft and buttons are wired without new assets', () => {
  const submitStart = appSource.indexOf("document.getElementById('submit-btn').addEventListener");
  const submitEnd = appSource.indexOf('function resetForm()', submitStart);
  const submitBlock = appSource.slice(submitStart, submitEnd);
  assert.match(submitBlock, /state\.orders\.unshift\(data\);[\s\S]*resetForm\(\);/);
  assert.doesNotMatch(submitBlock, /removeStoredFormDraft\(\)/);

  assert.equal(draftSource.includes('resetForm = function resetFormWithDraftGuard()'), false);
  assert.equal(draftSource.includes('baseResetForm'), false);

  assert.match(htmlSource, /id="draft-save-btn">下書き保存<\/button>/);
  assert.match(htmlSource, /id="draft-discard-btn">下書きを破棄<\/button>/);
  assert.match(htmlSource, /id="draft-local-note"[^>]*>下書きはこの端末内に保存されます。/);
  assert.match(htmlSource, /<script src="app\/draft-persistence\.js"><\/script>/);
  assert.match(draftSource, /restoreFormDraftOnStartup\(\);/);
  assert.equal(draftSource.includes('dwo_drawing_v1'), false);
  assert.equal(draftSource.includes('dwo_clasp_v1'), false);
});

test('draft device values use visible labels without changing existing checkbox values', () => {
  const ui = bootDraftUi(memoryStorage());
  const defaultValueInput = {
    value: 'on',
    closest() {
      return {
        querySelector() { return { textContent: '基礎床' }; }
      };
    }
  };
  const explicitValueInput = { value: 'GoA' };
  assert.equal(ui.context.getDraftCheckboxLogicalValue(defaultValueInput), '基礎床');
  assert.equal(ui.context.getDraftCheckboxLogicalValue(explicitValueInput), 'GoA');

  for (const id of ['chk-kisosho-ins','chk-rotei-ins','chk-kyokosen-ins','chk-hoji-ins']) {
    const match = htmlSource.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(match, id);
    assert.doesNotMatch(match[0], /\bvalue=/);
  }
});

test('calendar restore preserves the saved delivery date and reuses existing calculation hooks', async () => {
  const ui = bootDraftUi(memoryStorage());
  let appliedDate = null;
  ui.context.shippingDateGlobal = null;
  ui.context.nextApDateGlobal = null;
  ui.context.stdDeliveryDate = null;
  ui.context.selectedDeliveryDate = null;
  ui.context.vcalYear = 0;
  ui.context.vcalMonth = 0;
  ui.context.fetchHolidays = async () => ({});
  ui.context.getStdDays = () => 11;
  ui.context.addBizDays = () => '2026-10-21';
  ui.context.renderVcal = async () => {};
  ui.context.applyDelivery = async date => {
    appliedDate = date;
    ui.get('submit-btn').disabled = false;
  };

  const form = syntheticForm({
    shippingDate: '2026-10-03',
    deliveryDate: '2026-10-20',
    nextAppointment: '2026-10-25T10:00'
  });
  assert.equal(await ui.context.restoreDraftCalendarState(form), true);
  assert.equal(ui.context.shippingDateGlobal, '2026-10-03');
  assert.equal(ui.context.stdDeliveryDate, '2026-10-21');
  assert.equal(ui.context.selectedDeliveryDate, '2026-10-20');
  assert.equal(ui.context.nextApDateGlobal, '2026-10-25');
  assert.equal(appliedDate, '2026-10-20');
  assert.equal(ui.get('submit-btn').disabled, false);
});

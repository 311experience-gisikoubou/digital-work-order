// ============================================================
//  Phase 2 Stage 1: form draft persistence
// ============================================================
const FORM_DRAFT_STORAGE_KEY = 'dwo_form_draft_v1';
const FORM_DRAFT_SCHEMA_VERSION = 'dwo-form-draft-v1';
const DRAFT_REF_PATTERN = /^draft:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORM_DRAFT_FIELDS = [
  'clinicName','doctorName','patientName','patientAge','patientGender','issueDate',
  'insuranceType','orderTypes','repairDetail','bedType','devices','claspType','claspTypes','barType','barTypes',
  'castBarJaws','castBarCounts','reinforcementWireCount','hasRimount','rimountJaws','rimountCount',
  'hasMetalup','metalupDetail','hasKyoko','kyokoDetail','toothAnterior','toothPosterior',
  'shadeGuide','shadeNumber','taigoha','bite','goaFlag','hasArticulator',
  'articulatorType','articulatorDetail','deliveryDate','nextAppointment','priority','remarks','shippingDate',
  'standardDeliveryDate','businessDaysFromShipping','expediteFeeYen'
];

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function hasExactObjectKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isStringOrNull(value) {
  return typeof value === 'string' || value === null;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isJawBooleanObject(value) {
  return hasExactObjectKeys(value, ['upper','lower']) &&
    typeof value.upper === 'boolean' && typeof value.lower === 'boolean';
}

function isJawCountObject(value) {
  return hasExactObjectKeys(value, ['upper','lower']) &&
    Number.isInteger(value.upper) && value.upper >= 0 && value.upper <= 3 &&
    Number.isInteger(value.lower) && value.lower >= 0 && value.lower <= 3;
}

function validateDraftFormData(form) {
  if (!hasExactObjectKeys(form, FORM_DRAFT_FIELDS)) return false;

  const stringFields = [
    'clinicName','doctorName','patientName','patientAge','patientGender','issueDate',
    'repairDetail','metalupDetail','kyokoDetail','shadeGuide','shadeNumber',
    'articulatorType','articulatorDetail','deliveryDate','nextAppointment','priority','remarks','shippingDate',
    'standardDeliveryDate'
  ];
  if (stringFields.some(key => typeof form[key] !== 'string')) return false;

  const nullableStrings = ['bedType','claspType','barType','toothAnterior','toothPosterior'];
  if (nullableStrings.some(key => !isStringOrNull(form[key]))) return false;

  if (!['insurance','jishi'].includes(form.insuranceType)) return false;
  if (!isStringArray(form.orderTypes) || !isStringArray(form.devices)) return false;
  if (!isStringArray(form.claspTypes) || !isStringArray(form.barTypes)) return false;
  if (!isJawBooleanObject(form.castBarJaws) || !isJawCountObject(form.castBarCounts)) return false;
  if (!Number.isInteger(form.reinforcementWireCount) || form.reinforcementWireCount < 0) return false;
  if (!Number.isInteger(form.rimountCount) || form.rimountCount < 0 || form.rimountCount > 2) return false;
  if (!isJawBooleanObject(form.rimountJaws)) return false;
  if (!Number.isInteger(form.businessDaysFromShipping) || form.businessDaysFromShipping < 0) return false;
  if (!Number.isInteger(form.expediteFeeYen) || form.expediteFeeYen < 0) return false;

  const booleanFields = ['hasRimount','hasMetalup','hasKyoko','taigoha','bite','goaFlag','hasArticulator'];
  return booleanFields.every(key => typeof form[key] === 'boolean');
}

function formatDraftUuidV4(bytes) {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

function generateDraftRef(cryptoApi = globalThis.crypto) {
  const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!cryptoApi) throw new Error('SECURE_DRAFT_REF_UNAVAILABLE');

  if (typeof cryptoApi.randomUUID === 'function') {
    const uuid = cryptoApi.randomUUID();
    if (!uuidV4.test(uuid)) throw new Error('SECURE_DRAFT_REF_INVALID');
    return `draft:${uuid.toLowerCase()}`;
  }

  if (typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('SECURE_DRAFT_REF_UNAVAILABLE');
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return `draft:${formatDraftUuidV4(bytes)}`;
}

function validateFormDraftEnvelope(value) {
  const keys = ['schemaVersion','draftRef','savedAt','form','visualSnapshot','mediaOwnerRef'];
  if (!hasExactObjectKeys(value, keys)) return false;
  if (value.schemaVersion !== FORM_DRAFT_SCHEMA_VERSION) return false;
  if (!DRAFT_REF_PATTERN.test(value.draftRef) || value.mediaOwnerRef !== value.draftRef) return false;
  if (typeof value.savedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.savedAt) ||
      !Number.isFinite(Date.parse(value.savedAt))) return false;
  if (!validateDraftFormData(value.form)) return false;
  return isPlainObject(value.visualSnapshot) && Object.keys(value.visualSnapshot).length === 0;
}

function getFormDraftStorage(storage) {
  if (storage) return storage;
  return window.localStorage;
}

function readStoredFormDraft(storage) {
  let raw;
  try {
    raw = getFormDraftStorage(storage).getItem(FORM_DRAFT_STORAGE_KEY);
  } catch (_) {
    return { status: 'storage-error', draft: null };
  }
  if (raw === null) return { status: 'empty', draft: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    return { status: 'invalid', draft: null };
  }
  return validateFormDraftEnvelope(parsed)
    ? { status: 'valid', draft: parsed }
    : { status: 'invalid', draft: null };
}

function buildFormDraftEnvelope(form, options) {
  const opts = options || {};
  if (!validateDraftFormData(form)) throw new Error('FORM_DRAFT_FORM_INVALID');

  const previous = opts.previousDraft && validateFormDraftEnvelope(opts.previousDraft)
    ? opts.previousDraft
    : null;
  const draftRef = previous ? previous.draftRef : generateDraftRef(opts.cryptoApi);
  const now = opts.now instanceof Date ? opts.now : new Date();

  const envelope = {
    schemaVersion: FORM_DRAFT_SCHEMA_VERSION,
    draftRef,
    savedAt: now.toISOString(),
    form: JSON.parse(JSON.stringify(form)),
    visualSnapshot: {},
    mediaOwnerRef: draftRef
  };
  if (!validateFormDraftEnvelope(envelope)) throw new Error('FORM_DRAFT_ENVELOPE_INVALID');
  return envelope;
}

function saveFormDraftEnvelope(form, storage, cryptoApi, now) {
  let target;
  try {
    target = getFormDraftStorage(storage);
  } catch (_) {
    return { ok: false, code: 'STORAGE_UNAVAILABLE' };
  }
  const current = readStoredFormDraft(target);
  if (current.status === 'storage-error') return { ok: false, code: 'STORAGE_UNAVAILABLE' };

  let envelope;
  try {
    envelope = buildFormDraftEnvelope(form, {
      previousDraft: current.status === 'valid' ? current.draft : null,
      cryptoApi,
      now
    });
    const serialized = JSON.stringify(envelope);
    target.setItem(FORM_DRAFT_STORAGE_KEY, serialized);
    const persisted = target.getItem(FORM_DRAFT_STORAGE_KEY);
    if (persisted !== serialized) throw new Error('DRAFT_SAVE_VERIFY_FAILED');
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Error && error.message.startsWith('SECURE_DRAFT_REF_')
        ? error.message
        : 'DRAFT_SAVE_FAILED'
    };
  }
  return { ok: true, draft: envelope };
}

function removeStoredFormDraft(storage) {
  try {
    const target = getFormDraftStorage(storage);
    target.removeItem(FORM_DRAFT_STORAGE_KEY);
    return target.getItem(FORM_DRAFT_STORAGE_KEY) === null;
  } catch (_) {
    return false;
  }
}

// ============================================================
//  FormDraftManager: dwo_form_draft_v1 の唯一のdraft authority
//  draftRef === mediaOwnerRef を常に維持する。media-storage.js/media.js は
//  このAPI経由でのみ canonical draftRef を取得し、自前でdraftを生成しない。
// ============================================================
function getCurrentDraftRef(storage) {
  const result = readStoredFormDraft(storage);
  return result.status === 'valid' ? result.draft.draftRef : null;
}

// 既存の有効な下書きがあればそのdraftRefを再利用する（保存内容は現在のフォームへ更新する）。
// 下書きが存在しない場合だけ新規作成する。保存済み下書きが不正、またはstorageが使えない場合は
// 新しいdraftへ置き換えず、fail closedで失敗を返す。
function ensureCurrentDraftRef(storage, cryptoApi, now) {
  let target;
  try {
    target = getFormDraftStorage(storage);
  } catch (_) {
    return { ok: false, code: 'STORAGE_UNAVAILABLE' };
  }
  const current = readStoredFormDraft(target);
  if (current.status === 'valid') return { ok: true, draftRef: current.draft.draftRef };
  if (current.status === 'invalid' || current.status === 'storage-error') {
    return { ok: false, code: current.status === 'storage-error' ? 'STORAGE_UNAVAILABLE' : 'FORM_DRAFT_INVALID' };
  }
  const saved = saveFormDraftEnvelope(collectDraftFormData(), target, cryptoApi, now);
  if (!saved.ok) return { ok: false, code: saved.code };
  return { ok: true, draftRef: saved.draft.draftRef };
}

function removeCurrentFormDraft(storage) {
  return removeStoredFormDraft(storage);
}

var FormDraftManager = { getCurrentDraftRef, ensureCurrentDraftRef, removeCurrentFormDraft };
window.FormDraftManager = FormDraftManager;

function collectDraftFormData() {
  const data = collectFormData();
  const insKey = data.insuranceType === 'insurance' ? 'ins' : 'jishi';
  const getActiveToggleValues = group =>
    [...document.querySelectorAll(`.toggle-btn[data-group="${group}"].active`)]
      .map(button => button.dataset.val || button.textContent.trim());
  const businessDaysText = document.getElementById('drBizDays')?.textContent ?? '';
  const businessDaysMatch = businessDaysText.match(/(\d+)\s*営業日/);
  const currentStandardDeliveryDate = typeof stdDeliveryDate === 'string' ? stdDeliveryDate : '';
  const currentBusinessDays = businessDaysMatch ? Number.parseInt(businessDaysMatch[1], 10) : 0;
  const currentExpediteFee = Number.isInteger(window._urgentFee) && window._urgentFee >= 0 ? window._urgentFee : 0;

  return {
    clinicName: data.clinicName,
    doctorName: data.doctorName,
    patientName: data.patientName,
    patientAge: data.patientAge,
    patientGender: data.patientGender,
    issueDate: data.issueDate,
    insuranceType: data.insuranceType,
    orderTypes: [...data.orderTypes],
    repairDetail: data.repairDetail,
    bedType: data.bedType,
    devices: getDraftCheckedValues(data.insuranceType === 'insurance' ? 'device-insurance' : 'device-jishi'),
    claspType: data.claspType,
    claspTypes: getActiveToggleValues(`clasp-${insKey}`),
    barType: data.barType,
    barTypes: getActiveToggleValues(`bar-${insKey}`),
    castBarJaws: { ...data.castBarJaws },
    castBarCounts: { ...data.castBarCounts },
    reinforcementWireCount: data.reinforcementWireCount,
    hasRimount: data.hasRimount,
    rimountJaws: { ...data.rimountJaws },
    rimountCount: data.rimountCount,
    hasMetalup: data.hasMetalup,
    metalupDetail: data.metalupDetail,
    hasKyoko: data.hasKyoko,
    kyokoDetail: data.kyokoDetail,
    toothAnterior: data.toothAnterior,
    toothPosterior: data.toothPosterior,
    shadeGuide: data.shadeGuide,
    shadeNumber: data.shadeNumber,
    taigoha: data.taigoha,
    bite: data.bite,
    goaFlag: data.goaFlag,
    hasArticulator: data.hasArticulator,
    articulatorType: data.articulatorType,
    articulatorDetail: data.articulatorDetail,
    deliveryDate: data.deliveryDate,
    nextAppointment: data.nextAppointment,
    priority: data.priority,
    remarks: data.remarks,
    shippingDate: document.getElementById('shipping-date')?.value ?? '',
    standardDeliveryDate: currentStandardDeliveryDate,
    businessDaysFromShipping: currentBusinessDays,
    expediteFeeYen: currentExpediteFee
  };
}

function setDraftElementValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function setDraftCheckbox(id, checked) {
  const el = document.getElementById(id);
  if (el) el.checked = checked;
}

function getDraftCheckboxLogicalValue(input) {
  if (input.value && input.value !== 'on') return input.value;
  return input.closest?.('.check-item')?.querySelector?.('.check-label')?.textContent?.trim() || '';
}

function getDraftCheckedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
    .map(getDraftCheckboxLogicalValue)
    .filter(Boolean);
}

function restoreDraftCheckboxValues(containerId, values) {
  const allowed = new Set(values);
  document.querySelectorAll(`#${containerId} input[type="checkbox"]`).forEach(input => {
    input.checked = allowed.has(getDraftCheckboxLogicalValue(input));
  });
}

function restoreDraftToggleValue(group, value) {
  const buttons = [...document.querySelectorAll(`.toggle-btn[data-group="${group}"]`)];
  buttons.forEach(button => button.classList.remove('active'));
  if (value === null) return;
  const target = buttons.find(button => (button.dataset.val || button.textContent.trim()) === value);
  if (target) target.classList.add('active');
}

function restoreDraftToggleValues(group, values) {
  const selected = new Set(values);
  document.querySelectorAll(`.toggle-btn[data-group="${group}"]`).forEach(button => {
    const value = button.dataset.val || button.textContent.trim();
    button.classList.toggle('active', selected.has(value));
  });
}

function syncDraftExpandableAreas() {
  const pairs = [
    ['chk-repair','repair-detail-area'],
    ['chk-clasp-ins','clasp-insurance-area'], ['chk-bar-ins','bar-insurance-area'],
    ['chk-kisosho-ins','kisosho-insurance-area'], ['chk-rotei-ins','rotei-insurance-area'],
    ['chk-kyokosen-ins','kyokosen-insurance-area'], ['chk-hoji-ins','hoji-insurance-area'],
    ['chk-metalup-ins','metalup-insurance-area'], ['chk-rimount-ins','rimount-insurance-area'],
    ['chk-kyoko-ins','kyoko-insurance-area'], ['chk-clasp-jishi','clasp-jishi-area'],
    ['chk-bar-jishi','bar-jishi-area'], ['chk-kisosho-jishi','kisosho-jishi-area'],
    ['chk-rotei-jishi','rotei-jishi-area'], ['chk-kyokosen-jishi','kyokosen-jishi-area'],
    ['chk-hoji-jishi','hoji-jishi-area'], ['chk-metalup-jishi','metalup-jishi-area'],
    ['chk-rimount-jishi','rimount-jishi-area'], ['chk-kyoko-jishi','kyoko-jishi-area'],
    ['chk-articulator','articulator-area'], ['chk-shade','shade-area'], ['chk-shade-jishi','shade-jishi-area']
  ];
  pairs.forEach(([checkboxId, areaId]) => {
    const checkbox = document.getElementById(checkboxId);
    const area = document.getElementById(areaId);
    if (checkbox && area) area.classList.toggle('open', checkbox.checked);
  });

  ['shade','shade-jishi'].forEach(group => {
    const area = document.getElementById(group === 'shade' ? 'shade-other-area' : 'shade-jishi-other-area');
    const other = document.querySelector(`.toggle-btn[data-group="${group}"][data-val="other"].active`);
    if (area) area.classList.toggle('open', Boolean(other));
  });
}

function restoreDraftFormToUi(form) {
  if (!validateDraftFormData(form)) return false;

  setInsurance(form.insuranceType, { recalculate: false });

  const values = {
    'clinic-name': form.clinicName,
    'doctor-name': form.doctorName,
    'patient-name': form.patientName,
    'patient-age': form.patientAge,
    'patient-gender': form.patientGender,
    'issue-date': form.issueDate,
    'repair-detail': form.repairDetail,
    'articulator-type': form.articulatorType,
    'articulator-detail': form.articulatorDetail,
    'delivery-date': form.deliveryDate,
    'next-appointment': form.nextAppointment,
    'remarks': form.remarks,
    'shipping-date': form.shippingDate
  };
  Object.entries(values).forEach(([id, value]) => setDraftElementValue(id, value));

  restoreDraftCheckboxValues('order-type-group', form.orderTypes);
  restoreDraftCheckboxValues('device-insurance', []);
  restoreDraftCheckboxValues('device-jishi', []);
  restoreDraftCheckboxValues(form.insuranceType === 'insurance' ? 'device-insurance' : 'device-jishi', form.devices);

  const insKey = form.insuranceType === 'insurance' ? 'ins' : 'jishi';
  const bedGroup = form.insuranceType === 'insurance' ? 'bed-insurance' : 'bed-jishi';
  restoreDraftToggleValue(bedGroup, form.bedType);
  restoreDraftToggleValues(`clasp-${insKey}`, form.claspTypes);
  restoreDraftToggleValues(`bar-${insKey}`, form.barTypes);
  restoreDraftToggleValue(`tooth-ant-${insKey}`, form.toothAnterior);
  restoreDraftToggleValue(`tooth-post-${insKey}`, form.toothPosterior);

  setDraftElementValue(`cast-bar-upper-count-${insKey}`, String(form.castBarCounts.upper));
  setDraftElementValue(`cast-bar-lower-count-${insKey}`, String(form.castBarCounts.lower));
  setDraftCheckbox(`chk-kyokosen-${insKey}`, form.reinforcementWireCount > 0);
  setDraftElementValue(`kyokosen-${insKey}`, form.reinforcementWireCount > 0 ? String(form.reinforcementWireCount) : '1');

  setDraftCheckbox(`chk-rimount-${insKey}`, form.hasRimount);
  const rimountArea = document.getElementById(`rimount-${form.insuranceType === 'insurance' ? 'insurance' : 'jishi'}-area`);
  const rimountUpper = rimountArea?.querySelector('input[value="リマウント上"]');
  const rimountLower = rimountArea?.querySelector('input[value="リマウント下"]');
  if (rimountUpper) rimountUpper.checked = form.rimountJaws.upper;
  if (rimountLower) rimountLower.checked = form.rimountJaws.lower;

  setDraftCheckbox(`chk-metalup-${insKey}`, form.hasMetalup);
  setDraftElementValue(`metalup-${insKey}-detail`, form.metalupDetail);
  setDraftCheckbox(`chk-kyoko-${insKey}`, form.hasKyoko);
  setDraftElementValue(`kyoko-${insKey}-detail`, form.kyokoDetail);

  const shadeGroup = form.insuranceType === 'insurance' ? 'shade' : 'shade-jishi';
  const shadeCheckbox = form.insuranceType === 'insurance' ? 'chk-shade' : 'chk-shade-jishi';
  const shadeButtons = [...document.querySelectorAll(`.toggle-btn[data-group="${shadeGroup}"]`)];
  const matchingShade = shadeButtons.find(button =>
    button.dataset.val !== 'other' && (button.dataset.val || button.textContent.trim()) === form.shadeGuide
  );
  const hasShade = Boolean(form.shadeGuide || form.shadeNumber);
  setDraftCheckbox(shadeCheckbox, hasShade);
  shadeButtons.forEach(button => button.classList.remove('active'));
  if (hasShade) {
    if (matchingShade && !form.shadeNumber) matchingShade.classList.add('active');
    else {
      const other = shadeButtons.find(button => button.dataset.val === 'other');
      if (other) other.classList.add('active');
    }
  }
  setDraftElementValue('shade-guide', matchingShade && !form.shadeNumber ? '' : form.shadeGuide);
  setDraftElementValue('shade-number', matchingShade && !form.shadeNumber ? '' : form.shadeNumber);

  setDraftCheckbox('chk-taigoha', form.taigoha);
  setDraftCheckbox('chk-bite', form.bite);
  setDraftCheckbox('chk-goa-opt', form.goaFlag);
  setDraftCheckbox('chk-articulator', form.hasArticulator);

  state.priority = form.priority;
  document.querySelectorAll('.priority-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.val === form.priority);
  });

  syncNextAppointmentFromValue();
  syncDraftExpandableAreas();
  return true;
}

function saveCurrentFormDraft() {
  const result = saveFormDraftEnvelope(collectDraftFormData());
  if (!result.ok) {
    showToast('下書きを保存できませんでした。入力内容はそのまま残しています。', 'error');
    return false;
  }
  showToast('下書きをこの端末に保存しました');
  return true;
}

// draftRef（== mediaOwnerRef）配下の添付をReferenceMediaManagerで先に破棄してから
// 下書き自体を削除する。添付の掃除が完了できない場合は、下書きも現在の入力もそのまま残す。
async function discardCurrentFormDraft() {
  const draftRef = getCurrentDraftRef();
  if (draftRef && typeof ReferenceMediaManager !== 'undefined' && typeof ReferenceMediaManager.discardCurrentDraft === 'function') {
    try {
      await ReferenceMediaManager.discardCurrentDraft(draftRef);
    } catch (_) {
      showToast('添付を削除できなかったため、下書きを保持しました。入力内容はそのまま残しています。', 'error');
      return false;
    }
  }
  if (!removeStoredFormDraft()) {
    showToast('下書きを削除できませんでした。入力内容はそのまま残しています。', 'error');
    return false;
  }
  if (typeof resetForm === 'function') resetForm();
  showToast('下書きを破棄しました');
  return true;
}

async function restoreDraftCalendarState(form) {
  if (!form.shippingDate) return true;
  if (typeof fetchHolidays !== 'function' ||
      typeof getStdDays !== 'function' ||
      typeof addBizDays !== 'function' ||
      typeof renderVcal !== 'function' ||
      typeof applyDelivery !== 'function') return true;

  shippingDateGlobal = form.shippingDate;
  nextApDateGlobal = form.nextAppointment ? form.nextAppointment.slice(0, 10) : null;

  const holidays = await fetchHolidays();
  stdDeliveryDate = addBizDays(shippingDateGlobal, getStdDays(), holidays);
  selectedDeliveryDate = form.deliveryDate || stdDeliveryDate;

  const calendarDate = new Date(selectedDeliveryDate + 'T00:00:00');
  vcalYear = calendarDate.getFullYear();
  vcalMonth = calendarDate.getMonth();

  const wrap = document.getElementById('vcalWrap');
  if (wrap) wrap.style.display = 'block';
  await renderVcal();
  await applyDelivery(selectedDeliveryDate, holidays);
  return true;
}

async function restoreFormDraftOnStartup(storage) {
  const result = readStoredFormDraft(storage);
  if (result.status === 'empty') return false;
  if (result.status !== 'valid' || !restoreDraftFormToUi(result.draft.form)) {
    showToast('保存済み下書きを復元できませんでした。現在の入力には反映していません。', 'error');
    return false;
  }

  try {
    await restoreDraftCalendarState(result.draft.form);
  } catch (_) {
    showToast('下書きは復元しましたが、納期表示の再計算に失敗しました。発送日を再選択してください。', 'error');
    return false;
  }

  showToast('保存済み下書きを復元しました');
  return true;
}

window.addEventListener('DOMContentLoaded', () => {
  restoreFormDraftOnStartup();
});

document.getElementById('draft-save-btn')?.addEventListener('click', saveCurrentFormDraft);
document.getElementById('draft-discard-btn')?.addEventListener('click', discardCurrentFormDraft);

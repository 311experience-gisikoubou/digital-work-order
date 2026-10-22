/* Synthetic sample for opt-in iPad real-device preview only. No patient data, no persistence. */
(function () {
  'use strict';

  const sampleParam = new URLSearchParams(window.location.search).get('sample') === '1';
  const hostname = window.location.hostname.toLowerCase();
  const previewOnly = hostname === 'localhost' ||
    hostname === '127.0.0.1' || hostname.endsWith('.trycloudflare.com');
  if (!previewOnly) return;

  const TEST_ORDER_TYPE = '完成';
  const TEST_BED_TYPE = 'レジン床';
  const STORAGE_KEYS_TO_PROTECT = [
    'dwo_form_draft_v1', 'dwo_drawing_v1', 'dwo_clasp_v1'
  ];
  function notify(message, isError) {
    if (typeof showToast === 'function') showToast(message, isError ? 'error' : 'success');
  }
  function dateAfter(days) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
  }

  function isAutomaticEmptyDraft(raw) {
    // The existing media manager legitimately creates a *blank* draft envelope
    // on a pristine page load. Treat only its exact known defaults as empty.
    let envelope;
    try { envelope = JSON.parse(raw); } catch (_) { return false; }
    if (!envelope || envelope.schemaVersion !== 'dwo-form-draft-v1' ||
        typeof envelope.draftRef !== 'string' ||
        envelope.mediaOwnerRef !== envelope.draftRef) return false;
    if (!envelope.visualSnapshot || typeof envelope.visualSnapshot !== 'object' ||
        Object.keys(envelope.visualSnapshot).length !== 0) return false;
    const form = envelope.form;
    if (!form || typeof form !== 'object' || Array.isArray(form)) return false;
    const baseline = {
      clinicName:'',doctorName:'',patientName:'',patientAge:'',patientGender:'',
      insuranceType:'insurance',orderTypes:[],repairDetail:'',
      bedType:null,devices:[],claspType:null,claspTypes:[],
      barType:null,barTypes:[],castBarJaws:{upper:false,lower:false},
      castBarCounts:{upper:0,lower:0},reinforcementWireCount:0,
      hasRimount:false,rimountJaws:{upper:false,lower:false},rimountCount:0,
      hasMetalup:false,metalupDetail:'',hasKyoko:false,kyokoDetail:'',
      toothAnterior:null,toothPosterior:null,shadeGuide:'',shadeNumber:'',
      taigoha:false,bite:false,goaFlag:false,hasArticulator:false,
      articulatorType:'',articulatorDetail:'',nextAppointment:'',
      priority:'normal',remarks:'',shippingDate:'',
      standardDeliveryDate:'',businessDaysFromShipping:0,expediteFeeYen:0
    };
    const expectedFields = [...Object.keys(baseline),'issueDate','deliveryDate'].sort();
    if (JSON.stringify(Object.keys(form).sort()) !== JSON.stringify(expectedFields)) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.issueDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(form.deliveryDate)) return false;
    return Object.entries(baseline).every(([key,value]) =>
      JSON.stringify(form[key]) === JSON.stringify(value)
    );
  }

  function detectExistingWork() {
    try {
      if (STORAGE_KEYS_TO_PROTECT.slice(1).some(key => localStorage.getItem(key) !== null)) {
        return true;
      }
      const savedDraft = localStorage.getItem(STORAGE_KEYS_TO_PROTECT[0]);
      if (savedDraft !== null && !isAutomaticEmptyDraft(savedDraft)) return true;
    } catch (_) {
      return true; // Cannot prove safety without checking local state.
    }
    if (typeof state !== 'undefined' && Array.isArray(state.orders) && state.orders.length) return true;
    if (document.querySelector('#media-attachments .media-item')) return true;
    return ['clinic-name', 'doctor-name', 'patient-name'].some(id => {
      const input = document.getElementById(id);
      return Boolean(input && input.value.trim());
    });
  }

  async function fillSyntheticSample() {
    if (document.documentElement.dataset.syntheticSample === 'filled') {
      return {ok:true, reason:'already-filled'};
    }
    if (detectExistingWork()) {
      notify('保存済みの入力・手書きを保護したため、架空データは上書きしませんでした。', true);
      return {ok:false, reason:'existing-data-protected'};
    }

    const required = [
      'clinic-name','doctor-name','patient-name','patient-age','patient-gender',
      'issue-date','next-appointment-date','next-appointment-time','shipping-date','remarks'
    ];
    if (required.some(id => !document.getElementById(id))) {
      return {ok:false,reason:'missing-fields'};
    }

    const order = [...document.querySelectorAll('#order-type-group input[type="checkbox"]')]
      .find(input => input.value === TEST_ORDER_TYPE);
    const bed = [...document.querySelectorAll('#bed-insurance .toggle-btn')]
      .find(button => button.dataset.val === TEST_BED_TYPE);
    const goa = document.querySelector('#device-insurance input[value="GoA"]');
    const upper = document.querySelector('#jaw-upper .tooth[data-num="16"]');
    const lower = document.querySelector('#jaw-lower .tooth[data-num="46"]');
    if (!order || !bed || !goa || !upper || !lower ||
        typeof onShippingDateChange !== 'function' ||
        typeof syncNextAppointmentParts !== 'function' ||
        typeof collectFormData !== 'function') {
      return {ok:false,reason:'required-controls-missing'};
    }

    function set(id, value) { document.getElementById(id).value = value; }

    set('clinic-name','【テスト】こよし歯科医院');
    set('doctor-name','テスト 歯科医師');
    set('patient-name','【架空】山田 花子');
    set('patient-age','65');
    set('patient-gender','female');
    set('issue-date',dateAfter(0));
    set('next-appointment-date',dateAfter(21));
    set('next-appointment-time','10:00');
    set('shipping-date',dateAfter(1));
    set('remarks','【架空データ／動作確認専用】上顎16・下顎46を欠損として選択。義歯の完成指示を想定したテストケースです。実際の患者情報ではありません。');

    order.checked = true;
    order.dispatchEvent(new Event('change',{bubbles:true}));
    bed.click();
    goa.checked = true;
    goa.dispatchEvent(new Event('change',{bubbles:true}));

    const missing = document.querySelector('.mode-btn[data-mode="missing"]');
    if (missing) missing.click();
    upper.click();
    lower.click();

    await syncNextAppointmentParts();
    // Exercise the existing delivery calculation. Do not leave its large
    // calendar expanded automatically, because the approved layout is fixed.
    try {
      await onShippingDateChange();
    } catch (_) {
      notify('架空データは入力しました。納期の計算結果は確認してください。', true);
    } finally {
      const calendar = document.getElementById('vcalWrap');
      if (calendar) calendar.style.display = 'none';
    }

    // Important: no save calls. User decides whether to save or issue.
    document.documentElement.dataset.syntheticSample = 'filled';
    notify('架空の指示書データを入力しました。保存・発行はまだしていません。');
    return {ok:true,reason:'filled'};
  }

  function init() {
    const actionArea = document.querySelector('#approved-full-form .approved-optional-actions');
    if (actionArea) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-secondary';
      button.id = 'synthetic-sample-fill';
      button.textContent = '架空データを入力';
      button.addEventListener('click', () => { void fillSyntheticSample(); });
      actionArea.append(button);
    }
    // Existing draft and media initialization may finish after DOMContentLoaded.
    // Populate only after their startup restoration has settled.
    const standalone = window.navigator.standalone === true ||
      Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (sampleParam || standalone) window.setTimeout(() => { void fillSyntheticSample(); }, 900);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();

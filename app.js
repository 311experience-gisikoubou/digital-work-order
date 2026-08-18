// ============================================================
//  アプリ状態管理
// ============================================================
const state = {
  selectedTeeth: new Set(),
  insuranceType: 'insurance',   // 'insurance' | 'jishi'
  priority: 'normal',
  orders: []  // Firebaseから取得予定
};

// ============================================================
//  タブ切り替え
// ============================================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'lab') renderOrders();
  });
});

// ============================================================
//  保険 / 自費 切り替え
// ============================================================
document.getElementById('btn-insurance').addEventListener('click', () => setInsurance('insurance'));
document.getElementById('btn-jishi').addEventListener('click', () => setInsurance('jishi'));

function setInsurance(type, options) {
  const nextType = type === 'jishi' ? 'jishi' : 'insurance';
  const shouldRecalculate = !options || options.recalculate !== false;

  state.insuranceType = nextType;
  syncInsuranceUI();

  if (shouldRecalculate && typeof onShippingDateChange === 'function') {
    onShippingDateChange();
  }
}

function syncInsuranceUI() {
  const isInsurance = state.insuranceType === 'insurance';
  document.getElementById('btn-insurance').classList.toggle('active', isInsurance);
  document.getElementById('btn-jishi').classList.toggle('active', !isInsurance);
  document.getElementById('prosthetics-insurance').style.display = isInsurance ? '' : 'none';
  document.getElementById('prosthetics-jishi').style.display = isInsurance ? 'none' : '';

  const insuranceLabel = document.getElementById('ds-insurance-label');
  const jishiLabel = document.getElementById('ds-jishi-label');
  if (insuranceLabel) insuranceLabel.style.display = isInsurance ? '' : 'none';
  if (jishiLabel) jishiLabel.style.display = isInsurance ? 'none' : '';
}

syncInsuranceUI();

// ============================================================
//  トグルボタン（single / multi 両対応）
// ============================================================
document.addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !btn.dataset.group) return;
  if (btn.classList.contains('multi')) {
    // 複数選択可：トグル
    btn.classList.toggle('active');
  } else {
    // 単一選択：同グループを解除してアクティブ
    const group = btn.dataset.group;
    document.querySelectorAll(`.toggle-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
});

// ============================================================
//  展開エリア制御（汎用）
// ============================================================
function bindExpand(checkboxId, areaId) {
  const chk = document.getElementById(checkboxId);
  if (!chk) return;
  chk.addEventListener('change', () => {
    document.getElementById(areaId).classList.toggle('open', chk.checked);
  });
}

bindExpand('chk-repair',         'repair-detail-area');
bindExpand('chk-clasp-ins',      'clasp-insurance-area');
bindExpand('chk-bar-ins',        'bar-insurance-area');
bindExpand('chk-kisosho-ins',    'kisosho-insurance-area');
bindExpand('chk-rotei-ins',      'rotei-insurance-area');
bindExpand('chk-kyokosen-ins',   'kyokosen-insurance-area');
bindExpand('chk-hoji-ins',       'hoji-insurance-area');
bindExpand('chk-metalup-ins',    'metalup-insurance-area');
bindExpand('chk-rimount-ins',    'rimount-insurance-area');
bindExpand('chk-kyoko-ins',      'kyoko-insurance-area');
bindExpand('chk-clasp-jishi',    'clasp-jishi-area');
bindExpand('chk-bar-jishi',      'bar-jishi-area');
bindExpand('chk-kisosho-jishi',  'kisosho-jishi-area');
bindExpand('chk-rotei-jishi',    'rotei-jishi-area');
bindExpand('chk-kyokosen-jishi', 'kyokosen-jishi-area');
bindExpand('chk-hoji-jishi',     'hoji-jishi-area');
bindExpand('chk-metalup-jishi',  'metalup-jishi-area');
bindExpand('chk-rimount-jishi',  'rimount-jishi-area');
bindExpand('chk-kyoko-jishi',    'kyoko-jishi-area');
bindExpand('chk-articulator',    'articulator-area');
bindExpand('chk-shade',          'shade-area');
bindExpand('chk-shade-jishi',    'shade-jishi-area');

// シェード「その他」ボタンで自由入力を展開（保険）
document.querySelectorAll('.toggle-btn[data-group="shade"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// シェード「その他」ボタンで自由入力を展開（自費）
document.querySelectorAll('.toggle-btn[data-group="shade-jishi"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-jishi-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// ============================================================
//  優先度トグル
// ============================================================
document.querySelectorAll('.priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.priority = btn.dataset.val;
    document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ============================================================
//  次回予約日時（15分刻み）
// ============================================================
function buildNextAppointmentTimeOptions(selectedTime) {
  const timeEl = document.getElementById('next-appointment-time');
  if (!timeEl) return;

  const keepTime = selectedTime && !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(selectedTime)
    ? selectedTime
    : '';
  timeEl.textContent = '';

  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '時刻を選択';
  timeEl.appendChild(empty);

  for (let h = 0; h < 24; h += 1) {
    ['00', '15', '30', '45'].forEach(min => {
      const value = String(h).padStart(2, '0') + ':' + min;
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      timeEl.appendChild(opt);
    });
  }

  if (keepTime) {
    const opt = document.createElement('option');
    opt.value = keepTime;
    opt.textContent = keepTime + '（既存値）';
    timeEl.appendChild(opt);
  }

  if (selectedTime) timeEl.value = selectedTime;
}

function syncNextAppointmentFromValue() {
  const hidden = document.getElementById('next-appointment');
  const dateEl = document.getElementById('next-appointment-date');
  if (!hidden || !dateEl) return;
  const parts = hidden.value ? hidden.value.split('T') : [];
  const dateValue = parts[0] || '';
  const timeValue = parts[1] ? parts[1].slice(0, 5) : '';
  dateEl.value = dateValue;
  buildNextAppointmentTimeOptions(timeValue);
}

function updateNextAppointmentValue() {
  const hidden = document.getElementById('next-appointment');
  const dateEl = document.getElementById('next-appointment-date');
  const timeEl = document.getElementById('next-appointment-time');
  if (!hidden || !dateEl || !timeEl) return;
  hidden.value = dateEl.value && timeEl.value ? dateEl.value + 'T' + timeEl.value : '';
}

async function syncNextAppointmentParts() {
  updateNextAppointmentValue();
  const dateEl = document.getElementById('next-appointment-date');
  if (typeof nextApDateGlobal !== 'undefined') {
    nextApDateGlobal = dateEl && dateEl.value ? dateEl.value : null;
  }
  if (typeof shippingDateGlobal !== 'undefined' && shippingDateGlobal && typeof renderVcal === 'function') {
    await renderVcal();
    if (typeof selectedDeliveryDate !== 'undefined' && selectedDeliveryDate && typeof fetchHolidays === 'function' && typeof applyDelivery === 'function') {
      const hols = await fetchHolidays();
      await applyDelivery(selectedDeliveryDate, hols);
    }
  } else if (typeof onNextApChange === 'function') {
    await onNextApChange();
  }
}

// ============================================================
//  フォームデータ収集
// ============================================================
function collectFormData() {
  const ins = state.insuranceType;
  const insKey = ins === 'insurance' ? 'ins' : 'jishi';

  // チェックボックスグループ
  function getChecked(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
      .map(c => c.value);
  }

  // トグルボタン（単一選択）
  function getToggleVal(group) {
    const el = document.querySelector(`.toggle-btn[data-group="${group}"].active`);
    return el ? (el.dataset.val || el.textContent.trim()) : null;
  }

  // 発注形態
  const orderTypes = [...document.querySelectorAll('#order-type-group input:checked')].map(c => c.value);

  // 補綴物・装置
  const deviceGroup = ins === 'insurance' ? 'device-insurance' : 'device-jishi';
  const devices = getChecked(deviceGroup);

  // クラスプ
  const claspType = ins === 'insurance' ? getToggleVal('clasp-ins') : getToggleVal('clasp-jishi');

  // バー
  const barType = ins === 'insurance' ? getToggleVal('bar-ins') : getToggleVal('bar-jishi');
  const castBarSelected = [...document.querySelectorAll(`.toggle-btn[data-group="bar-${insKey}"].active`)]
    .some(el => ['鋳造バー', 'キャストバー'].includes(el.dataset.val || el.textContent.trim()));
  const castBarJaws = {
    upper: castBarSelected && document.getElementById(`chk-cast-bar-upper-${insKey}`).checked,
    lower: castBarSelected && document.getElementById(`chk-cast-bar-lower-${insKey}`).checked
  };
  const reinforcementWireCount = document.getElementById(`chk-kyokosen-${insKey}`).checked
    ? Number.parseInt(document.getElementById(`kyokosen-${insKey}`).value, 10) || 1
    : 0;

  // 人工歯
  const toothAnt  = ins === 'insurance' ? getToggleVal('tooth-ant-ins')  : getToggleVal('tooth-ant-jishi');
  const toothPost = ins === 'insurance' ? getToggleVal('tooth-post-ins') : getToggleVal('tooth-post-jishi');

  // 色調（トグルボタン選択値を優先、「その他」または未選択時はテキスト入力を使用）
  const shadeSel = ins === 'insurance' ? getToggleVal('shade') : getToggleVal('shade-jishi');

  const memoSnapshot = (typeof memoStrokes !== 'undefined' && Array.isArray(memoStrokes))
    ? JSON.parse(JSON.stringify(memoStrokes))
    : [];

  return {
    // 患者・医院情報
    clinicName:   document.getElementById('clinic-name').value.trim(),
    doctorName:   document.getElementById('doctor-name').value.trim(),
    patientName:  document.getElementById('patient-name').value.trim(),
    patientAge:   document.getElementById('patient-age').value,
    patientGender:document.getElementById('patient-gender').value,
    issueDate:    document.getElementById('issue-date').value || new Date().toISOString().slice(0,10),

    // 歯式
    selectedTeeth: [...state.selectedTeeth].sort((a,b)=>a-b),

    // 区分
    insuranceType: ins,

    // 発注形態
    orderTypes,
    repairDetail: document.getElementById('repair-detail').value,

    // 補綴物
    bedType:      getToggleVal(ins === 'insurance' ? 'bed-insurance' : 'bed-jishi'),
    devices,
    claspType,
    barType,
    castBarJaws,
    reinforcementWireCount,
    hasRimount: document.getElementById(`chk-rimount-${insKey}`).checked,

    // メタルアップ
    hasMetalup:   document.getElementById(`chk-metalup-${insKey}`).checked,
    metalupDetail:document.getElementById(`metalup-${insKey}-detail`)?.value ?? '',

    // 補強床
    hasKyoko:     document.getElementById(`chk-kyoko-${insKey}`).checked,
    kyokoDetail:  document.getElementById(`kyoko-${insKey}-detail`).value,

    // 人工歯
    toothAnterior:  toothAnt,
    toothPosterior: toothPost,

    // 色調（トグル選択値を優先、「その他」または未選択はテキスト入力を使用）
    shadeGuide:   (shadeSel && shadeSel !== 'other')
      ? shadeSel
      : (document.getElementById('shade-guide')?.value ?? ''),
    shadeNumber:  (shadeSel && shadeSel !== 'other')
      ? ''
      : (document.getElementById('shade-number')?.value ?? ''),

    // オプション（対合歯・バイト・GoA）
    taigoha:      document.getElementById('chk-taigoha')?.checked ?? false,
    bite:         document.getElementById('chk-bite')?.checked ?? false,
    goaFlag:      document.getElementById('chk-goa-opt')?.checked ?? false,
    hasArticulator: document.getElementById('chk-articulator').checked,
    articulatorType:  document.getElementById('articulator-type').value,
    articulatorDetail:document.getElementById('articulator-detail').value,

    // 納期
    deliveryDate:    document.getElementById('delivery-date').value,
    nextAppointment: (updateNextAppointmentValue(), document.getElementById('next-appointment').value),
    priority:        state.priority,
    remarks:      document.getElementById('remarks').value,
    memoStrokes:  memoSnapshot,

    // メタデータ
    status:       'pending',   // 未受付
    createdAt:    new Date().toISOString(),
    id:           'local_' + Date.now()
  };
}


// ============================================================
//  送信処理
// ============================================================
document.getElementById('submit-btn').addEventListener('click', async () => {
  const data = collectFormData();
  const errors = validate(data);

  if (errors.length > 0) {
    showToast(`入力必須項目: ${errors.join('、')}`, 'error');
    return;
  }

  // TODO: Firebase Firestore への保存
  // try {
  //   const docRef = await addDoc(collection(window.db, 'orders'), data);
  //   console.log('Saved:', docRef.id);
  // } catch(e) {
  //   showToast('送信に失敗しました', 'error');
  //   return;
  // }

  // 暫定：ローカル保存
  state.orders.unshift(data);
  showToast('✅ 指示書を送信しました');
  resetForm();
});

function resetForm() {
  // テキスト入力リセット
  ['clinic-name','doctor-name','patient-name','patient-age','patient-gender',
   'shade-guide','shade-number','delivery-date','next-appointment','next-appointment-date','next-appointment-time','remarks',
   'repair-detail','metalup-ins-detail','kyoko-ins-detail',
   'metalup-jishi-detail','kyoko-jishi-detail',
   'articulator-type','articulator-detail'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // 歯式リセット
  state.selectedTeeth.clear();
  document.querySelectorAll('.tooth.selected').forEach(t => t.classList.remove('selected'));
  updateTeethDisplay();

  // チェックボックスリセット
  document.querySelectorAll('input[type="checkbox"]:checked').forEach(c => { c.checked = false; });

  // 展開エリアリセット
  document.querySelectorAll('.expandable.open').forEach(a => a.classList.remove('open'));

  // トグル・ボタンリセット
  document.querySelectorAll('.toggle-btn.active').forEach(b => b.classList.remove('active'));
  buildNextAppointmentTimeOptions('');
}

// ============================================================
//  日付初期値セット
// ============================================================
function initDates() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('issue-date').value = today;
  // 納期デフォルト：7日後
  const next = new Date(); next.setDate(next.getDate() + 7);
  document.getElementById('delivery-date').value = next.toISOString().slice(0,10);
}

// ============================================================
//  初期化
// ============================================================
initDates();
syncNextAppointmentFromValue();

// ============================================================
//  Firebase（本番接続 — 設定後アンコメント）
// ============================================================
/*
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, orderBy, query }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// リアルタイム受信（技工所側）
const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
onSnapshot(q, snapshot => {
  state.orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
});

// 送信時の保存（上記 submit-btn の addDoc コメントをアンコメント）
*/

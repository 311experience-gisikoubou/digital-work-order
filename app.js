// ============================================================
//  アプリ状態管理
// ============================================================
const state = {
  selectedTeeth: new Set(),
  insuranceType: 'insurance',   // 'insurance' | 'jishi'
  ampm: 'AM',
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

function setInsurance(type) {
  state.insuranceType = type;
  document.getElementById('btn-insurance').classList.toggle('active', type === 'insurance');
  document.getElementById('btn-jishi').classList.toggle('active', type === 'jishi');
  document.getElementById('prosthetics-insurance').style.display = type === 'insurance' ? '' : 'none';
  document.getElementById('prosthetics-jishi').style.display = type === 'jishi' ? '' : 'none';
}

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
//  AM/PM トグル
// ============================================================
document.querySelectorAll('.ampm-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ampm = btn.dataset.val;
    document.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
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

  // 人工歯
  const toothAnt  = ins === 'insurance' ? getToggleVal('tooth-ant-ins')  : getToggleVal('tooth-ant-jishi');
  const toothPost = ins === 'insurance' ? getToggleVal('tooth-post-ins') : getToggleVal('tooth-post-jishi');

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

    // メタルアップ
    hasMetalup:   document.getElementById(`chk-metalup-${insKey}`).checked,
    metalupDetail:document.getElementById(`metalup-${insKey}-detail`)?.value ?? '',

    // 補強床
    hasKyoko:     document.getElementById(`chk-kyoko-${insKey}`).checked,
    kyokoDetail:  document.getElementById(`kyoko-${insKey}-detail`).value,

    // 人工歯
    toothAnterior:  toothAnt,
    toothPosterior: toothPost,

    // 色調
    shadeGuide:   document.getElementById('shade-guide')?.value ?? '',
    shadeNumber:  document.getElementById('shade-number')?.value ?? '',

    // オプション
    goaFlag:      getToggleVal('goa'),
    hasArticulator: document.getElementById('chk-articulator').checked,
    articulatorType:  document.getElementById('articulator-type').value,
    articulatorDetail:document.getElementById('articulator-detail').value,

    // 納期
    deliveryDate: document.getElementById('delivery-date').value,
    ampm:         state.ampm,
    priority:     state.priority,
    remarks:      document.getElementById('remarks').value,

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
   'shade-guide','shade-number','delivery-date','remarks',
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

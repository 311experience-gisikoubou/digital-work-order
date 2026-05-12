// ============================================================
//  ã¢ããªç¶æ
ç®¡ç
// ============================================================
const state = {
  selectedTeeth: new Set(),
  insuranceType: 'insurance',   // 'insurance' | 'jishi'
  ampm: 'AM',
  priority: 'normal',
  orders: []  // Firebaseããåå¾äºå®
};

// ============================================================
//  ã¿ãåãæ¿ã
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
//  ä¿éº / èªè²» åãæ¿ã
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
//  ãã°ã«ãã¿ã³ï¼single / multi ä¸¡å¯¾å¿ï¼
// ============================================================
document.addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !btn.dataset.group) return;
  if (btn.classList.contains('multi')) {
    // è¤æ°é¸æå¯ï¼ãã°ã«
    btn.classList.toggle('active');
  } else {
    // åä¸é¸æï¼åã°ã«ã¼ããè§£é¤ãã¦ã¢ã¯ãã£ã
    const group = btn.dataset.group;
    document.querySelectorAll(`.toggle-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
});

// ============================================================
//  å±éã¨ãªã¢å¶å¾¡ï¼æ±ç¨ï¼
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

// ã·ã§ã¼ãããã®ä»ããã¿ã³ã§èªç±å
¥åãå±éï¼ä¿éºï¼
document.querySelectorAll('.toggle-btn[data-group="shade"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// ã·ã§ã¼ãããã®ä»ããã¿ã³ã§èªç±å
¥åãå±éï¼èªè²»ï¼
document.querySelectorAll('.toggle-btn[data-group="shade-jishi"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-jishi-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// ============================================================
//  AM/PM ãã°ã«
// ============================================================
document.querySelectorAll('.ampm-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ampm = btn.dataset.val;
    document.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ============================================================
//  åªå
åº¦ãã°ã«
// ============================================================
document.querySelectorAll('.priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.priority = btn.dataset.val;
    document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ============================================================
//  ãã©ã¼ã ãã¼ã¿åé
// ============================================================
function collectFormData() {
  const ins = state.insuranceType;

  // ãã§ãã¯ããã¯ã¹ã°ã«ã¼ã
  function getChecked(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
      .map(c => c.value);
  }

  // ãã°ã«ãã¿ã³ï¼åä¸é¸æï¼
  function getToggleVal(group) {
    const el = document.querySelector(`.toggle-btn[data-group="${group}"].active`);
    return el ? (el.dataset.val || el.textContent.trim()) : null;
  }

  // çºæ³¨å½¢æ

  const orderTypes = [...document.querySelectorAll('#order-type-group input:checked')].map(c => c.value);

  // è£ç¶´ç©ã»è£
ç½®
  const deviceGroup = ins === 'insurance' ? 'device-insurance' : 'device-jishi';
  const devices = getChecked(deviceGroup);

  // ã¯ã©ã¹ã
  const claspType = ins === 'insurance' ? getToggleVal('clasp-ins') : getToggleVal('clasp-jishi');

  // ãã¼
  const barType = ins === 'insurance' ? getToggleVal('bar-ins') : getToggleVal('bar-jishi');

  // äººå·¥æ­¯
  const toothAnt  = ins === 'insurance' ? getToggleVal('tooth-ant-ins')  : getToggleVal('tooth-ant-jishi');
  const toothPost = ins === 'insurance' ? getToggleVal('tooth-post-ins') : getToggleVal('tooth-post-jishi');

  return {
    // æ£è
ã»å»é¢æ
å ±
    clinicName:   document.getElementById('clinic-name').value.trim(),
    doctorName:   document.getElementById('doctor-name').value.trim(),
    patientName:  document.getElementById('patient-name').value.trim(),
    patientAge:   document.getElementById('patient-age').value,
    patientGender:document.getElementById('patient-gender').value,
    issueDate:    document.getElementById('issue-date').value || new Date().toISOString().slice(0,10),

    // æ­¯å¼
    selectedTeeth: [...state.selectedTeeth].sort((a,b)=>a-b),

    // åºå
    insuranceType: ins,

    // çºæ³¨å½¢æ

    orderTypes,
    repairDetail: document.getElementById('repair-detail').value,

    // è£ç¶´ç©
    bedType:      getToggleVal(ins === 'insurance' ? 'bed-insurance' : 'bed-jishi'),
    devices,
    claspType,
    barType,

    // ã¡ã¿ã«ã¢ãã
    hasMetalup:   document.getElementById(`chk-metalup-${ins}`).checked,
    metalupDetail:document.getElementById(`metalup-${ins}-detail`).value,

    // è£å¼·åº
    hasKyoko:     document.getElementById(`chk-kyoko-${ins}`).checked,
    kyokoDetail:  document.getElementById(`kyoko-${ins}-detail`).value,

    // äººå·¥æ­¯
    toothAnterior:  toothAnt,
    toothPosterior: toothPost,

    // è²èª¿
    shadeGuide:   document.getElementById('shade-guide').value,
    shadeNumber:  document.getElementById('shade-number').value,

    // ãªãã·ã§ã³
    goaFlag:      getToggleVal('goa'),
    hasArticulator: document.getElementById('chk-articulator').checked,
    articulatorType:  document.getElementById('articulator-type').value,
    articulatorDetail:document.getElementById('articulator-detail').value,

    // ç´æ
    deliveryDate: document.getElementById('delivery-date').value,
    ampm:         state.ampm,
    priority:     state.priority,
    remarks:      document.getElementById('remarks').value,

    // ã¡ã¿ãã¼ã¿
    status:       'pending',   // æªåä»
    createdAt:    new Date().toISOString(),
    id:           'local_' + Date.now()
  };
}

// ============================================================
//  ããªãã¼ã·ã§ã³
// ============================================================
function validate(data) {
  const errors = [];
  if (!data.clinicName)   errors.push('æ­¯ç§å»é¢å');
  if (!data.doctorName)   errors.push('æ
å½æ­¯ç§å»å¸«');
  if (!data.patientName)  errors.push('æ£è
å');

  if (!data.deliveryDate) errors.push('ç´æ');
  return errors;
}

// ============================================================
//  éä¿¡å¦ç
// ============================================================
document.getElementById('submit-btn').addEventListener('click', async () => {
  const data = collectFormData();
  const errors = validate(data);

  if (errors.length > 0) {
    showToast(`å
¥åå¿
é é 
ç®: ${errors.join('ã')}`, 'error');
    return;
  }

  // TODO: Firebase Firestore ã¸ã®ä¿å­
  // try {
  //   const docRef = await addDoc(collection(window.db, 'orders'), data);
  //   console.log('Saved:', docRef.id);
  // } catch(e) {
  //   showToast('éä¿¡ã«å¤±æãã¾ãã', 'error');
  //   return;
  // }

  // æ«å®ï¼ã­ã¼ã«ã«ä¿å­
  state.orders.unshift(data);
  showToast('â
 æç¤ºæ¸ãéä¿¡ãã¾ãã');
  resetForm();
});

function resetForm() {
  // ãã­ã¹ãå
¥åãªã»ãã
  ['clinic-name','doctor-name','patient-name','patient-age','patient-gender',
   'shade-guide','shade-number','delivery-date','remarks',
   'repair-detail','metalup-ins-detail','kyoko-ins-detail',
   'metalup-jishi-detail','kyoko-jishi-detail',
   'articulator-type','articulator-detail'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // æ­¯å¼ãªã»ãã
  state.selectedTeeth.clear();
  document.querySelectorAll('.tooth.selected').forEach(t => t.classList.remove('selected'));
  updateTeethDisplay();

  // ãã§ãã¯ããã¯ã¹ãªã»ãã
  document.querySelectorAll('input[type="checkbox"]:checked').forEach(c => { c.checked = false; });

  // å±éã¨ãªã¢ãªã»ãã
  document.querySelectorAll('.expandable.open').forEach(a => a.classList.remove('open'));

  // ãã°ã«ã»ãã¿ã³ãªã»ãã
  document.querySelectorAll('.toggle-btn.active').forEach(b => b.classList.remove('active'));
}

// ============================================================
//  åæ³¨ãªã¹ãæç»
// ============================================================
function renderOrders() {
  const container = document.getElementById('order-list');

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">ð</div>
        <div>åæ³¨ãã¼ã¿ãããã¾ãã</div>
        <div style="font-size:12px;margin-top:8px">Firebaseæ¥ç¶å¾ãå»é¢å´ããéä¿¡ããã¨è¡¨ç¤ºããã¾ã</div>
      </div>`;
    updateSummary([]);
    return;
  }

  // ç´åæ¥ãã¨ã«ã°ã«ã¼ãå
  const groups = {};
  state.orders.forEach(o => {
    const key = o.deliveryDate || 'æ¥ä»æªè¨­å®';
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  // æ¥ä»ã§ã½ã¼ã
  const sortedDates = Object.keys(groups).sort();
  let html = '';
  sortedDates.forEach(date => {
    const label = formatDateLabel(date);
    html += `<div class="order-group"><div class="order-group-date">ð
 ${label}</div>`;
    groups[date].forEach(order => {
      const cls = order.insuranceType === 'insurance' ? 'insurance' : 'jishi';
      const badge = order.insuranceType === 'insurance'
        ? '<span class="order-badge insurance">ä¿éº</span>'
        : '<span class="order-badge jishi">èªè²»</span>';
      const statusChk = order.status === 'accepted'
        ? 'â
 åä»æ¸ã¿'
        : '<button class="act-btn check" onclick="acceptOrder(\'' + order.id + '\')">åä»</button>';

      html += `
        <div class="order-item ${cls}" id="order-${order.id}">
          <div style="font-size:20px">ð¤</div>
          <div class="order-info">
            <div class="order-patient">${order.patientName || 'æ£è
åæªè¨­å®'} ${badge}</div>
            <div class="order-meta">
              ${order.clinicName || ''} ï¼ ${order.deliveryDate || ''} ${order.ampm || ''}
              ${order.priority === 'urgent' ? 'ð¨æ¥ã' : ''}
              ${order.bedType ? 'ï½' + order.bedType : ''}
            </div>
          </div>
          <div class="order-actions">
            ${statusChk}
            <button class="act-btn detail" onclick="showDetail('${order.id}')">è©³ç´°</button>
            <button class="act-btn pdf" onclick="exportPDF('${order.id}')">PDF</button>
          </div>
        </div>`;
    });
    html += '</div>';
  });

  container.innerHTML = html;
  updateSummary(state.orders);
}

}

function updateSummary(orders) {
  const today = new Date().toISOString().slice(0,10);
  const endOfWeek = new Date(); endOfWeek.setDate(endOfWeek.getDate() + 7);

  document.getElementById('count-today').textContent =
    orders.filter(o => o.deliveryDate === today).length;
  document.getElementById('count-week').textContent =
    orders.filter(o => o.deliveryDate && o.deliveryDate <= endOfWeek.toISOString().slice(0,10)).length;
  document.getElementById('count-pending').textContent =
    orders.filter(o => o.status === 'pending').length;
  document.getElementById('count-done').textContent =
    orders.filter(o => o.status === 'accepted').length;
}

function acceptOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (order) {
    order.status = 'accepted';
    // TODO: Firestoreæ´æ°
    renderOrders();
    showToast('åä»æ¸ã¿ã«ãã¾ãã');
  }
}

// ============================================================
//  æ¥ä»åæå¤ã»ãã
// ============================================================
function initDates() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('issue-date').value = today;
  // ç´æããã©ã«ãï¼7æ¥å¾
  const next = new Date(); next.setDate(next.getDate() + 7);
  document.getElementById('delivery-date').value = next.toISOString().slice(0,10);
}

// ============================================================
//  åæå
// ============================================================
initDates();

// ============================================================
//  Firebaseï¼æ¬çªæ¥ç¶ â è¨­å®å¾ã¢ã³ã³ã¡ã³ãï¼
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

// ãªã¢ã«ã¿ã¤ã åä¿¡ï¼æå·¥æå´ï¼
const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
onSnapshot(q, snapshot => {
  state.orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
});

// éä¿¡æã®ä¿å­ï¼ä¸è¨ submit-btn ã® addDoc ã³ã¡ã³ããã¢ã³ã³ã¡ã³ãï¼
*/
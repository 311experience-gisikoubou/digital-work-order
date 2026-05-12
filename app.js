// ============================================================
//  Ã£ÂÂ¢Ã£ÂÂÃ£ÂÂªÃ§ÂÂ¶Ã¦
ÂÃ§Â®Â¡Ã§ÂÂ
// ============================================================
const state = {
  selectedTeeth: new Set(),
  insuranceType: 'insurance',   // 'insurance' | 'jishi'
  ampm: 'AM',
  priority: 'normal',
  orders: []  // FirebaseÃ£ÂÂÃ£ÂÂÃ¥ÂÂÃ¥Â¾ÂÃ¤ÂºÂÃ¥Â®Â
};

// ============================================================
//  Ã£ÂÂ¿Ã£ÂÂÃ¥ÂÂÃ£ÂÂÃ¦ÂÂ¿Ã£ÂÂ
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
//  Ã¤Â¿ÂÃ©ÂÂº / Ã¨ÂÂªÃ¨Â²Â» Ã¥ÂÂÃ£ÂÂÃ¦ÂÂ¿Ã£ÂÂ
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
//  Ã£ÂÂÃ£ÂÂ°Ã£ÂÂ«Ã£ÂÂÃ£ÂÂ¿Ã£ÂÂ³Ã¯Â¼Âsingle / multi Ã¤Â¸Â¡Ã¥Â¯Â¾Ã¥Â¿ÂÃ¯Â¼Â
// ============================================================
document.addEventListener('click', e => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn || !btn.dataset.group) return;
  if (btn.classList.contains('multi')) {
    // Ã¨Â¤ÂÃ¦ÂÂ°Ã©ÂÂ¸Ã¦ÂÂÃ¥ÂÂ¯Ã¯Â¼ÂÃ£ÂÂÃ£ÂÂ°Ã£ÂÂ«
    btn.classList.toggle('active');
  } else {
    // Ã¥ÂÂÃ¤Â¸ÂÃ©ÂÂ¸Ã¦ÂÂÃ¯Â¼ÂÃ¥ÂÂÃ£ÂÂ°Ã£ÂÂ«Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂÃ¨Â§Â£Ã©ÂÂ¤Ã£ÂÂÃ£ÂÂ¦Ã£ÂÂ¢Ã£ÂÂ¯Ã£ÂÂÃ£ÂÂ£Ã£ÂÂ
    const group = btn.dataset.group;
    document.querySelectorAll(`.toggle-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
});

// ============================================================
//  Ã¥Â±ÂÃ©ÂÂÃ£ÂÂ¨Ã£ÂÂªÃ£ÂÂ¢Ã¥ÂÂ¶Ã¥Â¾Â¡Ã¯Â¼ÂÃ¦Â±ÂÃ§ÂÂ¨Ã¯Â¼Â
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

// Ã£ÂÂ·Ã£ÂÂ§Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ®Ã¤Â»ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ¿Ã£ÂÂ³Ã£ÂÂ§Ã¨ÂÂªÃ§ÂÂ±Ã¥
Â¥Ã¥ÂÂÃ£ÂÂÃ¥Â±ÂÃ©ÂÂÃ¯Â¼ÂÃ¤Â¿ÂÃ©ÂÂºÃ¯Â¼Â
document.querySelectorAll('.toggle-btn[data-group="shade"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// Ã£ÂÂ·Ã£ÂÂ§Ã£ÂÂ¼Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ®Ã¤Â»ÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ¿Ã£ÂÂ³Ã£ÂÂ§Ã¨ÂÂªÃ§ÂÂ±Ã¥
Â¥Ã¥ÂÂÃ£ÂÂÃ¥Â±ÂÃ©ÂÂÃ¯Â¼ÂÃ¨ÂÂªÃ¨Â²Â»Ã¯Â¼Â
document.querySelectorAll('.toggle-btn[data-group="shade-jishi"]').forEach(btn => {
  btn.addEventListener('click', () => {
    const area = document.getElementById('shade-jishi-other-area');
    area.classList.toggle('open', btn.dataset.val === 'other' && btn.classList.contains('active'));
  });
});

// ============================================================
//  AM/PM Ã£ÂÂÃ£ÂÂ°Ã£ÂÂ«
// ============================================================
document.querySelectorAll('.ampm-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.ampm = btn.dataset.val;
    document.querySelectorAll('.ampm-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ============================================================
//  Ã¥ÂÂªÃ¥
ÂÃ¥ÂºÂ¦Ã£ÂÂÃ£ÂÂ°Ã£ÂÂ«
// ============================================================
document.querySelectorAll('.priority-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.priority = btn.dataset.val;
    document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ============================================================
//  Ã£ÂÂÃ£ÂÂ©Ã£ÂÂ¼Ã£ÂÂ Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¿Ã¥ÂÂÃ©ÂÂ
// ============================================================
function collectFormData() {
  const ins = state.insuranceType;

  // Ã£ÂÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ¯Ã£ÂÂÃ£ÂÂÃ£ÂÂ¯Ã£ÂÂ¹Ã£ÂÂ°Ã£ÂÂ«Ã£ÂÂ¼Ã£ÂÂ
  function getChecked(containerId) {
    return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)]
      .map(c => c.value);
  }

  // Ã£ÂÂÃ£ÂÂ°Ã£ÂÂ«Ã£ÂÂÃ£ÂÂ¿Ã£ÂÂ³Ã¯Â¼ÂÃ¥ÂÂÃ¤Â¸ÂÃ©ÂÂ¸Ã¦ÂÂÃ¯Â¼Â
  function getToggleVal(group) {
    const el = document.querySelector(`.toggle-btn[data-group="${group}"].active`);
    return el ? (el.dataset.val || el.textContent.trim()) : null;
  }

  // Ã§ÂÂºÃ¦Â³Â¨Ã¥Â½Â¢Ã¦
Â
  const orderTypes = [...document.querySelectorAll('#order-type-group input:checked')].map(c => c.value);

  // Ã¨Â£ÂÃ§Â¶Â´Ã§ÂÂ©Ã£ÂÂ»Ã¨Â£
Ã§Â½Â®
  const deviceGroup = ins === 'insurance' ? 'device-insurance' : 'device-jishi';
  const devices = getChecked(deviceGroup);

  // Ã£ÂÂ¯Ã£ÂÂ©Ã£ÂÂ¹Ã£ÂÂ
  const claspType = ins === 'insurance' ? getToggleVal('clasp-ins') : getToggleVal('clasp-jishi');

  // Ã£ÂÂÃ£ÂÂ¼
  const barType = ins === 'insurance' ? getToggleVal('bar-ins') : getToggleVal('bar-jishi');

  // Ã¤ÂºÂºÃ¥Â·Â¥Ã¦Â­Â¯
  const toothAnt  = ins === 'insurance' ? getToggleVal('tooth-ant-ins')  : getToggleVal('tooth-ant-jishi');
  const toothPost = ins === 'insurance' ? getToggleVal('tooth-post-ins') : getToggleVal('tooth-post-jishi');

  return {
    // Ã¦ÂÂ£Ã¨Â
Ã£ÂÂ»Ã¥ÂÂ»Ã©ÂÂ¢Ã¦Â
Ã¥Â Â±
    clinicName:   document.getElementById('clinic-name').value.trim(),
    doctorName:   document.getElementById('doctor-name').value.trim(),
    patientName:  document.getElementById('patient-name').value.trim(),
    patientAge:   document.getElementById('patient-age').value,
    patientGender:document.getElementById('patient-gender').value,
    issueDate:    document.getElementById('issue-date').value || new Date().toISOString().slice(0,10),

    // Ã¦Â­Â¯Ã¥Â¼Â
    selectedTeeth: [...state.selectedTeeth].sort((a,b)=>a-b),

    // Ã¥ÂÂºÃ¥ÂÂ
    insuranceType: ins,

    // Ã§ÂÂºÃ¦Â³Â¨Ã¥Â½Â¢Ã¦
Â
    orderTypes,
    repairDetail: document.getElementById('repair-detail').value,

    // Ã¨Â£ÂÃ§Â¶Â´Ã§ÂÂ©
    bedType:      getToggleVal(ins === 'insurance' ? 'bed-insurance' : 'bed-jishi'),
    devices,
    claspType,
    barType,

    // Ã£ÂÂ¡Ã£ÂÂ¿Ã£ÂÂ«Ã£ÂÂ¢Ã£ÂÂÃ£ÂÂ
    hasMetalup:   document.getElementById(`chk-metalup-${ins}`).checked,
    metalupDetail:document.getElementById(`metalup-${ins}-detail`).value,

    // Ã¨Â£ÂÃ¥Â¼Â·Ã¥ÂºÂ
    hasKyoko:     document.getElementById(`chk-kyoko-${ins}`).checked,
    kyokoDetail:  document.getElementById(`kyoko-${ins}-detail`).value,

    // Ã¤ÂºÂºÃ¥Â·Â¥Ã¦Â­Â¯
    toothAnterior:  toothAnt,
    toothPosterior: toothPost,

    // Ã¨ÂÂ²Ã¨ÂªÂ¿
    shadeGuide:   document.getElementById('shade-guide').value,
    shadeNumber:  document.getElementById('shade-number').value,

    // Ã£ÂÂªÃ£ÂÂÃ£ÂÂ·Ã£ÂÂ§Ã£ÂÂ³
    goaFlag:      getToggleVal('goa'),
    hasArticulator: document.getElementById('chk-articulator').checked,
    articulatorType:  document.getElementById('articulator-type').value,
    articulatorDetail:document.getElementById('articulator-detail').value,

    // Ã§Â´ÂÃ¦ÂÂ
    deliveryDate: document.getElementById('delivery-date').value,
    ampm:         state.ampm,
    priority:     state.priority,
    remarks:      document.getElementById('remarks').value,

    // Ã£ÂÂ¡Ã£ÂÂ¿Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¿
    status:       'pending',   // Ã¦ÂÂªÃ¥ÂÂÃ¤Â»Â
    createdAt:    new Date().toISOString(),
    id:           'local_' + Date.now()
  };
}

// ============================================================
//  Ã£ÂÂÃ£ÂÂªÃ£ÂÂÃ£ÂÂ¼Ã£ÂÂ·Ã£ÂÂ§Ã£ÂÂ³
// ============================================================
function validate(data) {
  const errors = [];
  if (!data.clinicName)   errors.push('Ã¦Â­Â¯Ã§Â§ÂÃ¥ÂÂ»Ã©ÂÂ¢Ã¥ÂÂ');
  if (!data.doctorName)   errors.push('Ã¦Â
Ã¥Â½ÂÃ¦Â­Â¯Ã§Â§ÂÃ¥ÂÂ»Ã¥Â¸Â«');
  if (!data.patientName)  errors.push('Ã¦ÂÂ£Ã¨Â
Ã¥ÂÂ');

  if (!data.deliveryDate) errors.push('Ã§Â´ÂÃ¦ÂÂ');
  return errors;
}

// ============================================================
//  Ã©ÂÂÃ¤Â¿Â¡Ã¥ÂÂ¦Ã§ÂÂ
// ============================================================
document.getElementById('submit-btn').addEventListener('click', async () => {
  const data = collectFormData();
  const errors = validate(data);

  if (errors.length > 0) {
    showToast(`Ã¥
Â¥Ã¥ÂÂÃ¥Â¿
Ã©Â ÂÃ©Â 
Ã§ÂÂ®: ${errors.join('Ã£ÂÂ')}`, 'error');
    return;
  }

  // TODO: Firebase Firestore Ã£ÂÂ¸Ã£ÂÂ®Ã¤Â¿ÂÃ¥Â­Â
  // try {
  //   const docRef = await addDoc(collection(window.db, 'orders'), data);
  //   console.log('Saved:', docRef.id);
  // } catch(e) {
  //   showToast('Ã©ÂÂÃ¤Â¿Â¡Ã£ÂÂ«Ã¥Â¤Â±Ã¦ÂÂÃ£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ', 'error');
  //   return;
  // }

  // Ã¦ÂÂ«Ã¥Â®ÂÃ¯Â¼ÂÃ£ÂÂ­Ã£ÂÂ¼Ã£ÂÂ«Ã£ÂÂ«Ã¤Â¿ÂÃ¥Â­Â
  state.orders.unshift(data);
  showToast('Ã¢Â
 Ã¦ÂÂÃ§Â¤ÂºÃ¦ÂÂ¸Ã£ÂÂÃ©ÂÂÃ¤Â¿Â¡Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ');
  resetForm();
});

function resetForm() {
  // Ã£ÂÂÃ£ÂÂ­Ã£ÂÂ¹Ã£ÂÂÃ¥
Â¥Ã¥ÂÂÃ£ÂÂªÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ
  ['clinic-name','doctor-name','patient-name','patient-age','patient-gender',
   'shade-guide','shade-number','delivery-date','remarks',
   'repair-detail','metalup-ins-detail','kyoko-ins-detail',
   'metalup-jishi-detail','kyoko-jishi-detail',
   'articulator-type','articulator-detail'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Ã¦Â­Â¯Ã¥Â¼ÂÃ£ÂÂªÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ
  state.selectedTeeth.clear();
  document.querySelectorAll('.tooth.selected').forEach(t => t.classList.remove('selected'));
  updateTeethDisplay();

  // Ã£ÂÂÃ£ÂÂ§Ã£ÂÂÃ£ÂÂ¯Ã£ÂÂÃ£ÂÂÃ£ÂÂ¯Ã£ÂÂ¹Ã£ÂÂªÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ
  document.querySelectorAll('input[type="checkbox"]:checked').forEach(c => { c.checked = false; });

  // Ã¥Â±ÂÃ©ÂÂÃ£ÂÂ¨Ã£ÂÂªÃ£ÂÂ¢Ã£ÂÂªÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ
  document.querySelectorAll('.expandable.open').forEach(a => a.classList.remove('open'));

  // Ã£ÂÂÃ£ÂÂ°Ã£ÂÂ«Ã£ÂÂ»Ã£ÂÂÃ£ÂÂ¿Ã£ÂÂ³Ã£ÂÂªÃ£ÂÂ»Ã£ÂÂÃ£ÂÂ
  document.querySelectorAll('.toggle-btn.active').forEach(b => b.classList.remove('active'));
}

// ============================================================
//  Ã¥ÂÂÃ¦Â³Â¨Ã£ÂÂªÃ£ÂÂ¹Ã£ÂÂÃ¦ÂÂÃ§ÂÂ»
// ============================================================
function renderOrders() {
  const container = document.getElementById('order-list');

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">Ã°ÂÂÂ</div>
        <div>Ã¥ÂÂÃ¦Â³Â¨Ã£ÂÂÃ£ÂÂ¼Ã£ÂÂ¿Ã£ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ</div>
        <div style="font-size:12px;margin-top:8px">FirebaseÃ¦ÂÂ¥Ã§Â¶ÂÃ¥Â¾ÂÃ£ÂÂÃ¥ÂÂ»Ã©ÂÂ¢Ã¥ÂÂ´Ã£ÂÂÃ£ÂÂÃ©ÂÂÃ¤Â¿Â¡Ã£ÂÂÃ£ÂÂÃ£ÂÂ¨Ã¨Â¡Â¨Ã§Â¤ÂºÃ£ÂÂÃ£ÂÂÃ£ÂÂ¾Ã£ÂÂ</div>
      </div>`;
    updateSummary([]);
    return;
  }

  // Ã§Â´ÂÃ¥ÂÂÃ¦ÂÂ¥Ã£ÂÂÃ£ÂÂ¨Ã£ÂÂ«Ã£ÂÂ°Ã£ÂÂ«Ã£ÂÂ¼Ã£ÂÂÃ¥ÂÂ
  const groups = {};
  state.orders.forEach(o => {
    const key = o.deliveryDate || 'Ã¦ÂÂ¥Ã¤Â»ÂÃ¦ÂÂªÃ¨Â¨Â­Ã¥Â®Â';
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  // Ã¦ÂÂ¥Ã¤Â»ÂÃ£ÂÂ§Ã£ÂÂ½Ã£ÂÂ¼Ã£ÂÂ
  const sortedDates = Object.keys(groups).sort();
  let html = '';
  sortedDates.forEach(date => {
    const label = formatDateLabel(date);
    html += `<div class="order-group"><div class="order-group-date">Ã°ÂÂ
 ${label}</div>`;
    groups[date].forEach(order => {
      const cls = order.insuranceType === 'insurance' ? 'insurance' : 'jishi';
      const badge = order.insuranceType === 'insurance'
        ? '<span class="order-badge insurance">Ã¤Â¿ÂÃ©ÂÂº</span>'
        : '<span class="order-badge jishi">Ã¨ÂÂªÃ¨Â²Â»</span>';
      const statusChk = order.status === 'accepted'
        ? 'Ã¢Â
 Ã¥ÂÂÃ¤Â»ÂÃ¦Â¸ÂÃ£ÂÂ¿'
        : '<button class="act-btn check" onclick="acceptOrder(\'' + order.id + '\')">Ã¥ÂÂÃ¤Â»Â</button>';

      html += `
        <div class="order-item ${cls}" id="order-${order.id}">
          <div style="font-size:20px">Ã°ÂÂÂ¤</div>
          <div class="order-info">
            <div class="order-patient">${order.patientName || 'Ã¦ÂÂ£Ã¨Â
Ã¥ÂÂÃ¦ÂÂªÃ¨Â¨Â­Ã¥Â®Â'} ${badge}</div>
            <div class="order-meta">
              ${order.clinicName || ''} Ã¯Â¼Â ${order.deliveryDate || ''} ${order.ampm || ''}
              ${order.priority === 'urgent' ? 'Ã°ÂÂÂ¨Ã¦ÂÂ¥Ã£ÂÂ' : ''}
              ${order.bedType ? 'Ã¯Â½Â' + order.bedType : ''}
            </div>
          </div>
          <div class="order-actions">
            ${statusChk}
            <button class="act-btn detail" onclick="showDetail('${order.id}')">Ã¨Â©Â³Ã§Â´Â°</button>
            <button class="act-btn pdf" onclick="exportPDF('${order.id}')">PDF</button>
          </div>
        </div>`;
    });
    html += '</div>';
  });

  container.innerHTML = html;
  updateSummary(state.orders);
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
    // TODO: FirestoreÃ¦ÂÂ´Ã¦ÂÂ°
    renderOrders();
    showToast('Ã¥ÂÂÃ¤Â»ÂÃ¦Â¸ÂÃ£ÂÂ¿Ã£ÂÂ«Ã£ÂÂÃ£ÂÂ¾Ã£ÂÂÃ£ÂÂ');
  }
}

// ============================================================
//  Ã¦ÂÂ¥Ã¤Â»ÂÃ¥ÂÂÃ¦ÂÂÃ¥ÂÂ¤Ã£ÂÂ»Ã£ÂÂÃ£ÂÂ
// ============================================================
function initDates() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('issue-date').value = today;
  // Ã§Â´ÂÃ¦ÂÂÃ£ÂÂÃ£ÂÂÃ£ÂÂ©Ã£ÂÂ«Ã£ÂÂÃ¯Â¼Â7Ã¦ÂÂ¥Ã¥Â¾Â
  const next = new Date(); next.setDate(next.getDate() + 7);
  document.getElementById('delivery-date').value = next.toISOString().slice(0,10);
}

// ============================================================
//  Ã¥ÂÂÃ¦ÂÂÃ¥ÂÂ
// ============================================================
initDates();

// ============================================================
//  FirebaseÃ¯Â¼ÂÃ¦ÂÂ¬Ã§ÂÂªÃ¦ÂÂ¥Ã§Â¶Â Ã¢ÂÂ Ã¨Â¨Â­Ã¥Â®ÂÃ¥Â¾ÂÃ£ÂÂ¢Ã£ÂÂ³Ã£ÂÂ³Ã£ÂÂ¡Ã£ÂÂ³Ã£ÂÂÃ¯Â¼Â
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

// Ã£ÂÂªÃ£ÂÂ¢Ã£ÂÂ«Ã£ÂÂ¿Ã£ÂÂ¤Ã£ÂÂ Ã¥ÂÂÃ¤Â¿Â¡Ã¯Â¼ÂÃ¦ÂÂÃ¥Â·Â¥Ã¦ÂÂÃ¥ÂÂ´Ã¯Â¼Â
const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
onSnapshot(q, snapshot => {
  state.orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrders();
});

// Ã©ÂÂÃ¤Â¿Â¡Ã¦ÂÂÃ£ÂÂ®Ã¤Â¿ÂÃ¥Â­ÂÃ¯Â¼ÂÃ¤Â¸ÂÃ¨Â¨Â submit-btn Ã£ÂÂ® addDoc Ã£ÂÂ³Ã£ÂÂ¡Ã£ÂÂ³Ã£ÂÂÃ£ÂÂÃ£ÂÂ¢Ã£ÂÂ³Ã£ÂÂ³Ã£ÂÂ¡Ã£ÂÂ³Ã£ÂÂÃ¯Â¼Â
*/
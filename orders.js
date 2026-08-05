// ============================================================
//  B5 2面付け印刷 選択状態（最大2件）
// ============================================================
var printSelection = [];

// ============================================================
//  受注サマリー
// ============================================================
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

// ============================================================
//  受注リスト描画
// ============================================================
function renderOrders() {
  const container = document.getElementById('order-list');

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">📋</div>
        <div>受注データがありません</div>
        <div style="font-size:12px;margin-top:8px">Firebase接続後、医院側から送信すると表示されます</div>
      </div>`;
    updateSummary([]);
    return;
  }
  container.textContent = '';

  // 納品日ごとにグループ化
  const groups = {};
  state.orders.forEach(o => {
    const key = o.deliveryDate || '日付未設定';
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  // 日付でソート
  const sortedDates = Object.keys(groups).sort();

  // B5印刷ツールバー
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'padding:8px 0 12px;text-align:right;';
  const printBtn = document.createElement('button');
  printBtn.id = 'btn-print-selected';
  printBtn.disabled = printSelection.length === 0;
  printBtn.style.cssText = 'padding:6px 14px;font-size:13px;cursor:pointer;';
  printBtn.textContent = printSelection.length > 0
    ? '選択分をB5印刷 (' + printSelection.length + '件)'
    : '選択分をB5印刷';
  printBtn.addEventListener('click', printSelected);
  toolbar.appendChild(printBtn);
  container.appendChild(toolbar);

  sortedDates.forEach(date => {
    const label = formatDateLabel(date);
    const groupEl = document.createElement('div');
    groupEl.className = 'order-group';
    const dateEl = document.createElement('div');
    dateEl.className = 'order-group-date';
    dateEl.textContent = '📅 ' + label;
    groupEl.appendChild(dateEl);
    groups[date].forEach(order => {
      const cls = order.insuranceType === 'insurance' ? 'insurance' : 'jishi';
      const isChecked = printSelection.indexOf(order.id) >= 0;
      const isDisabled = printSelection.length >= 2 && !isChecked;
      const item = document.createElement('div');
      item.className = 'order-item ' + cls;
      item.id = 'order-' + order.id;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'print-chk';
      chk.dataset.id = order.id;
      chk.checked = isChecked;
      chk.disabled = isDisabled;
      chk.style.cssText = 'width:16px;height:16px;cursor:pointer;flex-shrink:0;align-self:center;';
      chk.addEventListener('change', function() { togglePrintSelect(order.id); });
      item.appendChild(chk);

      const icon = document.createElement('div');
      icon.style.fontSize = '20px';
      icon.textContent = '👤';
      item.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'order-info';
      const patient = document.createElement('div');
      patient.className = 'order-patient';
      patient.appendChild(document.createTextNode(order.patientName || '患者名未設定'));
      patient.appendChild(document.createTextNode(' '));
      const badge = document.createElement('span');
      badge.className = 'order-badge ' + cls;
      badge.textContent = order.insuranceType === 'insurance' ? '保険' : '自費';
      patient.appendChild(badge);
      info.appendChild(patient);

      const meta = document.createElement('div');
      meta.className = 'order-meta';
      meta.textContent =
        (order.clinicName || '') + ' ／ ' + (order.deliveryDate || '') + ' ' + (order.ampm || '') +
        (order.priority === 'urgent' ? ' 🚨急ぎ' : '') +
        (order.bedType ? '｜' + order.bedType : '');
      info.appendChild(meta);
      item.appendChild(info);

      const actions = document.createElement('div');
      actions.className = 'order-actions';
      const statusBtn = document.createElement('button');
      statusBtn.className = 'act-btn check';
      if (order.status === 'accepted') {
        statusBtn.style.opacity = '0.65';
        statusBtn.title = 'クリックで受付取り消し';
        statusBtn.textContent = '✅ 受付済み';
        statusBtn.addEventListener('click', function() { cancelOrder(order.id); });
      } else {
        statusBtn.textContent = '受付';
        statusBtn.addEventListener('click', function() { acceptOrder(order.id); });
      }
      actions.appendChild(statusBtn);

      const detailBtn = document.createElement('button');
      detailBtn.className = 'act-btn detail';
      detailBtn.textContent = '詳細';
      detailBtn.addEventListener('click', function() { showDetail(order.id); });
      actions.appendChild(detailBtn);

      const pdfBtn = document.createElement('button');
      pdfBtn.className = 'act-btn pdf';
      pdfBtn.textContent = 'PDF';
      pdfBtn.addEventListener('click', function() { exportPDF(order.id); });
      actions.appendChild(pdfBtn);
      item.appendChild(actions);

      groupEl.appendChild(item);
    });
    container.appendChild(groupEl);
  });
  updateSummary(state.orders);
}

// ============================================================
//  B5印刷 チェックボックス制御
// ============================================================
function togglePrintSelect(id) {
  var idx = printSelection.indexOf(id);
  if (idx >= 0) {
    // チェック解除
    printSelection.splice(idx, 1);
  } else {
    // 2件選択済みの場合は追加しない（disabled で防いでいるが念のため）
    if (printSelection.length >= 2) {
      var chkEl = document.querySelector('.print-chk[data-id="' + id + '"]');
      if (chkEl) chkEl.checked = false;
      return;
    }
    printSelection.push(id);
  }
  // 全チェックボックスの checked / disabled を同期
  document.querySelectorAll('.print-chk').forEach(function(chk) {
    var chkId = chk.dataset.id;
    chk.checked = printSelection.indexOf(chkId) >= 0;
    chk.disabled = printSelection.length >= 2 && printSelection.indexOf(chkId) < 0;
  });
  // 印刷ボタンのラベルと有効状態を更新
  var btn = document.getElementById('btn-print-selected');
  if (btn) {
    btn.disabled = printSelection.length === 0;
    btn.textContent = printSelection.length > 0
      ? '選択分をB5印刷 (' + printSelection.length + '件)'
      : '選択分をB5印刷';
  }
}

// ============================================================
//  B5 2面付け印刷実行
// ============================================================
function printSelected() {
  if (printSelection.length === 0) {
    showToast('印刷する指示書を選択してください', 'error');
    return;
  }
  exportPDF(printSelection[0], printSelection[1] || null);
}

// ============================================================
//  受付処理
// ============================================================
function acceptOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (order) {
    order.status = 'accepted';
    // TODO: Firestore更新
    renderOrders();
    showToast('受付済みにしました');
  }
}

function cancelOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (order) {
    order.status = 'pending';
    // TODO: Firestore更新
    renderOrders();
    showToast('受付を取り消しました');
  }
}

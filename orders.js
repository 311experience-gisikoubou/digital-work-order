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
  const btnLabel = printSelection.length > 0
    ? '選択分をB5印刷 (' + printSelection.length + '件)'
    : '選択分をB5印刷';
  let html = '<div style="padding:8px 0 12px;text-align:right;">' +
    '<button id="btn-print-selected" onclick="printSelected()"' +
    (printSelection.length === 0 ? ' disabled' : '') +
    ' style="padding:6px 14px;font-size:13px;cursor:pointer;">' +
    btnLabel + '</button></div>';

  sortedDates.forEach(date => {
    const label = formatDateLabel(date);
    html += `<div class="order-group"><div class="order-group-date">📅 ${label}</div>`;
    groups[date].forEach(order => {
      const cls = order.insuranceType === 'insurance' ? 'insurance' : 'jishi';
      const badge = order.insuranceType === 'insurance'
        ? '<span class="order-badge insurance">保険</span>'
        : '<span class="order-badge jishi">自費</span>';
      const statusChk = order.status === 'accepted'
        ? '<button class="act-btn check" onclick="cancelOrder(\'' + order.id + '\')" style="opacity:0.65" title="クリックで受付取り消し">✅ 受付済み</button>'
        : '<button class="act-btn check" onclick="acceptOrder(\'' + order.id + '\')" >受付</button>';

      const isChecked = printSelection.indexOf(order.id) >= 0;
      const isDisabled = printSelection.length >= 2 && !isChecked;
      const chk = '<input type="checkbox" class="print-chk"' +
        ' data-id="' + order.id + '"' +
        (isChecked ? ' checked' : '') +
        (isDisabled ? ' disabled' : '') +
        ' onchange="togglePrintSelect(\'' + order.id + '\')"' +
        ' style="width:16px;height:16px;cursor:pointer;flex-shrink:0;align-self:center;">';

      html += `
        <div class="order-item ${cls}" id="order-${order.id}">
          ${chk}
          <div style="font-size:20px">👤</div>
          <div class="order-info">
            <div class="order-patient">${order.patientName || '患者名未設定'} ${badge}</div>
            <div class="order-meta">
              ${order.clinicName || ''} ／ ${order.deliveryDate || ''} ${order.ampm || ''}
              ${order.priority === 'urgent' ? '🚨急ぎ' : ''}
              ${order.bedType ? '｜' + order.bedType : ''}
            </div>
          </div>
          <div class="order-actions">
            ${statusChk}
            <button class="act-btn detail" onclick="showDetail('${order.id}')">詳細</button>
            <button class="act-btn pdf" onclick="exportPDF('${order.id}')">PDF</button>
          </div>
        </div>`;
    });
    html += '</div>';
  });

  container.innerHTML = html;
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

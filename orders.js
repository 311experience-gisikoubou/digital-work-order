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
  let html = '';
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

      html += `
        <div class="order-item ${cls}" id="order-${order.id}">
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

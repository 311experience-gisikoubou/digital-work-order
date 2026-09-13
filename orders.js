// ============================================================
//  B5 2面付け印刷 選択状態（最大2件）
// ============================================================
var printSelection = [];

// ============================================================
//  一時受注の消失警告
// ============================================================
let orderLossBeforeUnloadAttached = false;

function hasTemporaryOrders() {
  return Array.isArray(state.orders) && state.orders.length > 0;
}

function handleOrderBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = true;
}

function syncOrderLossGuard() {
  const hasOrders = hasTemporaryOrders();
  const warning = document.getElementById('order-loss-warning');
  const warningMessage = document.getElementById('order-loss-warning-message');
  if (warning) warning.hidden = !hasOrders;
  if (warningMessage && hasOrders) {
    warningMessage.textContent = (typeof orderSessionStorageAvailable !== 'undefined' && orderSessionStorageAvailable === false)
      ? 'この端末では再読み込み復元を利用できません。再読み込み・タブ終了・ブラウザ終了で消えます。'
      : '同じタブの再読み込みでは復元します。タブ終了・ブラウザ終了で消えます。';
  }

  if (hasOrders && !orderLossBeforeUnloadAttached) {
    window.addEventListener('beforeunload', handleOrderBeforeUnload);
    orderLossBeforeUnloadAttached = true;
  } else if (!hasOrders && orderLossBeforeUnloadAttached) {
    window.removeEventListener('beforeunload', handleOrderBeforeUnload);
    orderLossBeforeUnloadAttached = false;
  }
}

// ============================================================
//  Same-tab temporary-order reload recovery
// ============================================================
const ORDER_SESSION_STORAGE_KEY = 'dwo_session_orders_v1';
const ORDER_SESSION_SCHEMA_VERSION = 'dwo-session-orders-v1';
let orderSessionStorageAvailable = null;

function isPlainOrderObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidSessionOrder(order) {
  if (!isPlainOrderObject(order)) return false;
  if (!/^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(order.workOrderRef || '')) return false;
  if (!/^local_\d+$/.test(order.id || '')) return false;
  if (!['pending', 'accepted'].includes(order.status)) return false;
  if (!['insurance', 'jishi'].includes(order.insuranceType)) return false;
  if (typeof order.createdAt !== 'string' || !Number.isFinite(Date.parse(order.createdAt))) return false;
  for (const key of ['clinicName', 'doctorName', 'patientName', 'patientAge', 'patientGender', 'issueDate', 'deliveryDate', 'remarks']) {
    if (typeof order[key] !== 'string') return false;
  }
  if (!Array.isArray(order.selectedTeeth) || !order.selectedTeeth.every(v => typeof v === 'string' || Number.isInteger(v))) return false;
  if (!Array.isArray(order.orderTypes) || !order.orderTypes.every(v => typeof v === 'string')) return false;
  if (!Array.isArray(order.devices) || !order.devices.every(v => typeof v === 'string')) return false;
  if (!Array.isArray(order.memoStrokes)) return false;
  return true;
}

function validateSessionOrdersEnvelope(value) {
  if (!isPlainOrderObject(value)) return null;
  if (value.schemaVersion !== ORDER_SESSION_SCHEMA_VERSION || !Array.isArray(value.orders)) return null;
  if (!value.orders.every(isValidSessionOrder)) return null;
  const refs = value.orders.map(order => order.workOrderRef);
  if (new Set(refs).size !== refs.length) return null;
  const ids = value.orders.map(order => order.id);
  if (new Set(ids).size !== ids.length) return null;
  return value.orders;
}

function getOrderSessionStorage(storage) {
  if (storage) return storage;
  return window.sessionStorage;
}

function clearInvalidOrderSession(storage) {
  try { getOrderSessionStorage(storage).removeItem(ORDER_SESSION_STORAGE_KEY); } catch (_) { /* fail closed */ }
}

function syncTemporaryOrdersToSession(storage) {
  try {
    const target = getOrderSessionStorage(storage);
    if (!Array.isArray(state.orders) || state.orders.length === 0) {
      target.removeItem(ORDER_SESSION_STORAGE_KEY);
    } else {
      target.setItem(ORDER_SESSION_STORAGE_KEY, JSON.stringify({
        schemaVersion: ORDER_SESSION_SCHEMA_VERSION,
        orders: state.orders
      }));
    }
    orderSessionStorageAvailable = true;
    return true;
  } catch (_) {
    orderSessionStorageAvailable = false;
    clearInvalidOrderSession(storage);
    return false;
  }
}

function restoreTemporaryOrdersFromSession(storage) {
  try {
    const target = getOrderSessionStorage(storage);
    const raw = target.getItem(ORDER_SESSION_STORAGE_KEY);
    orderSessionStorageAvailable = true;
    if (!raw) return false;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      clearInvalidOrderSession(target);
      return false;
    }
    const restored = validateSessionOrdersEnvelope(parsed);
    if (!restored) {
      clearInvalidOrderSession(target);
      return false;
    }
    state.orders = restored;
    return true;
  } catch (_) {
    orderSessionStorageAvailable = false;
    return false;
  }
}

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
  syncOrderLossGuard();

  if (state.orders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:48px;color:var(--text-muted)">
        <div style="font-size:32px;margin-bottom:12px">📋</div>
        <div>受注データがありません</div>
        <div style="font-size:12px;margin-top:8px">医院側入力から反映した、このページ内の受注データが表示されます</div>
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

  // 印刷ツールバー
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'padding:8px 0 12px;text-align:right;';
  const printBtn = document.createElement('button');
  printBtn.id = 'btn-print-selected';
  printBtn.disabled = printSelection.length === 0;
  printBtn.style.cssText = 'padding:6px 14px;font-size:13px;cursor:pointer;';
  printBtn.textContent = printSelection.length > 0
    ? '選択分を印刷 (' + printSelection.length + '件)'
    : '選択分を印刷';
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

      const bridgeBtn = document.createElement('button');
      bridgeBtn.className = 'act-btn detail';
      bridgeBtn.textContent = '\u7d0d\u54c1\u9023\u643a';
      bridgeBtn.title = '\u7d0d\u54c1\u30a2\u30d7\u30ea\u53d6\u308a\u8fbc\u307f\u7528JSON\u3092\u4fdd\u5b58';
      bridgeBtn.addEventListener('click', function() {
        try {
          downloadDeliveryIntakeJson(order);
          showToast('\u7d0d\u54c1\u9023\u643aJSON\u3092\u4f5c\u6210\u3057\u307e\u3057\u305f');
        } catch (error) {
          showToast('\u7d0d\u54c1\u9023\u643aJSON\u3092\u5b89\u5168\u306b\u4f5c\u6210\u3067\u304d\u306a\u3044\u305f\u3081\u3001\u51fa\u529b\u3092\u4e2d\u6b62\u3057\u307e\u3057\u305f', 'error');
        }
      });
      actions.appendChild(bridgeBtn);
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
      ? '選択分を印刷 (' + printSelection.length + '件)'
      : '選択分を印刷';
  }
}

// ============================================================
//  2面付け印刷実行
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
    syncTemporaryOrdersToSession();
    renderOrders();
    showToast('受付済みにしました');
  }
}

function cancelOrder(id) {
  const order = state.orders.find(o => o.id === id);
  if (order) {
    order.status = 'pending';
    syncTemporaryOrdersToSession();
    renderOrders();
    showToast('受付を取り消しました');
  }
}

// Restore only a validated snapshot from this tab's page session.
restoreTemporaryOrdersFromSession();
syncOrderLossGuard();

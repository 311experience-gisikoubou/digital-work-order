// ============================================================
//  詳細モーダル
// ============================================================
function showDetail(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;

  const ins = order.insuranceType === 'insurance' ? '保険' : '自費';
  const teeth = order.selectedTeeth?.join('、') || '未選択';

  const content = document.getElementById('modal-detail-content');
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:13px';
  const tbody = document.createElement('tbody');
  [
    ['医院名', order.clinicName],
    ['担当医', order.doctorName],
    ['患者名', order.patientName],
    ['年齢', order.patientAge ? order.patientAge + '歳' : '—'],
    ['患歯', teeth],
    ['区分', ins],
    ['発注形態', (order.orderTypes||[]).join('、')],
    ['義歯床', order.bedType],
    ['装置', (order.devices||[]).join('、')],
    ['クラスプ', order.claspType],
    ['バー', order.barType ? order.barType + 'バー' : ''],
    ['人工歯 前歯', order.toothAnterior],
    ['人工歯 臼歯', order.toothPosterior],
    ['色調', (order.shadeGuide || '') + ' ' + (order.shadeNumber || '')],
    ['GoA描記版', order.goaFlag],
    ['納期', (order.deliveryDate || '') + ' ' + (order.ampm || '')],
    ['優先度', order.priority === 'urgent' ? '🚨 急ぎ' : '通常'],
    ['備考', order.remarks]
  ].forEach(function(item) {
    const tr = row(item[0], item[1]);
    if (tr) tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  content.replaceChildren(table);

  document.getElementById('modal-detail').classList.add('open');
}

function row(label, val) {
  if (!val) return null;
  const tr = document.createElement('tr');
  const th = document.createElement('td');
  th.style.cssText = 'padding:6px 10px;color:var(--text-secondary);white-space:nowrap;border-bottom:1px solid var(--border-color)';
  th.textContent = label;
  const td = document.createElement('td');
  td.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--border-color)';
  td.textContent = val;
  tr.appendChild(th);
  tr.appendChild(td);
  return tr;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

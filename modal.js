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
    ['対合歯', order.taigoha ? 'あり' : ''],
    ['バイト', order.bite ? 'あり' : ''],
    ['GoA描記版', order.goaFlag ? 'あり' : ''],
    ['咬合器', order.hasArticulator ? ((order.articulatorType || 'あり') + (order.articulatorDetail ? ' ' + order.articulatorDetail : '')) : ''],
    ['メタルアップ', order.hasMetalup ? (order.metalupDetail || 'あり') : ''],
    ['補強床', order.hasKyoko ? (order.kyokoDetail || 'あり') : ''],
    ['納期', (order.deliveryDate || '') + ' ' + (order.ampm || '')],
    ['優先度', order.priority === 'urgent' ? '🚨 急ぎ' : '通常'],
    ['備考', order.remarks]
  ].forEach(function(item) {
    const tr = row(item[0], item[1]);
    if (tr) tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  const detailParts = [table];
  const memoPreview = createMemoPreview(order.memoStrokes);
  if (memoPreview) detailParts.push(memoPreview);
  content.replaceChildren(...detailParts);

  document.getElementById('modal-detail').classList.add('open');
}

function createMemoPreview(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'detail-memo-preview';

  const title = document.createElement('div');
  title.className = 'detail-memo-title';
  title.textContent = '手書きメモ';
  wrap.appendChild(title);

  const bounds = (typeof getMemoStrokeBounds === 'function')
    ? getMemoStrokeBounds(strokes, 18, 1.2)
    : { x: 0, y: 0, width: 400, height: 500 };
  if (!bounds) return null;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', [bounds.x, bounds.y, bounds.width, bounds.height].map(function(n) {
    return Number(n).toFixed(1);
  }).join(' '));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'detail-memo-svg');

  strokes.forEach(function(s) {
    if (!s || !s.d) return;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', s.color || '#111');
    p.setAttribute('stroke-width', String(s.width || 6));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('d', s.d);
    svg.appendChild(p);
  });

  wrap.appendChild(svg);
  return wrap;
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

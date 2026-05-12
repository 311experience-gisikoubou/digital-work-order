// ============================================================
//  詳細モーダル
// ============================================================
function showDetail(id) {
  const order = state.orders.find(o => o.id === id);
  if (!order) return;

  const ins = order.insuranceType === 'insurance' ? '保険' : '自費';
  const teeth = order.selectedTeeth?.join('、') || '未選択';

  document.getElementById('modal-detail-content').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tbody>
        ${row('医院名', order.clinicName)}
        ${row('担当医', order.doctorName)}
        ${row('患者名', order.patientName)}
        ${row('年齢', order.patientAge ? order.patientAge + '歳' : '—')}
        ${row('患歯', teeth)}
        ${row('区分', ins)}
        ${row('発注形態', (order.orderTypes||[]).join('、'))}
        ${row('義歯床', order.bedType)}
        ${row('装置', (order.devices||[]).join('、'))}
        ${order.claspType ? row('クラスプ', order.claspType) : ''}
        ${order.barType   ? row('バー', order.barType + 'バー') : ''}
        ${row('人工歯 前歯', order.toothAnterior)}
        ${row('人工歯 臼歯', order.toothPosterior)}
        ${row('色調', `${order.shadeGuide || ''} ${order.shadeNumber || ''}`)}
        ${row('GoA描記版', order.goaFlag)}
        ${row('納期', `${order.deliveryDate} ${order.ampm}`)}
        ${row('優先度', order.priority === 'urgent' ? '🚨 急ぎ' : '通常')}
        ${order.remarks ? row('備考', order.remarks) : ''}
      </tbody>
    </table>`;

  document.getElementById('modal-detail').classList.add('open');
}

function row(label, val) {
  if (!val) return '';
  return `<tr>
    <td style="padding:6px 10px;color:var(--text-secondary);white-space:nowrap;border-bottom:1px solid var(--border-color)">${label}</td>
    <td style="padding:6px 10px;border-bottom:1px solid var(--border-color)">${val}</td>
  </tr>`;
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

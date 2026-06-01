// ============================================================
//  PDF出力（jsPDF）
// ============================================================
function exportPDF(id) {
  const order = id ? state.orders.find(o => o.id === id) : null;
  if (!order) { showToast('PDF出力するデータがありません', 'error'); return; }

  // jsPDF はUnicode/日本語フォント未内蔵のため、
  // 本番では jsPDF + カスタム日本語フォント embedding が必要（要確認）
  // 暫定として英数字のみの出力デモ
  if (typeof window.jspdf === 'undefined') {
    showToast('jsPDF 読み込み中、しばらくお待ちください', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(14);
  doc.text('Dental Work Order', 20, 20);
  doc.setFontSize(10);
  doc.text(`Patient: ${order.patientName}`, 20, 35);
  doc.text(`Clinic: ${order.clinicName}`, 20, 45);
  if (order.nextAppt) {
    doc.text(`次回アポイント: ${order.nextAppt.replace('T', ' ')}`, 20, 53);
  }
  doc.text(`Delivery: ${order.deliveryDate}`, 20, 61);
  doc.text(`Type: ${order.insuranceType === 'insurance' ? 'Insurance' : 'Self-pay'}`, 20, 69);
  doc.text(`Bed: ${order.bedType || '-'}`, 20, 77);
  doc.text(`Clasp: ${order.claspType || '-'}`, 20, 85);
  doc.text(`Bar: ${order.barType ? order.barType + ' Bar' : '-'}`, 20, 93);
  const attachments = [order.hasTaigoha && '対合歯', order.hasBite && 'バイト', order.hasGoaChk && 'GoA'].filter(Boolean);
  if (attachments.length) {
    doc.text(`添付資料: ${attachments.join(' / ')}`, 20, 101);
  }
  doc.save(`order_${order.patientName}_${order.deliveryDate}.pdf`);
  showToast('PDFを出力しました');
}

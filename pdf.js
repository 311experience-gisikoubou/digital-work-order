// ============================================================
//  PDF出力（jsPDF）
//  NOTE: jsPDF 標準フォントはCJK未対応のため日本語は文字化けします。
//        本番運用時は日本語フォントの embedding が必要です。
// ============================================================
function exportPDF(id) {
  const order = id ? state.orders.find(o => o.id === id) : collectFormData();
  if (!order) { showToast('PDF出力するデータがありません', 'error'); return; }

  if (typeof window.jspdf === 'undefined') {
    showToast('jsPDF 読み込み中、しばらくお待ちください', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const ML = 15;   // left margin
  const PW = 180;  // content width
  let y = 22;

  function sect(label) {
    y += 2;
    doc.setFillColor(200, 200, 200);
    doc.rect(ML, y - 5, PW, 6.5, 'F');
    doc.setFontSize(9);
    doc.text(label, ML + 1, y);
    y += 8;
  }

  function row(label, value) {
    if (value === null || value === undefined || value === '' || value === false) return;
    doc.setFontSize(10);
    doc.text(label + ': ' + String(value), ML + 3, y);
    y += 6;
  }

  // タイトル
  doc.setFontSize(18);
  doc.text('歯科技工指示書', 105, y, { align: 'center' });
  doc.setFontSize(8);
  doc.text('発行日: ' + (order.issueDate || ''), 195, 14, { align: 'right' });
  y += 2;
  doc.setDrawColor(120, 120, 120);
  doc.line(ML, y, ML + PW, y);
  y += 8;

  // 医院・患者情報
  sect('医院・患者情報');
  row('医院名', order.clinicName);
  row('担当医', order.doctorName);
  row('患者名', order.patientName);
  const ag = [order.patientAge ? order.patientAge + '歳' : '', order.patientGender].filter(Boolean).join('  ');
  if (ag) row('年齢・性別', ag);

  // 納期・優先度
  sect('納期・優先度');
  row('納期', [order.deliveryDate, order.ampm].filter(Boolean).join(' '));
  if (order.priority && order.priority !== 'normal') row('優先度', order.priority);

  // 区分・発注形態
  sect('区分・発注形態');
  row('区分', order.insuranceType === 'insurance' ? '保険' : '自費');
  if (order.orderTypes && order.orderTypes.length) row('発注形態', order.orderTypes.join(' / '));
  if (order.repairDetail) row('修理詳細', order.repairDetail);

  // 補綴物指示
  sect('補綴物指示');
  row('床種類', order.bedType);
  if (order.devices && order.devices.length) row('装置', order.devices.join(' / '));
  row('クラスプ', order.claspType);
  if (order.barType) row('バー', order.barType + 'バー');

  // クラスプ配置詳細（claspState グローバルから生成）
  if (typeof claspState !== 'undefined') {
    const CN = { W:'キャストE', E:'エーカース', T:'双子鉤', R:'レスト', H:'フック', C:'コンビ鉤', I:'バー' };
    const items = [];
    Object.keys(claspState).forEach(function(num) {
      (claspState[num] || []).forEach(function(c) {
        if (c.isTwin1) return;
        var lbl = (CN[c.type] || c.type) + (c.dir ? '-' + c.dir : '');
        lbl += c.twinWith ? '(' + num + '<->' + c.twinWith + ')' : '(' + num + ')';
        items.push(lbl);
      });
    });
    if (items.length) row('クラスプ配置', items.join(' / '));
  }

  // 人工歯・色調（入力時のみ）
  if (order.toothAnterior || order.toothPosterior || order.shadeGuide || order.shadeNumber) {
    sect('人工歯・色調');
    row('前歯', order.toothAnterior);
    row('臼歯', order.toothPosterior);
    const shade = [order.shadeGuide, order.shadeNumber].filter(Boolean).join(' ');
    if (shade) row('色調', shade);
  }

  // オプション（選択時のみ）
  if (order.hasMetalup || order.hasKyoko || order.goaFlag || order.hasArticulator) {
    sect('オプション');
    if (order.hasMetalup) row('メタルアップ', order.metalupDetail || 'あり');
    if (order.hasKyoko) row('補強床', order.kyokoDetail || 'あり');
    if (order.goaFlag) row('GOA', order.goaFlag);
    if (order.hasArticulator) {
      row('咬合器', [order.articulatorType, order.articulatorDetail].filter(Boolean).join(' ') || 'あり');
    }
  }

  // 備考（入力時のみ）
  if (order.remarks) {
    sect('備考');
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(order.remarks, PW - 6);
    lines.forEach(function(line) { doc.text(line, ML + 3, y); y += 6; });
  }

  // フッター
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('※ 歯式図は別途添付 / システム出力', ML, 287);

  const fname = 'shijisho_' + (order.patientName || 'noname') + '_' + (order.deliveryDate || '').replace(/-/g, '') + '.pdf';
  doc.save(fname);
  showToast('PDFを出力しました');
}

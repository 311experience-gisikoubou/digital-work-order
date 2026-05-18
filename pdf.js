// ============================================================
//  PDF出力（window.print() 方式）
//  日本語はブラウザ/OSのフォントで表示。jsPDFは使用しない。
// ============================================================
function exportPDF(id) {
  const order = id ? state.orders.find(o => o.id === id) : collectFormData();
  if (!order) { showToast('PDF出力するデータがありません', 'error'); return; }

  const html = _buildPrintHTML(order);

  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(html);
  iframe.contentDocument.close();
  setTimeout(function() {
    iframe.contentWindow.focus();
    var removed = false;
    function cleanup() {
      if (removed) return;
      removed = true;
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }
    iframe.contentWindow.addEventListener('afterprint', cleanup);
    setTimeout(cleanup, 30000);
    iframe.contentWindow.print();
  }, 400);
  showToast('印刷ダイアログを開きます');
}

function _buildPrintHTML(order) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const lines = [];

  function sect(label) {
    lines.push('<div class="sect">' + esc(label) + '</div>');
  }

  function row(label, value) {
    if (value === null || value === undefined || value === '' || value === false) return;
    lines.push(
      '<div class="row">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="val">' + esc(String(value)) + '</span>' +
      '</div>'
    );
  }

  // 医院・患者情報
  sect('医院・患者情報');
  row('医院名', order.clinicName);
  row('担当医', order.doctorName);
  row('患者名', order.patientName);
  const ag = [order.patientAge ? order.patientAge + '歳' : '', order.patientGender].filter(Boolean).join('　');
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
        lbl += c.twinWith ? '（' + num + '↔' + c.twinWith + '）' : '（' + num + '）';
        items.push(lbl);
      });
    });
    if (items.length) row('クラスプ配置', items.join('　'));
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
    lines.push('<div class="remarks">' + esc(order.remarks).replace(/\n/g, '<br>') + '</div>');
  }

  const css = `
    @page { size: A5; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Meiryo', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', 'MS Gothic', sans-serif;
      font-size: 9pt;
      color: #000;
      line-height: 1.6;
    }
    h1 {
      text-align: center;
      font-size: 13pt;
      margin-bottom: 2mm;
      padding-bottom: 3mm;
      border-bottom: 1.5px solid #444;
    }
    .issue-date {
      text-align: right;
      font-size: 8pt;
      color: #555;
      margin-bottom: 3mm;
    }
    .sect {
      background: #ccc;
      padding: 1mm 2mm;
      font-size: 8pt;
      font-weight: bold;
      margin: 3mm 0 1mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row {
      display: flex;
      padding: 1mm 2mm;
      border-bottom: 1px dotted #bbb;
      min-height: 5mm;
      align-items: baseline;
    }
    .lbl {
      width: 25mm;
      flex-shrink: 0;
      color: #555;
      font-size: 8pt;
    }
    .val { flex: 1; }
    .remarks {
      padding: 2mm 3mm;
      line-height: 1.8;
    }
    .footer {
      margin-top: 10mm;
      padding-top: 2mm;
      border-top: 1px solid #bbb;
      font-size: 6pt;
      color: #999;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  return '<!DOCTYPE html>\n' +
    '<html lang="ja">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<title>歯科技工指示書</title>\n' +
    '<style>' + css + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<h1>歯科技工指示書</h1>\n' +
    '<div class="issue-date">発行日：' + esc(order.issueDate || '') + '</div>\n' +
    lines.join('\n') + '\n' +
    '<div class="footer">※ 歯式図は別途添付　／　システム出力</div>\n' +
    '</body>\n' +
    '</html>';
}

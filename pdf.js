// ============================================================
//  PDF出力（window.print() 方式）
//  日本語はブラウザ/OSのフォントで表示。jsPDFは使用しない。
// ============================================================
function exportPDF(id) {
  const order = id ? state.orders.find(o => o.id === id) : collectFormData();
  if (!order) { showToast('PDF出力するデータがありません', 'error'); return; }

  const chartWrap = document.querySelector('.chart-wrap');
  const chartHtml = chartWrap ? chartWrap.outerHTML : '';
  const html = _buildPrintHTML(order, chartHtml);

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
  }, 2000);
  showToast('印刷ダイアログを開きます');
}

function _buildPrintHTML(order, chartHtml) {
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

  // クラスプ配置詳細（claspState グローバルから集計）
  if (typeof claspState !== 'undefined') {
    const CN = { W:'キャストE', E:'エーカース', T:'双子鉤', R:'レスト', H:'フック', C:'コンビ鉤', I:'バー' };
    const counts = {};
    Object.keys(claspState).forEach(function(num) {
      (claspState[num] || []).forEach(function(c) {
        if (c.isTwin1) return;
        counts[c.type] = (counts[c.type] || 0) + 1;
      });
    });
    const items = Object.keys(counts).map(function(t) {
      var unit = t === 'T' ? '組' : '本';
      return (CN[t] || t) + ' ' + counts[t] + unit;
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
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Meiryo', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', 'MS Gothic', sans-serif;
      font-size: 8pt;
      color: #000;
      line-height: 1.5;
    }
    .slip {
      width: 210mm;
      height: 148mm;
      padding: 5mm 8mm 4mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .perforated {
      border-top: 1px dashed #aaa;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .slip-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-bottom: 2mm;
      border-bottom: 1.5px solid #444;
      margin-bottom: 2mm;
      flex-shrink: 0;
    }
    h1 { font-size: 11pt; font-weight: bold; }
    .issue-date { font-size: 7pt; color: #555; }
    .sect {
      background: #ccc;
      padding: 0.5mm 2mm;
      font-size: 7pt;
      font-weight: bold;
      margin: 2mm 0 0.5mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row {
      display: flex;
      padding: 0.5mm 2mm;
      border-bottom: 1px dotted #bbb;
      min-height: 4mm;
      align-items: baseline;
    }
    .lbl {
      width: 20mm;
      flex-shrink: 0;
      color: #555;
      font-size: 7pt;
    }
    .val { flex: 1; }
    .remarks { padding: 1mm 3mm; line-height: 1.6; }
    .print-body {
      display: flex;
      gap: 3mm;
      align-items: flex-start;
      flex: 1;
      overflow: hidden;
    }
    .chart-col { flex: 0 0 52mm; }
    .info-col { flex: 1; min-width: 0; overflow: hidden; }
    .chart-wrap {
      position: relative; display: block;
      width: 52mm; height: 88mm;
      overflow: hidden; border-radius: 0;
      background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .chart-wrap img { display:block !important; width:52mm !important; height:88mm !important; }
    .chart-wrap svg,
    .chart-wrap .overlay-svg {
      position:absolute !important; top:0 !important; left:0 !important;
      width:52mm !important; height:88mm !important;
    }
    .tooth-el { fill:transparent; stroke:transparent; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  var slipInner =
    '<div class="slip-header">' +
    '<h1>歯科技工指示書</h1>' +
    '<div class="issue-date">発行日：' + esc(order.issueDate || '') + '</div>' +
    '</div>' +
    '<div class="print-body">' +
    (chartHtml ? '<div class="chart-col">' + chartHtml + '</div>' : '') +
    '<div class="info-col">' + lines.join('\n') + '</div>' +
    '</div>';

  return '<!DOCTYPE html>\n' +
    '<html lang="ja">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<title>歯科技工指示書</title>\n' +
    '<style>' + css + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="slip">' + slipInner + '</div>\n' +
    '<div class="perforated"></div>\n' +
    '<div class="slip">' + slipInner + '</div>\n' +
    '</body>\n' +
    '</html>';
}

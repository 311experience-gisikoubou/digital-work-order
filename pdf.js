// ============================================================
//  PDF出力（window.print() 方式）
//  日本語はブラウザ/OSのフォントで表示。jsPDFは使用しない。
// ============================================================
function exportPDF(id, id2) {
  var order1 = id ? state.orders.find(function(o){ return o.id === id; }) : collectFormData();
  if (!order1) { showToast('PDF出力するデータがありません', 'error'); return; }

  var order2 = (id2 != null)
    ? (state.orders.find(function(o){ return o.id === id2; }) || null)
    : null;

  var chartWrap = document.querySelector('.chart-wrap');
  var chartHtml = chartWrap ? chartWrap.outerHTML : '';
  var html = _buildPrintHTML(order1, chartHtml, order2);

  var iframe = document.createElement('iframe');
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

function _buildPrintHTML(order1, chartHtml, order2) {
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function sect(arr, label, dim) {
    arr.push('<div class="sect' + (dim ? ' dim' : '') + '">' + esc(label) + '</div>');
  }
  function row(arr, label, value, dim) {
    if (value === null || value === undefined || value === '' || value === false) return;
    arr.push(
      '<div class="row' + (dim ? ' dim' : '') + '">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="val">' + esc(String(value)) + '</span>' +
      '</div>'
    );
  }

  // ── 1件分のスリップHTMLを生成（orderがnullなら空スリップ）──
  function buildSlip(order) {
    if (!order) {
      return '<div class="slip-header"><h1>歯科技工指示書</h1><div class="issue-date"></div></div>' +
             '<div class="slip-empty"></div>' +
             '<div class="studio-sig">咬み合わせ医療会　こよし技工房</div>';
    }

    var L = [];
    var R = [];

    var keyDelivery = [
      order.deliveryDate ? formatJapaneseEraDate(order.deliveryDate) : '',
      order.ampm
    ].filter(Boolean).join(' ');
    var keyOrderType = order.orderTypes && order.orderTypes.length
      ? order.orderTypes.join(' / ') : '';

    // ── 左列：補足情報 ─────────────────────────────
    if (order.doctorName) row(L, '担当医', order.doctorName);
    var ag = [order.patientAge ? order.patientAge + '歳' : '', order.patientGender].filter(Boolean).join('　');
    if (ag) row(L, '年齢・性別', ag);
    row(L, '区分', order.insuranceType === 'insurance' ? '保険' : '自費');
    if (order.priority && order.priority !== 'normal') row(L, '優先度', order.priority);
    if (order.repairDetail) row(L, '修理詳細', order.repairDetail);

    // ── 歯式番号欄（7番まで・欠損部を強調）─────────
    var missingSet = new Set(order.selectedTeeth || []);
    var tnSpan = function(fdiNum, posNum) {
      var isMissing = missingSet.has(fdiNum);
      return '<span class="tn-num' + (isMissing ? ' tn-missing' : '') + '">' + posNum + '</span>';
    };
    var upperRow =
      '<div class="tn-row">' +
      tnSpan(17,7) + tnSpan(16,6) + tnSpan(15,5) + tnSpan(14,4) + tnSpan(13,3) + tnSpan(12,2) + tnSpan(11,1) +
      '<span class="tn-mid">│</span>' +
      tnSpan(21,1) + tnSpan(22,2) + tnSpan(23,3) + tnSpan(24,4) + tnSpan(25,5) + tnSpan(26,6) + tnSpan(27,7) +
      '</div>';
    var lowerRow =
      '<div class="tn-row">' +
      tnSpan(47,7) + tnSpan(46,6) + tnSpan(45,5) + tnSpan(44,4) + tnSpan(43,3) + tnSpan(42,2) + tnSpan(41,1) +
      '<span class="tn-mid">│</span>' +
      tnSpan(31,1) + tnSpan(32,2) + tnSpan(33,3) + tnSpan(34,4) + tnSpan(35,5) + tnSpan(36,6) + tnSpan(37,7) +
      '</div>';
    L.push('<div class="tn-block">' + upperRow + '<div class="tn-sep"></div>' + lowerRow + '</div>');

    // ── 右列：補綴指示 ─────────────────────────────
    sect(R, '補綴物指示');
    row(R, '床種類', order.bedType);
    if (order.devices && order.devices.length) row(R, '装置', order.devices.join(' / '));
    row(R, 'クラスプ', order.claspType);
    if (order.barType) row(R, 'バー', order.barType + 'バー');

    if (typeof claspState !== 'undefined') {
      var CN = { W:'キャストE', E:'エーカース', T:'双子鉤', R:'レスト', H:'フック', C:'コンビ鉤', I:'バー' };
      var counts = {};
      Object.keys(claspState).forEach(function(num) {
        (claspState[num] || []).forEach(function(c) {
          if (c.isTwin1) return;
          counts[c.type] = (counts[c.type] || 0) + 1;
        });
      });
      var items = Object.keys(counts).map(function(t) {
        var unit = t === 'T' ? '組' : '本';
        return (CN[t] || t) + ' ' + counts[t] + unit;
      });
      if (items.length) row(R, 'クラスプ配置', items.join('　'));
    }

    // ── 右列：人工歯・色調（シェード常時表示）─────
    var shade = [order.shadeGuide, order.shadeNumber].filter(Boolean).join(' ');
    sect(R, '人工歯・色調');
    row(R, 'シェード', shade || '＿＿＿＿');
    row(R, '前歯', order.toothAnterior, true);
    row(R, '臼歯', order.toothPosterior, true);

    // ── 右列：オプション（dim）─────────────────────
    if (order.hasMetalup || order.hasKyoko || order.goaFlag || order.hasArticulator) {
      sect(R, 'オプション', true);
      if (order.hasMetalup) row(R, 'メタルアップ', order.metalupDetail || 'あり', true);
      if (order.hasKyoko) row(R, '補強床', order.kyokoDetail || 'あり', true);
      if (order.goaFlag) row(R, 'GOA', order.goaFlag, true);
      if (order.hasArticulator) {
        row(R, '咬合器', [order.articulatorType, order.articulatorDetail].filter(Boolean).join(' ') || 'あり', true);
      }
    }

    // ── 右列：備考（常時）──────────────────────────
    sect(R, '備考');
    R.push('<div class="remarks">' + (order.remarks ? esc(order.remarks).replace(/\n/g, '<br>') : '') + '</div>');

    var keyBar =
      '<div class="key-bar">' +
      '<div class="key-item"><span class="key-lbl">患者名</span><span class="key-val-primary">' + esc(order.patientName || '—') + '</span></div>' +
      '<div class="key-item"><span class="key-lbl">セット日</span><span class="key-val-primary">' + esc(keyDelivery || '—') + '</span></div>' +
      '<div class="key-item"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></div>' +
      '<div class="key-item"><span class="key-lbl">発注形態</span><span class="key-val">' + esc(keyOrderType || '—') + '</span></div>' +
      '</div>';

    return '<div class="slip-header"><h1>歯科技工指示書</h1>' +
      '<div class="issue-date">発行日：' + esc(order.issueDate ? formatJapaneseEraDate(order.issueDate) : '') + '</div></div>' +
      '<div class="print-body">' +
      (chartHtml ? '<div class="chart-col">' + chartHtml + '</div>' : '') +
      '<div class="info-wrap">' +
      keyBar +
      '<div class="info-2col">' +
      '<div class="info-left">' + L.join('\n') + '</div>' +
      '<div class="info-right">' + R.join('\n') + '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="studio-sig">咬み合わせ医療会　こよし技工房</div>';
  }

  var css = `
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Meiryo', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', 'MS Gothic', sans-serif;
      font-size: 7.5pt;
      color: #000;
      line-height: 1.5;
    }
    .slip {
      width: 210mm;
      height: 148mm;
      padding: 4mm 6mm 3mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      border: 0.5mm solid #555;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .perforated {
      height: 1mm;
      border-top: 0.5mm dashed #888;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .slip-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-bottom: 1.5mm;
      border-bottom: 0.8mm solid #333;
      margin-bottom: 2mm;
      flex-shrink: 0;
    }
    h1 { font-size: 10pt; font-weight: bold; letter-spacing: 0.05em; }
    .issue-date { font-size: 6pt; color: #888; }
    .key-bar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1mm 3mm;
      padding: 1.5mm 2mm;
      background: #e8e8e8;
      border: 0.5mm solid #444;
      margin-bottom: 2mm;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .key-item { display: flex; align-items: baseline; gap: 1.5mm; overflow: hidden; }
    .key-lbl { font-size: 6pt; color: #666; flex-shrink: 0; white-space: nowrap; }
    .key-val { font-size: 11pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .key-val-primary { font-size: 11pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sect {
      background: #bbb;
      padding: 0.3mm 1.5mm;
      font-size: 6.5pt;
      font-weight: bold;
      margin: 1.5mm 0 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row { display: flex; padding: 0.3mm 1.5mm; border-bottom: 0.3mm solid #ccc; min-height: 4.5mm; align-items: center; }
    .lbl { width: 14mm; flex-shrink: 0; color: #444; font-size: 6.5pt; }
    .val { flex: 1; font-size: 7.5pt; }
    .sect.dim { background: #d4d4d4; color: #666; font-size: 6pt; }
    .row.dim { min-height: 3.5mm; border-bottom: 0.2mm solid #ddd; }
    .row.dim .lbl { color: #888; font-size: 6pt; }
    .row.dim .val { font-size: 7.5pt; color: #666; }
    .tn-block { margin: 2mm 0 1mm; border: 0.3mm solid #ccc; padding: 1mm; }
    .tn-row { display: flex; font-size: 5.5pt; padding: 0.2mm 0; }
    .tn-num { flex: 1; text-align: center; color: #ddd; }
    .tn-num.tn-missing { color: #000; font-weight: bold; }
    .tn-mid { flex: 0 0 auto; padding: 0 0.5mm; color: #333; font-weight: bold; }
    .tn-sep { border-top: 0.3mm solid #ccc; margin: 0.5mm 0; }
    .remarks { padding: 1mm 2mm; line-height: 2.0; min-height: 16mm; border-top: 0.3mm solid #ccc; }
    .slip-empty { flex: 1; }
    .studio-sig { text-align: right; font-size: 9pt; font-weight: bold; color: #555; padding-top: 1mm; line-height: 1.5; flex-shrink: 0; }
    .print-body { display: flex; gap: 4mm; align-items: flex-start; flex: 1; overflow: hidden; }
    .chart-col { flex: 0 0 68mm; align-self: center; }
    .info-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
    .info-2col { display: flex; gap: 2mm; flex: 1; overflow: hidden; }
    .info-left { flex: 1; min-width: 0; overflow: hidden; }
    .info-right { flex: 1; min-width: 0; overflow: hidden; }
    .chart-wrap {
      position: relative; display: block;
      width: 68mm; height: 110mm;
      overflow: hidden; border-radius: 0; background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .chart-wrap img { display:block !important; width:68mm !important; height:110mm !important; }
    .chart-wrap svg, .chart-wrap .overlay-svg {
      position:absolute !important; top:0 !important; left:0 !important;
      width:68mm !important; height:110mm !important;
    }
    .tooth-el { fill:transparent; stroke:transparent; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<title>歯科技工指示書</title>\n' +
    '<style>' + css + '</style>\n</head>\n<body>\n' +
    '<div class="slip">' + buildSlip(order1) + '</div>\n' +
    '<div class="perforated"></div>\n' +
    '<div class="slip">' + buildSlip(order2 || null) + '</div>\n' +
    '</body>\n</html>';
}

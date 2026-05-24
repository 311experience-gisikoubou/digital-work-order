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

  const L = [];  // 左列（補足情報）
  const R = [];  // 右列（補綴指示）

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

  // ── 最重要4項目（key-bar 用） ────────────────
  const keyDelivery = [order.deliveryDate, order.ampm].filter(Boolean).join(' ');
  const keyOrderType = order.orderTypes && order.orderTypes.length
    ? order.orderTypes.join(' / ') : '';

  // ── 左列：補足情報（小さめ） ─────────────────
  if (order.doctorName) row(L, '担当医', order.doctorName);
  const ag = [order.patientAge ? order.patientAge + '歳' : '', order.patientGender].filter(Boolean).join('　');
  if (ag) row(L, '年齢・性別', ag);
  row(L, '区分', order.insuranceType === 'insurance' ? '保険' : '自費');
  if (order.priority && order.priority !== 'normal') row(L, '優先度', order.priority);
  if (order.repairDetail) row(L, '修理詳細', order.repairDetail);

  // ── 右列：補綴指示（中重要） ─────────────────
  sect(R, '補綴物指示');
  row(R, '床種類', order.bedType);
  if (order.devices && order.devices.length) row(R, '装置', order.devices.join(' / '));
  row(R, 'クラスプ', order.claspType);
  if (order.barType) row(R, 'バー', order.barType + 'バー');

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
    if (items.length) row(R, 'クラスプ配置', items.join('　'));
  }

  // ── 右列：低重要（dim） ───────────────────────
  if (order.toothAnterior || order.toothPosterior || order.shadeGuide || order.shadeNumber) {
    sect(R, '人工歯・色調', true);
    row(R, '前歯', order.toothAnterior, true);
    row(R, '臼歯', order.toothPosterior, true);
    const shade = [order.shadeGuide, order.shadeNumber].filter(Boolean).join(' ');
    if (shade) row(R, '色調', shade, true);
  }

  if (order.hasMetalup || order.hasKyoko || order.goaFlag || order.hasArticulator) {
    sect(R, 'オプション', true);
    if (order.hasMetalup) row(R, 'メタルアップ', order.metalupDetail || 'あり', true);
    if (order.hasKyoko) row(R, '補強床', order.kyokoDetail || 'あり', true);
    if (order.goaFlag) row(R, 'GOA', order.goaFlag, true);
    if (order.hasArticulator) {
      row(R, '咬合器', [order.articulatorType, order.articulatorDetail].filter(Boolean).join(' ') || 'あり', true);
    }
  }

  // ── 右列：備考（常時） ───────────────────────
  sect(R, '備考');
  R.push('<div class="remarks">' + (order.remarks ? esc(order.remarks).replace(/\n/g, '<br>') : '') + '</div>');

  const css = `
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
    .issue-date { font-size: 6.5pt; color: #555; }
    /* ── key-bar: 最重要4項目 ── */
    .key-bar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5mm 3mm;
      padding: 1.5mm 2mm;
      background: #e8e8e8;
      border: 0.5mm solid #444;
      margin-bottom: 2mm;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .key-item {
      display: flex;
      align-items: baseline;
      gap: 1.5mm;
      overflow: hidden;
    }
    .key-lbl {
      font-size: 6pt;
      color: #666;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .key-val {
      font-size: 9.5pt;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* ── 通常行 ── */
    .sect {
      background: #bbb;
      padding: 0.3mm 1.5mm;
      font-size: 6.5pt;
      font-weight: bold;
      margin: 1.5mm 0 0mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row {
      display: flex;
      padding: 0.3mm 1.5mm;
      border-bottom: 0.3mm solid #ccc;
      min-height: 4.5mm;
      align-items: center;
    }
    .lbl {
      width: 14mm;
      flex-shrink: 0;
      color: #444;
      font-size: 6.5pt;
    }
    .val { flex: 1; font-size: 7.5pt; }
    /* ── dim: 低重要 ── */
    .sect.dim {
      background: #d4d4d4;
      color: #666;
      font-size: 6pt;
    }
    .row.dim {
      min-height: 3.5mm;
      border-bottom: 0.2mm solid #ddd;
    }
    .row.dim .lbl { color: #888; font-size: 6pt; }
    .row.dim .val { font-size: 6.5pt; color: #555; }
    /* ── 備考 ── */
    .remarks {
      padding: 1mm 2mm;
      line-height: 2.0;
      min-height: 16mm;
      border-top: 0.3mm solid #ccc;
    }
    /* ── レイアウト ── */
    .print-body {
      display: flex;
      gap: 4mm;
      align-items: flex-start;
      flex: 1;
      overflow: hidden;
    }
    .chart-col { flex: 0 0 68mm; }
    .info-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .info-2col {
      display: flex;
      gap: 2mm;
      flex: 1;
      overflow: hidden;
    }
    .info-left { flex: 0 0 42mm; min-width: 0; overflow: hidden; }
    .info-right { flex: 1; min-width: 0; overflow: hidden; }
    .chart-wrap {
      position: relative; display: block;
      width: 68mm; height: 110mm;
      overflow: hidden; border-radius: 0;
      background: #fff;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .chart-wrap img { display:block !important; width:68mm !important; height:110mm !important; }
    .chart-wrap svg,
    .chart-wrap .overlay-svg {
      position:absolute !important; top:0 !important; left:0 !important;
      width:68mm !important; height:110mm !important;
    }
    .tooth-el { fill:transparent; stroke:transparent; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  var keyBar =
    '<div class="key-bar">' +
    '<div class="key-item"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></div>' +
    '<div class="key-item"><span class="key-lbl">患者名</span><span class="key-val">' + esc(order.patientName || '—') + '</span></div>' +
    '<div class="key-item"><span class="key-lbl">納　期</span><span class="key-val">' + esc(keyDelivery || '—') + '</span></div>' +
    '<div class="key-item"><span class="key-lbl">発注形態</span><span class="key-val">' + esc(keyOrderType || '—') + '</span></div>' +
    '</div>';

  var slipInner =
    '<div class="slip-header">' +
    '<h1>歯科技工指示書</h1>' +
    '<div class="issue-date">発行日：' + esc(order.issueDate || '') + '</div>' +
    '</div>' +
    '<div class="print-body">' +
    (chartHtml ? '<div class="chart-col">' + chartHtml + '</div>' : '') +
    '<div class="info-wrap">' +
    keyBar +
    '<div class="info-2col">' +
    '<div class="info-left">' + L.join('\n') + '</div>' +
    '<div class="info-right">' + R.join('\n') + '</div>' +
    '</div>' +
    '</div>' +
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

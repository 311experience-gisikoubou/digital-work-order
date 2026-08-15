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
  var sourceMemoStrokes = Array.isArray(order1.memoStrokes)
    ? order1.memoStrokes
    : (typeof memoStrokes !== 'undefined' && Array.isArray(memoStrokes) ? memoStrokes : []);
  var memoHtml = buildMemoSvgHTML(sourceMemoStrokes);
  var html = _buildPrintHTML(order1, chartHtml, order2, memoHtml);

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

function escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildMemoSvgHTML(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0) return '';
  var bounds = (typeof getMemoStrokeBounds === 'function')
    ? getMemoStrokeBounds(strokes, 18, 1.2)
    : { x: 0, y: 0, width: 400, height: 500 };
  if (!bounds) return '';
  var paths = strokes.map(function(s) {
    if (!s || !s.d) return '';
    return '<path class="draw-path" fill="none" stroke="' + escAttr(s.color || '#111') +
      '" stroke-width="' + escAttr(s.width || 6) +
      '" stroke-linecap="round" stroke-linejoin="round" d="' + escAttr(s.d) + '"></path>';
  }).join('');
  if (!paths) return '';
  return '<svg class="memo-svg" viewBox="' +
    [bounds.x, bounds.y, bounds.width, bounds.height].map(function(n){ return Number(n).toFixed(1); }).join(' ') +
    '" preserveAspectRatio="xMidYMid meet">' + paths + '</svg>';
}

function _buildPrintHTML(order1, chartHtml, order2, memoHtml) {
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
    var textValue = String(value);
    var orderParts = textValue.split(/\s*\/\s*/).filter(Boolean);
    var orderTypeMap = { '試適': true, '完成': true, '修理': true, '再排列': true };
    if (orderParts.length && orderParts.every(function(v) { return orderTypeMap[v]; })) {
      badgeRow(arr, label, orderParts, 'order');
      return;
    }
    if (textValue === '保険' || textValue === '自費') {
      badgeRow(arr, label, textValue, 'insurance');
      return;
    }
    arr.push(
      '<div class="row' + (dim ? ' dim' : '') + '">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="val">' + esc(textValue) + '</span>' +
      '</div>'
    );
  }
  function gridSect(arr, label, dim) {
    arr.push('<div class="grid-section' + (dim ? ' dim' : '') + '">' + esc(label) + '</div>');
  }
  function gridRow(arr, label, value, dim, forceFull, extraClass) {
    if (value === null || value === undefined || value === '' || value === false) return;
    var text = String(value);
    var full = forceFull || text.length > 16;
    arr.push(
      '<div class="grid-row' + (dim ? ' dim' : '') + (full ? ' full' : '') + (extraClass ? ' ' + extraClass : '') + '">' +
      '<span class="grid-lbl">' + esc(label) + '</span>' +
      '<span class="grid-val">' + esc(text) + '</span>' +
      '</div>'
    );
  }
  function gridItem(label, value, dim, forceFull) {
    if (value === null || value === undefined || value === '' || value === false) return null;
    return { label: label, value: value, dim: !!dim, forceFull: !!forceFull, weight: forceFull ? 2 : 1 };
  }
  function pushGridItem(arr, item) {
    if (!item) return;
    gridRow(arr, item.label, item.value, item.dim, item.forceFull);
  }
  function badgeClass(value, prefix) {
    var text = String(value || '');
    if (text.indexOf('試適') >= 0) return prefix + '-tryin';
    if (text.indexOf('完成') >= 0) return prefix + '-finish';
    if (text.indexOf('修理') >= 0) return prefix + '-repair';
    if (text.indexOf('再排列') >= 0) return prefix + '-rearrange';
    if (text.indexOf('保険') >= 0) return prefix + '-insurance';
    if (text.indexOf('自費') >= 0) return prefix + '-private';
    return prefix + '-default';
  }
  function badgeRow(arr, label, values, prefix) {
    var list = Array.isArray(values) ? values.filter(Boolean) : [values].filter(Boolean);
    if (!list.length) return;
    arr.push(
      '<div class="row badge-row">' +
      '<span class="lbl">' + esc(label) + '</span>' +
      '<span class="val badge-list">' +
      list.map(function(v) {
        return '<span class="pdf-badge ' + badgeClass(v, prefix) + '">' + esc(v) + '</span>';
      }).join('') +
      '</span></div>'
    );
  }
  function displayGender(value) {
    if (value === 'male') return '男性';
    if (value === 'female') return '女性';
    return value || '';
  }

  // 月日曜日のみの日付フォーマット（PDF内の納品日・次回Ap用）
  function formatMonthDay(dateStr) {
    if (!dateStr) return '';
    try {
      var parts = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!parts) return dateStr;
      var m = parseInt(parts[2], 10), day = parseInt(parts[3], 10);
      var d = new Date(parseInt(parts[1], 10), m - 1, day);
      var weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      return m + '月' + day + '日(' + weekdays[d.getDay()] + ')';
    } catch (e) { return dateStr; }
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

    var keyDelivery = order.deliveryDate ? formatMonthDay(order.deliveryDate) : '';

    var nextApDate = '';
    var nextApTime = '';
    if (order.nextAppointment) {
      var naParts = order.nextAppointment.split('T');
      nextApDate = naParts[0] ? formatMonthDay(naParts[0]) : '';
      nextApTime = naParts[1] ? naParts[1].slice(0, 5) : '';
    }
    var hasNextAp = nextApDate || nextApTime;
    var keyOrderType = order.orderTypes && order.orderTypes.length
      ? order.orderTypes.join(' / ') : '';

    // ── 左列：補足情報 ─────────────────────────────
    if (order.doctorName) row(L, '担当医', order.doctorName);
    var ag = [order.patientAge ? order.patientAge + '歳' : '', displayGender(order.patientGender)].filter(Boolean).join('　');
    if (ag) row(L, '年齢・性別', ag);
    if (keyOrderType) row(L, '発注形態', keyOrderType);
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
      var CN = { W:'W ワイヤークラスプ', E:'C キャスト鉤', T:'T 双子鉤', R:'R レスト', CR:'CR キャストレスト', H:'H フック', C:'CM コンビ鉤', I:'I Iバー', WI:'WI ワイヤーIバー' };
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
    if (order.hasMetalup || order.hasKyoko || order.taigoha || order.bite || order.goaFlag || order.hasArticulator) {
      sect(R, 'オプション', true);
      if (order.hasMetalup) row(R, 'メタルアップ', order.metalupDetail || 'あり', true);
      if (order.hasKyoko) row(R, '補強床', order.kyokoDetail || 'あり', true);
      if (order.taigoha) row(R, '対合歯', 'あり', true);
      if (order.bite)    row(R, 'バイト',  'あり', true);
      if (order.goaFlag) row(R, 'GoA',    'あり', true);
      if (order.hasArticulator) {
        row(R, '咬合器', [order.articulatorType, order.articulatorDetail].filter(Boolean).join(' ') || 'あり', true);
      }
    }

    var compactR = [];
    gridSect(compactR, '補綴物指示');
    gridRow(compactR, '床種', order.bedType);
    if (order.devices && order.devices.length) gridRow(compactR, '装置', order.devices.join(' / '), false, true);
    gridRow(compactR, 'クラスプ', order.claspType, false, true, 'clasp-choice');
    if (order.barType) gridRow(compactR, 'バー', order.barType + 'バー');
    if (items && items.length) gridRow(compactR, '配置', items.join('　'), false, true);
    var deviceCountItems = [];
    var claspTotal = 0;
    if (typeof counts !== 'undefined') {
      Object.keys(counts).forEach(function(t) { claspTotal += counts[t] || 0; });
    }
    if (claspTotal > 0) deviceCountItems.push('クラスプ ×' + claspTotal);
    if (order.barType) deviceCountItems.push(order.barType + ' ×1');
    if (deviceCountItems.length) gridRow(compactR, '本数', deviceCountItems.join(' / '), false, true);

    gridSect(compactR, '人工歯・色調');
    gridRow(compactR, '色調', shade || '????');
    gridRow(compactR, '前歯', order.toothAnterior, true);
    gridRow(compactR, '臼歯', order.toothPosterior, true);

    if (order.hasMetalup || order.hasKyoko || order.taigoha || order.bite || order.goaFlag || order.hasArticulator) {
      gridSect(compactR, 'オプション', true);
      if (order.taigoha) gridRow(compactR, '対合歯', 'あり', true);
      if (order.bite) gridRow(compactR, 'バイト', 'あり', true);
      if (order.goaFlag) gridRow(compactR, 'GoA', 'あり', true);
      if (order.hasArticulator) {
        gridRow(compactR, '咬合器', order.articulatorType || 'あり', true);
        gridRow(compactR, '咬合器詳細', order.articulatorDetail, true, true);
      }
      if (order.hasMetalup) gridRow(compactR, 'メタルUP', order.metalupDetail || 'あり', true);
      if (order.hasKyoko) gridRow(compactR, '補強床', order.kyokoDetail || 'あり', true);
    }
    R = compactR;

    var spareR = [];
    function infoWeight(html) {
      if (String(html).indexOf('grid-row') < 0) return 0;
      return String(html).indexOf(' full') >= 0 ? 2 : 1;
    }
    var compactWeight = R.reduce(function(sum, html) { return sum + infoWeight(html); }, 0);
    while (compactWeight > 10) {
      var movedIndex = -1;
      for (var ri = R.length - 1; ri >= 0; ri--) {
        if (String(R[ri]).indexOf('grid-row') >= 0 && String(R[ri]).indexOf(' full') >= 0) {
          movedIndex = ri;
          break;
        }
      }
      if (movedIndex < 0) break;
      var moved = R.splice(movedIndex, 1)[0];
      spareR.unshift(moved);
      compactWeight -= infoWeight(moved);
    }

    var remarksText = String(order.remarks || '');
    var remarksLineCount = remarksText ? remarksText.split(/\r\n|\r|\n/).length : 0;
    var memoPathCount = memoHtml ? (memoHtml.match(/class="draw-path"/g) || []).length : 0;
    var memoScore = memoPathCount ? Math.min(180, 45 + memoPathCount * 5) : 0;
    var remarksScore = remarksText.replace(/\s/g, '').length + Math.max(0, remarksLineCount - 1) * 18 + memoScore;
    var notesLevel = remarksScore > 620 ? ' notes-ultra' : (remarksScore > 420 ? ' notes-dense' : (remarksScore > 240 ? ' notes-long' : (remarksScore > 120 ? ' notes-medium' : '')));
    var hasMemoClass = memoHtml ? ' notes-has-memo' : '';
    var infoWrapClass = notesLevel ? 'info-wrap notes-grow' + notesLevel : 'info-wrap';

    var notesHtml =
      '<div class="notes-area' + notesLevel + hasMemoClass + '">' +
      '<div class="notes-title">備考・手書きメモ</div>' +
      '<div class="notes-body">' +
      '<div class="remarks">' + (remarksText ? esc(remarksText).replace(/\n/g, '<br>') : '') + '</div>' +
      (memoHtml ? '<div class="memo-col">' + memoHtml + '</div>' : '') +
      '</div></div>';
    var spareText = spareR.join('');
    var spareLevel = spareText.length > 120 ? ' spare-ultra' : (spareText.length > 70 || spareR.length > 2 ? ' spare-dense' : '');
    var chartSpareHtml = spareR.length
      ? '<div class="chart-spare' + spareLevel + '"><div class="chart-spare-title">補足技工情報</div>' + spareR.join('\n') + '</div>'
      : '';
    var studioSigHtml = '<div class="studio-sig">咬み合わせ医療会　こよし技工房</div>';

    var keyBar =
      '<div class="key-bar">' +
      '<div class="key-item key-patient"><span class="key-lbl">患者名</span><span class="key-val-primary">' + esc(order.patientName || '—') + '</span></div>' +
      '<div class="key-item key-delivery"><span class="key-lbl">納品日</span><span class="key-val-primary">' + esc(keyDelivery || '—') + '</span></div>' +
      (hasNextAp
        ? '<div class="key-item"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></div>' +
          '<div class="key-item key-next-ap"><span class="key-lbl">次回Ap</span>' +
          '<div class="key-val-stack">' +
          (nextApDate ? '<span class="key-val">' + esc(nextApDate) + '</span>' : '') +
          (nextApTime ? '<span class="key-time">' + esc(nextApTime) + '</span>' : '') +
          '</div></div>'
        : '<div class="key-item key-full"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></div>'
      ) +
      '</div>';

    return '<div class="slip-header"><h1>歯科技工指示書</h1>' +
      '<div class="issue-date">発行日：' + esc(order.issueDate ? formatJapaneseEraDate(order.issueDate) : '') + '</div></div>' +
      '<div class="print-body">' +
      (chartHtml ? '<div class="chart-col">' + chartHtml + chartSpareHtml + studioSigHtml + '</div>' : '') +
      '<div class="' + infoWrapClass + '">' +
      keyBar +
      '<div class="info-2col">' +
      '<div class="info-left">' + L.join('\n') + '</div>' +
      '<div class="info-right">' + R.join('\n') + '</div>' +
      '</div>' +
      notesHtml +
      '</div>' +
      '</div>';
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
    h1 { font-size: 12pt; font-weight: bold; letter-spacing: 0.05em; flex-shrink: 0; }
    .issue-date { font-size: 8pt; color: #555; }
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
    .key-item { display: flex; align-items: baseline; gap: 1.5mm; min-width: 0; overflow: hidden; }
    .key-next-ap { align-items: flex-start; }
    .key-full { grid-column: 1 / -1; }
    .key-val-stack { display: flex; flex-direction: column; line-height: 1.4; min-width: 0; }
    .key-time { font-size: 9pt; font-weight: bold; color: #555; }
    .key-lbl { font-size: 6pt; color: #666; flex-shrink: 0; white-space: nowrap; }
    .key-val { font-size: 11pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .key-val-primary { font-size: 11pt; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .key-patient .key-val-primary { font-size: 16pt; line-height: 1.05; }
    .key-delivery .key-val-primary,
    .key-next-ap .key-val { font-size: 16pt; line-height: 1.05; }
    .key-next-ap .key-val-stack { flex-direction: row; align-items: baseline; gap: 2mm; line-height: 1.05; }
    .key-next-ap .key-time { font-size: 15pt; line-height: 1.05; }
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
    .badge-row { align-items: flex-start; }
    .badge-list { display: flex; flex-wrap: wrap; gap: 0.8mm; }
    .pdf-badge {
      display: inline-block;
      padding: 0.25mm 1.2mm;
      border: 0.25mm solid #777;
      border-radius: 1mm;
      font-size: 7pt;
      font-weight: bold;
      line-height: 1.25;
      color: #111;
      background: #f5f5f5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .order-tryin { background: #e8f2ff; border-color: #5b8ec7; }
    .order-finish { background: #eaf6ea; border-color: #5b9b61; }
    .order-repair { background: #fff3dc; border-color: #c28a36; }
    .order-rearrange { background: #f1eafe; border-color: #8d73c7; }
    .insurance-insurance { background: #e9f3ff; border-color: #5f8fc4; }
    .insurance-private { background: #fff0e8; border-color: #c97952; }
    .grid-section {
      grid-column: 1 / -1;
      background: #bbb;
      padding: 0.3mm 1.5mm;
      font-size: 6.5pt;
      font-weight: bold;
      margin-top: 1mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .grid-section.dim { background: #d4d4d4; color: #666; font-size: 6pt; }
    .grid-row {
      display: flex;
      align-items: center;
      gap: 1mm;
      min-height: 3.6mm;
      padding: 0.25mm 1mm;
      border-bottom: 0.25mm solid #ddd;
      min-width: 0;
      overflow: hidden;
    }
    .grid-row.full { grid-column: 1 / -1; }
    .grid-lbl { flex: 0 0 auto; max-width: 13mm; color: #444; font-size: 6pt; white-space: nowrap; }
    .grid-val { flex: 1; min-width: 0; font-size: 7pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .grid-row.full .grid-val { white-space: normal; line-height: 1.25; }
    .grid-row.clasp-choice { min-height: 7mm; align-items: center; }
    .grid-row.clasp-choice .grid-lbl { max-width: 16mm; font-size: 7pt; font-weight: bold; }
    .grid-row.clasp-choice .grid-val { font-size: 13.5pt; font-weight: 900; line-height: 1.1; white-space: normal; overflow: visible; text-overflow: clip; }
    .grid-row.dim .grid-lbl { color: #777; font-size: 5.8pt; }
    .grid-row.dim .grid-val { color: #555; font-size: 6.8pt; }
    .tn-block { margin: 2mm 0 1mm; border: 0.3mm solid #ccc; padding: 1mm; }
    .tn-row { display: flex; font-size: 5.5pt; padding: 0.2mm 0; }
    .tn-num { flex: 1; text-align: center; color: #ddd; }
    .tn-num.tn-missing { color: #000; }
    .tn-mid { flex: 0 0 auto; padding: 0 0.5mm; color: #333; font-weight: bold; }
    .tn-sep { border-top: 0.3mm solid #ccc; margin: 0.5mm 0; }
    .remarks {
      flex: 1;
      min-width: 0;
      padding: 1mm 2mm;
      font-size: 7.5pt;
      line-height: 2.0;
      overflow: hidden;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .slip-empty { flex: 1; }
    .studio-sig { width: 100%; margin-top: auto; text-align: left; font-size: 12pt; font-weight: bold; color: #555; padding-top: 1mm; line-height: 1.25; flex-shrink: 0; }
    .print-body { display: flex; gap: 4mm; align-items: stretch; flex: 1; overflow: hidden; }
    .chart-col { flex: 0 0 68mm; display: flex; flex-direction: column; }
    .chart-spare {
      margin-top: 1.5mm;
      border: 0.3mm solid #ccc;
      overflow: visible;
      display: grid;
      grid-template-columns: 1fr;
      align-content: start;
      flex: 1 1 auto;
      min-height: 0;
    }
    .chart-spare-title {
      background: #d4d4d4;
      color: #555;
      padding: 0.25mm 1.2mm;
      font-size: 5.8pt;
      font-weight: bold;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .chart-spare .grid-row {
      align-items: flex-start;
      min-height: 0;
      padding: 0.25mm 1mm;
      overflow: visible;
    }
    .chart-spare .grid-lbl { font-size: 5.8pt; max-width: 14mm; line-height: 1.15; }
    .chart-spare .grid-val { font-size: 6.3pt; line-height: 1.15; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; word-break: break-word; }
    .chart-spare.spare-dense .grid-row { padding: 0.15mm 0.8mm; }
    .chart-spare.spare-dense .grid-lbl { font-size: 5.2pt; }
    .chart-spare.spare-dense .grid-val { font-size: 5.6pt; line-height: 1.08; }
    .chart-spare.spare-ultra .chart-spare-title { font-size: 5.2pt; padding: 0.15mm 0.8mm; }
    .chart-spare.spare-ultra .grid-row { padding: 0.1mm 0.7mm; }
    .chart-spare.spare-ultra .grid-lbl { font-size: 4.8pt; max-width: 12mm; }
    .chart-spare.spare-ultra .grid-val { font-size: 5pt; line-height: 1.02; }
    .notes-area { flex: 0 0 34mm; display: flex; flex-direction: column; margin-top: 1.5mm; border: 0.3mm solid #ccc; overflow: hidden; }
    .notes-title { background: #bbb; padding: 0.3mm 1.5mm; font-size: 6.5pt; font-weight: bold; flex-shrink: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .notes-body { display: flex; gap: 2mm; flex: 1; min-height: 0; overflow: hidden; }
    .notes-grow .info-2col { flex: 0 1 auto; max-height: 54mm; }
    .notes-grow .notes-area { flex: 1 1 auto; min-height: 34mm; }
    .notes-has-memo .notes-body { flex-direction: column; gap: 1mm; }
    .notes-has-memo .remarks { flex: 1 1 auto; min-height: 12mm; }
    .notes-has-memo .memo-col {
      flex: 0 0 28mm;
      min-height: 24mm;
      width: 100%;
      border-left: 0;
      border-top: 0.3mm solid #ccc;
    }
    .notes-medium .remarks { font-size: 7pt; line-height: 1.75; }
    .notes-long .remarks { font-size: 6.3pt; line-height: 1.55; }
    .notes-medium.notes-has-memo .memo-col { flex-basis: 31mm; min-height: 26mm; }
    .notes-long.notes-has-memo .memo-col { flex-basis: 27mm; min-height: 24mm; }
    .notes-dense .remarks { font-size: 5.5pt; line-height: 1.35; padding: 0.8mm 1.5mm; }
    .notes-dense .notes-title { font-size: 6pt; padding: 0.2mm 1.2mm; }
    .notes-dense.notes-has-memo .memo-col { flex-basis: 24mm; min-height: 22mm; }
    .info-wrap.notes-ultra .info-2col { max-height: 46mm; }
    .notes-ultra .remarks { font-size: 4.2pt; line-height: 1.12; padding: 0.5mm 0.8mm; }
    .notes-ultra .notes-title { font-size: 5.5pt; padding: 0.2mm 1mm; }
    .notes-ultra.notes-has-memo .memo-col { flex-basis: 22mm; min-height: 20mm; }
    .notes-ultra.notes-has-memo .remarks { min-height: 8mm; }
    .memo-col { flex: 1; min-width: 0; min-height: 0; overflow: hidden; border-left: 0.3mm solid #ccc; }
    .memo-col svg, .memo-col .memo-svg {
      display: block !important;
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      border: 0.3mm solid #ccc !important;
      border-radius: 0 !important;
      background: #fff !important;
      overflow: hidden !important;
    }
    .memo-col .eraser-cursor, .memo-col #memoEraserLayer { display: none !important; }
    .memo-col #memoHitArea { display: none !important; }
    .info-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
    .info-2col { display: flex; gap: 2mm; flex: 1; overflow: hidden; }
    .info-left { flex: 1; min-width: 0; overflow: hidden; }
    .info-right { flex: 1; min-width: 0; overflow: hidden; display: grid; grid-template-columns: 1fr 1fr; align-content: start; column-gap: 1.5mm; }
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
    .clasp-sel-rect, .clasp-bbox, .clasp-handle, .rot-line { display: none !important; }
    .tooth-el { fill:transparent; stroke:transparent; }
    .tooth-el.missing { fill: rgba(204,34,34,0.28); stroke: #c00; stroke-width: 2.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tooth-stamp { font-size: 18px; text-anchor: middle; dominant-baseline: middle; font-weight: 900; opacity: 0; }
    .tooth-stamp.show { opacity: 1; }
    .tooth-stamp.missing { fill: #aa1a1a; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<title>歯科技工指示書</title>\n' +
    '<style>' + css + '</style>\n</head>\n<body>\n' +
    '<div class="slip">' + buildSlip(order1) + '</div>\n' +
    '<div class="perforated"></div>\n' +
    '<div class="slip">' + buildSlip(order2 || null) + '</div>\n' +
    '</body>\n</html>';
}

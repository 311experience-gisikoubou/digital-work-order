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
  var memoHtml = buildMemoPngHTML(sourceMemoStrokes) || buildMemoSvgHTML(sourceMemoStrokes);
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
  // Keep a modest safety margin around the memo, with extra room below for handwriting descenders.
  var viewLeft = bounds.x - 6;
  var viewTop = bounds.y - 6;
  var viewRight = bounds.x + bounds.width + 6;
  var viewBottom = bounds.y + bounds.height + 72;
  return '<svg class="memo-svg" viewBox="' +
    [viewLeft, viewTop, viewRight - viewLeft, viewBottom - viewTop].map(function(n){ return Number(n).toFixed(1); }).join(' ') +
    '" preserveAspectRatio="xMidYMid meet">' + paths + '</svg>';
}

function buildMemoPngDataUrl(strokes) {
  if (!Array.isArray(strokes) || strokes.length === 0 ||
      typeof document === 'undefined' || typeof Path2D === 'undefined') return '';

  var validStrokes = strokes.filter(function(s) { return s && s.d; });
  if (validStrokes.length === 0) return '';

  var canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 500;

  try {
    var context = canvas.getContext('2d');
    if (!context) return '';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    validStrokes.forEach(function(s) {
      context.strokeStyle = s.color || '#111';
      context.lineWidth = Number(s.width) > 0 ? Number(s.width) : 6;
      context.stroke(new Path2D(s.d));
    });
    return canvas.toDataURL('image/png');
  } catch (error) {
    return '';
  }
}

function buildMemoPngHTML(strokes) {
  var dataUrl = buildMemoPngDataUrl(strokes);
  return dataUrl
    ? '<img class="memo-print-img" src="' + escAttr(dataUrl) + '" alt="手書きメモ">'
    : '';
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
  function missingToothNotation(missingSet) {
    function n(fdiNum, posNum) {
      var active = missingSet.has(fdiNum);
      return '<span class="missing-num' + (active ? ' active' : '') + '">' + posNum + '</span>';
    }
    var upper =
      '<div class="missing-line"><span class="missing-jaw">上顎</span>' +
      n(17,7) + n(16,6) + n(15,5) + n(14,4) + n(13,3) + n(12,2) + n(11,1) +
      '<span class="missing-mid">|</span>' +
      n(21,1) + n(22,2) + n(23,3) + n(24,4) + n(25,5) + n(26,6) + n(27,7) +
      '</div>';
    var lower =
      '<div class="missing-line"><span class="missing-jaw">下顎</span>' +
      n(47,7) + n(46,6) + n(45,5) + n(44,4) + n(43,3) + n(42,2) + n(41,1) +
      '<span class="missing-mid">|</span>' +
      n(31,1) + n(32,2) + n(33,3) + n(34,4) + n(35,5) + n(36,6) + n(37,7) +
      '</div>';
    return '<span class="missing-chart">' + upper + lower + '</span>';
  }
  function toothMaterialName(value) {
    if (value === '硬レ歯') return '硬質レジン歯';
    return value;
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
             '<div class="slip-empty"></div>';
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
      var deviceName = { W:'WC', E:'CC', T:'双子鉤', R:'レスト', CR:'CR', H:'フック', C:'コンビ鉤', I:'Iバー', WI:'WIバー' };
      var items = Object.keys(counts).map(function(t) {
        return (deviceName[t] || CN[t] || t) + ' ×' + counts[t];
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
    function pushHtmlRow(label, html, extraClass) {
      if (!html) return;
      compactR.push(
        '<div class="grid-row full' + (extraClass ? ' ' + extraClass : '') + '">' +
        '<span class="grid-lbl">' + esc(label) + '</span>' +
        '<span class="grid-val">' + html + '</span>' +
        '</div>'
      );
    }
    function inlineItem(label, value) {
      if (value === null || value === undefined || value === '' || value === false) return '';
      return '<span class="inline-item"><span class="inline-lbl">' + esc(label) + '</span><span class="inline-val">' + esc(value) + '</span></span>';
    }
    gridRow(compactR, '床種', order.bedType);

    var deviceCountItems = [];
    if (items && items.length) deviceCountItems = deviceCountItems.concat(items);
    if (order.barType) deviceCountItems.push(order.barType + 'バー ×1');
    if (deviceCountItems.length) {
      pushHtmlRow(
        '装置',
        '<span class="device-list">' + deviceCountItems.map(function(item) {
          return '<span class="device-chip">' + esc(item) + '</span>';
        }).join('') + '</span>',
        'device-row'
      );
    }

    var missingTeethHtml = (order.selectedTeeth && order.selectedTeeth.length)
      ? missingToothNotation(missingSet)
      : '';
    pushHtmlRow('欠損歯式', missingTeethHtml, 'missing-chart-row');

    var toothInfoHtml = [
      inlineItem('前歯', toothMaterialName(order.toothAnterior)),
      inlineItem('臼歯', toothMaterialName(order.toothPosterior)),
      inlineItem('シェード', shade)
    ].filter(Boolean).join('');
    pushHtmlRow('人工歯・色調', toothInfoHtml ? '<span class="inline-info">' + toothInfoHtml + '</span>' : '', 'inline-row');

    var articulatorText = order.hasArticulator
      ? [order.articulatorType || 'あり', order.articulatorDetail].filter(Boolean).join(' ')
      : '';
    var optionInfoHtml = [
      order.taigoha ? inlineItem('対合歯', 'あり') : '',
      order.bite ? inlineItem('バイト', 'あり') : '',
      order.goaFlag ? inlineItem('GoA', 'あり') : '',
      order.hasArticulator ? inlineItem('咬合器', articulatorText) : ''
    ].filter(Boolean).join('');
    pushHtmlRow('オプション', optionInfoHtml ? '<span class="inline-info">' + optionInfoHtml + '</span>' : '', 'inline-row option-row');
    R = compactR;

    var remarksText = String(order.remarks || '');
    var remarksLineCount = remarksText ? remarksText.split(/\r\n|\r|\n/).length : 0;
    var remarksScore = remarksText.replace(/\s/g, '').length + Math.max(0, remarksLineCount - 1) * 18;
    var notesLevel = remarksScore > 620 ? ' notes-ultra' : (remarksScore > 420 ? ' notes-dense' : (remarksScore > 240 ? ' notes-long' : (remarksScore > 120 ? ' notes-medium' : '')));
    var infoWrapClass = notesLevel ? 'info-wrap notes-grow' + notesLevel : 'info-wrap';

    var notesHtml =
      '<div class="notes-area' + notesLevel + '">' +
      '<div class="notes-title">備考</div>' +
      '<div class="notes-body">' +
      '<div class="remarks">' + (remarksText ? esc(remarksText).replace(/\n/g, '<br>') : '') + '</div>' +
      '</div></div>';
    var studioName = '咬み合わせ医療会　こよし技工房';
    var chartMemoHtml = '<div class="chart-memo">' + (memoHtml || '') + '</div>';
    var bottomContactHtml =
      '<div class="bottom-contact">' +
      '<div class="contact-address">住所</div>' +
      '<div class="contact-phone">電話</div>' +
      '<div class="contact-line">LINE相談 <span class="qr-placeholder">QR</span></div>' +
      '</div>';
    var metaOrderBadges = (order.orderTypes && order.orderTypes.length)
      ? order.orderTypes.map(function(v) {
        return '<span class="pdf-badge ' + badgeClass(v, 'order') + '">' + esc(v) + '</span>';
      }).join('')
      : '<span class="meta-empty">-</span>';
    var metaInsuranceText = order.insuranceType === 'insurance' ? '保険' : '自費';
    var metaBar =
      '<div class="meta-bar">' +
      '<div class="meta-item"><span class="meta-lbl">発注形態</span><span class="meta-val badge-list">' + metaOrderBadges + '</span></div>' +
      '<div class="meta-sep"></div>' +
      '<div class="meta-item"><span class="meta-lbl">区分</span><span class="meta-val badge-list"><span class="pdf-badge ' + badgeClass(metaInsuranceText, 'insurance') + '">' + esc(metaInsuranceText) + '</span></span></div>' +
      '</div>';

    var keyBar =
      '<div class="key-bar">' +
      '<div class="key-item key-patient"><span class="key-icon icon-patient"></span><span class="key-text"><span class="key-lbl">患者名</span><span class="key-val-primary">' + esc(order.patientName || '—') + '</span></span></div>' +
      '<div class="key-item key-delivery"><span class="key-icon icon-calendar"></span><span class="key-text"><span class="key-lbl">納品日</span><span class="key-val-primary">' + esc(keyDelivery || '—') + '</span></span></div>' +
      (hasNextAp
        ? '<div class="key-item key-clinic"><span class="key-icon icon-clinic"></span><span class="key-text"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></span></div>' +
          '<div class="key-item key-next-ap"><span class="key-icon icon-clock"></span><span class="key-text"><span class="key-lbl">次回Ap</span>' +
          '<span class="key-val-stack">' +
          (nextApDate ? '<span class="key-val">' + esc(nextApDate) + '</span>' : '') +
          (nextApTime ? '<span class="key-time">' + esc(nextApTime) + '</span>' : '') +
          '</span></span></div>'
        : '<div class="key-item key-full key-clinic"><span class="key-icon icon-clinic"></span><span class="key-text"><span class="key-lbl">医院名</span><span class="key-val">' + esc(order.clinicName || '—') + '</span></span></div>'
      ) +
      '</div>';

    return '<div class="slip-header"><div class="title-block"><h1>歯科技工指示書</h1></div>' +
      '<div class="header-studio">' + esc(studioName) + '</div>' +
      '<div class="issue-date">発行日：' + esc(order.issueDate ? formatJapaneseEraDate(order.issueDate) : '') + '</div></div>' +
      '<div class="print-body">' +
      '<div class="chart-col">' +
      (chartHtml || '') +
      chartMemoHtml +
      '</div>' +
      '<div class="' + infoWrapClass + '">' +
      keyBar +
      metaBar +
      '<div class="info-2col">' +
      '<div class="card-title">補綴物指示</div>' +
      '<div class="info-right">' + R.join('\n') + '</div>' +
      '</div>' +
      notesHtml +
      '</div>' +
      '</div>' +
      bottomContactHtml;
  }

  var css = `
    @page { size: 182mm 257mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html,
    body {
      margin: 0;
      padding: 0;
      width: 182mm;
      height: 257mm;
    }
    body {
      font-family: 'Meiryo', 'Hiragino Kaku Gothic Pro', 'Yu Gothic', 'MS Gothic', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      background: #fff;
      font-size: 6.8pt;
      color: #1f2933;
      line-height: 1.42;
    }
    .slip {
      width: 182mm;
      height: 128mm;
      box-sizing: border-box;
      padding: 4.5mm 5mm 4mm;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      flex: 0 0 128mm;
      border: 0;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .perforated {
      width: 182mm;
      height: 1mm;
      box-sizing: border-box;
      flex: 0 0 1mm;
      border-left: 0;
      border-top: 0.25mm dashed #a7b6c2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .slip-header {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: flex-end;
      column-gap: 4mm;
      padding-bottom: 1.2mm;
      border-bottom: 0.45mm solid #0f8395;
      margin-bottom: 2mm;
      flex-shrink: 0;
    }
    .title-block { min-width: 0; }
    h1 { font-size: 16pt; font-weight: 900; letter-spacing: 0.03em; color: #102a43; line-height: 1; flex-shrink: 0; }
    .header-studio { color: #34515b; font-size: 8.2pt; font-weight: 700; line-height: 1.2; text-align: center; white-space: nowrap; padding-bottom: 0.4mm; }
    .issue-date { font-size: 6.8pt; color: #102a43; font-weight: 700; white-space: nowrap; padding-bottom: 0.4mm; text-align: right; }
    .key-bar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2mm 4mm;
      padding: 2.6mm 3mm;
      border: 0.2mm solid #d9e6e8;
      border-radius: 2.8mm;
      background: #fff;
      margin-bottom: 1.8mm;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .key-bar::after {
      content: '';
      position: absolute;
      top: 4mm;
      bottom: 4mm;
      left: 50%;
      border-left: 0.2mm solid #c7d3dc;
      display: none;
    }
    .key-item { display: flex; align-items: center; gap: 2mm; min-width: 0; overflow: hidden; }
    .key-next-ap { align-items: flex-start; }
    .key-full { grid-column: 1 / -1; }
    .key-text { display: flex; flex-direction: column; min-width: 0; }
    .key-val-stack { display: flex; flex-direction: column; line-height: 1.4; min-width: 0; }
    .key-time { font-size: 10.4pt; font-weight: 800; color: #0f8395; }
    .key-lbl { display: block; font-size: 5.8pt; color: #6e9591; font-weight: 800; flex-shrink: 0; white-space: nowrap; line-height: 1.15; margin-bottom: 0.7mm; }
    .key-val { display: block; font-size: 7.8pt; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; line-height: 1.15; }
    .key-val-primary { display: block; font-size: 10pt; font-weight: 900; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; line-height: 1.1; }
    .key-patient .key-val-primary { font-size: 12.5pt; line-height: 1.05; }
    .key-delivery .key-val-primary { font-size: 10pt; line-height: 1.05; }
    .key-next-ap .key-val { font-size: 7.8pt; line-height: 1.05; }
    .key-next-ap .key-val-stack { flex-direction: row; align-items: baseline; gap: 1.5mm; line-height: 1.05; }
    .key-next-ap .key-time { font-size: 10.8pt; line-height: 1.05; }
    .key-icon { position: relative; flex: 0 0 6.2mm; width: 6.2mm; height: 6.2mm; color: #0f8395; }
    .key-icon::before,
    .key-icon::after { content: ''; position: absolute; display: block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .icon-patient::before { width: 2.7mm; height: 2.7mm; border-radius: 50%; background: #0f8395; left: 1.75mm; top: 0.2mm; }
    .icon-patient::after { width: 5.1mm; height: 3.1mm; border-radius: 2.5mm 2.5mm 0.7mm 0.7mm; background: #0f8395; left: 0.55mm; bottom: 0.1mm; }
    .icon-clinic::before { width: 4.6mm; height: 5.4mm; left: 0.8mm; top: 0.4mm; border: 0.45mm solid #60717f; border-radius: 0.2mm; background: repeating-linear-gradient(90deg, transparent 0 1.2mm, #60717f 1.2mm 1.55mm); }
    .icon-clinic::after { width: 1.4mm; height: 1.8mm; left: 2.4mm; bottom: 0.25mm; border: 0.35mm solid #60717f; border-bottom: 0; }
    .icon-calendar::before { width: 4.8mm; height: 4.8mm; left: 0.7mm; top: 0.8mm; border: 0.45mm solid #60717f; border-radius: 0.45mm; background: linear-gradient(#60717f 0 1.1mm, #fff 1.1mm 100%); }
    .icon-calendar::after { width: 2.4mm; height: 1.7mm; left: 1.9mm; top: 2.9mm; background: radial-gradient(circle at 0.3mm 0.3mm, #60717f 0 0.25mm, transparent 0.3mm), radial-gradient(circle at 1.2mm 0.3mm, #60717f 0 0.25mm, transparent 0.3mm), radial-gradient(circle at 2.1mm 0.3mm, #60717f 0 0.25mm, transparent 0.3mm), radial-gradient(circle at 0.3mm 1.1mm, #60717f 0 0.25mm, transparent 0.3mm), radial-gradient(circle at 1.2mm 1.1mm, #60717f 0 0.25mm, transparent 0.3mm), radial-gradient(circle at 2.1mm 1.1mm, #60717f 0 0.25mm, transparent 0.3mm); }
    .icon-clock::before { width: 5mm; height: 5mm; left: 0.6mm; top: 0.6mm; border: 0.45mm solid #60717f; border-radius: 50%; }
    .icon-clock::after { width: 2.1mm; height: 2.1mm; left: 3.05mm; top: 1.7mm; border-left: 0.45mm solid #60717f; border-bottom: 0.45mm solid #60717f; transform: rotate(-5deg); transform-origin: left bottom; }
    .meta-bar {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: center;
      gap: 2mm;
      padding: 1.4mm 2mm;
      margin-bottom: 1.8mm;
      border: 0.2mm solid #d9e6e8;
      border-radius: 2.4mm;
      background: #fff;
      flex-shrink: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .meta-item { display: flex; align-items: center; justify-content: center; gap: 2mm; min-width: 0; }
    .meta-lbl { font-size: 7pt; font-weight: 800; color: #142f43; white-space: nowrap; }
    .meta-val { display: flex; align-items: center; justify-content: center; min-width: 0; }
    .meta-sep { display: none; }
    .meta-empty { color: #9aa8b2; font-size: 6pt; }
    .sect {
      color: #246073;
      border-bottom: 0.2mm solid #c7dde6;
      padding: 0.2mm 0;
      font-size: 6.2pt;
      font-weight: 800;
      margin: 1mm 0 0.5mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .row { display: flex; padding: 0.35mm 0; border-bottom: 0.15mm solid #dbe6eb; min-height: 3.8mm; align-items: center; }
    .lbl { width: 12mm; flex-shrink: 0; color: #60717f; font-size: 5.8pt; }
    .val { flex: 1; font-size: 6.8pt; color: #1f2933; }
    .sect.dim { color: #60717f; font-size: 5.8pt; }
    .row.dim { min-height: 3.2mm; border-bottom: 0.15mm solid #e3ebef; }
    .row.dim .lbl { color: #7b8b97; font-size: 5.5pt; }
    .row.dim .val { font-size: 6.4pt; color: #394b59; }
    .badge-row { align-items: flex-start; }
    .badge-list { display: flex; flex-wrap: wrap; gap: 0.8mm; }
    .pdf-badge {
      display: inline-block;
      padding: 0.25mm 1mm;
      border: 0.2mm solid #9bb8c6;
      border-radius: 1mm;
      font-size: 6.2pt;
      font-weight: 800;
      line-height: 1.25;
      color: #234454;
      background: #f5fbfd;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .meta-bar .pdf-badge {
      font-size: 11pt;
      font-weight: 800;
      line-height: 1.1;
      padding: 0.8mm 1.8mm;
      border-radius: 1.6mm;
    }
    .order-tryin { background: #e8f2ff; border-color: #5b8ec7; }
    .order-finish { background: #eaf6ea; border-color: #5b9b61; }
    .order-repair { background: #fff3dc; border-color: #c28a36; }
    .order-rearrange { background: #f1eafe; border-color: #8d73c7; }
    .insurance-insurance { background: #e9f3ff; border-color: #5f8fc4; }
    .insurance-private { background: #fff0e8; border-color: #c97952; }
    .grid-section {
      color: #246073;
      border-bottom: 0.2mm solid #c7dde6;
      padding: 0.2mm 0;
      font-size: 6.2pt;
      font-weight: 800;
      margin-top: 1mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .grid-section.dim { color: #60717f; font-size: 5.8pt; }
    .grid-row {
      display: flex;
      align-items: flex-start;
      gap: 1.5mm;
      padding: 0.65mm 0;
      border-bottom: 0.15mm dashed #d8e3e5;
      min-width: 0;
      overflow: visible;
    }
    .grid-row.full { }
    .grid-lbl { flex: 0 0 15mm; max-width: 15mm; color: #36515a; font-size: 6.3pt; font-weight: 700; white-space: nowrap; }
    .grid-val { flex: 1; min-width: 0; font-size: 7.4pt; color: #111; font-weight: 700; overflow: visible; text-overflow: clip; white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.35; }
    .grid-row.full .grid-val { white-space: normal; line-height: 1.35; }
    .device-row { align-items: flex-start; }
    .device-list { display: flex; flex-wrap: wrap; align-items: center; gap: 0.8mm 2mm; }
    .device-chip {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      padding: 0.35mm 1mm;
      border: 0.18mm solid #d7e5e2;
      border-radius: 999px;
      background: #f8fbfb;
      color: #111;
      font-size: 6.8pt;
      font-weight: 700;
      line-height: 1.2;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .grid-row.clasp-choice { min-height: 5.5mm; align-items: center; }
    .grid-row.clasp-choice .grid-lbl { flex-basis: 13mm; max-width: 13mm; font-size: 6pt; font-weight: 800; }
    .grid-row.clasp-choice .grid-val { font-size: 10pt; font-weight: 900; line-height: 1.1; white-space: normal; overflow: visible; text-overflow: clip; }
    .grid-row.dim .grid-lbl { color: #777; font-size: 5.8pt; }
    .grid-row.dim .grid-val { color: #555; font-size: 6.8pt; }
    .missing-chart-row { align-items: flex-start; }
    .missing-chart-row .grid-val { display: block; }
    .missing-chart {
      display: inline-flex;
      flex-direction: column;
      width: 100%;
      gap: 0.3mm;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: #fff;
      line-height: 1.05;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .missing-line { display: flex; align-items: center; height: 3.2mm; gap: 1.1mm; }
    .missing-jaw { flex: 0 0 7mm; color: #36515a; font-size: 5.8pt; font-weight: 800; }
    .missing-num { flex: 0 0 3.5mm; text-align: center; color: #c2ccd3; font-size: 5.8pt; font-weight: 700; }
    .missing-num.active { color: #111; }
    .missing-mid { flex: 0 0 2mm; text-align: center; color: #aeb9c1; font-size: 5pt; }
    .inline-info {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.8mm 2.5mm;
    }
    .inline-item {
      display: inline-flex;
      align-items: baseline;
      gap: 0.8mm;
      white-space: nowrap;
    }
    .inline-lbl {
      color: #5f7880;
      font-size: 6.2pt;
      font-weight: 700;
    }
    .inline-val {
      color: #111;
      font-size: 7.2pt;
      font-weight: 800;
    }
    .tn-block { margin: 1.3mm 0 0.8mm; border: 0.2mm solid #dbe6eb; border-radius: 1.2mm; padding: 0.8mm; }
    .tn-row { display: flex; font-size: 5.5pt; padding: 0.2mm 0; }
    .tn-num { flex: 1; text-align: center; color: #ddd; }
    .tn-num.tn-missing { color: #000; }
    .tn-mid { flex: 0 0 auto; padding: 0 0.5mm; color: #333; font-weight: bold; }
    .tn-sep { border-top: 0.3mm solid #ccc; margin: 0.5mm 0; }
    .remarks {
      flex: 1;
      width: 100%;
      height: 100%;
      min-width: 0;
      padding: 1.4mm 1.8mm;
      font-size: 7pt;
      line-height: 1.55;
      color: #111;
      overflow: hidden;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .slip-empty { flex: 1; }
    .bottom-contact {
      flex: 0 0 7mm;
      min-height: 7mm;
      margin-top: 1.2mm;
      padding-top: 0.8mm;
      border-top: 0.15mm solid #dfe8ea;
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 3mm;
      box-sizing: border-box;
      font-size: 5.8pt;
      color: #4a5d63;
    }
    .contact-address,
    .contact-phone {
      white-space: nowrap;
    }
    .contact-phone {
      font-weight: 700;
    }
    .contact-line {
      display: flex;
      align-items: center;
      gap: 1mm;
      white-space: nowrap;
    }
    .qr-placeholder {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 5mm;
      height: 5mm;
      border: 0.15mm solid #d9e6e8;
      color: #8aa0a5;
      font-size: 4.8pt;
      font-weight: 700;
      background: #fff;
    }
    .print-body {
      display: flex;
      gap: 4mm;
      align-items: stretch;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    .chart-col {
      flex: 0 0 48mm;
      width: 48mm;
      min-width: 48mm;
      display: flex;
      flex-direction: column;
      min-height: 0;
      border: 0.2mm solid #dbe6eb;
      border-radius: 2mm;
      padding: 2mm;
      overflow: hidden;
      box-sizing: border-box;
    }
    .chart-spare {
      margin-top: 1.2mm;
      border-top: 0.2mm dashed #c7dde6;
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      border-radius: 1.2mm;
      overflow: visible;
      display: grid;
      grid-template-columns: 1fr;
      align-content: start;
      flex: 1 1 auto;
      min-height: 0;
    }
    .chart-spare-title {
      background: transparent;
      color: #60717f;
      padding: 0.3mm 1mm;
      font-size: 5.5pt;
      font-weight: 800;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .chart-spare .grid-row {
      align-items: flex-start;
      min-height: 0;
      padding: 0.18mm 1mm;
      overflow: visible;
    }
    .chart-spare .grid-lbl { font-size: 5.2pt; max-width: 12mm; line-height: 1.12; }
    .chart-spare .grid-val { font-size: 5.6pt; line-height: 1.12; white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; word-break: break-word; }
    .chart-spare.spare-dense .grid-row { padding: 0.15mm 0.8mm; }
    .chart-spare.spare-dense .grid-lbl { font-size: 5.2pt; }
    .chart-spare.spare-dense .grid-val { font-size: 5.6pt; line-height: 1.08; }
    .chart-spare.spare-ultra .chart-spare-title { font-size: 5.2pt; padding: 0.15mm 0.8mm; }
    .chart-spare.spare-ultra .grid-row { padding: 0.1mm 0.7mm; }
    .chart-spare.spare-ultra .grid-lbl { font-size: 4.8pt; max-width: 12mm; }
    .chart-spare.spare-ultra .grid-val { font-size: 5pt; line-height: 1.02; }
    .notes-area { flex: 0 0 24mm; min-height: 24mm; display: flex; flex-direction: column; margin-top: 0; border: 0.2mm solid #c7dde6; border-radius: 2mm; overflow: hidden; background: #fff; }
    .notes-title { background: #fff; color: #0b4f8a; padding: 1mm 1.6mm 0.4mm; font-size: 7pt; font-weight: 900; flex-shrink: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .notes-title::before { content: '□'; color: #0f8395; margin-right: 1mm; font-size: 6.4pt; }
    .notes-body { display: block; flex: 1; min-height: 0; overflow: hidden; }
    .notes-grow .info-2col { flex: 0 1 auto; max-height: 75mm; }
    .notes-grow .notes-area { flex: 0 0 24mm; min-height: 24mm; }
    .notes-has-memo .notes-body { flex-direction: row; gap: 1.5mm; }
    .notes-has-memo .remarks { flex: 1 1 55%; min-height: 0; }
    .notes-has-memo .memo-col {
      flex: 0 0 42%;
      min-height: 0;
      width: auto;
      border-left: 0;
      border-top: 0;
    }
    .notes-medium .remarks { font-size: 6.3pt; line-height: 1.42; }
    .notes-long .remarks { font-size: 5.6pt; line-height: 1.28; }
    .notes-medium.notes-has-memo .memo-col { flex-basis: 42%; min-height: 0; }
    .notes-long.notes-has-memo .memo-col { flex-basis: 40%; min-height: 0; }
    .notes-dense .remarks { font-size: 4.9pt; line-height: 1.18; padding: 0.8mm 1.2mm; }
    .notes-dense .notes-title { font-size: 5.8pt; padding: 0.45mm 1.2mm; }
    .notes-dense.notes-has-memo .memo-col { flex-basis: 38%; min-height: 0; }
    .info-wrap.notes-ultra .info-2col { max-height: 70mm; }
    .notes-ultra .remarks { font-size: 4.2pt; line-height: 1.08; padding: 0.6mm 0.9mm; }
    .notes-ultra .notes-title { font-size: 5.4pt; padding: 0.35mm 1mm; }
    .notes-ultra.notes-has-memo .memo-col { flex-basis: 36%; min-height: 0; }
    .notes-ultra.notes-has-memo .remarks { min-height: 8mm; }
    .memo-col { flex: 1; min-width: 0; min-height: 0; overflow: hidden; border-left: 0.2mm dashed #dbe6eb; }
    .memo-col svg, .memo-col .memo-svg {
      display: block !important;
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: #fff !important;
      overflow: hidden !important;
    }
    .memo-col .eraser-cursor, .memo-col #memoEraserLayer { display: none !important; }
    .memo-col #memoHitArea { display: none !important; }
    .info-wrap {
      flex: 0 0 120mm;
      width: 120mm;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .info-2col {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      border: 0.2mm solid #d9e6e8;
      border-radius: 2.8mm;
      padding: 2mm 2.4mm;
      box-sizing: border-box;
      background: #fff;
      margin-bottom: 1.8mm;
    }
    .card-title {
      font-size: 7pt;
      font-weight: 900;
      color: #2d5660;
      margin-bottom: 1.4mm;
      flex-shrink: 0;
    }
    .info-wrap .key-bar {
      flex-shrink: 0;
    }
    .info-wrap .meta-bar {
      flex-shrink: 0;
    }
    .info-wrap .notes-area {
      flex: 0 0 24mm;
      min-height: 24mm;
      margin-top: 0;
    }
    .info-left { flex: 0 0 auto; min-width: 0; overflow: hidden; }
    .info-right { flex: 1 1 auto; min-width: 0; overflow: hidden; display: flex; flex-direction: column; }
    .chart-wrap {
      position: relative;
      display: block;
      width: 35mm;
      height: 60mm;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 0;
      background: #fff;
      transform: none;
      transform-origin: top center;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .chart-memo {
      position: relative;
      flex: 1 1 auto;
      width: 100%;
      min-height: 0;
      margin-top: 1.5mm;
      border-top: 0.15mm dashed #d9e6e8;
      overflow: hidden;
      background: #fff;
    }
    .chart-memo::before {
      content: '手書きメモ';
      position: absolute;
      top: 1mm;
      left: 1mm;
      z-index: 2;
      margin: 0;
      font-size: 5.8pt;
      font-weight: 800;
      line-height: 1.2;
      color: #6e9591;
      pointer-events: none;
    }
    .chart-memo svg,
    .chart-memo .memo-svg {
      display: block !important;
      width: 100% !important;
      height: calc(100% - 6mm) !important;
      border: 0 !important;
      background: #fff !important;
    }
    .chart-memo .memo-print-img {
      display: block !important;
      width: 75% !important;
      height: 75% !important;
      object-fit: contain !important;
      object-position: center center !important;
      margin: auto !important;
      border: 0 !important;
      background: #fff !important;
    }
    .chart-wrap::before,
    .chart-wrap::after {
      position: absolute;
      left: 0;
      z-index: 5;
      padding: 0.5mm 1.2mm;
      border-radius: 1mm;
      background: #e9f7f9;
      color: #0f7586;
      font-size: 5.6pt;
      font-weight: 800;
      line-height: 1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .chart-wrap::before { content: '上顎'; top: 1mm; }
    .chart-wrap::after { content: '下顎'; top: 30mm; }
    .chart-wrap img { display:block !important; width:35mm !important; height:60mm !important; }
    .chart-wrap svg, .chart-wrap .overlay-svg {
      position:absolute !important; top:0 !important; left:0 !important;
      width:35mm !important; height:60mm !important;
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

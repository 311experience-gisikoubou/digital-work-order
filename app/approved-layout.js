/* Approved 2026-10-21 whole-form layout: reparent existing controls, never duplicate IDs. */
(function () {
  'use strict';
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function disclosure(title, nodes) {
    const details = element('details', 'approved-clasp-details');
    const summary = element('summary', '', title);
    details.append(summary);
    nodes.filter(Boolean).forEach(node => details.append(node));
    return details;
  }
  function redrawMini(preview) {
    const img = document.querySelector('.approved-editor-modal .chart-wrap img, #approved-editor-modal .chart-wrap img, .chart-wrap img');
    if (!img || !img.complete || !img.naturalWidth) return;
    const canvas = preview.querySelector('canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const upper = preview.dataset.arch === 'upper';
    const viewY = upper ? 0 : 535;
    const viewH = upper ? 535 : 535;
    const srcY = Math.round(img.naturalHeight * viewY / 1070);
    const srcH = Math.min(img.naturalHeight - srcY, Math.round(img.naturalHeight * viewH / 1070));
    const renderW = canvas.width;
    const renderH = canvas.height;
    ctx.clearRect(0, 0, renderW, renderH);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, renderW, renderH);
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, renderW, renderH);
    // The existing SVG coordinates are authoritative; no tooth shape is regenerated.
    if (typeof window.getToothStateSnapshot !== 'function' || typeof window.coords !== 'object') return;
    const selected = window.getToothStateSnapshot();
    const values = upper
      ? [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28]
      : [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
    values.forEach(num => {
      const s = selected[num];
      const at = window.coords[num];
      if (!at || !s) return;
      const x = at.cx / 600 * renderW;
      const y = (at.cy - viewY) / viewH * renderH;
      if (y < 0 || y > renderH) return;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (s.baseState === 'missing') {
        ctx.fillStyle = '#c92222';
        ctx.font = 'bold 25px sans-serif';
        ctx.fillText('×', x, y);
      } else if (s.baseState === 'abutment') {
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#2563a8';
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (s.caution) {
        ctx.fillStyle = '#db870e';
        ctx.beginPath();
        ctx.arc(x + 12, y - 12, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  function layout() {
    const clinic = document.querySelector('#view-clinic .clinic-form-content');
    const cards = clinic && [...clinic.children].filter(n => n.classList && n.classList.contains('card'));
    if (!clinic || !cards || cards.length !== 7 || document.getElementById('approved-full-form')) return;
    clinic.id = 'approved-full-form';
    const [patient, insurance, orderType, prosthetics, tooth, options, remarks] = cards;
    const assignments = [
      [patient,'patient'],[insurance,'insurance'],[orderType,'order-type'],
      [prosthetics,'prosthetics'],[tooth,'tooth'],[options,'options'],[remarks,'remarks']
    ];
    assignments.forEach(([card,name]) => card.classList.add('approved-card-'+name));

    const actions = clinic.querySelector('.submit-area');
    if (actions) {
      const bar = element('div', 'approved-form-actions');
      const heading = element('div', 'approved-form-identification');
      heading.append(element('strong', '', 'デジタル歯科技工指示書'));
      heading.append(element('small', '', 'こよし技工房 ／ 医院側入力・受注管理'));
      bar.append(heading, actions);
      clinic.prepend(bar);
    }

    const existingDelivery = patient.querySelector('.delivery-system');
    if (existingDelivery) {
      const deliveryCard = element('section', 'card approved-card-delivery');
      const title = element('div', 'card-title', '模型発送日・納期カレンダー');
      deliveryCard.append(title, existingDelivery);
      const deliveryOptions = element('div','approved-delivery-options');
      deliveryOptions.append(insurance, orderType);
      deliveryCard.append(deliveryOptions);
      clinic.append(deliveryCard);
    }
    const media = options.querySelector('#media-attachments');
    if (media) {
      const mediaCard = element('section','card approved-card-media');
      mediaCard.append(element('div','card-title','参考資料'));
      // Reparent the existing file inputs; never replace or clone them.
      mediaCard.append(media);
      clinic.append(mediaCard);
    }

    const numeric = tooth.querySelector('.tooth-chart-wrap');
    const toolbar = tooth.querySelector('.tooth-toolbar');
    const clasp = tooth.querySelector('.clasp-section');
    const drawing = tooth.querySelector('.chart-wrap');
    if (!numeric || !toolbar || !clasp || !drawing) return;
    const legacyDrawing = drawing.parentElement;
    if (!legacyDrawing) return;

    // Build approved horizontal tooth chart; existing SVG/handwriting kept in one modal.
    const shell = element('div','approved-chart-shell');
    const head = element('div','approved-chart-header');
    head.append(element('h3','', '歯式チャート（図・数字連動）'), toolbar);
    const body = element('div','approved-chart-body');
    const figures = element('div','approved-mini-figures');
    const modal = element('div','approved-editor-backdrop');
    modal.id = 'approved-editor-modal';
    modal.hidden = true;
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.setAttribute('aria-label','歯式図の拡大編集');
    const modalPanel = element('div','approved-editor-panel');
    const modalHeader = element('div','approved-editor-head');
    modalHeader.append(element('strong','', '歯式図の拡大編集'));
    const close = element('button','approved-editor-close','閉じる');
    close.type = 'button';
    modalHeader.append(close);
    modalPanel.append(modalHeader,legacyDrawing);
    modal.append(modalPanel);
    document.body.append(modal);
    function closeModal() { modal.hidden = true; document.body.classList.remove('approved-editor-open'); }
    function openModal() {
      modal.hidden = false;
      document.body.classList.add('approved-editor-open');
      close.focus();
      window.dispatchEvent(new Event('resize'));
    }
    close.addEventListener('click',closeModal);
    modal.addEventListener('click',e => {if(e.target === modal) closeModal();});
    document.addEventListener('keydown',e => {if(e.key === 'Escape' && !modal.hidden) closeModal();});

    for (const [arch, label] of [['upper','上顎'],['lower','下顎']]) {
      const frame = element('button','approved-mini-jaw');
      frame.type = 'button';
      frame.dataset.arch = arch;
      frame.setAttribute('aria-label',label+'歯式図を拡大編集');
      frame.append(element('div','approved-mini-title',label+'（タップで拡大編集）'));
      const canvas = element('canvas','approved-mini-canvas');
      canvas.width = 290;
      canvas.height = 270;
      frame.append(canvas);
      frame.addEventListener('click',openModal);
      figures.append(frame);
    }
    const right = element('div','approved-chart-numeric');
    const numericNode = numeric.querySelector('#tooth-chart');
    const upperRow = numericNode && numericNode.querySelector('#jaw-upper');
    const lowerRow = numericNode && numericNode.querySelector('#jaw-lower');
    if (!numericNode || !upperRow || !lowerRow) return;
    function totalButton(arch) {
      const frame = element('div','approved-total-placement');
      const button = element('button','approved-total-btn',
        arch === 'upper' ? '上顎総義歯 7-7' : '下顎総義歯 7-7');
      button.type = 'button';
      button.dataset.arch = arch;
      button.addEventListener('click', () => {
        if (arch === 'upper') selectUpperDenture();
        else selectLowerDenture();
      });
      frame.append(button);
      return frame;
    }
    function numericLine(arch,row) {
      const line = element('div','approved-numeric-line');
      line.append(element('span','approved-numeric-label',arch === 'upper' ? '上顎' : '下顎'),row);
      return line;
    }
    numericNode.replaceChildren(
      totalButton('upper'),numericLine('upper',upperRow),
      numericLine('lower',lowerRow),totalButton('lower'));
    right.append(element('div','approved-numeric-head','数字歯式（図と連動）'),numeric);
    body.append(figures,right);

    // Reuse the existing clasp controls, only collapse visual groups.
    clasp.removeAttribute('style');
    clasp.classList.add('approved-clasp-panel');
    const claspToolbar = clasp.querySelector('#claspToolbar');
    const claspList = clasp.querySelector('.clasp-result');
    const memo = clasp.querySelector('.memo-wrap');
    const twinHint = clasp.querySelector('#twinHint');
    const first = clasp.querySelector('h3');
    if (first) first.textContent = 'クラスプ記録';
    if (claspToolbar) clasp.append(disclosure('クラスプ種類（選択）', [twinHint,claspToolbar]));
    if (claspList) clasp.append(disclosure('配置したクラスプ一覧', [claspList]));
    if (memo) clasp.append(disclosure('クラスプの備考・手書き', [memo]));
    const foot = element('div','approved-chart-foot','図と数字歯式の選択状態は連動します。図をタップすると拡大編集できます。');
    shell.append(head,body,foot);
    tooth.append(shell);
    tooth.append(clasp);

    const img = drawing.querySelector('img');
    const redraw = () => {figures.querySelectorAll('.approved-mini-jaw').forEach(redrawMini);};
    if (img) img.addEventListener('load',redraw);
    if (img && img.complete) redraw();
    // SVG attribute changes are produced by existing canonical tooth state updates.
    const svg = tooth.ownerDocument.getElementById('toothSvg');
    if (svg && typeof MutationObserver === 'function') {
      let pending = false;
      const observer = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; redraw(); });
      });
      observer.observe(svg,{subtree:true,attributes:true,attributeFilter:['class']});
    }
    window.addEventListener('resize',redraw);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',layout);
  else layout();
})();

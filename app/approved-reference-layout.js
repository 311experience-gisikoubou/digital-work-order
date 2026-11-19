/* 2026-10-21 user-approved fixed composition. Existing inputs are MOVED, not recreated. */
(function () {
  'use strict';
  function create(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function enhanceApprovedLayout() {
    const root = document.getElementById('approved-full-form');
    if (!root || root.dataset.approvedSource === '20261021-teal') return;
    const patient = root.querySelector('.approved-card-patient');
    const delivery = root.querySelector('.approved-card-delivery');
    const prosthetics = root.querySelector('.approved-card-prosthetics');
    const options = root.querySelector('.approved-card-options');
    const media = root.querySelector('.approved-card-media');
    const remarks = root.querySelector('.approved-card-remarks');
    if (![patient,delivery,prosthetics,options,media,remarks].every(Boolean)) return;
    const rows = [...patient.children].filter(node => node.classList?.contains('form-row'));
    if (rows.length !== 4) return;
    const [row1,row2,labRow,dateRow] = rows;
    const patientName = row2.querySelector('.form-group');
    if (!patientName || dateRow.children.length !== 2) return;
    row1.append(patientName);
    row2.append(...[...dateRow.children]);
    dateRow.remove();
    row1.classList.add('approved-patient-top');
    row2.classList.add('approved-patient-bottom');

    // Keep the merged laboratory-number save flow fully operational, but off the
    // compact approved reference footprint until the user opens its settings.
    const lab = create('details','approved-lab-settings');
    const summary = create('summary','','歯科技工所番号');
    lab.append(summary,labRow);
    patient.querySelector('.card-title').append(lab);

    const shipping = delivery.querySelector('.shipping-row');
    const result = delivery.querySelector('#deliveryResult');
    const insurance = delivery.querySelector('.approved-card-insurance');
    const deliveryOptions = delivery.querySelector('.approved-delivery-options');
    if (!shipping || !result || !insurance || !deliveryOptions) return;
    shipping.append(insurance, result);
    shipping.classList.add('approved-shipping-four');
    const art = create('section','approved-artificial-card');
    art.append(create('div','card-title','人工歯'));
    const ins = prosthetics.querySelector('#prosthetics-insurance > .form-row');
    const jishi = prosthetics.querySelector('#prosthetics-jishi > .form-row');
    if (ins && jishi) {
      art.append(ins,jishi);
      // Both the shade title and its existing checkbox open the original selector.
      for (const shadeCheckboxId of ['chk-shade','chk-shade-jishi']) {
        const input = document.getElementById(shadeCheckboxId);
        const heading = input?.closest('.form-group')?.querySelector(':scope > label');
        if (heading) heading.htmlFor = shadeCheckboxId;
      }
      ins.classList.add('approved-artificial-insurance');
      jishi.classList.add('approved-artificial-jishi');
      const update = () => {
        const isInsurance = document.getElementById('btn-insurance')?.classList.contains('active');
        ins.hidden = !isInsurance;
        jishi.hidden = Boolean(isInsurance);
      };
      for (const id of ['btn-insurance','btn-jishi']) {
        document.getElementById(id)?.addEventListener('click',update);
      }
      update();
    }
    deliveryOptions.append(art);

    // The original prosthetic form has more functions than the fixed design
    // visibly shows. They remain accessible through a lightweight disclosure,
    // never removed, cloned, or moved outside their original insurance group.
    for (const bodyId of ['prosthetics-insurance','prosthetics-jishi']) {
      const body = document.getElementById(bodyId);
      if (!body) continue;
      const mainDevices = body.querySelector(bodyId.endsWith('insurance') ? '#device-insurance' : '#device-jishi');
      if (!mainDevices) continue;
      const allParts = [...body.children];
      const pivot = allParts.indexOf(mainDevices);
      if (pivot < 0) continue;
      const more = create('details','approved-prosthetic-extra');
      more.append(create('summary','','詳細設定'));
      const inner = create('div','approved-prosthetic-extra-inner');
      allParts.slice(pivot+1).forEach(node => inner.append(node));
      more.append(inner);
      body.append(more);
      // Open this disclosure only when its summary is tapped. Automatically
      // expanding after GoA etc. covered other fields on narrow iPad viewports.
    }
    // One source-image media button; all existing photo/video/audio/file
    // attachment operations are still one tap away inside the disclosure.
    const actionsOfMedia = media.querySelector('.media-actions');
    if (actionsOfMedia) {
      const mediaDetails = create('details','approved-media-actions');
      mediaDetails.append(create('summary','','ファイルを選択'));
      actionsOfMedia.replaceWith(mediaDetails);
      mediaDetails.append(actionsOfMedia);
    }
    const second = create('div','approved-second-row');
    second.append(prosthetics,options,media,remarks);
    root.append(second);
    // The approved image shows the clasp-type picker expanded; remaining groups closed.
    const typePicker = root.querySelector('.approved-clasp-panel .approved-clasp-details');
    if (typePicker) typePicker.open = true;
    // Optional actions remain accessible, without expanding the approved header footprint.
    const actions = root.querySelector('.approved-form-actions .submit-area');
    const discard = root.querySelector('#draft-discard-btn');
    const note = root.querySelector('#draft-local-note');
    if (actions && discard) {
      const extras = create('details','approved-optional-actions');
      extras.append(create('summary','','その他'),discard);
      if (note) extras.append(note);
      actions.append(extras);
    }
    root.dataset.approvedSource = '20261021-teal';
    window.dispatchEvent(new Event('resize'));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceApprovedLayout);
  else enhanceApprovedLayout();
})();

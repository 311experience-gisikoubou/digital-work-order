// Phase 8 Gateway viewer browser script.
// Served only by gateway/viewer-server.mjs, fetched over 127.0.0.1.
// All work-order text is rendered with textContent / safe DOM construction;
// this file never builds HTML from strings (no innerHTML with request data).
(function () {
  'use strict';

  function el(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        if (key === 'text') node.textContent = props[key];
        else node.setAttribute(key, props[key]);
      });
    }
    return node;
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: 'no-store' });
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok) {
      throw new Error((data && data.error) || ('HTTP_' + response.status));
    }
    return data;
  }

  function formatReceivedAt(ms) {
    try {
      return new Date(ms).toLocaleString();
    } catch (_) {
      return String(ms);
    }
  }

  function renderJobList(jobs, invalidCount) {
    const list = document.getElementById('job-list');
    list.textContent = '';
    if (jobs.length === 0) {
      list.appendChild(el('li', { text: '受信済みジョブはありません。' }));
    }
    jobs.forEach(function (job) {
      const item = el('li');
      item.appendChild(el('div', { text: '受信: ' + formatReceivedAt(job.receivedAt) }));
      const summary = job.workOrderSummary || {};
      const parts = [];
      if (summary.clinicName) parts.push('医院: ' + summary.clinicName);
      if (summary.patientName) parts.push('患者: ' + summary.patientName);
      if (summary.deliveryDate) parts.push('納期: ' + summary.deliveryDate);
      parts.push('添付: ' + job.attachmentCount + '件');
      item.appendChild(el('div', { text: parts.join(' / ') }));
      item.addEventListener('click', function () {
        loadDetail(job.jobId);
      });
      list.appendChild(item);
    });
    if (invalidCount > 0) {
      list.appendChild(el('li', { text: '無効な保存データ(件数のみ表示): ' + invalidCount }));
    }
  }

  function renderFieldRows(container, fields) {
    fields.forEach(function (field) {
      const row = el('div', { class: 'field-row' });
      row.appendChild(el('div', { class: 'key', text: field.key }));
      let valueText;
      if (field.value === null || field.value === undefined) {
        valueText = '';
      } else if (typeof field.value === 'object') {
        valueText = JSON.stringify(field.value);
      } else {
        valueText = String(field.value);
      }
      row.appendChild(el('div', { class: 'value', text: valueText }));
      container.appendChild(row);
    });
  }

  function renderAttachment(container, attachment) {
    const wrap = el('div', { class: 'media-item' });
    wrap.appendChild(el('div', {
      text: attachment.kind + ' / ' + attachment.mime + ' / ' + attachment.size + ' bytes'
    }));
    if (attachment.kind === 'image') {
      const img = el('img');
      img.src = attachment.url;
      img.alt = attachment.attachmentId;
      wrap.appendChild(img);
    } else if (attachment.kind === 'video') {
      const video = el('video');
      video.src = attachment.url;
      video.controls = true;
      wrap.appendChild(video);
    } else if (attachment.kind === 'audio') {
      const audio = el('audio');
      audio.src = attachment.url;
      audio.controls = true;
      wrap.appendChild(audio);
    } else {
      const link = el('a', { href: attachment.url, text: 'ファイルを開く (' + attachment.attachmentId + ')' });
      link.target = '_blank';
      link.rel = 'noopener';
      wrap.appendChild(link);
    }
    container.appendChild(wrap);
  }

  function triggerDownload(url) {
    const anchor = el('a', { href: url });
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function loadDetail(jobId) {
    const panel = document.getElementById('detail-panel');
    panel.textContent = '';
    try {
      const detail = await getJson('/api/jobs/' + encodeURIComponent(jobId));
      panel.appendChild(el('h2', { text: '受信ジョブ詳細' }));

      const downloadBtn = el('button', { text: '納品・請求アプリ用JSONをダウンロード' });
      downloadBtn.addEventListener('click', function () {
        triggerDownload('/api/jobs/' + encodeURIComponent(jobId) + '/delivery-intake.json');
      });
      panel.appendChild(downloadBtn);

      panel.appendChild(el('h3', { text: '指示書内容(ローカル端末専用)' }));
      const fieldsBox = el('div');
      renderFieldRows(fieldsBox, detail.fields || []);
      panel.appendChild(fieldsBox);

      panel.appendChild(el('h3', { text: '添付メディア' }));
      const mediaBox = el('div');
      (detail.attachments || []).forEach(function (attachment) {
        renderAttachment(mediaBox, attachment);
      });
      panel.appendChild(mediaBox);
    } catch (error) {
      panel.appendChild(el('p', { text: '詳細を表示できませんでした: ' + (error && error.message) }));
    }
  }

  async function init() {
    const list = document.getElementById('job-list');
    try {
      const data = await getJson('/api/jobs');
      renderJobList(data.jobs || [], data.invalidCount || 0);
    } catch (error) {
      list.textContent = '';
      list.appendChild(el('li', { text: '一覧を取得できませんでした: ' + (error && error.message) }));
    }
  }

  init();
})();

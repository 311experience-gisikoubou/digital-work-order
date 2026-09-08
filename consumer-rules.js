(function (root) {
  'use strict';

  const TARGET_APP = 'digital-work-order';
  const EXPORT_SCHEMA_VERSION = 'consumer-export-v1';
  const UTC_SECONDS_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/;
  const RULE_ID_PATTERN = /^rule_[a-f0-9]{32}$/;
  const VERSION_PATTERN = /^[1-9][0-9]*\.[0-9]+\.[0-9]+$/;
  const CONDITION_LABELS = Object.freeze({
    document_intake_is_unclassified: '書類の分類を確認',
    required_status_is_missing: '必要な状態を確認',
    structured_category_is_missing: '分類の入力を確認',
    workflow_checkpoint_is_missing: '作業手順の確認点を確認'
  });
  const ACTION_LABELS = Object.freeze({
    display_review_checkpoint: '確認ポイントを表示',
    require_status_confirmation: '状態確認を促す',
    request_structured_category: '分類入力を促す',
    route_to_document_intake: '書類受付の確認を促す'
  });
  const EXPORT_KEYS = ['schemaVersion', 'targetApp', 'generatedAt', 'rules'];
  const RULE_KEYS = ['ruleId', 'version', 'conditionCode', 'actionCode', 'approvedAt'];
  let paperWorkOrderObjectUrl = '';
  let paperWorkOrderFile = null;
  let resetPaperWorkOrderOCR = () => {};

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function hasOnlyRequiredKeys(value, keys) {
    if (!isPlainObject(value)) return false;
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
  }

  function isUtcSecondTimestamp(value) {
    if (typeof value !== 'string' || value.length !== 20 || !UTC_SECONDS_PATTERN.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && `${date.toISOString().slice(0, 19)}Z` === value;
  }

  function isValidRule(rule) {
    return hasOnlyRequiredKeys(rule, RULE_KEYS)
      && typeof rule.ruleId === 'string'
      && RULE_ID_PATTERN.test(rule.ruleId)
      && typeof rule.version === 'string'
      && rule.version.length <= 32
      && VERSION_PATTERN.test(rule.version)
      && Object.prototype.hasOwnProperty.call(CONDITION_LABELS, rule.conditionCode)
      && Object.prototype.hasOwnProperty.call(ACTION_LABELS, rule.actionCode)
      && isUtcSecondTimestamp(rule.approvedAt);
  }

  function validateConsumerExport(value) {
    if (!hasOnlyRequiredKeys(value, EXPORT_KEYS)
      || value.schemaVersion !== EXPORT_SCHEMA_VERSION
      || value.targetApp !== TARGET_APP
      || !isUtcSecondTimestamp(value.generatedAt)
      || !Array.isArray(value.rules)
      || value.rules.length > 100
      || !value.rules.every(isValidRule)) {
      return { valid: false, rules: [] };
    }
    return { valid: true, rules: value.rules };
  }

  function parseConsumerExportText(text) {
    try {
      return validateConsumerExport(JSON.parse(text));
    } catch (_) {
      return { valid: false, rules: [] };
    }
  }

  function formatRule(rule) {
    return `${CONDITION_LABELS[rule.conditionCode]} / ${ACTION_LABELS[rule.actionCode]}`;
  }

  function renderRules(rules, status) {
    const count = document.getElementById('consumer-rules-count');
    const list = document.getElementById('consumer-rules-list');
    if (!count || !list) return;

    list.textContent = '';
    if (status === 'error') {
      count.textContent = '承認済み共通ルールを読み込めませんでした。通常の指示書入力は続けて利用できます。';
      list.hidden = true;
      return;
    }

    count.textContent = `承認済み共通ルール：${rules.length}件`;
    list.hidden = rules.length === 0;
    rules.forEach(rule => {
      const item = document.createElement('li');
      item.textContent = formatRule(rule);
      list.appendChild(item);
    });
  }

  function readSelectedFile(file) {
    if (!file) {
      renderRules([], 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseConsumerExportText(typeof reader.result === 'string' ? reader.result : '');
      renderRules(result.rules, result.valid ? 'ok' : 'error');
    };
    reader.onerror = () => renderRules([], 'error');
    reader.onabort = () => renderRules([], 'error');
    reader.readAsText(file, 'utf-8');
  }

  function releasePaperWorkOrderObjectUrl() {
    if (!paperWorkOrderObjectUrl) return;
    URL.revokeObjectURL(paperWorkOrderObjectUrl);
    paperWorkOrderObjectUrl = '';
  }

  function syncPaperWorkOrderReference() {
    const panel = document.getElementById('paper-work-order-reference');
    const image = document.getElementById('paper-work-order-reference-image');
    const clinicView = document.getElementById('view-clinic');
    const hasImage = Boolean(paperWorkOrderObjectUrl);
    if (image) { if (hasImage) image.src = paperWorkOrderObjectUrl; else image.removeAttribute('src'); }
    if (panel) panel.hidden = !hasImage;
    if (clinicView && clinicView.classList) clinicView.classList.toggle('paper-reference-active', hasImage);
  }

  function expandPaperWorkOrderReference() {
    const panel = document.getElementById('paper-work-order-reference');
    const body = document.getElementById('paper-reference-body');
    const toggle = document.getElementById('paper-reference-toggle');
    if (panel && panel.classList) panel.classList.remove('is-collapsed');
    if (body) body.hidden = false;
    if (toggle) { toggle.textContent = '画像を隠す'; toggle.setAttribute('aria-expanded', 'true'); }
  }

  function clearPaperWorkOrderPreview() {
    paperWorkOrderFile = null;
    resetPaperWorkOrderOCR();
    releasePaperWorkOrderObjectUrl();
    const preview = document.getElementById('paper-work-order-preview');
    const previewWrap = document.getElementById('paper-work-order-preview-wrap');
    const filename = document.getElementById('paper-work-order-filename');
    const status = document.getElementById('paper-work-order-status');
    const input = document.getElementById('paper-work-order-import');
    if (preview) preview.removeAttribute('src');
    if (previewWrap) previewWrap.hidden = true;
    if (filename) filename.textContent = '';
    if (status) status.textContent = '画像は端末内でのみ一時表示し、保存・外部送信しません。';
    if (input) input.value = '';
    syncPaperWorkOrderReference();
  }

  function showPaperWorkOrderPreview(file) {
    if (!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
      clearPaperWorkOrderPreview();
      const status = document.getElementById('paper-work-order-status');
      if (status) status.textContent = '画像ファイルを選択してください。';
      return;
    }

    clearPaperWorkOrderPreview();
    paperWorkOrderObjectUrl = URL.createObjectURL(file);
    paperWorkOrderFile = file;
    resetPaperWorkOrderOCR();
    const preview = document.getElementById('paper-work-order-preview');
    const previewWrap = document.getElementById('paper-work-order-preview-wrap');
    const filename = document.getElementById('paper-work-order-filename');
    const status = document.getElementById('paper-work-order-status');
    const input = document.getElementById('paper-work-order-import');
    if (preview) preview.src = paperWorkOrderObjectUrl;
    if (previewWrap) previewWrap.hidden = false;
    if (filename) filename.textContent = file.name || '撮影した画像';
    if (status) status.textContent = '端末内で一時表示中です。読み取りは「端末内で読み取る」から開始できます。';
    if (input) input.value = '';
    syncPaperWorkOrderReference();
  }

  function initPaperWorkOrderImport() {
    const labView = document.getElementById('view-lab');
    if (!labView || document.getElementById('paper-work-order-import-panel')) return;

    const panel = document.createElement('section');
    panel.id = 'paper-work-order-import-panel';
    panel.className = 'consumer-rules-panel paper-intake';
    panel.setAttribute('aria-labelledby', 'paper-work-order-import-title');
    panel.innerHTML = `
      <div class="consumer-rules-heading">
        <h2 id="paper-work-order-import-title">紙指示書の取り込み</h2>
        <button type="button" class="consumer-rules-import-button" id="paper-work-order-import-button">紙指示書を取り込む</button>
        <input type="file" id="paper-work-order-import" accept="image/*" capture="environment" hidden>
      </div>
      <p id="paper-work-order-status" class="consumer-rules-count" aria-live="polite">画像は端末内でのみ一時表示し、保存・外部送信しません。</p>
      <div id="paper-work-order-preview-wrap" hidden style="margin-top:12px;">
        <div id="paper-work-order-filename" style="font-size:13px;font-weight:700;margin-bottom:8px;word-break:break-all;"></div>
        <img id="paper-work-order-preview" alt="取り込んだ紙指示書のプレビュー" style="display:block;max-width:100%;max-height:70vh;border:1px solid var(--border-color);border-radius:var(--radius-sm);object-fit:contain;background:#fff;">
        <button type="button" class="btn-primary" id="paper-work-order-open-clinic" style="margin-top:10px;">画像を見ながら入力</button>
        <button type="button" class="btn-secondary" id="paper-work-order-discard" style="margin-top:10px;">画像を破棄</button>
      </div>
      <p>OCR試行版：架空のテスト画像のみ使用してください。</p>
    <button type="button" class="btn-primary" id="paper-ocr-start" disabled>端末内で読み取る</button>
    <button type="button" class="btn-secondary" id="paper-cancel">候補確認をキャンセル</button>
    <p id="paper-ocr-status" role="status" aria-live="polite">画像を取り込んでください。手入力も利用できます。</p>
    <div id="paper-review" hidden>
      <p>画像と照合し、反映する項目にチェックを付けてください。選択した項目は既存フォームの値を上書きします。</p>
      <div class="paper-candidate"><label for="paper-clinicName">歯科医院名の候補</label><input id="paper-clinicName" type="text" maxlength="100" autocomplete="off"><label><input id="paper-approve-clinicName" type="checkbox">歯科医院名を承認</label></div>
      <div class="paper-candidate"><label for="paper-doctorName">担当歯科医師の候補</label><input id="paper-doctorName" type="text" maxlength="100" autocomplete="off"><label><input id="paper-approve-doctorName" type="checkbox">担当歯科医師を承認</label></div>
      <div class="paper-candidate"><label for="paper-patientName">患者名の候補</label><input id="paper-patientName" type="text" maxlength="100" autocomplete="off"><label><input id="paper-approve-patientName" type="checkbox">患者名を承認</label></div>
      <div class="paper-candidate"><label for="paper-deliveryDate">納期の候補</label><input id="paper-deliveryDate" type="date" autocomplete="off"><label><input id="paper-approve-deliveryDate" type="checkbox">納期を承認</label></div>
      <button type="button" class="btn-primary" id="paper-copy">選択した候補を承認してフォームへ反映</button>
    </div>
`;

    labView.insertBefore(panel, labView.firstChild);

    const input = document.getElementById('paper-work-order-import');
    const button = document.getElementById('paper-work-order-import-button');
    const discard = document.getElementById('paper-work-order-discard');
    const openClinic = document.getElementById('paper-work-order-open-clinic');
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => showPaperWorkOrderPreview(input.files && input.files[0]));
    discard.addEventListener('click', clearPaperWorkOrderPreview);
    openClinic.addEventListener('click', () => {
      if (!paperWorkOrderObjectUrl) return;
      syncPaperWorkOrderReference();
      expandPaperWorkOrderReference();
      const clinicTab = document.querySelector && document.querySelector('.tab-btn[data-tab="clinic"]');
      if (clinicTab && typeof clinicTab.click === 'function') clinicTab.click();
    });
    const referenceToggle = document.getElementById('paper-reference-toggle');
    const referenceBody = document.getElementById('paper-reference-body');
    const referencePanel = document.getElementById('paper-work-order-reference');
    if (referenceToggle && referenceBody && referencePanel) referenceToggle.addEventListener('click', () => {
      const collapsed = referencePanel.classList.toggle('is-collapsed');
      referenceBody.hidden = collapsed;
      referenceToggle.textContent = collapsed ? '画像を表示' : '画像を隠す';
      referenceToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    });
    initPaperWorkOrderOCR();
  }

  function initPaperWorkOrderOCR() {
    const get = id => document.getElementById(id);
    if (!root.PaperOCR) return;
    const { fields, labels, recognize, copyApproved } = root.PaperOCR;
    let generation = 0, worker = null, busy = false, timer = null;
    const status = message => { get('paper-ocr-status').textContent = message; };
    const resetReview = () => {
      get('paper-review').hidden = true;
      for (const key of Object.keys(fields)) { get(`paper-${key}`).value = ''; get(`paper-approve-${key}`).checked = false; }
    };
    const stop = () => {
      generation += 1;
      clearTimeout(timer);
      if (worker) { worker.terminate().catch(() => {}); worker = null; }
      busy = false;
      get('paper-ocr-start').disabled = !paperWorkOrderFile;
      resetReview();
    };
    resetPaperWorkOrderOCR = () => {
      stop();
      status(paperWorkOrderFile ? '画像を確認して読み取りを開始してください。' : '画像を取り込んでください。手入力も利用できます。');
    };
    get('paper-cancel').addEventListener('click', () => { stop(); status('候補確認をキャンセルしました。画像は保持しています。'); });
    get('paper-ocr-start').addEventListener('click', async () => {
      if (!paperWorkOrderFile || busy) return;
      stop(); busy = true;
      const run = generation;
      get('paper-ocr-start').disabled = true;
      status('端末内で読み取り中です。手入力は引き続き利用できます。');
      timer = setTimeout(() => { if (run === generation) { stop(); status('読み取りが時間内に完了しませんでした。画像は保持しています。再試行または手入力してください。'); } }, 120000);
      try {
        const candidates = await recognize(paperWorkOrderFile, document.baseURI, active => {
          if (run !== generation) { active.terminate().catch(() => {}); throw new Error('stale-run'); }
          worker = active;
        });
        if (run !== generation) return;
        for (const key of Object.keys(fields)) get(`paper-${key}`).value = candidates[key];
        get('paper-review').hidden = false;
        status('未承認の候補です。画像と照合・修正し、反映する項目を選んでください。空欄は読み取れなかった項目です。');
      } catch (_) {
        if (run === generation) status('読み取りに失敗しました。画像は保持しています。再試行・差し替え・手入力ができます。');
      } finally {
        if (run === generation) { clearTimeout(timer); busy = false; worker = null; get('paper-ocr-start').disabled = !paperWorkOrderFile; }
      }
    });
    for (const key of Object.keys(fields)) {
      get(`paper-${key}`).addEventListener('input', () => {
        get(`paper-approve-${key}`).checked = false;
        status('候補を変更しました。画像と照合し、変更した項目を再度承認してください。');
      });
    }
    get('paper-copy').addEventListener('click', () => {
      if (get('paper-review').hidden || busy) return;
      const candidates = {}, approved = {};
      for (const key of Object.keys(fields)) { candidates[key] = get(`paper-${key}`).value; approved[key] = get(`paper-approve-${key}`).checked; }
      try {
        const copied = copyApproved(document, candidates, approved);
        const summary = copied.map(key => `${labels[key]}：${get(fields[key]).value}`).join(' / ');
        status(`反映・照合済み（受注は未確定）：${summary}。医院側フォームで続けて確認してください。納期のカレンダー表示・料金は再計算していません。画像は保持しています。`);
        for (const key of Object.keys(fields)) get(`paper-approve-${key}`).checked = false;
      } catch (_) {
        status('反映・照合に失敗しました。選択項目と入力内容、コピー先を確認してください。画像は保持しています。');
      }
    });

  }

  function initConsumerRules() {
    const input = document.getElementById('consumer-rules-import');
    const button = document.getElementById('consumer-rules-import-button');
    if (!input || !button) return;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      readSelectedFile(input.files && input.files[0]);
      input.value = '';
    });
  }

  function init() {
    initConsumerRules();
    initPaperWorkOrderImport();
  }

  root.ConsumerRuleConsumer = Object.freeze({ parseConsumerExportText, validateConsumerExport, formatRule, init });
  if (typeof document !== 'undefined') init();
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('beforeunload', clearPaperWorkOrderPreview);
    root.addEventListener('pagehide', clearPaperWorkOrderPreview);
  }
}(globalThis));

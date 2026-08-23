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

  function init() {
    const input = document.getElementById('consumer-rules-import');
    const button = document.getElementById('consumer-rules-import-button');
    if (!input || !button) return;
    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      readSelectedFile(input.files && input.files[0]);
      input.value = '';
    });
  }

  root.ConsumerRuleConsumer = Object.freeze({ parseConsumerExportText, validateConsumerExport, formatRule, init });
  if (typeof document !== 'undefined') init();
}(globalThis));

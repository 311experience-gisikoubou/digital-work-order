// Clinic-side laboratory registration number. Local device setting only.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'dwo_laboratory_registration_number_v1';
  const CANONICAL_PATTERN = /^\d{2}-\d{2}-\d{5}$/;

  function normalizeNumber(value) {
    const text = String(value == null ? '' : value).trim()
      .replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xff10))
      .replace(/－/g, '-');
    if (!/^\d{9}$/.test(text) && !CANONICAL_PATTERN.test(text)) return '';
    const digits = text.replace(/-/g, '');
    return digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
  }

  function storageOrDefault(storage) {
    return storage === undefined ? root.localStorage : storage;
  }

  function readSavedNumber(storage) {
    try {
      const raw = storageOrDefault(storage).getItem(STORAGE_KEY);
      if (raw === null) return { status: 'empty', number: '' };
      const number = normalizeNumber(raw);
      return number ? { status: 'saved', number } : { status: 'invalid', number: '' };
    } catch (_) {
      return { status: 'storage-error', number: '' };
    }
  }

  function saveNumber(value, storage) {
    const number = normalizeNumber(value);
    if (!number) return { status: 'invalid', number: '' };
    try {
      const target = storageOrDefault(storage);
      target.setItem(STORAGE_KEY, number);
      if (target.getItem(STORAGE_KEY) !== number) {
        return { status: 'storage-error', number: '' };
      }
      return { status: 'saved', number };
    } catch (_) {
      return { status: 'storage-error', number: '' };
    }
  }

  function getSavedNumber(storage) {
    const result = readSavedNumber(storage);
    return result.status === 'saved' ? result.number : '';
  }

  function initControls() {
    if (!root.document || typeof root.document.getElementById !== 'function') return;
    const input = root.document.getElementById('laboratory-registration-number');
    const button = root.document.getElementById('laboratory-registration-number-save');
    const status = root.document.getElementById('laboratory-registration-number-status');
    if (!input || !button || !status) return;

    const stored = readSavedNumber();
    if (stored.status === 'saved') {
      input.value = stored.number;
      status.textContent = '保存済み（この端末のブラウザ内）';
    } else if (stored.status === 'invalid') {
      status.textContent = '保存データが不正です。正しい番号を入力して保存してください。';
    } else if (stored.status === 'storage-error') {
      status.textContent = '保存領域を利用できません。番号を保存できません。';
    } else {
      status.textContent = '未保存：初回のみ番号を入力して保存してください。';
    }

    input.addEventListener('input', function () {
      status.textContent = '変更は未保存です。「番号を保存」を押してください。';
    });
    button.addEventListener('click', function () {
      const result = saveNumber(input.value);
      if (result.status === 'saved') {
        input.value = result.number;
        status.textContent = '保存しました。次回から自動で表示されます（この端末のブラウザ内）。';
      } else if (result.status === 'invalid') {
        status.textContent = '番号は9桁で入力してください（例：00-00-00000）。以前の保存値は変更されません。';
      } else {
        status.textContent = '保存できませんでした。ブラウザの保存設定を確認してください。';
      }
    });
  }

  root.LaboratoryNumberSettings = Object.freeze({
    STORAGE_KEY, normalizeNumber, readSavedNumber, saveNumber, getSavedNumber
  });
  initControls();
})(globalThis);

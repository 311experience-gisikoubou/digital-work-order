(function(global) {
  'use strict';

  const WORK_ORDER_REF_PATTERN =
    /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const JOB_ID_PATTERN = /^job_[0-9a-f]{64}$/;
  const CONTROLLER_KEYS = 'dispatch';
  const RESULT_KEYS = 'jobId|status';
  let activeController = null;

  function isExactController(controller) {
    return controller !== null && typeof controller === 'object' &&
      !Array.isArray(controller) && Object.isFrozen(controller) &&
      Object.keys(controller).sort().join('|') === CONTROLLER_KEYS &&
      typeof controller.dispatch === 'function';
  }

  function install(controller) {
    if (!isExactController(controller)) throw new Error('DRIVE_RELAY_SEND_CONTROLLER_INVALID');
    if (activeController && activeController !== controller) {
      throw new Error('DRIVE_RELAY_SEND_CONTROLLER_REPLACEMENT_FORBIDDEN');
    }
    activeController = controller;
    if (typeof global.renderOrders === 'function') global.renderOrders();
    return Object.freeze({ available: true });
  }

  function isExactResult(result) {
    return result !== null && typeof result === 'object' && !Array.isArray(result) &&
      Object.keys(result).sort().join('|') === RESULT_KEYS &&
      JOB_ID_PATTERN.test(result.jobId || '') &&
      (result.status === 'RELAY_REPORTED_ACCEPTED' || result.status === 'KEEP_PENDING');
  }

  function notify(message, type) {
    if (typeof global.showToast === 'function') global.showToast(message, type);
  }

  function clearControllerAndRender() {
    activeController = null;
    if (typeof global.renderOrders === 'function') global.renderOrders();
  }

  function createButton(workOrderRef) {
    const controller = activeController;
    if (!controller) return null;
    if (!WORK_ORDER_REF_PATTERN.test(workOrderRef || '')) {
      throw new Error('DRIVE_RELAY_SEND_WORK_ORDER_REF_INVALID');
    }

    const button = global.document.createElement('button');
    button.className = 'act-btn detail';
    button.textContent = '技工所へ送信';
    button.title = '暗号化指示書を中継へ送信（技工所の受領確認とは別）';
    button.addEventListener('click', async function() {
      if (activeController !== controller) {
        notify('送信設定が変わったため処理を中止しました', 'error');
        return;
      }
      if (typeof global.confirm !== 'function' || !global.confirm(
        '暗号化した指示書を中継へ送信します。技工所の受領完了ではありません。送信しますか？'
      )) return;

      button.disabled = true;
      button.textContent = '送信確認中…';
      try {
        const result = await controller.dispatch(workOrderRef);
        if (!isExactResult(result)) {
          throw new Error('DRIVE_RELAY_SEND_RESULT_INVALID');
        }
        if (result.status === 'RELAY_REPORTED_ACCEPTED') {
          notify('中継への保存を確認しました（技工所の受領確認待ち）');
        } else {
          notify('送信状態を確認できません。同じ指示書で再確認できます', 'error');
        }
      } catch (_) {
        notify('送信を確認できませんでした。同じ指示書で再確認できます', 'error');
      } finally {
        if (activeController === controller) {
          button.disabled = false;
          button.textContent = '技工所へ送信';
        }
      }
    });
    return button;
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', clearControllerAndRender);
  }

  global.DriveRelaySendUi = Object.freeze({ install, createButton });
})(typeof window !== 'undefined' ? window : globalThis);

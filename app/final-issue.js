// ============================================================
//  Phase 2 Stage 5: 正式発行フロー
//  既存の受注一覧反映ハンドラを実画面から外し、
//  PDF / session / media / draft を1本のfail-closedフローで接続する。
// ============================================================
(function(global) {
  'use strict';

  const submitButton = document.getElementById('submit-btn');
  if (!submitButton) return;

  // app.js の旧「一覧へ反映」ハンドラは互換用に残すが、実画面では使わない。
  if (typeof submitOrder === 'function') {
    submitButton.removeEventListener('click', submitOrder);
  }

  let issueOrderInProgress = false;

  // ローカル転送パッケージ用: このタブで実際に発行完了まで到達した
  // workOrderRef だけを記録する（セッション内のみ、永続化しない）。
  // 再読込でstate.ordersへ復元された過去の受注はここに含まれないため、
  // 後述の prepareIssuedTransferPackage は意図的にfail closedする。
  const issuedWorkOrderRefs = new Set();
  const WORK_ORDER_REF_PATTERN =
    /^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // このタブ限定・非永続のローカル転送状態（送信・ネットワークは一切行わない）。
  // 値は 'ISSUED_NOT_SENT' | 'PREPARING_LOCAL_PACKAGE' |
  // 'PACKAGE_PREPARED_NOT_SENT' | 'PREPARATION_FAILED_NOT_SENT' のみ。
  // 'sent'・'ready on remote'・'received'・'ACK' は存在せず、エントリも削除しない。
  const transferStatusByRef = new Map();

  function transferPackageError(code) {
    return Object.assign(new Error(code), { code });
  }

  function rollbackTentativeOrder(order) {
    const index = state.orders.findIndex(item =>
      item === order || item.workOrderRef === order.workOrderRef
    );
    if (index >= 0) state.orders.splice(index, 1);
    if (typeof syncTemporaryOrdersToSession === 'function') {
      syncTemporaryOrdersToSession();
    }
    if (typeof syncOrderLossGuard === 'function') syncOrderLossGuard();
  }

  async function issueCurrentOrder() {
    if (issueOrderInProgress) return;

    const data = collectFormData();
    const errors = validate(data);
    if (errors.length > 0) {
      showToast(`入力必須項目: ${errors.join('、')}`, 'error');
      return;
    }

    let visualSnapshot = null;
    try {
      visualSnapshot = typeof freezeVisualSnapshot === 'function'
        ? freezeVisualSnapshot()
        : null;
    } catch (_) {
      visualSnapshot = null;
    }
    if (!visualSnapshot) {
      showToast('歯式・クラスプ・手書きの表示状態を固定できないため、発行を中止しました', 'error');
      return;
    }

    try {
      data.workOrderRef = generateWorkOrderRef();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('SECURE_WORK_ORDER_REF_')) throw error;
      showToast('安全な指示書IDを生成できないため、発行を中止しました', 'error');
      return;
    }

    data.selectedTeeth = JSON.parse(JSON.stringify(visualSnapshot.selectedTeeth));
    data.memoStrokes = JSON.parse(JSON.stringify(visualSnapshot.drawing.memoStrokes));
    data.visualSnapshot = visualSnapshot;

    const draftManager = global.FormDraftManager;
    const mediaManager = global.ReferenceMediaManager;
    if (!draftManager || typeof draftManager.removeCurrentFormDraft !== 'function' ||
        !mediaManager || typeof mediaManager.commitCurrentDraft !== 'function' ||
        typeof requestIssuePdfPaperSize !== 'function' ||
        typeof createIssuePdfBlob !== 'function' ||
        typeof openFixedPdfBlob !== 'function') {
      showToast('発行に必要な機能を準備できないため、処理を中止しました', 'error');
      return;
    }

    issueOrderInProgress = true;
    submitButton.disabled = true;

    let orderInserted = false;
    let issuanceCommitted = false;
    let mediaReceipt = { committed: 0 };
    const draftRef = typeof draftManager.getCurrentDraftRef === 'function'
      ? draftManager.getCurrentDraftRef()
      : null;

    try {
      const paperSize = await requestIssuePdfPaperSize();
      if (!paperSize) return;

      showToast((paperSize === 'a4' ? 'A4' : 'B5') + ' PDFを作成しています');
      const pdfBlob = await createIssuePdfBlob(data, paperSize);

      // Session保存まで確認できた受注だけを添付確定へ進める。
      state.orders.unshift(data);
      orderInserted = true;
      if (typeof syncTemporaryOrdersToSession !== 'function' ||
          !syncTemporaryOrdersToSession()) {
        throw new Error('ORDER_SESSION_SAVE_FAILED');
      }
      if (typeof syncOrderLossGuard === 'function') syncOrderLossGuard();

      mediaReceipt = await mediaManager.commitCurrentDraft(data.workOrderRef);

      // 発行の重要処理が完了した後にだけ下書きを削除する。
      if (!draftManager.removeCurrentFormDraft()) {
        const rollbackDraftRef = mediaReceipt.draftRef || draftRef;
        if (mediaReceipt.committed > 0 && rollbackDraftRef &&
            typeof mediaManager.rollbackCommittedDraft === 'function') {
          try {
            await mediaManager.rollbackCommittedDraft(data.workOrderRef, rollbackDraftRef);
            mediaReceipt = { committed: 0 };
          } catch (_) {
            // 添付を元へ戻せない場合は、添付との整合を優先して受注を残す。
            showToast(
              '発行は完了しましたが、下書きだけ削除できませんでした。再発行せず「下書きを破棄」で整理してください',
              'error'
            );
            if (typeof renderOrders === 'function') renderOrders();
            openFixedPdfBlob(pdfBlob, paperSize);
            return;
          }
        }
        rollbackTentativeOrder(data);
        orderInserted = false;
        throw new Error('DRAFT_DELETE_FAILED');
      }

      issuanceCommitted = true;
      issuedWorkOrderRefs.add(data.workOrderRef);
      transferStatusByRef.set(data.workOrderRef, 'ISSUED_NOT_SENT');
      if (typeof renderOrders === 'function') renderOrders();
      showToast('✅ 指示書を発行しました');
      resetForm();
      openFixedPdfBlob(pdfBlob, paperSize);

    } catch (error) {
      if (issuanceCommitted) {
        showToast(
          '指示書は発行済みですが、PDFを開けませんでした。受注一覧から再度PDFを作成してください',
          'error'
        );
        return;
      }

      if (orderInserted) rollbackTentativeOrder(data);
      const code = error && error.code
        ? error.code
        : error && error.message
          ? error.message
          : '';

      if (code === 'ORDER_SESSION_SAVE_FAILED') {
        showToast(
          '受注を安全に保存できないため、発行を中止しました。入力内容と下書きは残っています',
          'error'
        );
      } else if (code === 'DRAFT_DELETE_FAILED') {
        showToast(
          '下書きを削除できないため、発行を中止しました。入力内容は残っています',
          'error'
        );
      } else if (String(code).startsWith('MEDIA_STORAGE_')) {
        showToast(
          '添付を受注へ確定できないため、発行を中止しました。入力内容と下書きは残っています',
          'error'
        );
      } else if (code !== 'PDF_PAPER_SELECTION_BUSY') {
        showToast(
          'PDFを作成または発行できませんでした。入力内容と下書きは残っています',
          'error'
        );
      }
    } finally {
      issueOrderInProgress = false;
      submitButton.disabled = false;
    }
  }

  submitButton.addEventListener('click', issueCurrentOrder);

  // ============================================================
  //  ローカル手渡し専用パッケージ生成（送信・通信は一切行わない）
  //  既存 ReferenceMediaManager.prepareTransferPackage に委譲するだけで、
  //  新フォーマットや代替パッケージ構築・メディアの複製は行わない。
  //  state.orders から該当 workOrderRef を1件だけ特定し、
  //  このタブで発行完了（issuanceCommitted）まで到達した参照以外はfail closedする。
  // ============================================================
  async function prepareIssuedTransferPackage(workOrderRef) {
    if (typeof workOrderRef !== 'string' || !WORK_ORDER_REF_PATTERN.test(workOrderRef)) {
      throw transferPackageError('TRANSFER_PACKAGE_INVALID_REF');
    }

    if (!issuedWorkOrderRefs.has(workOrderRef)) {
      throw transferPackageError('TRANSFER_PACKAGE_NOT_ISSUED');
    }

    const matches = Array.isArray(state.orders)
      ? state.orders.filter(order => order && order.workOrderRef === workOrderRef)
      : [];

    if (matches.length === 0) {
      throw transferPackageError('TRANSFER_PACKAGE_ORDER_NOT_FOUND');
    }
    if (matches.length > 1) {
      throw transferPackageError('TRANSFER_PACKAGE_DUPLICATE_ORDER');
    }

    const mediaManager = global.ReferenceMediaManager;
    if (!mediaManager || typeof mediaManager.prepareTransferPackage !== 'function') {
      throw transferPackageError('TRANSFER_PACKAGE_MEDIA_UNAVAILABLE');
    }

    // 同一refに対する準備が既に進行中の場合は、二重の委譲を防ぐため拒否する。
    // 直前の準備が失敗（PREPARATION_FAILED_NOT_SENT）していた場合は
    // 新たな明示的リトライとして許可する。
    if (transferStatusByRef.get(workOrderRef) === 'PREPARING_LOCAL_PACKAGE') {
      throw transferPackageError('TRANSFER_PREPARE_IN_PROGRESS');
    }

    transferStatusByRef.set(workOrderRef, 'PREPARING_LOCAL_PACKAGE');
    try {
      const result = await mediaManager.prepareTransferPackage(matches[0]);
      transferStatusByRef.set(workOrderRef, 'PACKAGE_PREPARED_NOT_SENT');
      return result;
    } catch (error) {
      transferStatusByRef.set(workOrderRef, 'PREPARATION_FAILED_NOT_SENT');
      throw error;
    }
  }

  // ============================================================
  //  このタブ内限定の状態参照（非永続・送信なし）。
  //  state.ordersから該当refが一意に特定できない場合（未発行・削除済み・
  //  重複）は常に 'UNVERIFIED' を返し、過去の状態値を漏らさない。
  // ============================================================
  function getIssuedTransferStatus(workOrderRef) {
    if (typeof workOrderRef !== 'string' || !WORK_ORDER_REF_PATTERN.test(workOrderRef)) {
      return 'UNVERIFIED';
    }
    if (!issuedWorkOrderRefs.has(workOrderRef)) {
      return 'UNVERIFIED';
    }

    const matches = Array.isArray(state.orders)
      ? state.orders.filter(order => order && order.workOrderRef === workOrderRef)
      : [];
    if (matches.length !== 1) {
      return 'UNVERIFIED';
    }

    return transferStatusByRef.get(workOrderRef) || 'ISSUED_NOT_SENT';
  }

  // 初期のdisabled解除はcalendar.jsに任せる。
  // 模型発送日から納期・急ぎ料金の判定が完了する前には発行できない。
  global.DwoFinalIssue = {
    issueCurrentOrder,
    prepareIssuedTransferPackage,
    getIssuedTransferStatus
  };
})(globalThis);

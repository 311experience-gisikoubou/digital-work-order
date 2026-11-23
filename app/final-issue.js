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

  // issuanceCommitted直後の受注スナップショット（JSON文字列・statusフィールド
  // は除外）。このタブのJSメモリ上にのみ保持し、sessionStorage・IndexedDB・
  // クラウド・ログ・新規ファイルへは一切書き込まない。目的はただ1つ:
  // 「このドキュメントで実際に発行完了まで到達したref」であっても、発行後に
  // 患者・臨床・材料・歯式・納期・料金等のいずれかのフィールドが
  // state.orders 上で改変された場合には、新たな検証済み発行なしでの
  // 引き渡し準備（prepareIssuedTransferPackage）を許可しないこと。
  // status（pending/accepted）は orders.js 側で発行後も正当に切り替わる
  // 業務上の運用フィールドのため、比較対象から除外する。
  const issuedOrderSnapshots = new Map();

  // 入れ子オブジェクトのキー順序の違いによる偽陽性の不一致を避けつつ、
  // 配列の順序は臨床的に意味があるため一切並べ替えない、決定的な再帰
  // シリアライズ。循環参照・非シリアライズ値（BigInt等）はすべて例外として
  // 投げ、呼び出し側（snapshotOrderExcludingStatus）でfail closedへ変換する。
  function stableStringify(value, stack) {
    if (value === null || typeof value !== 'object') {
      const encoded = JSON.stringify(value);
      // JSON.stringify(undefined) === undefined, BigIntは例外を投げる等、
      // シリアライズ不能な値は呼び出し側でfail closedとして扱う。
      if (encoded === undefined) {
        throw transferPackageError('SNAPSHOT_UNSERIALIZABLE_VALUE');
      }
      return encoded;
    }
    if (stack.indexOf(value) !== -1) {
      throw transferPackageError('SNAPSHOT_CIRCULAR_REFERENCE');
    }
    stack.push(value);
    let result;
    try {
      if (Array.isArray(value)) {
        // 配列順序は臨床的に意味があるため、並べ替えない（意図的に維持する）。
        result = '[' + value.map(item => {
          const encoded = stableStringify(item, stack);
          return encoded === undefined ? 'null' : encoded;
        }).join(',') + ']';
      } else {
        const keys = Object.keys(value).sort();
        const parts = [];
        keys.forEach(key => {
          const encoded = stableStringify(value[key], stack);
          if (encoded === undefined) return;
          parts.push(JSON.stringify(key) + ':' + encoded);
        });
        result = '{' + parts.join(',') + '}';
      }
    } finally {
      stack.pop();
    }
    return result;
  }

  // statusフィールドだけを除いた決定的なJSON文字列を作る。入れ子オブジェクト
  // のキーも再帰的にソートすることで、プロパティ追加順序の違いによる
  // 偽陽性の不一致を避ける（値そのものの変化だけを検知する。配列順序は
  // 維持する）。循環参照・非シリアライズ値が入り込んだ場合は、例外を外へ
  // 漏らさず null を返す（fail closed。呼び出し側は「有効なスナップショット
  // が無い」= 改変あり/未発行として扱う）。このスナップショットはこのタブの
  // JSメモリ上にのみ存在し、sessionStorage・クラウド・ログへは一切書かない。
  function snapshotOrderExcludingStatus(order) {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return null;
    try {
      const clone = {};
      Object.keys(order).forEach(key => {
        if (key === 'status') return;
        clone[key] = order[key];
      });
      return stableStringify(clone, []);
    } catch (_) {
      return null;
    }
  }

  // このドキュメントで実際に発行完了したref（issuedWorkOrderRefs）に限り、
  // 発行時点のスナップショットと現在の state.orders の内容が一致するかを
  // 同期的に確認する。一致しない・いずれかのスナップショットを安全に取得
  // できない（循環参照等）・既存スキーマ検証関数が存在しない/失敗する、
  // のいずれかであれば「変化あり」= 信用しない（fail closed）。
  // status単体の変化（pending/accepted）は許可したままにする。
  // 復元マーカー経路（verifyMarkerForRef）とは独立しており、ここでの
  // isValidSessionOrder の要求はそちらの既存の必須検証を変更しない。
  function isIssuedSnapshotUnchanged(workOrderRef, order) {
    const recordedSnapshot = issuedOrderSnapshots.get(workOrderRef);
    if (typeof recordedSnapshot !== 'string') return false;

    const currentSnapshot = snapshotOrderExcludingStatus(order);
    if (typeof currentSnapshot !== 'string') return false;
    if (currentSnapshot !== recordedSnapshot) return false;

    if (typeof isValidSessionOrder !== 'function') return false;
    let valid;
    try {
      valid = isValidSessionOrder(order);
    } catch (_) {
      return false;
    }
    if (!valid) return false;

    return true;
  }

  // マーカー（sessionStorage）により「復元された」refだけを保持する。
  // 所属は常に直近の再検証結果のみを表す表示用キャッシュであり、
  // ローカル転送パッケージ準備の許可根拠には絶対に使わない。
  // issuedWorkOrderRefs（このドキュメントで実際にissuanceCommittedへ到達
  // したref）とは別管理にし、こちらは改ざん・削除・受注編集を検知した
  // 時点で直ちに取り消す（prepareIssuedTransferPackage は毎回ゼロから
  // 再検証する。過去にtrueを返したことは根拠として使わない）。
  const restoredMarkerRefs = new Set();
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

  // ============================================================
  //  発行済みマーカー（sessionStorage・同タブ限定・バージョン付き）
  //
  //  pdf.js は window.location.assign(blobURL) でPDFを開くため、Safari等では
  //  戻る/再読込で新しいJSコンテキストが生成され issuedWorkOrderRefs（メモリの
  //  みの集合）が失われる場合がある。state.orders は orders.js の
  //  dwo_session_orders_v1 から復元されるが、復元された受注が「本当にこのタブ
  //  で発行完了したか」はメモリ上のSetでしか判別できなかった。
  //
  //  このマーカーは opaque な workOrderRef と、発行完了時点の受注スナップショ
  //  ット（JSON.stringify）のSHA-256ダイジェストだけを保持し、患者・医院等の
  //  医療情報、認証情報、PDF、転送パッケージそのものは一切含めない。マーカー
  //  は「偶発的な破損・不整合に対する整合性チェック」であって暗号学的な認証で
  //  はない（sessionStorageはユーザースクリプトから書き換え可能）。マーカーの
  //  検証結果は、ローカルでの prepareTransferPackage 委譲を許可するためだけに
  //  使う。送信・受信・ACKの状態を一切生成・representしない。
  // ============================================================
  const ISSUED_MARKER_STORAGE_KEY = 'dwo_issued_markers_v1';
  const ISSUED_MARKER_SCHEMA_VERSION = 'dwo-issued-markers-v1';
  const DIGEST_HEX_PATTERN = /^[0-9a-f]{64}$/;

  function getIssuedMarkerStorage() {
    try {
      return global.sessionStorage || null;
    } catch (_) {
      return null;
    }
  }

  function bufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  async function sha256Hex(text) {
    const subtle = global.crypto && global.crypto.subtle;
    const Encoder = global.TextEncoder;
    if (!subtle || typeof subtle.digest !== 'function' || typeof Encoder !== 'function') {
      throw transferPackageError('ISSUED_MARKER_CRYPTO_UNAVAILABLE');
    }
    const bytes = new Encoder().encode(text);
    const digestBuffer = await subtle.digest('SHA-256', bytes);
    return bufferToHex(digestBuffer);
  }

  // マーカー全体を読む。schemaVersion不一致・形式不正・重複refは
  // すべて「信用しない」= null を返す（fail closed、部分的な信用はしない）。
  function readIssuedMarkers() {
    const storage = getIssuedMarkerStorage();
    if (!storage) return null;
    let raw;
    try {
      raw = storage.getItem(ISSUED_MARKER_STORAGE_KEY);
    } catch (_) {
      return null;
    }
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (parsed.schemaVersion !== ISSUED_MARKER_SCHEMA_VERSION || !Array.isArray(parsed.entries)) return null;
    const entries = parsed.entries;
    const valid = entries.every(entry =>
      entry && typeof entry === 'object' &&
      typeof entry.workOrderRef === 'string' && WORK_ORDER_REF_PATTERN.test(entry.workOrderRef) &&
      typeof entry.digest === 'string' && DIGEST_HEX_PATTERN.test(entry.digest)
    );
    if (!valid) return null;
    const refs = entries.map(entry => entry.workOrderRef);
    if (new Set(refs).size !== refs.length) return null; // 重複refは破損扱い。
    return entries;
  }

  function writeIssuedMarkers(entries) {
    const storage = getIssuedMarkerStorage();
    if (!storage) throw transferPackageError('ISSUED_MARKER_STORAGE_UNAVAILABLE');
    storage.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify({
      schemaVersion: ISSUED_MARKER_SCHEMA_VERSION,
      entries
    }));
  }

  // issuanceCommitted（添付確定＋下書き削除の成功）より後にだけ呼ぶこと。
  // ここで投げた例外は呼び出し側（issueCurrentOrder）が「発行は維持したまま
  // 警告のみ表示する」ために捕捉する。発行自体のロールバックは行わない。
  async function recordIssuedMarker(order) {
    const digest = await sha256Hex(JSON.stringify(order));
    const existing = readIssuedMarkers() || [];
    const next = existing.filter(entry => entry.workOrderRef !== order.workOrderRef);
    next.push({ workOrderRef: order.workOrderRef, digest });
    writeIssuedMarkers(next);
  }

  // 単一refについて、マーカー・state.orders・厳格なスキーマ検証・ダイジェストの
  // 4点が一致した場合だけ「復元されたrefとして一時的に信用する」。
  //
  // このドキュメントで実際に発行完了（issuanceCommitted）まで到達したref
  // （issuedWorkOrderRefs）は、sessionStorageやWeb Cryptoの有無に関わらず
  // 常に有効（同一JSコンテキストのメモリ上の事実そのものであり、マーカーの
  // 検証対象ではない）。
  //
  // それ以外（マーカーにより復元されたref）については、この関数が過去に
  // trueを返したことを一切信用しない。毎回ゼロからマーカー・該当受注・
  // スキーマ・ダイジェストを再読み込み・再計算し、どこかで不一致（改ざん・
  // 削除・重複・受注内容の変化・検証関数の不在）があれば直ちに
  // restoredMarkerRefs から取り消す（信用の継続はしない）。
  async function verifyMarkerForRef(workOrderRef) {
    if (issuedWorkOrderRefs.has(workOrderRef)) return true;

    const markers = readIssuedMarkers();
    if (!markers) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }
    const entry = markers.find(item => item.workOrderRef === workOrderRef);
    if (!entry) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }

    const matches = Array.isArray(state.orders)
      ? state.orders.filter(order => order && order.workOrderRef === workOrderRef)
      : [];
    if (matches.length !== 1) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }

    const order = matches[0];
    // 復元経路の受注スキーマ検証は必須（省略不可）。検証関数そのものが
    // 存在しない場合も「信用しない」= fail closed とする。このマーカーは
    // 暗号学的な認証やsend/receipt許可ではなく、偶発的な破損・不整合の
    // 検知にすぎない。
    if (typeof isValidSessionOrder !== 'function' || !isValidSessionOrder(order)) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }

    let digest;
    try {
      digest = await sha256Hex(JSON.stringify(order));
    } catch (_) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }
    if (digest !== entry.digest) {
      restoredMarkerRefs.delete(workOrderRef);
      return false;
    }

    restoredMarkerRefs.add(workOrderRef);
    if (!transferStatusByRef.has(workOrderRef)) {
      transferStatusByRef.set(workOrderRef, 'ISSUED_NOT_SENT');
    }
    return true;
  }

  async function verifyAllIssuedMarkers() {
    const markers = readIssuedMarkers();
    if (!markers) return;
    for (const entry of markers) {
      await verifyMarkerForRef(entry.workOrderRef);
    }
  }

  // 再読込・新JSコンテキスト復帰時に一度だけ自動で走る、非ブロッキングの検証。
  // 失敗しても例外を外へ漏らさない（検証できなかったrefは単にUNVERIFIEDへ留まる
  // だけで、リモートへの自動操作は一切行わない）。
  let issuedMarkerVerification = verifyAllIssuedMarkers().catch(() => {});

  // テスト・BFCache復帰（pageshow）等から明示的に再検証したい場合に使う、
  // 小さな非同期の復元専用API。UUIDの再生成や再発行は一切行わない。
  function refreshIssuedTransferState() {
    issuedMarkerVerification = verifyAllIssuedMarkers().catch(() => {});
    return issuedMarkerVerification;
  }

  if (typeof global.addEventListener === 'function') {
    // BFCache復帰時に状態を再確認するだけで、UUIDの再生成や再発行は行わない。
    global.addEventListener('pageshow', function() {
      refreshIssuedTransferState();
    });
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
      // 発行完了の瞬間のスナップショットを固定する。以降この参照に対して
      // prepareIssuedTransferPackage / getIssuedTransferStatus は、常に
      // このスナップショット（statusを除く）と現在のstate.orders内容を
      // 比較し、改変があれば未発行として扱う。スナップショット自体を
      // 取得できなかった場合（循環参照等、通常は起こり得ない想定外の値）
      // でも例外を外へ漏らさず、受注の発行自体は維持したまま（ロール
      // バックしない）、以降の同一docでの引き渡し準備はfail closedとなる
      // （有効な元スナップショットが無いため）。
      const issuedSnapshot = snapshotOrderExcludingStatus(data);
      issuedOrderSnapshots.set(data.workOrderRef, issuedSnapshot);
      transferStatusByRef.set(data.workOrderRef, 'ISSUED_NOT_SENT');

      let markerWarningShown = false;
      if (typeof issuedSnapshot !== 'string') {
        markerWarningShown = true;
        showToast(
          '発行は完了しましたが、改変検知用の記録を作成できませんでした。このタブでは「発行済み」としての引き渡し準備ができない場合があります',
          'error'
        );
      }
      try {
        // 添付確定・下書き削除の成功後にのみ、復元用マーカーを書き込む。
        // ここで失敗しても発行自体は取り消さない（既に成立済みのため）。
        await recordIssuedMarker(data);
      } catch (_) {
        markerWarningShown = true;
        showToast(
          '発行は完了しましたが、復元用の記録を保存できませんでした。このタブを再読込すると、受注一覧の内容は残りますが「発行済み」としての引き渡し準備が復元できない場合があります',
          'error'
        );
      }

      if (typeof renderOrders === 'function') renderOrders();
      // マーカー保存に失敗した警告を、直後の成功トーストで即座に上書き・
      // 隠してしまわないようにする（発行自体は維持したまま、B5/A4 PDFは
      // 通常どおり開く）。
      if (!markerWarningShown) {
        showToast('✅ 指示書を発行しました');
      }
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

    // 直近の自動検証を待つ（「マーカーを再確認する」= 署名や外部確認では
    // なく、このタブのsessionStorageに対する再読込・再計算のみ）。
    try {
      await issuedMarkerVerification;
    } catch (_) { /* fail closed側へ進む */ }

    // このドキュメントで実際に発行完了まで到達したrefだけは、マーカーを
    // 経由せずメモリ上の事実のみで許可する。それ以外（マーカーで復元され
    // たref・未確認のref）は、ローカル転送パッケージを準備する直前に必ず
    // ゼロから再検証する。過去にこの関数やverifyMarkerForRefが真を返した
    // ことは一切根拠として使わない（改ざん・削除・受注編集後の再利用を
    // 防ぐ）。
    let authorized = issuedWorkOrderRefs.has(workOrderRef);
    if (!authorized) {
      try {
        authorized = await verifyMarkerForRef(workOrderRef);
      } catch (_) {
        authorized = false; /* 検証できなければ未発行として扱う */
      }
    }

    if (!authorized) {
      // 復元済みとして表示していたキャッシュがあれば直ちに取り消す。
      // ここでメディア委譲（mediaManager.prepareTransferPackage）は
      // 一切呼ばない。
      restoredMarkerRefs.delete(workOrderRef);
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

    // このドキュメントで実際に発行完了したrefについては、マーカーの有無とは
    // 無関係に、発行完了時点のスナップショット（statusを除く）と現在の
    // state.orders内容が一致することを毎回確認する。発行後に患者・臨床・
    // 材料・歯式・納期・料金等のいずれかが改変されていれば、新たな検証済み
    // 発行なしでの引き渡し準備は許可しない（statusのpending/accepted切替
    // 単独は許可したままにする）。
    if (issuedWorkOrderRefs.has(workOrderRef) && !isIssuedSnapshotUnchanged(workOrderRef, matches[0])) {
      throw transferPackageError('TRANSFER_PACKAGE_NOT_ISSUED');
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
    if (!issuedWorkOrderRefs.has(workOrderRef) && !restoredMarkerRefs.has(workOrderRef)) {
      return 'UNVERIFIED';
    }

    const matches = Array.isArray(state.orders)
      ? state.orders.filter(order => order && order.workOrderRef === workOrderRef)
      : [];
    if (matches.length !== 1) {
      return 'UNVERIFIED';
    }

    // このドキュメントで発行完了したrefについては、同期的に安全確認できる
    // 範囲(=メモリ上のスナップショット比較)で改変を検知できる場合、
    // 改変済みの受注を「発行済み」として誤って示し続けない。
    if (issuedWorkOrderRefs.has(workOrderRef) && !isIssuedSnapshotUnchanged(workOrderRef, matches[0])) {
      return 'UNVERIFIED';
    }

    return transferStatusByRef.get(workOrderRef) || 'ISSUED_NOT_SENT';
  }

  // 初期のdisabled解除はcalendar.jsに任せる。
  // 模型発送日から納期・急ぎ料金の判定が完了する前には発行できない。
  global.DwoFinalIssue = {
    issueCurrentOrder,
    prepareIssuedTransferPackage,
    getIssuedTransferStatus,
    refreshIssuedTransferState
  };
})(globalThis);

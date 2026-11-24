const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const { TextEncoder: NodeTextEncoder } = require('node:util');

const root = path.join(__dirname, '..');
const issueSource = fs.readFileSync(path.join(root, 'app', 'final-issue.js'), 'utf8');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Draft PR #180 ローカル暗号化エンベロープ受け渡しの合成テストの一部
// （5番、round-trip）だけが使う、既存の暗号モジュールそのもの。新しい
// 暗号プリミティブ・独自パケット整形は一切追加しない（既存関数をそのまま
// requireするだけ）。
const RealMediaTransferPackage = require(path.join(root, 'media-transfer-package.js'));
const RealMediaTransferCrypto = require(path.join(root, 'media-transfer-crypto.js'));

// app/final-issue.js の発行済みマーカーが実際に使う、唯一の sessionStorage
// キーとスキーマ版（v2: ダイジェストはstatusを除いたスナップショットに
// 対して計算する。v1はstatus込みで計算していたため、発行後の正当な
// pending -> accepted 切替だけで復元が拒否される不具合があった）。
// マーカーの改ざん・破損・重複・古いv1形式の残存等をホワイトボックスで
// 注入するテストのためだけに、実装側の定数値をここでも保持する。
const ISSUED_MARKER_STORAGE_KEY = 'dwo_issued_markers_v2';
const ISSUED_MARKER_SCHEMA_VERSION = 'dwo-issued-markers-v2';

function visualSnapshot(circular) {
  const snapshot = {
    selectedTeeth: [18],
    drawing: { memoStrokes: [] }
  };
  if (circular) {
    // テスト専用: 発行完了直後のスナップショット取得（循環参照検出による
    // fail closed）の失敗だけを模すため、selectedTeeth/drawing.memoStrokes
    // とは無関係な余剰プロパティへ自己参照を追加する。issueCurrentOrder内の
    // JSON.parse(JSON.stringify(visualSnapshot.selectedTeeth)) /
    // JSON.parse(JSON.stringify(visualSnapshot.drawing.memoStrokes)) の経路は
    // 通さない（＝発行自体の前段処理は正常に完了させる）。
    snapshot.auditCircularRef = snapshot;
  }
  return snapshot;
}

// 実 orders.js の isValidSessionOrder が要求する必須フィールド（id の
// local_\d+ 形式、insuranceType の列挙、deliveryDate/remarks等の文字列、
// orderTypes/devices の配列）だけを再現した、テスト専用の軽量・代表的な
// スキーマ検証関数。claspTypes/barTypes の対応や visualSnapshot の厳密な
// 自己検証（app/visual-snapshot.js が担う別ファイルの責務）は意図的に
// 対象外とする。実在の患者情報・秘密情報は一切含まない架空のフィクスチャ
// のみを検証する。
function lightweightIsValidSessionOrder(order) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) return false;
  if (!/^dwo:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(order.workOrderRef || '')) return false;
  if (!/^local_\d+$/.test(order.id || '')) return false;
  if (!['pending', 'accepted'].includes(order.status)) return false;
  if (!['insurance', 'jishi'].includes(order.insuranceType)) return false;
  if (typeof order.createdAt !== 'string' || !Number.isFinite(Date.parse(order.createdAt))) return false;
  for (const key of ['clinicName', 'doctorName', 'patientName', 'patientAge', 'patientGender', 'issueDate', 'deliveryDate', 'remarks']) {
    if (typeof order[key] !== 'string') return false;
  }
  if (!Array.isArray(order.selectedTeeth)) return false;
  if (!Array.isArray(order.orderTypes) || !order.orderTypes.every(v => typeof v === 'string')) return false;
  if (!Array.isArray(order.devices) || !order.devices.every(v => typeof v === 'string')) return false;
  if (!Array.isArray(order.memoStrokes)) return false;
  return true;
}

// 実ブラウザの sessionStorage に近い、同期的な fake 実装。
// Mapを内部に持つだけで、ネットワークや永続化は一切行わない。
function createFakeSessionStorage(events, label) {
  const data = new Map();
  const tag = label ? label + ':' : '';
  return {
    getItem(key) {
      if (events) events.push(tag + 'storage-get:' + key);
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (events) events.push(tag + 'storage-set:' + key);
      data.set(key, String(value));
    },
    removeItem(key) {
      if (events) events.push(tag + 'storage-remove:' + key);
      data.delete(key);
    },
    // テスト専用: 内部状態を直接観察・改ざんするための非標準の抜け道。
    _raw: data
  };
}

function createThrowingSessionStorage() {
  return {
    getItem() { throw new Error('storage inaccessible'); },
    setItem() { throw new Error('storage inaccessible'); },
    removeItem() { throw new Error('storage inaccessible'); }
  };
}

function microtask() {
  return new Promise(resolve => setImmediate(resolve));
}

// prepareIssuedEncryptedTransferEnvelope の合成テスト専用: 既存の
// ReferenceMediaManager.prepareTransferPackage のfakeが返す、架空・最小限の
// パッケージ形状。実データは含まない。MediaTransferCrypto.encryptPackage
// 自体は（実モジュールを使わない限り）fakeへ差し替えるため、ここでの
// manifest/workOrder/attachmentsは「pkg.manifest.workOrderRefが一致する
// か」をfinal-issue.js側が確認できる最小限の形で十分とする。
function fakeTransferPackageFor(workOrderRef) {
  return {
    manifest: {
      workOrderRef,
      workOrder: { sha256: 'a'.repeat(64) },
      attachments: []
    },
    workOrder: { blob: { arrayBuffer: async () => new ArrayBuffer(0) } },
    attachments: {}
  };
}

// Draft PR #180 (B5 transfer copy) 合成テスト専用: createIssuePdfBlob が
// 返す、既存の Blob 契約（type/size/slice/arrayBuffer）だけを満たす最小限
// のfixture。実際のPDFレンダリング・既存pdf.jsの描画は一切再実装しない。
// %PDF- ヘッダも含める（media-transfer-package.js側の検証とも整合する
// 合成バイト列。実際の患者・医院情報は一切含まない）。
function validB5PdfBlobFixture(size) {
  const total = typeof size === 'number' && size > 5 ? size : 32;
  const bytes = new Uint8Array(total);
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // '%PDF-'
  function toArrayBuffer(view) {
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }
  return {
    type: 'application/pdf',
    size: total,
    slice(start, end) {
      const sliced = bytes.slice(start, end);
      return { arrayBuffer: async () => toArrayBuffer(sliced) };
    },
    arrayBuffer: async () => toArrayBuffer(bytes)
  };
}

// 暗号化の完了タイミングを手動で制御できる、最小限のfake
// MediaTransferCrypto。実際のECDH/HKDF/AES-GCM/ECDSAは一切実装しない
// （既存のmedia-transfer-crypto.jsだけがそれを行う）。
function makeDeferredCrypto(events) {
  let resolveFn = null;
  let rejectFn = null;
  const module_ = {
    async encryptPackage(pkg) {
      events.push('crypto-encrypt:' + (pkg && pkg.manifest && pkg.manifest.workOrderRef));
      return new Promise((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });
    }
  };
  return {
    module: module_,
    resolve(value) { resolveFn(value); },
    reject(error) { rejectFn(error); }
  };
}

// 実装側の computeMarkerDigest（snapshotOrderExcludingStatus + SHA-256）と
// 同じアルゴリズムで、テスト側からもマーカーのダイジェストを独立に計算
// するためのヘルパー。新しい・弱いハッシュ実装は追加しない。node:crypto の
// webcrypto のみを使う。statusフィールドは除外し、入れ子オブジェクトの
// キーは再帰的にソートする（配列順序は維持する）点まで実装と一致させる。
function stableStringifyForTest(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(item => {
      const encoded = stableStringifyForTest(item);
      return encoded === undefined ? 'null' : encoded;
    }).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = [];
  keys.forEach(key => {
    const encoded = stableStringifyForTest(value[key]);
    if (encoded === undefined) return;
    parts.push(JSON.stringify(key) + ':' + encoded);
  });
  return '{' + parts.join(',') + '}';
}

function snapshotExcludingStatusForTest(order) {
  const clone = {};
  Object.keys(order).forEach(key => {
    if (key === 'status') return;
    clone[key] = order[key];
  });
  return stableStringifyForTest(clone);
}

async function digestOrder(order) {
  const bytes = new NodeTextEncoder().encode(snapshotExcludingStatusForTest(order));
  const buffer = await nodeCrypto.webcrypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(buffer).toString('hex');
}

// 「検証がまだ完了していない間はUNVERIFIEDのまま」を観察するための、
// digestの完了タイミングを手動で制御できるcryptoスタブ。
// openGate() されるまでは実際のdigest計算を保留するだけで、
// 計算内容自体は常に本物の node:crypto webcrypto に委譲する。
function createGatedCrypto() {
  const realSubtle = nodeCrypto.webcrypto.subtle;
  let open = false;
  const waiters = [];
  function digest(algorithm, data) {
    if (open) return realSubtle.digest(algorithm, data);
    return new Promise(resolve => {
      waiters.push(() => resolve(realSubtle.digest(algorithm, data)));
    });
  }
  return {
    cryptoObj: { subtle: { digest } },
    openGate() {
      open = true;
      const pending = waiters.splice(0, waiters.length);
      pending.forEach(run => run());
    }
  };
}

function makeHarness(options = {}) {
  const events = [];
  const state = { orders: Array.isArray(options.initialOrders) ? options.initialOrders.slice() : [] };
  let boundHandler = null;
  const pageshowHandlers = [];
  const legacyHandler = () => {};
  const button = {
    disabled: true,
    addEventListener(type, handler) {
      if (type === 'click') boundHandler = handler;
      events.push('bind:' + type);
    },
    removeEventListener(type, handler) {
      if (type === 'click' && handler === legacyHandler) events.push('unbind:legacy');
    }
  };
  const workOrderRef = options.workOrderRef || 'dwo:123e4567-e89b-42d3-a456-426614174000';
  const mediaError = Object.assign(new Error('media failed'), { code: 'MEDIA_STORAGE_COMMIT_FAILED' });
  let syncCalls = 0;
  const draftManager = {
    getCurrentDraftRef() {
      events.push('draft-ref');
      return 'draft:123e4567-e89b-42d3-a456-426614174050';
    },
    removeCurrentFormDraft() {
      events.push('draft-remove');
      return options.draftRemove !== false;
    }
  };
  const mediaManager = {
    async commitCurrentDraft(ref) {
      events.push('media-commit:' + ref);
      if (options.mediaFail) throw mediaError;
      return { committed: options.mediaCount === undefined ? 1 : options.mediaCount, draftRef: draftManager.getCurrentDraftRef() };
    },
    async rollbackCommittedDraft(ref, draftRef) {
      events.push('media-rollback:' + ref + ':' + draftRef);
      if (options.rollbackFail) throw Object.assign(new Error('rollback failed'), { code: 'MEDIA_STORAGE_COMMIT_FAILED' });
      return { rolledBack: options.mediaCount === undefined ? 1 : options.mediaCount };
    }
  };
  let deferredPrepareResolve = null;
  let deferredPrepareReject = null;
  let prepareFailOnceRemaining = options.preparePackageFailOnce ? 1 : 0;
  // Draft PR #180 (B5 transfer copy) 合成テスト専用: mediaManager.
  // prepareTransferPackage へ実際に渡された第2引数（options）を観察する
  // ためだけの非侵襲的な記録。既存の挙動・戻り値・eventsへの記録は
  // 一切変更しない（既存テストに影響しない）。
  const prepareCallArgs = [];
  if (!options.noPreparePackage) {
    mediaManager.prepareTransferPackage = async (order, pkgOptions) => {
      events.push('prepare-package:' + (order && order.workOrderRef));
      prepareCallArgs.push({ order, pkgOptions });
      if (options.preparePackageFail || prepareFailOnceRemaining > 0) {
        prepareFailOnceRemaining = Math.max(0, prepareFailOnceRemaining - 1);
        throw Object.assign(new Error('package failed'), { code: 'MEDIA_STORAGE_RESTORE_FAILED' });
      }
      if (options.deferPrepare) {
        return new Promise((resolve, reject) => {
          deferredPrepareResolve = resolve;
          deferredPrepareReject = reject;
        });
      }
      // options.preparedPackageResult: 暗号化アダプタ合成テスト専用の最小限の
      // 差し替え。既定（未指定）では既存テストと完全に同じ形を返す。
      return typeof options.preparedPackageResult === 'function'
        ? options.preparedPackageResult(order)
        : { workOrderRef: order && order.workOrderRef, kind: 'transfer-package' };
    };
  }
  // sessionStorage: 既定では同期的なfake実装（Map裏付け）を新規に用意する。
  // options.sessionStorage を渡せば、別のvmコンテキスト（＝別のJSリアリゼーシ
  // ョン＝PDF Blob遷移後の再読込を模す）と同じインスタンスを共有できる。
  // options.sessionStorage === null の場合はstorage自体を提供しない
  // （window.sessionStorageが無い/アクセス不能な端末を模す）。
  const sessionStorage = options.sessionStorage === null
    ? undefined
    : (options.sessionStorage || createFakeSessionStorage(events));

  // crypto: 既定ではNodeの実装（node:crypto webcrypto）をそのまま使う。
  // 新しいダイジェスト実装や代替暗号は一切追加しない。
  const cryptoImpl = options.cryptoDisabled ? undefined : (options.crypto || nodeCrypto.webcrypto);
  const TextEncoderCtor = options.textEncoderDisabled ? undefined : NodeTextEncoder;

  // isValidSessionOrder: 既定ではテスト専用の軽量・代表的なスキーマ検証を
  // 注入する（実 orders.js と同じ必須フィールド/形式のみを検証）。
  // options.noSessionOrderValidator === true の場合は、検証関数そのものが
  // 存在しない端末/読込順序を模すためにあえて注入しない。
  // options.sessionOrderValidator を渡せば、検証関数は存在するが常に
  // 拒否する等の代替実装に差し替えられる。
  const sessionOrderValidator = options.noSessionOrderValidator
    ? undefined
    : (options.sessionOrderValidator || lightweightIsValidSessionOrder);

  const context = {
    console,
    Error,
    JSON,
    String,
    Promise,
    Uint8Array,
    state,
    sessionStorage,
    crypto: cryptoImpl,
    TextEncoder: TextEncoderCtor,
    isValidSessionOrder: sessionOrderValidator,
    // MediaTransferCrypto: 既定（未指定）では一切注入しない（「暗号ヘルパー
    // が存在しない端末」を模す）。暗号化アダプタ合成テストだけが
    // options.mediaTransferCrypto 経由で明示的に注入する。新しい暗号
    // プリミティブや独自パケット整形をこのテストファイル側で実装しない。
    MediaTransferCrypto: options.mediaTransferCrypto,
    addEventListener(type, handler) {
      if (type === 'pageshow') pageshowHandlers.push(handler);
      events.push('bind:' + type);
    },
    submitOrder: legacyHandler,
    FormDraftManager: draftManager,
    ReferenceMediaManager: mediaManager,
    document: { getElementById(id) { return id === 'submit-btn' ? button : null; } },
    collectFormData() {
      // 実 orders.js の isValidSessionOrder が要求する必須フィールドを
      // 一通り満たした、架空・代表的な受注フィクスチャ（id は local_\d+、
      // insuranceType は列挙値、deliveryDate/remarks等は文字列、
      // orderTypes/devices は配列）。実在の患者情報は含まない。
      return {
        clinicName: 'SAMPLE CLINIC',
        doctorName: 'SAMPLE DOCTOR',
        patientName: 'SAMPLE PATIENT',
        patientAge: '65',
        patientGender: 'female',
        issueDate: '2026-10-02',
        deliveryDate: '2026-10-09',
        remarks: '',
        insuranceType: 'insurance',
        orderTypes: ['sample-order-type'],
        devices: ['sample-device'],
        selectedTeeth: [],
        status: 'pending',
        createdAt: '2026-10-02T00:00:00.000Z',
        id: 'local_1'
      };
    },
    validate() { return options.validationErrors || []; },
    freezeVisualSnapshot() {
      return options.snapshotFail ? null : visualSnapshot(options.circularVisualSnapshot);
    },
    generateWorkOrderRef() { return workOrderRef; },
    async requestIssuePdfPaperSize() {
      events.push('paper');
      return options.paper === undefined ? 'b5' : options.paper;
    },
    async createIssuePdfBlob() {
      events.push('pdf');
      if (options.pdfFail) throw new Error('pdf failed');
      return { type: 'application/pdf', size: 1000 };
    },
    syncTemporaryOrdersToSession() {
      syncCalls += 1;
      events.push('session:' + syncCalls);
      if (options.sessionFail && syncCalls === 1) return false;
      return true;
    },
    syncOrderLossGuard() { events.push('loss-guard'); },
    renderOrders() { events.push('render'); },
    showToast(message, type) { events.push('toast:' + (type || 'info') + ':' + message); },
    resetForm() { events.push('reset'); },
    openFixedPdfBlob() {
      events.push('open');
      if (options.openFail) throw new Error('open failed');
    }
  };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(issueSource, context, { filename: 'app/final-issue.js' });
  return {
    context,
    events,
    state,
    button,
    workOrderRef,
    mediaManager,
    sessionStorage,
    prepareCallArgs,
    run: () => boundHandler(),
    firePageshow: () => pageshowHandlers.forEach(handler => handler()),
    get dwoFinalIssue() { return context.DwoFinalIssue; },
    resolvePrepare(value) {
      if (deferredPrepareResolve) deferredPrepareResolve(value);
    },
    rejectPrepare(error) {
      if (deferredPrepareReject) deferredPrepareReject(error);
    }
  };
}

test('Stage 5 success freezes PDF before committing order/media and clears draft only at the end', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);
  assert.equal(h.button.disabled, false);
  const index = name => h.events.findIndex(event => event.startsWith(name));
  assert.ok(index('paper') < index('pdf'));
  assert.ok(index('pdf') < index('session:1'));
  assert.ok(index('session:1') < index('media-commit:'));
  assert.ok(index('media-commit:') < index('draft-remove'));
  assert.ok(index('draft-remove') < index('reset'));
  assert.ok(index('reset') < index('open'));
});

test('paper cancel leaves order, media, draft and form untouched', async () => {
  const h = makeHarness({ paper: null });
  await h.run();
  assert.equal(h.state.orders.length, 0);
  assert.ok(!h.events.includes('pdf'));
  assert.ok(!h.events.some(e => e.startsWith('media-commit:')));
  assert.ok(!h.events.includes('draft-remove'));
  assert.ok(!h.events.includes('reset'));
  assert.ok(!h.events.includes('open'));
});

test('PDF failure leaves order, media, draft and form untouched', async () => {
  const h = makeHarness({ pdfFail: true });
  await h.run();
  assert.equal(h.state.orders.length, 0);
  assert.ok(!h.events.some(e => e.startsWith('media-commit:')));
  assert.ok(!h.events.includes('draft-remove'));
  assert.ok(!h.events.includes('reset'));
});

test('session save failure rolls the tentative order back before media commit', async () => {
  const h = makeHarness({ sessionFail: true });
  await h.run();
  assert.equal(h.state.orders.length, 0);
  assert.ok(h.events.includes('session:1'));
  assert.ok(h.events.includes('session:2'));
  assert.ok(!h.events.some(e => e.startsWith('media-commit:')));
  assert.ok(!h.events.includes('draft-remove'));
  assert.ok(!h.events.includes('reset'));
});

test('media commit failure rolls the tentative order back and preserves draft/form', async () => {
  const h = makeHarness({ mediaFail: true });
  await h.run();
  assert.equal(h.state.orders.length, 0);
  assert.ok(h.events.some(e => e.startsWith('media-commit:')));
  assert.ok(!h.events.includes('draft-remove'));
  assert.ok(!h.events.includes('reset'));
});

test('draft deletion failure compensates media then removes the tentative order', async () => {
  const h = makeHarness({ draftRemove: false, mediaCount: 1 });
  await h.run();
  assert.equal(h.state.orders.length, 0);
  assert.ok(h.events.some(e => e.startsWith('media-rollback:')));
  assert.ok(!h.events.includes('reset'));
  assert.ok(!h.events.includes('open'));
});

test('if media rollback itself fails, order is retained to avoid orphaning committed attachments', async () => {
  const h = makeHarness({ draftRemove: false, mediaCount: 1, rollbackFail: true });
  await h.run();
  assert.equal(h.state.orders.length, 1);
  assert.ok(h.events.some(e => e.startsWith('media-rollback:')));
  assert.ok(h.events.includes('open'));
  assert.ok(!h.events.includes('reset'));
});

test('post-commit PDF opening failure never rolls back an already issued order', async () => {
  const h = makeHarness({ openFail: true });
  await h.run();
  assert.equal(h.state.orders.length, 1);
  assert.ok(h.events.includes('draft-remove'));
  assert.ok(h.events.includes('reset'));
  assert.ok(h.events.some(e => e.includes('指示書は発行済み')));
});

test('prepareIssuedTransferPackage delegates once to the existing media helper for a completed issuance', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);
  assert.equal(h.state.orders[0].workOrderRef, h.workOrderRef);

  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'prepare-package:' + h.workOrderRef);
});

test('prepareIssuedTransferPackage fails closed for an unverified or never-issued ref without calling the media helper', async () => {
  const rolledBack = makeHarness({ mediaFail: true });
  await rolledBack.run();
  assert.equal(rolledBack.state.orders.length, 0);
  await assert.rejects(
    () => rolledBack.dwoFinalIssue.prepareIssuedTransferPackage(rolledBack.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.ok(!rolledBack.events.some(e => e.startsWith('prepare-package:')));

  const succeeded = makeHarness();
  await succeeded.run();

  await assert.rejects(
    () => succeeded.dwoFinalIssue.prepareIssuedTransferPackage('dwo:00000000-0000-4000-8000-000000000000'),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  await assert.rejects(
    () => succeeded.dwoFinalIssue.prepareIssuedTransferPackage('not-a-valid-ref'),
    error => error && error.code === 'TRANSFER_PACKAGE_INVALID_REF'
  );
  await assert.rejects(
    () => succeeded.dwoFinalIssue.prepareIssuedTransferPackage(null),
    error => error && error.code === 'TRANSFER_PACKAGE_INVALID_REF'
  );
  assert.ok(!succeeded.events.some(e => e.startsWith('prepare-package:')));
});

test('prepareIssuedTransferPackage fails closed when the media helper is unconfigured or the ref resolves to more than one order', async () => {
  const unconfigured = makeHarness({ noPreparePackage: true });
  await unconfigured.run();
  await assert.rejects(
    () => unconfigured.dwoFinalIssue.prepareIssuedTransferPackage(unconfigured.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_MEDIA_UNAVAILABLE'
  );

  const duplicated = makeHarness();
  await duplicated.run();
  duplicated.state.orders.push(Object.assign({}, duplicated.state.orders[0]));
  await assert.rejects(
    () => duplicated.dwoFinalIssue.prepareIssuedTransferPackage(duplicated.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_DUPLICATE_ORDER'
  );
  assert.ok(!duplicated.events.some(e => e.startsWith('prepare-package:')));
});

test('issued transfer status is UNVERIFIED for invalid, never-issued, removed, and duplicated refs', async () => {
  const h = makeHarness();
  await h.run();

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus('not-a-valid-ref'), 'UNVERIFIED');
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(null), 'UNVERIFIED');
  assert.equal(
    h.dwoFinalIssue.getIssuedTransferStatus('dwo:00000000-0000-4000-8000-000000000000'),
    'UNVERIFIED'
  );

  const rolledBack = makeHarness({ mediaFail: true });
  await rolledBack.run();
  assert.equal(rolledBack.dwoFinalIssue.getIssuedTransferStatus(rolledBack.workOrderRef), 'UNVERIFIED');

  h.state.orders.length = 0;
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');

  const duplicated = makeHarness();
  await duplicated.run();
  duplicated.state.orders.push(Object.assign({}, duplicated.state.orders[0]));
  assert.equal(duplicated.dwoFinalIssue.getIssuedTransferStatus(duplicated.workOrderRef), 'UNVERIFIED');
});

test('issued transfer status reports ISSUED_NOT_SENT immediately after a committed issuance', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
});

test('issued transfer status moves to PREPARING_LOCAL_PACKAGE during an explicit local prepare, then PACKAGE_PREPARED_NOT_SENT on success', async () => {
  const h = makeHarness({ deferPrepare: true });
  await h.run();

  const pending = h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  await microtask();
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'PREPARING_LOCAL_PACKAGE');

  h.resolvePrepare({ workOrderRef: h.workOrderRef, kind: 'transfer-package' });
  const result = await pending;
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'PACKAGE_PREPARED_NOT_SENT');
});

test('issued transfer status reports PREPARATION_FAILED_NOT_SENT after a failed local prepare, and allows a new explicit retry', async () => {
  const h = makeHarness({ preparePackageFailOnce: true });
  await h.run();

  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'MEDIA_STORAGE_RESTORE_FAILED'
  );
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'PREPARATION_FAILED_NOT_SENT');

  // 直前の失敗後は、明示的な新しいリトライを拒否してはならない。
  const retry = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(retry, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'PACKAGE_PREPARED_NOT_SENT');
});

test('issued transfer status rejects overlapping prepare calls for the same ref with TRANSFER_PREPARE_IN_PROGRESS without a second delegate call', async () => {
  const h = makeHarness({ deferPrepare: true });
  await h.run();

  const first = h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  await microtask();
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'PREPARING_LOCAL_PACKAGE');

  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PREPARE_IN_PROGRESS'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);

  h.resolvePrepare({ workOrderRef: h.workOrderRef, kind: 'transfer-package' });
  await first;
});

test('issued transfer status never surfaces sent/received/ACK-style values and the original media helper error propagates unchanged', async () => {
  const h = makeHarness({ preparePackageFail: true });
  await h.run();

  const banned = ['sent', 'ready on remote', 'received', 'ACK'];
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'MEDIA_STORAGE_RESTORE_FAILED' && error.message === 'package failed'
  );
  const status = h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef);
  assert.ok(!banned.includes(status));
  assert.equal(status, 'PREPARATION_FAILED_NOT_SENT');
});

// ============================================================
//  発行済みマーカー（sessionStorageのみ・新しいJSコンテキストへの復元）
// ============================================================

test('issued transfer session marker restores a verified local package delegate after a simulated Blob PDF navigation into a new JS context', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  assert.equal(first.state.orders.length, 1);

  // pdf.js は window.location.assign(blobURL) でPDFを開く。Safari等では
  // 戻る/再読込で新しいJSコンテキストが生成されうるため、別のvmコンテキスト
  // （＝別のharness）でsessionStorageだけを共有して再現する。
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  const second = makeHarness({
    sessionStorage: shared,
    initialOrders: [restoredOrder],
    workOrderRef: first.workOrderRef
  });

  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'ISSUED_NOT_SENT');

  const result = await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);
  assert.deepEqual(result, { workOrderRef: second.workOrderRef, kind: 'transfer-package' });

  const calls = second.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'PACKAGE_PREPARED_NOT_SENT');

  const banned = ['sent', 'ready on remote', 'received', 'ACK'];
  assert.ok(!banned.includes(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef)));
});

test('issued transfer status stays UNVERIFIED while marker verification is still pending and only reports ISSUED_NOT_SENT once it resolves', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const gate = createGatedCrypto();
  const second = makeHarness({
    sessionStorage: shared,
    initialOrders: [restoredOrder],
    workOrderRef: first.workOrderRef,
    crypto: gate.cryptoObj
  });

  // digest計算がまだ完了していない間は安全側のUNVERIFIEDのまま。
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');

  gate.openGate();
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'ISSUED_NOT_SENT');
});

test('issued transfer session denies a marker that was recorded earlier than any real media/draft commit for that ref', async () => {
  const shared = createFakeSessionStorage();
  const prematureRef = 'dwo:00000000-0000-4000-8000-000000000099';
  const prematureOrder = { workOrderRef: prematureRef, note: 'never actually committed' };
  const digest = await digestOrder(prematureOrder);
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify({
    schemaVersion: ISSUED_MARKER_SCHEMA_VERSION,
    entries: [{ workOrderRef: prematureRef, digest }]
  }));

  // state.orders には対応する受注が存在しない。つまりマーカーだけが先に
  // 書かれ、添付確定・下書き削除がまだ終わっていない状況を表す。
  const h = makeHarness({ sessionStorage: shared });
  await h.dwoFinalIssue.refreshIssuedTransferState();

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(prematureRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(prematureRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.ok(!h.events.some(e => e.startsWith('prepare-package:')));
});

test('issued transfer session never treats a restored-but-unmarked order as issued (saved tentative order stays UNVERIFIED)', async () => {
  const shared = createFakeSessionStorage();
  const tentativeOrder = {
    workOrderRef: 'dwo:11111111-1111-4111-8111-111111111111',
    status: 'pending'
  };
  const h = makeHarness({ sessionStorage: shared, initialOrders: [tentativeOrder] });
  await h.dwoFinalIssue.refreshIssuedTransferState();

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(tentativeOrder.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(tentativeOrder.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session rejects a corrupted (non-JSON) marker without throwing out of restoration', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  // 実発行後、何らかの理由でsessionStorageの値が破損した状況を模す。
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, '{ not valid json');

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session rejects a marker with the wrong schema version', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  const digest = await digestOrder(restoredOrder);
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify({
    schemaVersion: 'dwo-issued-markers-v0-wrong',
    entries: [{ workOrderRef: first.workOrderRef, digest }]
  }));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
});

test('issued transfer session rejects a marker containing duplicate entries for the same ref', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  const digest = await digestOrder(restoredOrder);
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify({
    schemaVersion: ISSUED_MARKER_SCHEMA_VERSION,
    entries: [
      { workOrderRef: first.workOrderRef, digest },
      { workOrderRef: first.workOrderRef, digest }
    ]
  }));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session rejects a marker whose digest does not match the restored order snapshot (tamper/mismatch)', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  const realDigest = await digestOrder(restoredOrder);
  const tamperedDigest = (realDigest[0] === '0' ? '1' : '0') + realDigest.slice(1);
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify({
    schemaVersion: ISSUED_MARKER_SCHEMA_VERSION,
    entries: [{ workOrderRef: first.workOrderRef, digest: tamperedDigest }]
  }));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
});

test('issued transfer session rejects restoration when the order content was mutated after the marker was recorded', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const mutatedOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  mutatedOrder.patientName = 'TAMPERED PATIENT';

  const second = makeHarness({ sessionStorage: shared, initialOrders: [mutatedOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session fails closed when sessionStorage access throws during restoration', async () => {
  const first = makeHarness();
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  const throwingStorage = createThrowingSessionStorage();

  const second = makeHarness({ sessionStorage: throwingStorage, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session keeps a real issuance and warns (without rollback) when the marker write itself fails due to storage, and still allows same-document local preparation', async () => {
  const throwingStorage = createThrowingSessionStorage();
  const h = makeHarness({ sessionStorage: throwingStorage });
  await h.run();

  assert.equal(h.state.orders.length, 1);
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
  assert.ok(h.events.some(e => e.includes('復元用の記録を保存できません')));

  // 同一ドキュメント内であれば、メモリ上の発行実績だけでこれまで通り準備できる。
  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });
});

test('issued transfer session keeps a real issuance and warns (without rollback) when Web Crypto is unavailable for the marker digest', async () => {
  const h = makeHarness({ cryptoDisabled: true });
  await h.run();

  assert.equal(h.state.orders.length, 1);
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
  assert.ok(h.events.some(e => e.includes('復元用の記録を保存できません')));

  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });
});

test('issued transfer session does not regenerate a work order ref or double-issue on a BFCache pageshow event', async () => {
  const shared = createFakeSessionStorage();
  const h = makeHarness({ sessionStorage: shared });
  await h.run();
  assert.equal(h.state.orders.length, 1);

  const refsBefore = h.state.orders.map(o => o.workOrderRef).join(',');
  h.firePageshow();
  await microtask();

  assert.equal(h.state.orders.length, 1);
  assert.equal(h.state.orders.map(o => o.workOrderRef).join(','), refsBefore);
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
});

// ============================================================
//  Audit remediation regression: 復元後のマーカー再検証・スキーマ検証必須化
// ============================================================

test('issued transfer session revokes a marker-restored ref and refuses a later local package prepare after the marker digest is tampered with post-restore', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'ISSUED_NOT_SENT');

  // 一度は正当に復元・準備が成功することを先に確認する（旧コードの
  // issuedWorkOrderRefs.has(...)早期returnが「一度成立した信用」を
  // 恒久化してしまうバグを再現するための前提）。
  const firstResult = await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);
  assert.deepEqual(firstResult, { workOrderRef: second.workOrderRef, kind: 'transfer-package' });

  // 復元成功の直後に、同タブのsessionStorageマーカーだけを改ざんする。
  const raw = JSON.parse(shared._raw.get(ISSUED_MARKER_STORAGE_KEY));
  raw.entries = raw.entries.map(entry => Object.assign({}, entry, {
    digest: (entry.digest[0] === '0' ? '1' : '0') + entry.digest.slice(1)
  }));
  shared.setItem(ISSUED_MARKER_STORAGE_KEY, JSON.stringify(raw));

  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');

  const calls = second.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1, 'the delegate must not be called again once the marker is revoked');
});

test('issued transfer session revokes a marker-restored ref after the marker entry is removed post-restore', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);

  // マーカー自体を削除する（破損・クリア等を模す）。
  shared.removeItem(ISSUED_MARKER_STORAGE_KEY);

  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');

  const calls = second.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1, 'the delegate must not be called again once the marker is removed');
});

test('issued transfer session revokes a marker-restored ref after the restored order itself is mutated in state.orders post-restore', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);

  // 復元が成立した後に、同一タブ内で受注の内容が編集された状況を模す。
  second.state.orders[0].remarks = 'EDITED AFTER RESTORE';

  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');

  const calls = second.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1, 'the delegate must not be called again once the restored order content changed');
});

test('issued transfer session fails closed on restore when isValidSessionOrder is absent from the document, even though the marker digest matches', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({
    sessionStorage: shared,
    initialOrders: [restoredOrder],
    workOrderRef: first.workOrderRef,
    noSessionOrderValidator: true
  });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.ok(!second.events.some(e => e.startsWith('prepare-package:')));
});

test('issued transfer session fails closed on restore when isValidSessionOrder exists but rejects the restored order', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({
    sessionStorage: shared,
    initialOrders: [restoredOrder],
    workOrderRef: first.workOrderRef,
    sessionOrderValidator: () => false
  });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  assert.ok(!second.events.some(e => e.startsWith('prepare-package:')));
});

test('issued transfer session reinstantiates a verified local package delegate when isValidSessionOrder exists and accepts the representative restored order fixture', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  const second = makeHarness({
    sessionStorage: shared,
    initialOrders: [restoredOrder],
    workOrderRef: first.workOrderRef,
    sessionOrderValidator: lightweightIsValidSessionOrder
  });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'ISSUED_NOT_SENT');

  const result = await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);
  assert.deepEqual(result, { workOrderRef: second.workOrderRef, kind: 'transfer-package' });
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'PACKAGE_PREPARED_NOT_SENT');
});

test('issued transfer session leaves the marker-storage-failure warning toast visible (not overwritten by the success toast) while still opening the B5 PDF without undoing the real commit', async () => {
  const throwingStorage = createThrowingSessionStorage();
  const h = makeHarness({ sessionStorage: throwingStorage });
  await h.run();

  assert.equal(h.state.orders.length, 1, 'the real commit must not be undone');
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
  assert.ok(h.events.includes('open'), 'the B5/A4 PDF must still open');

  const warningIndex = h.events.findIndex(e => e.includes('復元用の記録を保存できません'));
  assert.ok(warningIndex >= 0, 'the marker-storage warning toast must be shown');
  assert.ok(
    !h.events.some(e => e.includes('✅ 指示書を発行しました')),
    'the success toast must not overwrite/hide the marker-storage warning'
  );
});

// ============================================================
//  Audit remediation regression: 発行後のstate.orders改変を
//  prepareIssuedTransferPackage / getIssuedTransferStatus が
//  同一ドキュメント内の発行済みrefに対しても検知すること
// ============================================================

test('prepareIssuedTransferPackage refuses a same-document issued ref once patientName/remarks/teeth are mutated after issuance, without a new media delegate call', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);

  // 発行完了直後は、改変前と同じ内容であれば通常どおり準備できる。
  const first = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(first, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });

  // 発行完了（issuanceCommitted）後に、同一ドキュメント内で患者名・remarks・
  // 歯式が改変された状況を模す。
  h.state.orders[0].patientName = 'TAMPERED AFTER ISSUE';
  h.state.orders[0].remarks = 'EDITED AFTER ISSUE';
  h.state.orders[0].selectedTeeth = [11, 12, 13];

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1, 'no new media delegate call must happen once the issued snapshot no longer matches');
});

test('prepareIssuedTransferPackage still allows a same-document, unchanged issuance to prepare locally even when marker storage throws', async () => {
  const throwingStorage = createThrowingSessionStorage();
  const h = makeHarness({ sessionStorage: throwingStorage });
  await h.run();

  assert.equal(h.state.orders.length, 1);
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');

  // 内容は一切変更していないので、マーカー書き込みが失敗していても
  // このドキュメント内の発行実績だけでローカル準備が許可されたままになる。
  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);
});

test('a status-only change (pending -> accepted) on a same-document issued ref never blocks prepareIssuedTransferPackage', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);
  assert.equal(h.state.orders[0].status, 'pending');

  // statusは発行後にorders.js側で正当に切り替わる運用フィールドであり、
  // 比較対象から除外されているため単独の変化は許可され続ける。
  h.state.orders[0].status = 'accepted';

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);
});

// ============================================================
//  Audit remediation (round 2): 決定的な再帰スナップショット・
//  循環参照へのfail closed・isValidSessionOrder必須化のための
//  追加合成テスト
// ============================================================

test('a circular/non-serializable value introduced into state.orders after issuance makes status UNVERIFIED and refuses local prepare without a delegate call or an uncaught error', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);

  // 発行完了後、臨床スキーマが検証しない余剰フィールドへ循環参照を注入する
  // （改ざんの極端な例。JSON.stringifyが失敗する入力を想定する）。
  const circular = {};
  circular.self = circular;
  h.state.orders[0].auditDebugCircularRef = circular;

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 0, 'no delegate call must happen once the current order cannot be safely snapshotted');
});

test('same-document issued ref fails closed on status/prepare when isValidSessionOrder is absent from the document, without a delegate call', async () => {
  const h = makeHarness({ noSessionOrderValidator: true });
  await h.run();
  assert.equal(h.state.orders.length, 1);

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 0);
});

test('same-document issued ref fails closed on status/prepare when isValidSessionOrder throws, without a delegate call', async () => {
  const throwingValidator = () => { throw new Error('schema check exploded'); };
  const h = makeHarness({ sessionOrderValidator: throwingValidator });
  await h.run();
  assert.equal(h.state.orders.length, 1);

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 0);
});

test('reordering nested visualSnapshot object keys without changing any value does not block prepareIssuedTransferPackage for a same-document issued ref', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);

  const order = h.state.orders[0];
  // 値は一切変えず、入れ子オブジェクト（visualSnapshot）のキー挿入順序だけを
  // 変える（selectedTeeth/drawing の内容そのものは不変）。
  const reordered = {};
  Object.keys(order.visualSnapshot).reverse().forEach(key => {
    reordered[key] = order.visualSnapshot[key];
  });
  order.visualSnapshot = reordered;

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'ISSUED_NOT_SENT');
  const result = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  assert.deepEqual(result, { workOrderRef: h.workOrderRef, kind: 'transfer-package' });

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 1);
});

test('changing a nested clinical value (visualSnapshot.drawing.memoStrokes) after issuance refuses local prepare for a same-document issued ref', async () => {
  const h = makeHarness();
  await h.run();
  assert.equal(h.state.orders.length, 1);

  h.state.orders[0].visualSnapshot.drawing.memoStrokes = [{ points: [[1, 1], [2, 2]] }];

  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );

  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 0);
});

test('a circular visualSnapshot reference that defeats snapshot capture right after issuance still preserves the order and opens the PDF with a warning (not overwritten by the success toast), then fails closed on a later local prepare', async () => {
  const h = makeHarness({ circularVisualSnapshot: true });
  await h.run();

  assert.equal(h.state.orders.length, 1, 'the real commit must not be undone');
  assert.ok(h.events.includes('open'), 'the B5/A4 PDF must still open');
  assert.ok(
    h.events.some(e => e.includes('改変検知用の記録を作成できません')),
    'the snapshot-capture-failure warning toast must be shown'
  );
  assert.ok(
    !h.events.some(e => e.includes('✅ 指示書を発行しました')),
    'the success toast must not overwrite/hide the warning'
  );

  // 有効な元スナップショットが無いため、以降の同一ドキュメント内ローカル
  // 準備はfail closedする。
  assert.equal(h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
  const calls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(calls.length, 0);
});

// ============================================================
//  v2マーカー修正: pending -> accepted 切替後の復元、v1残存マーカーの
//  fail closed（無移行）
// ============================================================

test('issued transfer session v2 marker digest excludes status: a pending -> accepted toggle before a simulated reload still allows restoration and local prepare', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  assert.equal(first.state.orders[0].status, 'pending');

  // 発行直後、PDFの戻る/再読込（新しいJSコンテキスト）より前に、同タブ内で
  // orders.js側の運用上正当な pending -> accepted への切替が起きた状況を
  // 模す。
  first.state.orders[0].status = 'accepted';
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
  assert.equal(restoredOrder.status, 'accepted');

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'ISSUED_NOT_SENT');

  const result = await second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef);
  assert.deepEqual(result, { workOrderRef: second.workOrderRef, kind: 'transfer-package' });
});

test('issued transfer session: a marker recorded only under the old v1 storage key/schema is never read by the new v2 restore path (no silent migration, fails closed)', async () => {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));

  // first.run() はv2キーへ正当なマーカーを書き込む。古いタブ/古いコードが
  // 残した残存データのみが存在する状態を模すため、v2マーカーを削除してから
  // v1マーカーだけを書き込む。v2キーが実際に存在しないことを確認する。
  shared.removeItem(ISSUED_MARKER_STORAGE_KEY);
  assert.equal(shared._raw.has(ISSUED_MARKER_STORAGE_KEY), false);

  // production は既にv2キー/スキーマだけを使う。ここでは古いv1形式だけを
  // sessionStorageへ直接書き込む（古いタブ/古いコードが残した残存データを
  // 模す）。v2キーには何も書かない。
  const legacyDigest = await digestOrder(restoredOrder);
  shared.setItem('dwo_issued_markers_v1', JSON.stringify({
    schemaVersion: 'dwo-issued-markers-v1',
    entries: [{ workOrderRef: first.workOrderRef, digest: legacyDigest }]
  }));

  const second = makeHarness({ sessionStorage: shared, initialOrders: [restoredOrder], workOrderRef: first.workOrderRef });
  await second.dwoFinalIssue.refreshIssuedTransferState();
  assert.equal(second.dwoFinalIssue.getIssuedTransferStatus(second.workOrderRef), 'UNVERIFIED');
  await assert.rejects(
    () => second.dwoFinalIssue.prepareIssuedTransferPackage(second.workOrderRef),
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('issued transfer session marker now uses the v2 storage key and schema version, and never writes under the old v1 key', async () => {
  const shared = createFakeSessionStorage();
  const h = makeHarness({ sessionStorage: shared });
  await h.run();
  assert.equal(shared._raw.has('dwo_issued_markers_v1'), false);
  const raw = JSON.parse(shared._raw.get('dwo_issued_markers_v2'));
  assert.equal(raw.schemaVersion, 'dwo-issued-markers-v2');
  assert.equal(raw.entries[0].workOrderRef, h.workOrderRef);
});

// ============================================================
//  Draft PR #180: prepareIssuedEncryptedTransferEnvelope
//  （ローカル暗号化エンベロープ準備・送信は一切行わない）
// ============================================================

test('prepareIssuedEncryptedTransferEnvelope invokes the existing crypto engine exactly once with the exact verified package and opaque identities for a real issued same-tab ref, keeps status NOT_SENT, and makes no remote call', async () => {
  const cryptoEvents = [];
  const fake = {
    async encryptPackage(pkg, senderIdentity, recipientPublicInfo, cryptoOptions) {
      cryptoEvents.push('crypto-encrypt:' + (pkg && pkg.manifest && pkg.manifest.workOrderRef));
      return {
        descriptor: { workOrderRef: pkg.manifest.workOrderRef },
        __sender: senderIdentity,
        __recipient: recipientPublicInfo,
        __opts: cryptoOptions
      };
    }
  };
  const h = makeHarness({
    mediaTransferCrypto: fake,
    preparedPackageResult: order => fakeTransferPackageFor(order.workOrderRef)
  });
  await h.run();
  assert.equal(h.state.orders.length, 1);

  const senderIdentity = { opaque: 'sender-only-in-memory' };
  const recipientPublicInfo = { opaque: 'recipient-only-in-memory' };
  const cryptoOptions = { note: 'scoped-crypto-options-only' };

  const envelope = await h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(
    h.workOrderRef, senderIdentity, recipientPublicInfo, { cryptoOptions }
  );

  assert.equal(envelope.descriptor.workOrderRef, h.workOrderRef);
  assert.equal(envelope.__sender, senderIdentity);
  assert.equal(envelope.__recipient, recipientPublicInfo);
  assert.equal(envelope.__opts, cryptoOptions);

  assert.equal(cryptoEvents.length, 1);
  assert.equal(cryptoEvents[0], 'crypto-encrypt:' + h.workOrderRef);

  const prepareCalls = h.events.filter(e => e.startsWith('prepare-package:'));
  assert.equal(prepareCalls.length, 1);

  const banned = ['sent', 'SENT', 'ACK', 'received', 'ready on remote'];
  const status = h.dwoFinalIssue.getIssuedTransferStatus(h.workOrderRef);
  assert.ok(!banned.includes(status));
  assert.equal(status, 'PACKAGE_PREPARED_NOT_SENT');
});

test('prepareIssuedEncryptedTransferEnvelope refuses before any encryption for a never-issued ref, a malformed ref, a duplicated ref, and a damaged restored marker', async () => {
  function countEncrypt(events) { return events.filter(e => e.startsWith('crypto-encrypt:')).length; }
  function makeFake(events) {
    return { async encryptPackage(pkg) { events.push('crypto-encrypt:' + pkg.manifest.workOrderRef); return {}; } };
  }

  // 一度も発行完了に到達しなかった（添付確定失敗でロールバックされた）ref。
  {
    const events = [];
    const h = makeHarness({ mediaFail: true, mediaTransferCrypto: makeFake(events) });
    await h.run();
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
    );
    assert.equal(countEncrypt(events), 0);
  }

  // 形式が不正なref。
  {
    const events = [];
    const h = makeHarness({ mediaTransferCrypto: makeFake(events) });
    await h.run();
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope('not-a-valid-ref', {}, {}),
      error => error && error.code === 'TRANSFER_PACKAGE_INVALID_REF'
    );
    assert.equal(countEncrypt(events), 0);
  }

  // 同一refがstate.orders上で重複している。
  {
    const events = [];
    const h = makeHarness({ mediaTransferCrypto: makeFake(events) });
    await h.run();
    h.state.orders.push(Object.assign({}, h.state.orders[0]));
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_PACKAGE_DUPLICATE_ORDER'
    );
    assert.equal(countEncrypt(events), 0);
  }

  // 復元用マーカーが破損している（新JSコンテキストでの復元セッション）。
  {
    const events = [];
    const shared = createFakeSessionStorage();
    const first = makeHarness({ sessionStorage: shared });
    await first.run();
    const restoredOrder = JSON.parse(JSON.stringify(first.state.orders[0]));
    shared.setItem(ISSUED_MARKER_STORAGE_KEY, '{ not valid json');

    const second = makeHarness({
      sessionStorage: shared,
      initialOrders: [restoredOrder],
      workOrderRef: first.workOrderRef,
      mediaTransferCrypto: makeFake(events)
    });
    await second.dwoFinalIssue.refreshIssuedTransferState();
    await assert.rejects(
      () => second.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(second.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
    );
    assert.equal(countEncrypt(events), 0);
  }
});

test('prepareIssuedEncryptedTransferEnvelope refuses before any encryption when the existing crypto helper module is missing or Web Crypto itself is unavailable/broken, without calling the package builder', async () => {
  // 暗号モジュール（MediaTransferCrypto）そのものが存在しない。
  {
    const h = makeHarness();
    await h.run();
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_ENVELOPE_CRYPTO_MODULE_UNAVAILABLE'
    );
    assert.ok(!h.events.some(e => e.startsWith('prepare-package:')));
  }

  // Web Crypto自体が存在しない。
  {
    const h = makeHarness({
      cryptoDisabled: true,
      mediaTransferCrypto: { async encryptPackage() { throw new Error('must not be called'); } }
    });
    await h.run();
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_ENVELOPE_CRYPTO_UNAVAILABLE'
    );
    assert.ok(!h.events.some(e => e.startsWith('prepare-package:')));
  }

  // Web Cryptoが壊れている（getRandomValuesが無い）。
  {
    const brokenCrypto = { subtle: { digest: async () => new ArrayBuffer(32), importKey: async () => ({}) } };
    const h = makeHarness({
      crypto: brokenCrypto,
      mediaTransferCrypto: { async encryptPackage() { throw new Error('must not be called'); } }
    });
    await h.run();
    await assert.rejects(
      () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
      error => error && error.code === 'TRANSFER_ENVELOPE_CRYPTO_UNAVAILABLE'
    );
    assert.ok(!h.events.some(e => e.startsWith('prepare-package:')));
  }
});

test('prepareIssuedEncryptedTransferEnvelope refuses before any encryption when the underlying local package build itself fails, and rejects missing sender/recipient identities without calling the package builder', async () => {
  const events = [];
  const fake = { async encryptPackage(pkg) { events.push('crypto-encrypt:' + pkg.manifest.workOrderRef); return {}; } };
  const h = makeHarness({ preparePackageFail: true, mediaTransferCrypto: fake });
  await h.run();
  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
    error => error && error.code === 'MEDIA_STORAGE_RESTORE_FAILED'
  );
  assert.equal(events.filter(e => e.startsWith('crypto-encrypt:')).length, 0);

  const h2 = makeHarness({ mediaTransferCrypto: fake });
  await h2.run();
  await assert.rejects(
    () => h2.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h2.workOrderRef, null, {}),
    error => error && error.code === 'TRANSFER_ENVELOPE_INVALID_SENDER_IDENTITY'
  );
  await assert.rejects(
    () => h2.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h2.workOrderRef, {}, null),
    error => error && error.code === 'TRANSFER_ENVELOPE_INVALID_RECIPIENT_INFO'
  );
  assert.ok(!h2.events.some(e => e.startsWith('prepare-package:')));
});

test('prepareIssuedEncryptedTransferEnvelope fails closed with no envelope returned when the order is mutated during the awaited encryption step itself', async () => {
  const cryptoEvents = [];
  const deferred = makeDeferredCrypto(cryptoEvents);
  const h = makeHarness({
    mediaTransferCrypto: deferred.module,
    preparedPackageResult: order => fakeTransferPackageFor(order.workOrderRef)
  });
  await h.run();

  const pending = h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {});
  await microtask();
  assert.equal(cryptoEvents.length, 1);

  // 暗号化がまだawait中の間に、同一ドキュメント内で臨床フィールドを改変する。
  h.state.orders[0].patientName = 'TAMPERED DURING ENCRYPTION';

  deferred.resolve({ descriptor: { workOrderRef: h.workOrderRef } });

  await assert.rejects(
    () => pending,
    error => error && error.code === 'TRANSFER_PACKAGE_NOT_ISSUED'
  );
});

test('prepareIssuedEncryptedTransferEnvelope rejects an overlapping explicit call for the same ref with an in-memory guard, without invoking the crypto engine a second time', async () => {
  const cryptoEvents = [];
  const deferred = makeDeferredCrypto(cryptoEvents);
  const h = makeHarness({
    mediaTransferCrypto: deferred.module,
    preparedPackageResult: order => fakeTransferPackageFor(order.workOrderRef)
  });
  await h.run();

  const first = h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {});
  await microtask();

  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
    error => error && error.code === 'TRANSFER_ENVELOPE_PREPARE_IN_PROGRESS'
  );
  assert.equal(cryptoEvents.length, 1);

  deferred.resolve({ descriptor: { workOrderRef: h.workOrderRef } });
  const envelope = await first;
  assert.equal(envelope.descriptor.workOrderRef, h.workOrderRef);
});

test('prepareIssuedEncryptedTransferEnvelope allows a fresh explicit retry after a crypto engine failure, without resurrecting the failed attempt', async () => {
  const cryptoEvents = [];
  let failNext = true;
  const fake = {
    async encryptPackage(pkg) {
      cryptoEvents.push('crypto-encrypt:' + pkg.manifest.workOrderRef);
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error('simulated crypto engine failure'), { code: 'CRYPTO_SIMULATED_FAILURE' });
      }
      return { descriptor: { workOrderRef: pkg.manifest.workOrderRef } };
    }
  };
  const h = makeHarness({
    mediaTransferCrypto: fake,
    preparedPackageResult: order => fakeTransferPackageFor(order.workOrderRef)
  });
  await h.run();

  await assert.rejects(
    () => h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}),
    error => error && error.code === 'CRYPTO_SIMULATED_FAILURE'
  );

  const envelope = await h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {});
  assert.equal(envelope.descriptor.workOrderRef, h.workOrderRef);
  assert.equal(cryptoEvents.length, 2);
});

test('prepareIssuedEncryptedTransferEnvelope produces a real WebCrypto envelope via the existing crypto module that the same existing module can decrypt back (round trip), without re-testing the crypto algorithms themselves', async () => {
  const REAL_CRYPTO_OPTS = { crypto: nodeCrypto.webcrypto, transferApi: RealMediaTransferPackage };

  const sender = await RealMediaTransferCrypto.generateSenderIdentity(REAL_CRYPTO_OPTS);
  const recipient = await RealMediaTransferCrypto.generateRecipientIdentity('sample-roundtrip-passphrase-01', REAL_CRYPTO_OPTS);
  const offer = await RealMediaTransferCrypto.createPairingOffer(recipient, REAL_CRYPTO_OPTS);
  const response = await RealMediaTransferCrypto.createPairingResponse(offer, sender, REAL_CRYPTO_OPTS);
  const registry = await RealMediaTransferCrypto.verifyPairingResponse(offer, response, REAL_CRYPTO_OPTS);

  const h = makeHarness({ mediaTransferCrypto: RealMediaTransferCrypto });
  await h.run();

  // 架空のサンプルworkOrderだけを使い、実際の患者情報は一切含めない。
  const realWorkOrder = { workOrderRef: h.workOrderRef, issueDate: '2026-10-02', note: 'synthetic-fixture-only' };
  const realPkg = await RealMediaTransferPackage.buildPackage(h.workOrderRef, realWorkOrder, [], REAL_CRYPTO_OPTS);
  h.mediaManager.prepareTransferPackage = async order => {
    h.events.push('prepare-package:' + order.workOrderRef);
    return realPkg;
  };

  const envelope = await h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(
    h.workOrderRef,
    sender,
    recipient,
    { cryptoOptions: REAL_CRYPTO_OPTS }
  );

  assert.equal(envelope.version, 'dwo-media-envelope-v1');
  assert.equal(envelope.descriptor.workOrderRef, h.workOrderRef);

  const decrypted = await RealMediaTransferCrypto.decryptEnvelope(envelope, recipient, registry, REAL_CRYPTO_OPTS);
  assert.equal(decrypted.workOrderRef, h.workOrderRef);
  assert.equal(decrypted.package.manifest.workOrderRef, h.workOrderRef);
});

// Synthetic regression tests for changes during asynchronous verification.
async function checkIssuanceConsistencyDuringDigest(change, shouldAllow) {
  const shared = createFakeSessionStorage();
  const first = makeHarness({ sessionStorage: shared });
  await first.run();
  const restored = JSON.parse(JSON.stringify(first.state.orders[0]));
  let hold = false, enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const crypto = { subtle: { async digest(alg, bytes) {
    if (hold) {
      hold = false;
      await new Promise(resolve => { release = resolve; enter(); });
    }
    return nodeCrypto.webcrypto.subtle.digest(alg, bytes);
  } } };
  const h = makeHarness({
    sessionStorage: shared, initialOrders: [restored],
    workOrderRef: first.workOrderRef, crypto
  });
  await h.dwoFinalIssue.refreshIssuedTransferState();
  hold = true;
  const pending = h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef);
  const settled = pending.then(() => true, () => false);
  await entered;
  change(h, shared);
  release();
  assert.equal(await settled, shouldAllow);
  assert.equal(h.events.filter(e => e.startsWith('prepare-package:')).length, shouldAllow ? 1 : 0);
}
test('async issuance check refuses changed order', () => checkIssuanceConsistencyDuringDigest(h => {
  h.state.orders[0].remarks = 'SAMPLE CHANGE';
}, false));
test('async issuance check refuses missing issuance record', () => checkIssuanceConsistencyDuringDigest((h, s) => {
  s.removeItem(ISSUED_MARKER_STORAGE_KEY);
}, false));
test('async issuance check accepts unchanged order', () => checkIssuanceConsistencyDuringDigest(() => {}, true));
test('async issuance check accepts status-only change', () => checkIssuanceConsistencyDuringDigest(h => {
  h.state.orders[0].status = 'accepted';
}, true));

test('PDF Stage 5 exposes cancellable paper choice and frozen-order blob generation', () => {
  assert.match(pdfSource, /function requestIssuePdfPaperSize\(\)/);
  assert.match(pdfSource, /pendingIssuePaperResolve/);
  assert.match(pdfSource, /function createIssuePdfBlob\(order, paperSize\)/);
  assert.match(pdfSource, /_createFixedPdfBlobFromOrders\(order, null, paperSize\)/);
  assert.match(pdfSource, /resolveIssue\(null\)/);
});

test('issue module detaches the legacy handler and preserves calendar-owned initial disable', () => {
  assert.ok(htmlSource.includes('id="submit-btn" disabled>この内容で発行する　→</button>'));
  const mediaAt = htmlSource.indexOf('<script src="media.js"></script>');
  const issueAt = htmlSource.indexOf('<script src="app/final-issue.js"></script>');
  assert.ok(mediaAt > 0 && issueAt > mediaAt);
  assert.match(issueSource, /removeEventListener\('click', submitOrder\)/);
  assert.match(issueSource, /初期のdisabled解除はcalendar\.jsに任せる/);
});

test('B5-transfer-copy includes generated B5 PDF using existing package builder', async () => {
  const T = require('../media-transfer-package.js');
  const h = makeHarness();
  await h.run();
  const issued = h.state.orders[0];
  const pdf = new Blob(['%PDF-1.7\nsynthetic'], { type: 'application/pdf' });
  let rendered;
  h.context.createIssuePdfBlob = async (order, paper) => {
    assert.equal(paper, 'b5');
    assert.notEqual(order, issued);
    assert.notEqual(order.visualSnapshot, issued.visualSnapshot);
    rendered = order;
    return pdf;
  };
  h.mediaManager.prepareTransferPackage = async (order, opts) => {
    assert.equal(order, rendered);
    assert.equal(opts.issuedB5Pdf, pdf);
    return T.buildPackage(order.workOrderRef, order, [], { ...opts, crypto: nodeCrypto.webcrypto });
  };
  const pkg = await h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true });
  assert.equal((await T.verifyPackage(pkg, { crypto: nodeCrypto.webcrypto })).ok, true);
  assert.equal(pkg.manifest.attachments[0].attachmentId, 'att-issued-b5-pdf');
  assert.equal(await new Blob(pkg.attachments['att-issued-b5-pdf'].chunks).text(), await pdf.text());
});

test('B5-transfer-copy rejects package without requested PDF', async () => {
  const h = makeHarness({ preparedPackageResult: order => fakeTransferPackageFor(order.workOrderRef) });
  await h.run();
  h.context.createIssuePdfBlob = async () => validB5PdfBlobFixture();
  await assert.rejects(() => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true }),
    { code: 'TRANSFER_PACKAGE_B5_PDF_INVALID' });
});

test('B5-transfer-copy rejects invalid or failed renderer before packaging', async () => {
  const h = makeHarness();
  await h.run();
  h.context.createIssuePdfBlob = async () => { throw new Error('synthetic'); };
  await assert.rejects(() => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true }),
    { code: 'TRANSFER_PACKAGE_B5_PDF_GENERATION_FAILED' });
  h.context.createIssuePdfBlob = async () => new Blob([], { type: 'application/pdf' });
  await assert.rejects(() => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true }),
    { code: 'TRANSFER_PACKAGE_B5_PDF_INVALID' });
  assert.equal(h.prepareCallArgs.length, 0);
});

test('B5-transfer-copy rejects issued or detached content changes during rendering', async () => {
  for (const mutateDetached of [false, true]) {
    const h = makeHarness();
    await h.run();
    h.context.createIssuePdfBlob = async order => {
      (mutateDetached ? order : h.state.orders[0]).remarks = 'synthetic change';
      return validB5PdfBlobFixture();
    };
    await assert.rejects(() => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true }),
      { code: 'TRANSFER_PACKAGE_NOT_ISSUED' });
    assert.equal(h.prepareCallArgs.length, 0);
  }
});

test('B5-transfer-copy rejects changed issued content during packaging', async () => {
  const h = makeHarness();
  await h.run();
  h.context.createIssuePdfBlob = async () => validB5PdfBlobFixture();
  h.mediaManager.prepareTransferPackage = async () => {
    h.state.orders[0].remarks = 'synthetic change';
    return fakeTransferPackageFor(h.workOrderRef);
  };
  await assert.rejects(() => h.dwoFinalIssue.prepareIssuedTransferPackage(h.workOrderRef, { includeB5Pdf: true }),
    { code: 'TRANSFER_PACKAGE_NOT_ISSUED' });
});

test('B5-transfer-copy encrypted opt-in forwards PDF and preserves opt-out', async () => {
  const T = require('../media-transfer-package.js');
  let encrypted;
  const h = makeHarness({ mediaTransferCrypto: { async encryptPackage(pkg) {
    encrypted = pkg;
    return { descriptor: { workOrderRef: pkg.manifest.workOrderRef } };
  } } });
  await h.run();
  let renders = 0;
  h.context.createIssuePdfBlob = async () => {
    renders++;
    return new Blob(['%PDF-1.7\nsynthetic'], { type: 'application/pdf' });
  };
  h.mediaManager.prepareTransferPackage = async (order, opts) =>
    T.buildPackage(order.workOrderRef, order, [], { ...opts, crypto: nodeCrypto.webcrypto });
  await h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {}, { includeB5Pdf: true });
  assert.equal(encrypted.manifest.attachments[0].attachmentId, 'att-issued-b5-pdf');
  await h.dwoFinalIssue.prepareIssuedEncryptedTransferEnvelope(h.workOrderRef, {}, {});
  assert.equal(encrypted.manifest.attachments.length, 0);
  assert.equal(renders, 1);
});

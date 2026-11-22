const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const issueSource = fs.readFileSync(path.join(root, 'app', 'final-issue.js'), 'utf8');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function visualSnapshot() {
  return {
    selectedTeeth: [18],
    drawing: { memoStrokes: [] }
  };
}

function makeHarness(options = {}) {
  const events = [];
  const state = { orders: [] };
  let boundHandler = null;
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
  const workOrderRef = 'dwo:123e4567-e89b-42d3-a456-426614174000';
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
  if (!options.noPreparePackage) {
    mediaManager.prepareTransferPackage = async order => {
      events.push('prepare-package:' + (order && order.workOrderRef));
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
      return { workOrderRef: order && order.workOrderRef, kind: 'transfer-package' };
    };
  }
  const context = {
    console,
    Error,
    JSON,
    String,
    Promise,
    state,
    submitOrder: legacyHandler,
    FormDraftManager: draftManager,
    ReferenceMediaManager: mediaManager,
    document: { getElementById(id) { return id === 'submit-btn' ? button : null; } },
    collectFormData() {
      return {
        clinicName: 'SAMPLE CLINIC',
        doctorName: 'SAMPLE DOCTOR',
        patientName: 'SAMPLE PATIENT',
        patientAge: '65',
        patientGender: 'female',
        issueDate: '2026-10-02',
        selectedTeeth: [],
        status: 'pending',
        createdAt: '2026-10-02T00:00:00.000Z',
        id: 'local_sample'
      };
    },
    validate() { return options.validationErrors || []; },
    freezeVisualSnapshot() { return options.snapshotFail ? null : visualSnapshot(); },
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
    run: () => boundHandler(),
    get dwoFinalIssue() { return context.DwoFinalIssue; },
    resolvePrepare(value) {
      if (deferredPrepareResolve) deferredPrepareResolve(value);
    },
    rejectPrepare(error) {
      if (deferredPrepareReject) deferredPrepareReject(error);
    }
  };
}

function microtask() {
  return new Promise(resolve => setImmediate(resolve));
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

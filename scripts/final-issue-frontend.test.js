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
    run: () => boundHandler()
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

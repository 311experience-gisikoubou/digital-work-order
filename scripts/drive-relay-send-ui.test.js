const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app/drive-relay-send-ui.js'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ref = 'dwo:123e4567-e89b-42d3-a456-426614174000';
const jobId = 'job_' + 'a'.repeat(64);

function load() {
  const listeners = new Map();
  const toasts = [];
  const state = { renders: 0 };
  const sandbox = {
    confirm: () => true,
    document: {
      createElement(tag) {
        assert.equal(tag, 'button');
        const handlers = new Map();
        return {
          disabled: false,
          addEventListener(type, handler) { handlers.set(type, handler); },
          async click() { return handlers.get('click')(); }
        };
      }
    },
    addEventListener(type, handler) { listeners.set(type, handler); },
    renderOrders() { state.renders += 1; },
    showToast(message, type) { toasts.push({ message, type }); }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'drive-relay-send-ui.js' });
  return { sandbox, listeners, state, toasts };
}

test('explicit send UI stays absent until an exact frozen controller is installed', () => {
  const { sandbox } = load();
  assert.equal(sandbox.DriveRelaySendUi.createButton(ref), null);
  assert.throws(
    () => sandbox.DriveRelaySendUi.install({ dispatch() {} }),
    /DRIVE_RELAY_SEND_CONTROLLER_INVALID/
  );
});

test('explicit confirmation reports relay acceptance separately from lab ACK', async () => {
  const { sandbox, state, toasts } = load();
  const calls = [];
  const controller = Object.freeze({
    async dispatch(workOrderRef) {
      calls.push(workOrderRef);
      return { status: 'RELAY_REPORTED_ACCEPTED', jobId };
    }
  });
  assert.equal(sandbox.DriveRelaySendUi.install(controller).available, true);
  assert.equal(state.renders, 1);
  const button = sandbox.DriveRelaySendUi.createButton(ref);
  assert.equal(button.textContent, '技工所へ送信');
  assert.match(button.title, /受領確認とは別/);
  await button.click();
  assert.deepEqual(calls, [ref]);
  assert.deepEqual(toasts, [{
    message: '中継への保存を確認しました（技工所の受領確認待ち）',
    type: undefined
  }]);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '技工所へ送信');
});

test('cancel, uncertain response, controller replacement and pagehide fail closed', async () => {
  const { sandbox, listeners, toasts } = load();
  let dispatches = 0;
  const controller = Object.freeze({
    async dispatch(workOrderRef) {
      dispatches += 1;
      return { status: 'KEEP_PENDING', jobId };
    }
  });
  sandbox.DriveRelaySendUi.install(controller);
  const button = sandbox.DriveRelaySendUi.createButton(ref);
  sandbox.confirm = () => false;
  await button.click();
  assert.equal(dispatches, 0);

  sandbox.confirm = () => true;
  await button.click();
  assert.equal(dispatches, 1);
  assert.match(toasts.at(-1).message, /同じ指示書で再確認/);
  assert.throws(
    () => sandbox.DriveRelaySendUi.install(Object.freeze({ dispatch() {} })),
    /DRIVE_RELAY_SEND_CONTROLLER_REPLACEMENT_FORBIDDEN/
  );
  listeners.get('pagehide')();
  assert.equal(sandbox.DriveRelaySendUi.createButton(ref), null);
});

test('orders wire the gated button and the module loads before orders', () => {
  assert.match(ordersSource, /DriveRelaySendUi\.createButton\(order\.workOrderRef\)/);
  assert.match(ordersSource, /if \(sendBtn\) actions\.appendChild\(sendBtn\)/);
  const moduleIndex = html.indexOf('<script src="app/drive-relay-send-ui.js">');
  const ordersIndex = html.indexOf('<script src="orders.js">');
  assert.ok(moduleIndex >= 0 && moduleIndex < ordersIndex);
});

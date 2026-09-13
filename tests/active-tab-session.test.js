const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const tabStart = appSource.indexOf('//  タブ切り替え / 同一タブ再読込時の画面復元');
const insuranceStart = appSource.indexOf('//  保険 / 自費 切り替え', tabStart);
assert.ok(tabStart >= 0 && insuranceStart > tabStart);

const tabBlock = appSource.slice(
  appSource.lastIndexOf('// ============================================================', tabStart),
  appSource.lastIndexOf('// ============================================================', insuranceStart)
);

function createClassList(active = false) {
  const values = new Set(active ? ['active'] : []);
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}
function createElement(tab, active = false) {
  const events = {};
  return {
    dataset: tab ? { tab } : {},
    classList: createClassList(active),
    addEventListener(name, callback) { events[name] = callback; },
    events
  };
}

function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    snapshot() { return Object.fromEntries(data); }
  };
}

function boot(storage) {
  const clinicButton = createElement('clinic', true);
  const labButton = createElement('lab');
  const clinicView = createElement(null, true);
  const labView = createElement(null);
  const windowEvents = {};
  let renderCount = 0;
  const buttons = [clinicButton, labButton];
  const views = [clinicView, labView];
  const context = {
    document: {
      querySelectorAll(selector) {
        if (selector === '.tab-btn') return buttons;
        if (selector === '.view') return views;
        return [];
      },
      querySelector(selector) {
        if (selector === '.tab-btn[data-tab="clinic"]') return clinicButton;
        if (selector === '.tab-btn[data-tab="lab"]') return labButton;
        return null;
      },
      getElementById(id) {
        if (id === 'view-clinic') return clinicView;
        if (id === 'view-lab') return labView;
        return null;
      }
    },
    window: {
      sessionStorage: storage,
      addEventListener(name, callback) { windowEvents[name] = callback; }
    },
    renderOrders() { renderCount += 1; }
  };
  vm.createContext(context);
  vm.runInContext(tabBlock, context);
  return {
    context,
    clinicButton,
    labButton,
    clinicView,
    labView,
    windowEvents,
    getRenderCount: () => renderCount
  };
}

test('clicking lab stores only the allow-listed active tab and renders orders', () => {
  const storage = createStorage();
  const app = boot(storage);
  app.labButton.events.click();

  assert.deepEqual(storage.snapshot(), { dwo_session_active_tab_v1: 'lab' });
  assert.equal(app.labButton.classList.contains('active'), true);
  assert.equal(app.labView.classList.contains('active'), true);
  assert.equal(app.clinicButton.classList.contains('active'), false);
  assert.equal(app.getRenderCount(), 1);
});

test('same-tab reload restores the last active lab view', () => {
  const storage = createStorage();
  const first = boot(storage);
  first.labButton.events.click();
  const reloaded = boot(storage);
  reloaded.windowEvents.DOMContentLoaded();

  assert.equal(reloaded.labButton.classList.contains('active'), true);
  assert.equal(reloaded.labView.classList.contains('active'), true);
  assert.equal(reloaded.clinicButton.classList.contains('active'), false);
  assert.equal(reloaded.getRenderCount(), 1);
});

test('unknown stored tab fails closed to clinic and clears the invalid value', () => {
  const storage = createStorage({ dwo_session_active_tab_v1: 'unknown' });
  const app = boot(storage);
  app.windowEvents.DOMContentLoaded();

  assert.equal(app.clinicButton.classList.contains('active'), true);
  assert.equal(app.clinicView.classList.contains('active'), true);
  assert.equal(app.labButton.classList.contains('active'), false);
  assert.deepEqual(storage.snapshot(), {});
  assert.equal(app.getRenderCount(), 0);
});

test('sessionStorage failure keeps the default clinic view usable', () => {
  const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  const app = boot(throwingStorage);
  assert.doesNotThrow(() => app.windowEvents.DOMContentLoaded());
  assert.equal(app.clinicButton.classList.contains('active'), true);
  assert.equal(app.labButton.classList.contains('active'), false);
  assert.equal(app.getRenderCount(), 0);
});

test('clinic remains the default when no active tab has been stored', () => {
  const storage = createStorage();
  const app = boot(storage);
  app.windowEvents.DOMContentLoaded();

  assert.equal(app.clinicButton.classList.contains('active'), true);
  assert.equal(app.clinicView.classList.contains('active'), true);
  assert.equal(app.getRenderCount(), 0);
  assert.deepEqual(storage.snapshot(), {});
});
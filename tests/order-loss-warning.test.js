import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const orders = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('temporary order loss warning is visible only while page-memory orders exist', () => {
  assert.match(index, /id="order-loss-warning"[^>]*hidden/);
  const start = orders.indexOf('//  一時受注の消失警告');
  const end = orders.indexOf('//  受注サマリー', start);
  assert.ok(start >= 0 && end > start);

  let added = null;
  let removed = null;
  const warning = { hidden: true };
  const context = {
    state: { orders: [] },
    document: { getElementById: id => id === 'order-loss-warning' ? warning : null },
    window: {
      addEventListener: (type, fn) => { if (type === 'beforeunload') added = fn; },
      removeEventListener: (type, fn) => { if (type === 'beforeunload') removed = fn; }
    }
  };
  vm.createContext(context);
  vm.runInContext(orders.slice(orders.lastIndexOf('// ============================================================', start), orders.lastIndexOf('// ============================================================', end)), context);

  context.syncOrderLossGuard();
  assert.equal(warning.hidden, true);
  assert.equal(added, null);

  context.state.orders.push({ id: 'synthetic-order' });
  context.syncOrderLossGuard();
  assert.equal(warning.hidden, false);
  assert.equal(typeof added, 'function');

  const event = { prevented: false, returnValue: false, preventDefault() { this.prevented = true; } };
  added(event);
  assert.equal(event.prevented, true);
  assert.equal(event.returnValue, true);

  context.state.orders.length = 0;
  context.syncOrderLossGuard();
  assert.equal(warning.hidden, true);
  assert.equal(removed, added);
});

test('clinic reflection activates the loss guard immediately without persistence', () => {
  assert.match(app, /state\.orders\.unshift\(data\);\s*if \(typeof syncOrderLossGuard === 'function'\) syncOrderLossGuard\(\);/);
  assert.doesNotMatch(orders, /localStorage|sessionStorage|indexedDB|caches\./i);
});

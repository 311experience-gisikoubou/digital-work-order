import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const start = ordersSource.indexOf('//  Same-tab temporary-order reload recovery');
const end = ordersSource.indexOf('//  受注サマリー', start);
assert.ok(start >= 0 && end > start);
const regionStart = ordersSource.lastIndexOf('// ============================================================', start);
const regionEnd = ordersSource.lastIndexOf('// ============================================================', end);

function loadRecovery(state) {
  const context = { state, window: {} };
  vm.createContext(context);
  vm.runInContext(ordersSource.slice(regionStart, regionEnd), context);
  return context;
}

function syntheticOrder(overrides = {}) {
  return {
    clinicName: 'SAMPLE-CLINIC',
    doctorName: 'SAMPLE-DOCTOR',
    patientName: 'SAMPLE-PATIENT',
    patientAge: '65',
    patientGender: 'female',
    issueDate: '2026-09-13',
    selectedTeeth: ['11'],
    insuranceType: 'insurance',
    orderTypes: ['完成'],
    devices: [],
    deliveryDate: '2026-09-30',
    remarks: '',
    memoStrokes: [],
    status: 'pending',
    createdAt: '2026-09-13T00:00:00.000Z',
    id: 'local_1',
    workOrderRef: 'dwo:123e4567-e89b-42d3-a456-426614174000',
    ...overrides
  };
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    has(key) { return data.has(key); }
  };
}

test('temporary orders survive same-tab reload through the versioned session envelope', () => {
  const state = { orders: [syntheticOrder()] };
  const context = loadRecovery(state);
  const storage = memoryStorage();
  assert.equal(context.syncTemporaryOrdersToSession(storage), true);
  state.orders = [];
  assert.equal(context.restoreTemporaryOrdersFromSession(storage), true);
  assert.equal(state.orders.length, 1);
  assert.equal(state.orders[0].patientName, 'SAMPLE-PATIENT');
});

test('accepted state is persisted and zero orders remove the session key', () => {
  const state = { orders: [syntheticOrder({ status: 'accepted' })] };
  const context = loadRecovery(state);
  const storage = memoryStorage();
  context.syncTemporaryOrdersToSession(storage);
  state.orders = [];
  context.restoreTemporaryOrdersFromSession(storage);
  assert.equal(state.orders[0].status, 'accepted');
  state.orders = [];
  context.syncTemporaryOrdersToSession(storage);
  assert.equal(storage.has('dwo_session_orders_v1'), false);
});

test('invalid JSON, unknown schema, and duplicate workOrderRef fail closed without partial restore', () => {
  for (const raw of [
    '{bad-json',
    JSON.stringify({ schemaVersion: 'unknown', orders: [syntheticOrder()] }),
    JSON.stringify({ schemaVersion: 'dwo-session-orders-v1', orders: [syntheticOrder(), syntheticOrder({ id: 'local_2' })] })
  ]) {
    const state = { orders: [] };
    const context = loadRecovery(state);
    const storage = memoryStorage({ dwo_session_orders_v1: raw });
    assert.equal(context.restoreTemporaryOrdersFromSession(storage), false);
    assert.deepEqual(state.orders, []);
    assert.equal(storage.has('dwo_session_orders_v1'), false);
  }
});

test('failed sync best-effort clears an older session snapshot to avoid stale restore', () => {
  const state = { orders: [syntheticOrder({ status: 'accepted' })] };
  const context = loadRecovery(state);
  const data = new Map([['dwo_session_orders_v1', JSON.stringify({ schemaVersion: 'dwo-session-orders-v1', orders: [syntheticOrder()] })]]);
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem() { throw new Error('quota'); },
    removeItem(key) { data.delete(key); },
    has(key) { return data.has(key); }
  };
  assert.equal(context.syncTemporaryOrdersToSession(storage), false);
  assert.equal(storage.has('dwo_session_orders_v1'), false);
});

test('sessionStorage failures fall back to page memory without breaking the order', () => {
  const state = { orders: [syntheticOrder()] };
  const context = loadRecovery(state);
  const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(context.syncTemporaryOrdersToSession(throwingStorage), false);
  assert.equal(state.orders.length, 1);
  state.orders = [];
  assert.equal(context.restoreTemporaryOrdersFromSession(throwingStorage), false);
  assert.deepEqual(state.orders, []);
});

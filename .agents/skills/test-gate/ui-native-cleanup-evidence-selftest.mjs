#!/usr/bin/env node
// Self-test for verifyNativeCleanupReceipt. Synthetic fixtures only; no product data.
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { verifyNativeCleanupReceipt } from './ui-native-cleanup-evidence.mjs';

const STATE_ID = 'git:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const pre = {
  stage: 'PRE_SHUTDOWN_OBSERVED',
  stateId: STATE_ID,
  ownedTaskId: 'run-1',
  workerPid: 101,
  nativeProcessPid: 102,
  cdpPort: 9466,
  workspaceId: 'synthetic',
  trackedPids: [102],
  observedAt: '2026-10-09T07:00:00.000Z',
};

function buildPost() {
  return {
    schemaVersion: 1,
    receiptType: 'UI_NATIVE_CLEANUP_V1',
    result: 'PASS',
    code: 'NATIVE_CLEANUP_OK',
    stateId: STATE_ID,
    runId: 'run-1',
    ownedTaskId: 'run-1',
    workerPid: 101,
    nativeProcessPid: 102,
    cdpPort: 9466,
    verifiedBeforeShutdown: true,
    workerExited: true,
    nativeProcessExited: true,
    trackedChildrenExited: true,
    cdpPortReleased: true,
    syntheticWorkspaceIsolated: true,
    preEvidencePath: 'C:/synthetic/native-owned-pre-shutdown.json',
    postObservedAt: '2026-10-09T07:00:01.000Z',
  };
}

function sign(post) {
  return createHash('sha256').update(JSON.stringify(post)).digest('hex');
}

function receiptWithId(post) {
  return { ...post, receiptId: sign(post) };
}

// 1. valid PASS
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, pre);
  assert.deepStrictEqual(result, { ok: true, reason: 'NATIVE_CLEANUP_OK' });
}

// 2. missing/altered flags STOP
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  receipt.cdpPortReleased = false;
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, pre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'CLEANUP_PROOF_INCOMPLETE');
}

// 3. stale state STOP
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  const staleStateId = 'git:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = verifyNativeCleanupReceipt(receipt, staleStateId, pre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'STATE_ID_MISMATCH');
}

// 4. pre mismatch STOP
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  const badPre = { ...pre, nativeProcessPid: 999 };
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, badPre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'PRE_POST_MISMATCH');
}

// 5. wrong receiptId STOP
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  receipt.receiptId = 'f'.repeat(64);
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, pre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'RECEIPT_ID_TAMPERED');
}

// 6. extra field STOP
{
  const post = buildPost();
  const receipt = receiptWithId(post);
  receipt.unexpectedField = 'synthetic';
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, pre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'RECEIPT_EXTRA_FIELDS');
}

// 7. invalid time STOP
{
  const post = buildPost();
  post.postObservedAt = 'not-a-timestamp';
  const receipt = receiptWithId(post);
  const result = verifyNativeCleanupReceipt(receipt, STATE_ID, pre);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'TIMESTAMP_INVALID');
}

console.log('ui-native-cleanup-evidence-selftest: all assertions passed');

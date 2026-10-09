#!/usr/bin/env node
// Self-test: proves verifyQualifiedCommitReceipt STOPs on malformed/mismatched
// inputs using only synthetic example.invalid data. No real git repo needed.
import assert from 'node:assert/strict';
import { verifyQualifiedCommitReceipt } from './qualified-commit-receipt-audit.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const NONEXISTENT_REPO_ROOT = 'C:/nonexistent-example-invalid-repo-xyz';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseArgs() {
  return {
    repoRoot: NONEXISTENT_REPO_ROOT,
    repository: { owner: 'example-invalid-owner', name: 'example-invalid-repo' },
    commit: SHA_A,
    receipt: {
      result: 'PASS',
      executor: { routeType: 'qualified-agent' },
      repository: { owner: 'example-invalid-owner', name: 'example-invalid-repo' },
      implementationHead: SHA_A,
      executionEvidence: { preHead: SHA_B, changedPaths: [] },
    },
  };
}

let cases = 0;
function expectStop(label, args, expectedCode) {
  cases += 1;
  const result = verifyQualifiedCommitReceipt(args);
  assert.equal(result.result, 'STOP', `${label}: expected STOP result`);
  assert.equal(result.code, expectedCode, `${label}: expected code ${expectedCode}`);
}

// 1. missing receipt
{
  const args = baseArgs();
  args.receipt = undefined;
  expectStop('missing receipt', args, 'RECEIPT_NOT_PASS');
}

// 2. direct route (not qualified-agent)
{
  const args = baseArgs();
  args.receipt.executor.routeType = 'direct';
  expectStop('direct route', args, 'RECEIPT_ROUTE_TYPE_NOT_QUALIFIED_AGENT');
}

// 3. invalid SHA
{
  const args = baseArgs();
  args.commit = 'not-a-valid-sha';
  expectStop('invalid SHA', args, 'COMMIT_SHA_INVALID');
}

// 4. repository mismatch
{
  const args = baseArgs();
  args.receipt.repository.name = 'different-example-invalid-repo';
  expectStop('repository mismatch', args, 'RECEIPT_REPOSITORY_MISMATCH');
}

// 5. wrong implementationHead
{
  const args = baseArgs();
  args.receipt.implementationHead = SHA_C;
  expectStop('wrong implementationHead', args, 'IMPLEMENTATION_HEAD_MISMATCH');
}

// 6. invalid preHead
{
  const args = baseArgs();
  args.receipt.executionEvidence.preHead = 'not-a-valid-sha';
  expectStop('invalid preHead', args, 'EXECUTION_EVIDENCE_PRE_HEAD_INVALID');
}

// 7. absent repoRoot
{
  const args = baseArgs();
  args.repoRoot = undefined;
  expectStop('absent repoRoot', args, 'REPO_ROOT_INVALID');
}

// 8. missing commit in nonexistent repo (otherwise valid-shaped receipt)
expectStop('missing commit in nonexistent repo', clone(baseArgs()), 'COMMIT_NOT_FOUND');

console.log(`PASS qualified-commit-receipt-audit-selftest (${cases} cases)`);

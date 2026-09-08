#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runMergeExecutionGate } from './merge-execution-gate.mjs';

const HEAD_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = Date.parse('2026-09-08T10:30:00Z');
const AUTHOR = '311experience-gisikoubou';

function receipt({ pr = 52, head = HEAD_A, source = 'EXPLICIT_HUMAN' } = {}) {
  return [
    'MERGE_AUTHORIZATION_V1',
    `PR: ${pr}`,
    `HEAD: ${head}`,
    'AUTHORIZED: YES',
    `SOURCE: ${source}`,
  ].join('\n');
}

function makePr(overrides = {}) {
  return {
    number: 52,
    state: 'open',
    merged_at: null,
    draft: false,
    base: { ref: 'main' },
    head: { sha: HEAD_A },
    ...overrides,
  };
}
function comment(body, { login = AUTHOR, createdAt = '2026-09-08T10:25:00Z', id = 100 } = {}) {
  return { id, body, created_at: createdAt, user: { login } };
}

function fakeFetch(pr, comments) {
  return async url => {
    if (url.includes('/pulls/52')) {
      return { ok: true, status: 200, json: async () => pr };
    }
    if (url.includes('/issues/52/comments')) {
      const page = new URL(url).searchParams.get('page');
      return { ok: true, status: 200, json: async () => (page === '1' ? comments : []) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

async function run(pr, comments) {
  return runMergeExecutionGate({
    repo: '311experience-gisikoubou/digital-work-order',
    prNumber: 52,
    baseBranch: 'main',
    author: AUTHOR,
    nowMs: NOW,
    fetchImpl: fakeFetch(pr, comments),
  });
}

async function expectFail(pr, comments, code) {
  const result = await run(pr, comments);
  assert.equal(result.pass, false);
  assert.equal(result.finding, code);
  assert.equal(result.expectedHeadSha, null);
}
const valid = await run(makePr(), [comment(receipt())]);
assert.equal(valid.pass, true);
assert.equal(valid.expectedHeadSha, HEAD_A);
assert.equal(valid.authorizationCommentId, 100);
assert.equal(valid.authorizationSource, 'EXPLICIT_HUMAN');

const persisted = await run(makePr(), [comment(receipt({ source: 'PERSISTED_AFTER_AUDIT' }))]);
assert.equal(persisted.pass, true);
assert.equal(persisted.authorizationSource, 'PERSISTED_AFTER_AUDIT');

await expectFail(makePr(), [], 'AUTHORIZATION_RECEIPT_REQUIRED');
await expectFail(makePr(), [comment(receipt({ head: HEAD_B }))], 'AUTHORIZATION_HEAD_MISMATCH');
await expectFail(makePr(), [comment(receipt({ pr: 51 }))], 'AUTHORIZATION_PR_MISMATCH');
await expectFail(makePr(), [comment(receipt(), { login: 'someone-else' })], 'AUTHORIZATION_AUTHOR_MISMATCH');
await expectFail(
  makePr(),
  [comment(receipt(), { createdAt: '2026-09-08T09:00:00Z' })],
  'AUTHORIZATION_RECEIPT_EXPIRED',
);

const merged = await run(makePr({ state: 'closed', merged_at: '2026-09-08T10:29:00Z' }), [comment(receipt())]);
assert.equal(merged.pass, false);
assert.equal(merged.checks.prOpen, false);
assert.equal(merged.expectedHeadSha, null);
const draft = await run(makePr({ draft: true }), [comment(receipt())]);
assert.equal(draft.pass, false);
assert.equal(draft.checks.notDraft, false);

const wrongBase = await run(makePr({ base: { ref: 'release' } }), [comment(receipt())]);
assert.equal(wrongBase.pass, false);
assert.equal(wrongBase.checks.baseBranch, false);

const beforeDrift = await run(makePr(), [comment(receipt())]);
assert.equal(beforeDrift.pass, true);
const afterDrift = await run(makePr({ head: { sha: HEAD_B } }), [comment(receipt())]);
assert.equal(afterDrift.pass, false);
assert.equal(afterDrift.finding, 'AUTHORIZATION_HEAD_MISMATCH');

const malformed = `${receipt()}\nEXTRA: no`;
await expectFail(makePr(), [comment(malformed)], 'AUTHORIZATION_RECEIPT_REQUIRED');

console.log('merge-execution-gate selftest: PASS');

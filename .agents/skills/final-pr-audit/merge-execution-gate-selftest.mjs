#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fetchJson, parseArgs, parseEvidenceJson, runMergeExecutionGate } from './merge-execution-gate.mjs';

const HEAD_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HEAD_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = Date.parse('2026-09-08T10:30:00Z');
const AUTHOR = 'foundation-test-author';

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
    repo: 'example/repository',
    prNumber: 52,
    baseBranch: 'main',
    author: AUTHOR,
    nowMs: NOW,
    fetchImpl: fakeFetch(pr, comments),
  });
}

function makeEvidence({ repository = 'example/repository', fetchedAt = '2026-09-08T10:29:00Z', pr = makePr(), authorizationComments = [comment(receipt())], schemaVersion = 1 } = {}) {
  return { schemaVersion, repository, fetchedAt, pr, authorizationComments };
}

async function runEvidence(evidence) {
  return runMergeExecutionGate({
    repo: 'example/repository',
    prNumber: 52,
    baseBranch: 'main',
    author: AUTHOR,
    nowMs: NOW,
    evidence,
  });
}

async function expectEvidenceFail(evidence, code) {
  const result = await runEvidence(evidence);
  assert.equal(result.pass, false);
  assert.equal(result.finding, code);
  assert.equal(result.expectedHeadSha, null);
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

assert.deepEqual(
  parseArgs(['--repo', 'example/repository', '--pr', '52', '--base', 'main', '--author', AUTHOR]),
  { repo: 'example/repository', pr: '52', base: 'main', author: AUTHOR },
  'strict CLI argument parsing',
);
assert.throws(() => parseArgs(['--repo', 'a/b', '--repo', 'c/d']), /Duplicate argument/);
assert.throws(() => parseArgs(['--reop', 'a/b']), /Unknown argument/);
assert.throws(() => parseArgs(['--evidence-file', '']), /Invalid arguments/);

const bomEvidence = makeEvidence();
assert.deepEqual(parseEvidenceJson(`\uFEFF${JSON.stringify(bomEvidence)}`), bomEvidence, 'BOM evidence parsing');
assert.throws(() => parseEvidenceJson('not-json'), /Invalid evidence JSON/);
assert.throws(() => parseEvidenceJson('null'), /Invalid evidence JSON/);

let delayedClock = Date.parse('2026-09-08T10:20:00Z');
const delayedFetchBase = fakeFetch(makePr(), [comment(receipt(), { createdAt: '2026-09-08T10:00:00Z' })]);
const delayedFetch = async (url, options) => {
  const result = await delayedFetchBase(url, options);
  delayedClock = Date.parse('2026-09-08T10:31:00Z');
  return result;
};
const delayedExpiry = await runMergeExecutionGate({
  repo: 'example/repository', prNumber: 52, baseBranch: 'main', author: AUTHOR,
  nowFn: () => delayedClock, fetchImpl: delayedFetch,
});
assert.equal(delayedExpiry.pass, false, 'receipt expires after fetch delay');
assert.equal(delayedExpiry.finding, 'AUTHORIZATION_RECEIPT_EXPIRED');

let stalledBodyAborted = false;
await assert.rejects(
  fetchJson('https://example.invalid/test', async (_url, options) => ({
    ok: true, status: 200,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => { stalledBodyAborted = true; reject(new Error('stalled response body aborted')); }, { once: true });
    }),
  }), 20),
  /stalled response body aborted/,
);
assert.equal(stalledBodyAborted, true);

let sawAbortSignal = false;
const signalFetchBase = fakeFetch(makePr(), [comment(receipt())]);
const signalFetch = async (url, options) => {
  sawAbortSignal ||= options?.signal instanceof AbortSignal;
  return signalFetchBase(url, options);
};
const signalResult = await runMergeExecutionGate({
  repo: 'example/repository', prNumber: 52, baseBranch: 'main', author: AUTHOR,
  nowMs: NOW, fetchImpl: signalFetch,
});
assert.equal(signalResult.pass, true);
assert.equal(sawAbortSignal, true, 'GitHub fetch receives abort signal');

let nullEvidenceFetchCalled = false;
const nullEvidence = await runMergeExecutionGate({
  repo: 'example/repository', prNumber: 52, baseBranch: 'main', author: AUTHOR,
  nowMs: NOW, evidence: null,
  fetchImpl: async () => { nullEvidenceFetchCalled = true; throw new Error('must not fetch'); },
});
assert.equal(nullEvidence.pass, false, 'explicit null evidence must not fetch');
assert.equal(nullEvidence.finding, 'EVIDENCE_SHAPE_INVALID');
assert.equal(nullEvidenceFetchCalled, false);

const validEvidence = await runEvidence(makeEvidence());
assert.equal(validEvidence.pass, true);
assert.equal(validEvidence.expectedHeadSha, HEAD_A);

await expectEvidenceFail(makeEvidence({ repository: 'example/other' }), 'EVIDENCE_REPOSITORY_MISMATCH');
await expectEvidenceFail(makeEvidence({ schemaVersion: 2 }), 'EVIDENCE_SCHEMA_UNSUPPORTED');
await expectEvidenceFail(makeEvidence({ fetchedAt: '2026-09-08T10:00:00Z' }), 'EVIDENCE_STALE');
await expectEvidenceFail(makeEvidence({ fetchedAt: '2026-09-08T10:40:00Z' }), 'EVIDENCE_FROM_FUTURE');
await expectEvidenceFail(makeEvidence({ pr: makePr({ number: 51 }) }), 'EVIDENCE_PR_MISMATCH');
await expectEvidenceFail(makeEvidence({ authorizationComments: [{ body: receipt(), created_at: '2026-09-08T10:25:00Z', user: {} }] }), 'EVIDENCE_SHAPE_INVALID');

const malformed = `${receipt()}\nEXTRA: no`;
await expectFail(makePr(), [comment(malformed)], 'AUTHORIZATION_RECEIPT_REQUIRED');

console.log('merge-execution-gate selftest: PASS');

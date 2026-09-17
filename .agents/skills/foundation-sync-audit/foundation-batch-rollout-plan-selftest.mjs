#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const helper = join(here, 'foundation-batch-rollout-plan.mjs');
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const D = 'd'.repeat(40);
const E = 'e'.repeat(40);
const F = 'f'.repeat(40);

const release = {
  fromVersion: '1.0.0-dev.86', sourceVersion: '1.0.0-dev.87', fromCommit: E, sourceCommit: F,
  entries: [
    { path: '.agents/skills/example/SKILL.md', oldSha: A, newSha: B },
    { path: '.agents/skills/new/SKILL.md', oldSha: null, newSha: C },
    { path: '.agents/skills/old/SKILL.md', oldSha: D, newSha: null },
  ],
};
const staleShas = {
  '.agents/skills/example/SKILL.md': A,
  '.agents/skills/new/SKILL.md': null,
  '.agents/skills/old/SKILL.md': D,
};
const currentShas = {
  '.agents/skills/example/SKILL.md': B,
  '.agents/skills/new/SKILL.md': C,
  '.agents/skills/old/SKILL.md': null,
};
function target(repository, branch, shas) {
  return { repository, branch, head: A, baseTree: B, targetShas: shas };
}
function manifest(targets, releaseOverride = release) {
  return { schemaVersion: 1, release: releaseOverride, targets };
}
function run(input, expectedStatus = 0) {
  const r = spawnSync(process.execPath, [helper, '--manifest-json', JSON.stringify(input)], { encoding: 'utf8' });
  assert.equal(r.status, expectedStatus, `unexpected exit ${r.status}: ${r.stdout}\n${r.stderr}`);
  return JSON.parse(r.stdout);
}

const mixed = run(manifest([
  target('acme/current', 'main', currentShas),
  target('acme/stale', 'refs/heads/main', staleShas),
  target('acme/feature', 'foundation/dev87', staleShas),
  target('acme/partial', 'foundation/dev87', {
    '.agents/skills/example/SKILL.md': B,
    '.agents/skills/new/SKILL.md': null,
    '.agents/skills/old/SKILL.md': D,
  }),
]));
assert.equal(mixed.result, 'PASS');
assert.equal(mixed.code, 'FOUNDATION_BATCH_ROLLOUT_PLAN_READY');
assert.deepEqual(mixed.counts, { targets: 4, current: 1, update: 2, partialResume: 1, branchRequired: 1, readyPlans: 2 });
assert.equal(mixed.targets[0].state, 'CURRENT');
assert.equal(mixed.targets[0].action, 'NONE');
assert.equal(mixed.targets[1].state, 'UPDATE');
assert.equal(mixed.targets[1].action, 'CREATE_FEATURE_BRANCH');
assert.equal(mixed.targets[1].branchFromSha, A);
assert.equal(mixed.targets[2].action, 'APPLY_REMOTE_PLAN');
assert.equal(mixed.targets[2].remotePlan.result, 'PASS');
assert.equal(mixed.targets[2].remotePlan.counts.planned, 3);
assert.equal(mixed.targets[3].state, 'PARTIAL_RESUME');
assert.equal(mixed.targets[3].remotePlan.counts.planned, 2);
assert.deepEqual(mixed.targets[3].pendingPaths.sort(), ['.agents/skills/new/SKILL.md', '.agents/skills/old/SKILL.md'].sort());

const drift = run(manifest([target('acme/drift', 'foundation/dev87', { ...staleShas, '.agents/skills/example/SKILL.md': C })]), 2);
assert.equal(drift.code, 'FOUNDATION_BATCH_TARGET_DRIFT');
assert.equal(drift.repository, 'acme/drift');
assert.equal(drift.path, '.agents/skills/example/SKILL.md');

const missing = structuredClone(staleShas);
delete missing['.agents/skills/new/SKILL.md'];
assert.equal(run(manifest([target('acme/missing', 'main', missing)]), 2).code, 'FOUNDATION_BATCH_TARGET_PATH_EVIDENCE_MISSING');

assert.equal(run(manifest([
  target('acme/dup', 'main', staleShas), target('acme/dup', 'foundation/other', staleShas),
]), 2).code, 'FOUNDATION_BATCH_DUPLICATE_TARGET');

const duplicatePathRelease = structuredClone(release);
duplicatePathRelease.entries.push({ ...duplicatePathRelease.entries[0] });
assert.equal(run(manifest([target('acme/x', 'main', staleShas)], duplicatePathRelease), 2).code, 'FOUNDATION_BATCH_DUPLICATE_RELEASE_PATH');

const outsideRelease = structuredClone(release);
outsideRelease.entries = [{ path: 'src/app.ts', oldSha: A, newSha: B }];
assert.equal(run(manifest([target('acme/x', 'main', { 'src/app.ts': A })], outsideRelease), 2).code, 'FOUNDATION_BATCH_PATH_OUTSIDE_SHARED_SURFACE');

const unchangedRelease = structuredClone(release);
unchangedRelease.entries = [{ path: 'AGENTS.md', oldSha: A, newSha: A }];
assert.equal(run(manifest([target('acme/x', 'main', { 'AGENTS.md': A })], unchangedRelease), 2).code, 'FOUNDATION_BATCH_UNCHANGED_RELEASE_ENTRY');

const badContentRelease = structuredClone(release);
badContentRelease.entries = [{ path: 'AGENTS.md', oldSha: A, newSha: B, newContent: 'not-b-sha' }];
assert.equal(run(manifest([target('acme/x', 'main', { 'AGENTS.md': A })], badContentRelease), 2).code, 'FOUNDATION_BATCH_SOURCE_CONTENT_SHA_MISMATCH');

const badSingleTarget = target('acme/single-stop', 'foundation/dev87', staleShas);
badSingleTarget.baseTree = 'not-a-sha';
assert.equal(run(manifest([badSingleTarget]), 2).code, 'FOUNDATION_BATCH_TARGET_BASE_TREE_INVALID');

console.log('foundation-batch-rollout-plan selftest: PASS');

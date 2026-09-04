#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const helperArg = process.argv[2];
if (!helperArg) throw new Error('helper path required');
const helper = resolve(helperArg);
const sha = (c) => c.repeat(40);
const base = {
  fromVersion: '1.0.0-dev.37',
  sourceVersion: '1.0.0-dev.38',
  fromCommit: sha('1'),
  sourceCommit: sha('2'),
  targetRepository: 'owner/repo',
  targetBranch: 'chore/foundation-dev38-sync',
  targetHead: sha('3'),
  targetBaseTree: sha('4'),
  entries: [
    { path: 'AGENTS.md', oldSha: sha('a'), newSha: sha('b'), targetSha: sha('a') },
    { path: '.agents/skills/x/SKILL.md', oldSha: sha('c'), newSha: sha('c'), targetSha: sha('c') },
    { path: '.agents/skills/x/new.mjs', oldSha: null, newSha: sha('d'), targetSha: null },
    { path: '.agents/skills/x/old.mjs', oldSha: sha('e'), newSha: null, targetSha: sha('e') },
  ],
};
function run(manifest, expected = 0) {
  const r = spawnSync(process.execPath, [helper, '--manifest-json', JSON.stringify(manifest)], { encoding: 'utf8' });
  if (r.status !== expected) throw new Error(`status ${r.status}, expected ${expected}: ${r.stdout} ${r.stderr}`);
  return JSON.parse(r.stdout);
}
let out = run(base);
if (out.code !== 'FOUNDATION_REMOTE_UPDATE_PLAN_READY') throw new Error(JSON.stringify(out));
if (out.counts.planned !== 3 || out.counts.replaced !== 1 || out.counts.created !== 1 || out.counts.deleted !== 1 || out.counts.unchanged !== 1) throw new Error(JSON.stringify(out));
if (out.gitDataContract.updateRef.force !== false || out.gitDataContract.updateRef.expectedCurrentHead !== sha('3')) throw new Error(JSON.stringify(out));
if (out.gitDataContract.createTree.treeElements.length !== 3) throw new Error(JSON.stringify(out));
if (!out.requiredBlobShas.includes(sha('b')) || !out.requiredBlobShas.includes(sha('d'))) throw new Error(JSON.stringify(out));

out = run({ ...base, entries: [{ path: 'AGENTS.md', oldSha: sha('a'), newSha: sha('b'), targetSha: sha('9') }] }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_TARGET_DRIFT') throw new Error(JSON.stringify(out));
out = run({ ...base, entries: [{ path: '.agents/skills/x/new.mjs', oldSha: null, newSha: sha('d'), targetSha: sha('9') }] }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_NEW_PATH_CONFLICT') throw new Error(JSON.stringify(out));
out = run({ ...base, targetBranch: 'main' }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_PROTECTED_BRANCH') throw new Error(JSON.stringify(out));
out = run({ ...base, targetBranch: 'refs/heads/main' }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_PROTECTED_BRANCH') throw new Error(JSON.stringify(out));
out = run({ ...base, targetBranch: 'refs/heads/chore/foundation-dev38-sync' });
if (out.targetBranch !== 'chore/foundation-dev38-sync') throw new Error(JSON.stringify(out));
out = run({ ...base, entries: [{ path: 'AGENTS.local.md', oldSha: sha('a'), newSha: sha('b'), targetSha: sha('a') }] }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_PATH_OUTSIDE_SHARED_SURFACE') throw new Error(JSON.stringify(out));
out = run({ ...base, entries: [base.entries[0], base.entries[0]] }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_DUPLICATE_PATH') throw new Error(JSON.stringify(out));
out = run({ ...base, targetHead: 'bad' }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_TARGET_HEAD_INVALID') throw new Error(JSON.stringify(out));
out = run({ ...base, entries: [{ path: '.agents/skills/x/new.mjs', oldSha: null, newSha: sha('d'), targetSha: sha('d') }] });
if (out.counts.planned !== 0 || out.counts.unchanged !== 1) throw new Error(JSON.stringify(out));
out = run({ ...base, fromVersion: base.sourceVersion }, 2);
if (out.code !== 'FOUNDATION_REMOTE_PLAN_VERSION_NOT_ADVANCED') throw new Error(JSON.stringify(out));

console.log('foundation-remote-update-plan selftest: PASS');

#!/usr/bin/env node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const watcherArg = process.argv[2];
if (!watcherArg) throw new Error('watcher path required');
const watcher = resolve(watcherArg);
const root = await mkdtemp(join(tmpdir(), 'stagnation-watch-selftest-'));

function cmd(command, args, cwd = root) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${command} failed: ${r.stderr}`);
  return r.stdout.trim();
}
cmd('git', ['init']);
cmd('git', ['config', 'user.email', 'test@example.com']);
cmd('git', ['config', 'user.name', 'Test']);
cmd('git', ['checkout', '-b', 'feat/test']);
await writeFile(join(root, 'app.txt'), 'v1\n');
await writeFile(join(root, 'AGENTS.md'), 'governance\n');
cmd('git', ['add', '.']);
cmd('git', ['commit', '-m', 'base']);

function run(extra, expectStatus = 0) {
  const args = [
    watcher,
    '--target-root', root,
    '--work-id', 'issue-1',
    '--gate-phase', 'test-gate',
    '--work-state', 'incomplete',
    '--human-gate', 'none',
    '--continuation-action', 'resume',
    '--workflow-status', 'failed',
    '--pr-state', 'none',
    '--failure-signature', 'same-fail',
    '--route-signature', 'route-a',
    '--interval-minutes', '60',
    ...extra,
  ];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (r.status !== expectStatus) throw new Error(`status ${r.status}, expected ${expectStatus}: ${r.stdout} ${r.stderr}`);
  return JSON.parse(r.stdout);
}

let out = run(['--now', '2026-09-03T10:00:00Z']);
if (out.code !== 'STAGNATION_BASELINE_CREATED') throw new Error(JSON.stringify(out));
out = run(['--now', '2026-09-03T10:59:00Z']);
if (out.code !== 'STAGNATION_CHECKPOINT_NOT_DUE') throw new Error(JSON.stringify(out));
out = run(['--now', '2026-09-03T11:00:00Z'], 2);
if (out.code !== 'STAGNATION_L1_ROOT_CAUSE_REQUIRED' || out.nextState.unchangedCheckpoints !== 1) throw new Error(JSON.stringify(out));
out = run(['--now', '2026-09-03T12:00:00Z'], 2);
if (out.code !== 'STAGNATION_L2_FORCED_REFLECTION_REQUIRED' || out.nextState.unchangedCheckpoints !== 2) throw new Error(JSON.stringify(out));
out = run(['--now', '2026-09-03T13:00:00Z'], 2);
if (out.code !== 'STAGNATION_HARD_STOP_ROUTE_CHANGE_REQUIRED' || out.nextState.unchangedCheckpoints !== 3) throw new Error(JSON.stringify(out));

await writeFile(join(root, 'app.txt'), 'v2\n');
out = run(['--now', '2026-09-03T13:01:00Z']);
if (out.code !== 'MEANINGFUL_PROGRESS_DETECTED' || out.nextState.unchangedCheckpoints !== 0) throw new Error(JSON.stringify(out));

// Governance-only edits do not count as product progress in product scope.
await writeFile(join(root, 'AGENTS.md'), 'governance changed\n');
out = run(['--now', '2026-09-03T14:01:00Z'], 2);
if (out.code !== 'STAGNATION_L1_ROOT_CAUSE_REQUIRED') throw new Error(JSON.stringify(out));

// A governance-only commit changes HEAD but must not count as product progress.
cmd('git', ['add', 'AGENTS.md']);
cmd('git', ['commit', '-m', 'governance only']);
out = run(['--now', '2026-09-03T15:01:00Z'], 2);
if (out.code !== 'STAGNATION_L2_FORCED_REFLECTION_REQUIRED') throw new Error(JSON.stringify(out));

// New observation resets stagnation even without product diff changes.
out = run(['--now', '2026-09-03T15:02:00Z', '--observation-signature', 'new-root-cause']);
if (out.code !== 'MEANINGFUL_PROGRESS_DETECTED') throw new Error(JSON.stringify(out));

// Active execution is not counted as stagnation.
out = run(['--now', '2026-09-03T19:02:00Z', '--workflow-status', 'in-progress']);
if (out.code !== 'ACTIVE_EXECUTION_IN_PROGRESS') throw new Error(JSON.stringify(out));

// Status-only response on safe incomplete work is forbidden.
out = run(['--now', '2026-09-03T19:03:00Z', '--continuation-action', 'report-only'], 2);
if (out.code !== 'SAFE_WORK_CONTINUATION_REQUIRED') throw new Error(JSON.stringify(out));

// Waiting is valid only at a genuine human gate.
out = run([
  '--now', '2026-09-03T19:04:00Z',
  '--human-gate', 'required',
  '--continuation-action', 'wait-human',
]);
if (out.code !== 'WAITING_AT_VALID_HUMAN_GATE' || out.result !== 'WAIT_HUMAN') throw new Error(JSON.stringify(out));
out = run(['--now', '2026-09-03T19:05:00Z', '--continuation-action', 'wait-human'], 2);
if (out.code !== 'UNNECESSARY_HUMAN_WAIT') throw new Error(JSON.stringify(out));

// A missed 3-hour window escalates directly to HARD_STOP on the next checkpoint.
const statePath = join(root, '.git', 'ai-dev-foundation', 'stagnation', 'issue-2.json');
const baseline2 = spawnSync(process.execPath, [
  watcher, '--target-root', root, '--work-id', 'issue-2', '--gate-phase', 'test-gate',
  '--work-state', 'incomplete', '--human-gate', 'none', '--continuation-action', 'resume',
  '--workflow-status', 'failed', '--pr-state', 'none', '--failure-signature', 'same-fail',
  '--route-signature', 'route-a', '--interval-minutes', '60', '--now', '2026-09-03T10:00:00Z',
], { encoding: 'utf8' });
if (baseline2.status !== 0) throw new Error(baseline2.stdout);
const jumped = spawnSync(process.execPath, [
  watcher, '--target-root', root, '--work-id', 'issue-2', '--gate-phase', 'test-gate',
  '--work-state', 'incomplete', '--human-gate', 'none', '--continuation-action', 'resume',
  '--workflow-status', 'failed', '--pr-state', 'none', '--failure-signature', 'same-fail',
  '--route-signature', 'route-a', '--interval-minutes', '60', '--now', '2026-09-03T13:01:00Z',
], { encoding: 'utf8' });
if (jumped.status !== 2 || !jumped.stdout.includes('STAGNATION_HARD_STOP_ROUTE_CHANGE_REQUIRED')) throw new Error(jumped.stdout);
const persisted = JSON.parse(await readFile(statePath, 'utf8'));
if (persisted.unchangedCheckpoints < 3) throw new Error('missed-window checkpoints not persisted');

// Remote-only callers can round-trip state as JSON without local writes.
const remoteBase = spawnSync(process.execPath, [
  watcher, '--target-root', root, '--work-id', 'remote-1', '--gate-phase', 'audit',
  '--work-state', 'incomplete', '--human-gate', 'none', '--continuation-action', 'resume',
  '--workflow-status', 'failed', '--pr-state', 'none', '--failure-signature', 'x',
  '--route-signature', 'r', '--interval-minutes', '60', '--now', '2026-09-03T10:00:00Z', '--no-write',
], { encoding: 'utf8' });
if (remoteBase.status !== 0) throw new Error(remoteBase.stdout);
const remoteState = JSON.parse(remoteBase.stdout).nextState;
const remoteNext = spawnSync(process.execPath, [
  watcher, '--target-root', root, '--work-id', 'remote-1', '--gate-phase', 'audit',
  '--work-state', 'incomplete', '--human-gate', 'none', '--continuation-action', 'resume',
  '--workflow-status', 'failed', '--pr-state', 'none', '--failure-signature', 'x',
  '--route-signature', 'r', '--interval-minutes', '60', '--now', '2026-09-03T11:00:00Z',
  '--state-json', JSON.stringify(remoteState), '--no-write',
], { encoding: 'utf8' });
if (remoteNext.status !== 2 || !remoteNext.stdout.includes('STAGNATION_L1_ROOT_CAUSE_REQUIRED')) throw new Error(remoteNext.stdout);

console.log('stagnation-watch selftest: PASS');

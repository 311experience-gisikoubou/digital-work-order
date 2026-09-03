#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const i = args.lastIndexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
function hasFlag(name) { return args.includes(name); }
function stop(message, code = 'STAGNATION_WATCH_INVALID_INPUT') {
  const output = { result: 'STOP', code, message };
  console.log(JSON.stringify(output));
  process.exit(2);
}
function git(cwd, gitArgs, { allowFailure = false } = {}) {
  const r = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' });
  if (r.status !== 0 && !allowFailure) {
    stop(`git ${gitArgs.join(' ')} failed: ${r.stderr.trim()}`, 'STAGNATION_WATCH_GIT_FAILED');
  }
  return r;
}
function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}
function normalizePath(value) { return value.replaceAll('\\', '/'); }
function isGovernancePath(path) {
  const p = normalizePath(path);
  return p === 'AGENTS.md'
    || p === 'AGENTS.local.md'
    || p === 'CURRENT_STATUS.md'
    || p.startsWith('.agents/')
    || p.startsWith('.claude/')
    || p.startsWith('.github/');
}

const targetRoot = resolve(argValue('--target-root', process.cwd()));
const workId = argValue('--work-id').trim();
const gatePhase = argValue('--gate-phase', 'unknown').trim();
const blockerSignature = argValue('--blocker-signature', '').trim();
const failureSignature = argValue('--failure-signature', '').trim();
const observationSignature = argValue('--observation-signature', '').trim();
const routeSignature = argValue('--route-signature', '').trim();
const prState = argValue('--pr-state', 'unknown').trim().toLowerCase();
const workflowStatus = argValue('--workflow-status', 'unknown').trim().toLowerCase();
const workState = argValue('--work-state').trim().toLowerCase();
const humanGate = argValue('--human-gate').trim().toLowerCase();
const continuationAction = argValue('--continuation-action').trim().toLowerCase();
const fingerprintScope = argValue('--fingerprint-scope', 'product').trim().toLowerCase();
const intervalMinutesRaw = argValue('--interval-minutes', '60').trim();
const nowRaw = argValue('--now', '').trim();
const inputStateJson = argValue('--state-json', '').trim();
const noWrite = hasFlag('--no-write');

if (!workId) stop('--work-id is required');
if (!['complete', 'incomplete'].includes(workState)) stop('--work-state must be complete|incomplete');
if (!['none', 'required'].includes(humanGate)) stop('--human-gate must be none|required');
if (!['resume', 'report-only', 'wait-human'].includes(continuationAction)) {
  stop('--continuation-action must be resume|report-only|wait-human');
}
if (!['product', 'all'].includes(fingerprintScope)) stop('--fingerprint-scope must be product|all');
if (!['none', 'open', 'ready', 'merged', 'closed', 'unknown'].includes(prState)) stop('--pr-state invalid');
if (!['idle', 'in-progress', 'passed', 'failed', 'cancelled', 'unknown'].includes(workflowStatus)) {
  stop('--workflow-status invalid');
}
const intervalMinutes = Number(intervalMinutesRaw);
if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) stop('--interval-minutes must be > 0');
const intervalMs = intervalMinutes * 60_000;
const now = nowRaw ? Date.parse(nowRaw) : Date.now();
if (!Number.isFinite(now)) stop('--now must be ISO-8601 parseable');

const rootCheck = git(targetRoot, ['rev-parse', '--show-toplevel']);
const gitRoot = resolve(rootCheck.stdout.trim());
if (gitRoot !== targetRoot) stop('--target-root must be repository root', 'STAGNATION_WATCH_TARGET_NOT_REPO_ROOT');

const branch = git(targetRoot, ['branch', '--show-current']).stdout.trim();
if (!branch) stop('detached HEAD is not supported', 'STAGNATION_WATCH_DETACHED_HEAD');
const headSha = git(targetRoot, ['rev-parse', 'HEAD']).stdout.trim();

const diff = git(targetRoot, ['diff', '--binary', 'HEAD', '--', '.']).stdout;
const untrackedRaw = git(targetRoot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout;
const untracked = untrackedRaw.split('\0').filter(Boolean).map(normalizePath).sort();
const treeRaw = git(targetRoot, ['ls-tree', '-r', '-z', 'HEAD']).stdout;
const treeEntries = treeRaw.split('\0').filter(Boolean);

const material = [];
for (const entry of treeEntries) {
  const tab = entry.indexOf('\t');
  if (tab < 0) continue;
  const meta = entry.slice(0, tab);
  const path = normalizePath(entry.slice(tab + 1));
  if (fingerprintScope === 'product' && isGovernancePath(path)) continue;
  material.push(`tree:${meta}:${path}`);
}
for (const path of untracked) {
  if (fingerprintScope === 'product' && isGovernancePath(path)) continue;
  try {
    const bytes = await readFile(join(targetRoot, path));
    material.push(`untracked:${path}:${sha(bytes)}`);
  } catch {
    material.push(`untracked:${path}:unreadable`);
  }
}
let filteredDiff = diff;
if (fingerprintScope === 'product') {
  const names = git(targetRoot, ['diff', '--name-only', 'HEAD', '--', '.']).stdout
    .split(/\r?\n/).filter(Boolean).map(normalizePath)
    .filter((p) => !isGovernancePath(p));
  const chunks = [];
  for (const path of names.sort()) {
    chunks.push(git(targetRoot, ['diff', '--binary', 'HEAD', '--', path]).stdout);
  }
  filteredDiff = chunks.join('\n');
}
material.push(`diff:${sha(filteredDiff)}`);
const productTreeHash = sha(material.sort().join('\n'));

const fingerprintObject = {
  branch,
  productTreeHash,
  gatePhase,
  blockerSignature,
  failureSignature,
  observationSignature,
  routeSignature,
  prState,
  workflowStatus: workflowStatus === 'in-progress' ? 'in-progress' : workflowStatus,
};
const fingerprint = sha(JSON.stringify(fingerprintObject));

const safeWorkId = workId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'work';
const defaultStateFile = join(targetRoot, '.git', 'ai-dev-foundation', 'stagnation', `${safeWorkId}.json`);
const stateFile = resolve(argValue('--state-file', defaultStateFile));

let previous = null;
if (inputStateJson) {
  try { previous = JSON.parse(inputStateJson); } catch { stop('--state-json invalid JSON'); }
} else {
  try { previous = JSON.parse(await readFile(stateFile, 'utf8')); } catch { previous = null; }
}

const isoNow = new Date(now).toISOString();
const baseState = {
  schema: 'ai-stagnation-state-v1',
  workId,
  fingerprint,
  fingerprintObject,
  lastMeaningfulProgressAt: isoNow,
  lastCheckpointAt: isoNow,
  unchangedCheckpoints: 0,
  level: 'CLEAR',
  requiredAction: 'continue',
  updatedAt: isoNow,
};

let result = 'PROCEED';
let code = 'STAGNATION_BASELINE_CREATED';
let nextState = baseState;
let detail = {};

if (workState === 'complete') {
  result = 'COMPLETE';
  code = 'WORK_COMPLETE';
  nextState = { ...baseState, level: 'COMPLETE', requiredAction: 'none' };
} else if (humanGate === 'required') {
  if (continuationAction !== 'wait-human') {
    result = 'STOP';
    code = 'HUMAN_GATE_REQUIRED';
    nextState = previous ?? baseState;
  } else {
    result = 'WAIT_HUMAN';
    code = 'WAITING_AT_VALID_HUMAN_GATE';
    nextState = {
      ...(previous ?? baseState),
      workId,
      lastCheckpointAt: isoNow,
      updatedAt: isoNow,
      level: 'WAIT_HUMAN',
      requiredAction: 'wait-human',
    };
  }
} else if (continuationAction === 'wait-human') {
  result = 'STOP';
  code = 'UNNECESSARY_HUMAN_WAIT';
  nextState = previous ?? baseState;
} else if (continuationAction === 'report-only') {
  result = 'STOP';
  code = 'SAFE_WORK_CONTINUATION_REQUIRED';
  nextState = previous ?? baseState;
} else if (workflowStatus === 'in-progress') {
  result = 'PROCEED';
  code = 'ACTIVE_EXECUTION_IN_PROGRESS';
  nextState = {
    ...(previous ?? baseState),
    workId,
    fingerprint,
    fingerprintObject,
    updatedAt: isoNow,
    level: previous?.level ?? 'CLEAR',
    requiredAction: 'continue-active-execution',
  };
} else if (!previous || previous.schema !== 'ai-stagnation-state-v1' || previous.workId !== workId) {
  result = 'PROCEED';
  code = 'STAGNATION_BASELINE_CREATED';
  nextState = baseState;
} else if (previous.fingerprint !== fingerprint) {
  result = 'PROCEED';
  code = 'MEANINGFUL_PROGRESS_DETECTED';
  nextState = baseState;
  detail = { previousFingerprint: previous.fingerprint };
} else {
  const lastCheckpointMs = Date.parse(previous.lastCheckpointAt || previous.updatedAt || previous.lastMeaningfulProgressAt);
  const elapsedMs = Number.isFinite(lastCheckpointMs) ? Math.max(0, now - lastCheckpointMs) : intervalMs;
  const dueCheckpoints = Math.floor(elapsedMs / intervalMs);
  if (dueCheckpoints < 1) {
    result = 'PROCEED';
    code = 'STAGNATION_CHECKPOINT_NOT_DUE';
    nextState = { ...previous, updatedAt: isoNow };
    detail = { minutesUntilNextCheckpoint: Math.ceil((intervalMs - elapsedMs) / 60_000) };
  } else {
    const unchangedCheckpoints = Math.min(999, Number(previous.unchangedCheckpoints || 0) + dueCheckpoints);
    let level = 'L1';
    let requiredAction = 'root-cause-analysis';
    code = 'STAGNATION_L1_ROOT_CAUSE_REQUIRED';
    if (unchangedCheckpoints >= 3) {
      level = 'HARD_STOP';
      requiredAction = 'route-reselection';
      code = 'STAGNATION_HARD_STOP_ROUTE_CHANGE_REQUIRED';
    } else if (unchangedCheckpoints >= 2) {
      level = 'L2';
      requiredAction = 'forced-reflection';
      code = 'STAGNATION_L2_FORCED_REFLECTION_REQUIRED';
    }
    result = 'STOP';
    nextState = {
      ...previous,
      fingerprint,
      fingerprintObject,
      lastCheckpointAt: isoNow,
      unchangedCheckpoints,
      level,
      requiredAction,
      updatedAt: isoNow,
    };
    detail = { dueCheckpoints, elapsedMinutes: Math.floor(elapsedMs / 60_000) };
  }
}

if (!noWrite && !inputStateJson) {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

const output = {
  result,
  code,
  workId,
  branch,
  headSha,
  productTreeHash,
  fingerprintScope,
  gatePhase,
  blockerSignature: blockerSignature || null,
  failureSignature: failureSignature || null,
  observationSignature: observationSignature || null,
  routeSignature: routeSignature || null,
  prState,
  workflowStatus,
  workState,
  humanGate,
  continuationAction,
  intervalMinutes,
  stateFile: inputStateJson ? null : stateFile,
  nextState,
  ...detail,
};
console.log(JSON.stringify(output));
process.exit(result === 'STOP' ? 2 : 0);

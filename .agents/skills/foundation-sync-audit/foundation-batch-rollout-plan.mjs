#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const args = process.argv.slice(2);
const here = dirname(fileURLToPath(import.meta.url));
const singlePlanner = join(here, 'foundation-remote-update-plan.mjs');

function argValue(name, fallback = '') {
  const i = args.lastIndexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}
function stop(code, detail = {}) {
  console.log(JSON.stringify({ result: 'STOP', code, ...detail }));
  process.exit(2);
}
function isSha(value) { return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value); }
function gitBlobSha(content) {
  const body = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
}
function normalizePath(value) {
  if (typeof value !== 'string') return '';
  const p = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || p.includes('/../') || p.startsWith('../') || p.endsWith('/..') || p.includes('//')) return '';
  return p;
}
function isCanonicalPath(path) {
  return path === 'AGENTS.md' || path.startsWith('.agents/skills/') || path.startsWith('.claude/skills/');
}
function normalizeBranch(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^refs\/heads\//, '');
}
function isRepository(value) { return typeof value === 'string' && /^[^/\s]+\/[^/\s]+$/.test(value); }
function parseSinglePlannerOutput(run, repository) {
  let parsed;
  try { parsed = JSON.parse(run.stdout || '{}'); }
  catch {
    stop('FOUNDATION_BATCH_SINGLE_PLAN_INVALID_OUTPUT', { repository, exitCode: run.status, stderr: (run.stderr || '').trim() || null });
  }
  if (run.status !== 0 || parsed?.result !== 'PASS') {
    stop('FOUNDATION_BATCH_SINGLE_PLAN_STOP', { repository, singlePlan: parsed ?? null, exitCode: run.status });
  }
  return parsed;
}

let raw = argValue('--manifest-json');
const manifestPath = argValue('--manifest');
if (raw && manifestPath) stop('FOUNDATION_BATCH_INPUT_AMBIGUOUS');
if (!raw && manifestPath) {
  try { raw = await readFile(manifestPath, 'utf8'); }
  catch (error) { stop('FOUNDATION_BATCH_MANIFEST_READ_FAILED', { message: String(error?.message || error) }); }
}
if (!raw && !process.stdin.isTTY) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  raw = Buffer.concat(chunks).toString('utf8');
}
if (!raw) stop('FOUNDATION_BATCH_MANIFEST_REQUIRED');

let manifest;
try { manifest = JSON.parse(raw); }
catch { stop('FOUNDATION_BATCH_MANIFEST_INVALID_JSON'); }

const { schemaVersion, release, targets } = manifest ?? {};
if (schemaVersion !== 1) stop('FOUNDATION_BATCH_SCHEMA_UNSUPPORTED', { schemaVersion: schemaVersion ?? null });
const { fromVersion, sourceVersion, fromCommit, sourceCommit, entries } = release ?? {};
if (typeof fromVersion !== 'string' || !fromVersion.trim()) stop('FOUNDATION_BATCH_FROM_VERSION_REQUIRED');
if (typeof sourceVersion !== 'string' || !sourceVersion.trim()) stop('FOUNDATION_BATCH_SOURCE_VERSION_REQUIRED');
if (fromVersion === sourceVersion) stop('FOUNDATION_BATCH_VERSION_NOT_ADVANCED', { version: sourceVersion });
if (!isSha(fromCommit)) stop('FOUNDATION_BATCH_FROM_COMMIT_INVALID');
if (!isSha(sourceCommit)) stop('FOUNDATION_BATCH_SOURCE_COMMIT_INVALID');
if (fromCommit === sourceCommit) stop('FOUNDATION_BATCH_SOURCE_COMMIT_NOT_ADVANCED');
if (!Array.isArray(entries) || entries.length === 0) stop('FOUNDATION_BATCH_RELEASE_ENTRIES_REQUIRED');
if (entries.length > 1000) stop('FOUNDATION_BATCH_RELEASE_ENTRIES_TOO_MANY', { count: entries.length });
if (!Array.isArray(targets) || targets.length === 0) stop('FOUNDATION_BATCH_TARGETS_REQUIRED');
if (targets.length > 100) stop('FOUNDATION_BATCH_TARGETS_TOO_MANY', { count: targets.length });

const releasePaths = new Set();
const releaseEntries = entries.map((entry) => {
  const path = normalizePath(entry?.path);
  if (!path || !isCanonicalPath(path) || path === 'AGENTS.local.md') stop('FOUNDATION_BATCH_PATH_OUTSIDE_SHARED_SURFACE', { path: entry?.path ?? null });
  if (releasePaths.has(path)) stop('FOUNDATION_BATCH_DUPLICATE_RELEASE_PATH', { path });
  releasePaths.add(path);
  const oldSha = entry?.oldSha ?? null;
  const newSha = entry?.newSha ?? null;
  for (const [field, value] of [['oldSha', oldSha], ['newSha', newSha]]) {
    if (value !== null && !isSha(value)) stop('FOUNDATION_BATCH_RELEASE_SHA_INVALID', { path, field });
  }
  if (oldSha === null && newSha === null) stop('FOUNDATION_BATCH_EMPTY_RELEASE_ENTRY', { path });
  if (oldSha === newSha) stop('FOUNDATION_BATCH_UNCHANGED_RELEASE_ENTRY', { path });
  const hasNewContent = Object.prototype.hasOwnProperty.call(entry ?? {}, 'newContent');
  if (hasNewContent) {
    if (newSha === null || typeof entry.newContent !== 'string') stop('FOUNDATION_BATCH_SOURCE_CONTENT_INVALID', { path });
    const calculatedSha = gitBlobSha(entry.newContent);
    if (calculatedSha !== newSha) stop('FOUNDATION_BATCH_SOURCE_CONTENT_SHA_MISMATCH', { path, expectedNewSha: newSha, calculatedSha });
  }
  return { path, oldSha, newSha, ...(hasNewContent ? { newContent: entry.newContent } : {}) };
});

const seenTargets = new Set();
const plannedTargets = [];
let currentCount = 0;
let updateCount = 0;
let partialCount = 0;
let branchRequiredCount = 0;
let readyPlanCount = 0;

for (const target of targets) {
  const repository = target?.repository;
  const branch = normalizeBranch(target?.branch);
  const head = target?.head;
  const baseTree = target?.baseTree;
  const targetShas = target?.targetShas;
  if (!isRepository(repository)) stop('FOUNDATION_BATCH_TARGET_REPOSITORY_INVALID', { repository: repository ?? null });
  if (!branch) stop('FOUNDATION_BATCH_TARGET_BRANCH_REQUIRED', { repository });
  if (!isSha(head)) stop('FOUNDATION_BATCH_TARGET_HEAD_INVALID', { repository });
  if (!isSha(baseTree)) stop('FOUNDATION_BATCH_TARGET_BASE_TREE_INVALID', { repository });
  if (!targetShas || typeof targetShas !== 'object' || Array.isArray(targetShas)) stop('FOUNDATION_BATCH_TARGET_SHAS_REQUIRED', { repository });
  const targetKey = repository;
  if (seenTargets.has(targetKey)) stop('FOUNDATION_BATCH_DUPLICATE_TARGET', { repository, branch });
  seenTargets.add(targetKey);

  const pendingEntries = [];
  const currentPaths = [];
  for (const entry of releaseEntries) {
    if (!Object.prototype.hasOwnProperty.call(targetShas, entry.path)) stop('FOUNDATION_BATCH_TARGET_PATH_EVIDENCE_MISSING', { repository, path: entry.path });
    const targetSha = targetShas[entry.path];
    if (targetSha !== null && !isSha(targetSha)) stop('FOUNDATION_BATCH_TARGET_SHA_INVALID', { repository, path: entry.path });
    if (targetSha === entry.newSha) {
      currentPaths.push(entry.path);
      continue;
    }
    if (targetSha === entry.oldSha) {
      pendingEntries.push({ ...entry, targetSha });
      continue;
    }
    stop('FOUNDATION_BATCH_TARGET_DRIFT', {
      repository, branch, path: entry.path, expectedOldSha: entry.oldSha, expectedNewSha: entry.newSha, targetSha,
    });
  }

  if (pendingEntries.length === 0) {
    currentCount += 1;
    plannedTargets.push({
      repository, branch, head, baseTree, state: 'CURRENT', action: 'NONE',
      counts: { releaseEntries: releaseEntries.length, current: currentPaths.length, pending: 0 },
    });
    continue;
  }

  const partial = currentPaths.length > 0;
  if (partial) partialCount += 1;
  else updateCount += 1;
  const state = partial ? 'PARTIAL_RESUME' : 'UPDATE';
  const protectedBranch = branch === 'main' || branch === 'master';
  if (protectedBranch) {
    branchRequiredCount += 1;
    plannedTargets.push({
      repository, branch, head, baseTree, state, action: 'CREATE_FEATURE_BRANCH', branchFromSha: head,
      counts: { releaseEntries: releaseEntries.length, current: currentPaths.length, pending: pendingEntries.length },
      pendingPaths: pendingEntries.map((entry) => entry.path),
    });
    continue;
  }

  const singleManifest = {
    fromVersion, sourceVersion, fromCommit, sourceCommit,
    targetRepository: repository, targetBranch: branch, targetHead: head, targetBaseTree: baseTree,
    entries: pendingEntries,
  };
  const run = spawnSync(process.execPath, [singlePlanner, '--manifest-json', JSON.stringify(singleManifest)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (run.error) stop('FOUNDATION_BATCH_SINGLE_PLAN_EXEC_FAILED', { repository, message: String(run.error?.message || run.error) });
  const remotePlan = parseSinglePlannerOutput(run, repository);
  readyPlanCount += 1;
  plannedTargets.push({
    repository, branch, head, baseTree, state, action: 'APPLY_REMOTE_PLAN',
    counts: { releaseEntries: releaseEntries.length, current: currentPaths.length, pending: pendingEntries.length },
    pendingPaths: pendingEntries.map((entry) => entry.path), remotePlan,
  });
}

const output = {
  result: 'PASS',
  code: 'FOUNDATION_BATCH_ROLLOUT_PLAN_READY',
  release: { fromVersion, sourceVersion, fromCommit, sourceCommit, changedPaths: releaseEntries.length },
  counts: {
    targets: targets.length, current: currentCount, update: updateCount, partialResume: partialCount,
    branchRequired: branchRequiredCount, readyPlans: readyPlanCount,
  },
  targets: plannedTargets,
  contract: {
    createFeatureBranchesOnlyForAction: 'CREATE_FEATURE_BRANCH',
    rerunPlannerAfterBranchCreation: true,
    applyOnlyAction: 'APPLY_REMOTE_PLAN',
    postWriteFullSyncAuditRequired: true,
    applicationPrMergeAuthorizationRequired: true,
  },
};
console.log(JSON.stringify(output, null, 2));

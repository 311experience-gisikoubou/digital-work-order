#!/usr/bin/env node
// Read-only: proves a specific committed change set matches a specific final
// receipt's claims (parent, head, changed paths) and that the receipt itself
// independently verifies MERGE_READY via the existing final-receipt verifier.
// This does NOT prove who historically wrote the commit and does NOT
// authorize a merge; it only binds one commit to one qualified-agent receipt.
import { spawnSync } from 'node:child_process';
import { verifyFinalReceipt } from './implementation-route-receipt.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;

function safeToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value);
}

function stop(code, extra = {}) {
  return { schemaVersion: 1, result: 'STOP', code, ...extra };
}

function runGit(repoRoot, args, timeoutMs = 10000) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024,
  });
}

// --name-status -z yields alternating NUL-terminated (status, path) tokens;
// --no-renames guarantees each status is a single letter, never a
// rename/copy score suffix, so no dual-path ambiguity exists here.
function parseNameStatusZ(stdout) {
  const tokens = String(stdout || '').split('\0').filter((token) => token.length > 0);
  const paths = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const filePath = tokens[i + 1];
    if (filePath === undefined) break;
    paths.push(filePath);
  }
  return paths;
}

function sortedUnique(paths) {
  return [...new Set(paths)].sort();
}

function pathsEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function verifyQualifiedCommitReceipt({ repoRoot, repository, commit, receipt }) {
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) return stop('REPO_ROOT_INVALID');
  if (!repository || typeof repository !== 'object' || Array.isArray(repository) ||
      !safeToken(repository.owner) || !safeToken(repository.name)) {
    return stop('REPOSITORY_INVALID');
  }
  if (!SHA_RE.test(commit || '')) return stop('COMMIT_SHA_INVALID');
  const normalizedCommit = commit.toLowerCase();

  if (!receipt || typeof receipt !== 'object' || receipt.result !== 'PASS') return stop('RECEIPT_NOT_PASS');
  if (!receipt.executor || receipt.executor.routeType !== 'qualified-agent') {
    return stop('RECEIPT_ROUTE_TYPE_NOT_QUALIFIED_AGENT');
  }
  if (!receipt.repository || receipt.repository.owner !== repository.owner ||
      receipt.repository.name !== repository.name) {
    return stop('RECEIPT_REPOSITORY_MISMATCH');
  }
  if (receipt.implementationHead !== normalizedCommit) return stop('IMPLEMENTATION_HEAD_MISMATCH');
  if (!receipt.executionEvidence || typeof receipt.executionEvidence !== 'object' ||
      !SHA_RE.test(receipt.executionEvidence.preHead || '')) {
    return stop('EXECUTION_EVIDENCE_PRE_HEAD_INVALID');
  }
  if (!Array.isArray(receipt.executionEvidence.changedPaths)) return stop('EXECUTION_EVIDENCE_CHANGED_PATHS_INVALID');

  const existsCheck = runGit(repoRoot, ['cat-file', '-e', `${normalizedCommit}^{commit}`]);
  if (existsCheck.error || existsCheck.status !== 0) return stop('COMMIT_NOT_FOUND');

  const parentsResult = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', normalizedCommit]);
  if (parentsResult.error || parentsResult.status !== 0) return stop('COMMIT_PARENTS_UNKNOWN');
  const parts = String(parentsResult.stdout || '').trim().split(/\s+/).filter((part) => part.length > 0);
  const parents = parts.slice(1);
  if (parents.length !== 1) return stop('COMMIT_NOT_EXACTLY_ONE_PARENT');
  const actualParent = parents[0].toLowerCase();
  if (!SHA_RE.test(actualParent)) return stop('COMMIT_PARENT_SHA_INVALID');
  if (actualParent !== receipt.executionEvidence.preHead.toLowerCase()) return stop('PARENT_PRE_HEAD_MISMATCH');

  const diffResult = runGit(repoRoot, ['diff', '--name-status', '--no-renames', '-z', actualParent, normalizedCommit]);
  if (diffResult.error || diffResult.status !== 0) return stop('COMMIT_DIFF_UNKNOWN');
  const actualChangedPaths = sortedUnique(parseNameStatusZ(diffResult.stdout));
  const receiptChangedPaths = sortedUnique(receipt.executionEvidence.changedPaths);
  if (!pathsEqual(actualChangedPaths, receiptChangedPaths)) return stop('CHANGED_PATHS_MISMATCH');

  const finalVerification = verifyFinalReceipt(receipt, {
    owner: repository.owner, name: repository.name, branch: receipt.branch, head: normalizedCommit, repoRoot,
  });
  if (!finalVerification || finalVerification.result !== 'MERGE_READY') {
    return stop('FINAL_RECEIPT_VERIFICATION_FAILED', { finalVerification });
  }

  return {
    schemaVersion: 1,
    result: 'QUALIFIED_COMMIT_VERIFIED_NOT_MERGE_AUTHORIZATION',
    code: 'QUALIFIED_COMMIT_VERIFIED_NOT_MERGE_AUTHORIZATION',
    repository: { owner: repository.owner, name: repository.name },
    branch: receipt.branch,
    commit: normalizedCommit,
    parent: actualParent,
    changedPaths: actualChangedPaths,
  };
}

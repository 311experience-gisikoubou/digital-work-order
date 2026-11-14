#!/usr/bin/env node
// Read-only: proves a specific committed change set matches a specific final
// receipt's claims (parent, head, changed paths) and that the receipt itself
// independently verifies MERGE_READY via the existing final-receipt verifier.
// This does NOT prove who historically wrote the commit and does NOT
// authorize a merge; it only binds one commit to one qualified-agent receipt.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyFinalReceipt } from './implementation-route-receipt.mjs';
import {
  computeChangeSetSha256, verifyRepositoryIdentity, verifyFeatureRepository, changedPathsWithinScope,
  readHeadSha, verifyWorktreeClean,
} from './implementation-runner.mjs';
import { validateResearchEnvelopeShape, computeConstraintsDigest } from './research-gate.mjs';
import { verifyCanonicalWrapperMetadataSuffix } from './qualified-docs-suffix-audit.mjs';

const SHA_RE = /^[0-9a-f]{40}$/i;
const CHANGE_SET_SHA256_RE = /^[0-9A-Fa-f]{64}$/;
// The single canonical native-skill wrapper template path this narrow,
// two-commit lineage mode is allowed to bind as the (C) exception's exact
// allowedScope. Fixed here, never caller-widenable.
const WRAPPER_TEMPLATE_PATH = 'templates/.claude/skills/local-ai-handoff/SKILL.md.template';

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

// Shared, read-only git binding check reused by both verifyQualifiedCommitReceipt
// (current-authorization path) and triageHistoricalCommitEvidence (diagnostic-only
// historical path) below, so the actual commit/parent/changed-paths matching logic
// is never duplicated or allowed to silently drift between the two entry points.
// Returns { ok: true, actualParent, actualChangedPaths } or { ok: false, code }.
function verifyCommittedChangeBinding(repoRoot, normalizedCommit, claimedPreHead, claimedChangedPaths) {
  const existsCheck = runGit(repoRoot, ['cat-file', '-e', `${normalizedCommit}^{commit}`]);
  if (existsCheck.error || existsCheck.status !== 0) return { ok: false, code: 'COMMIT_NOT_FOUND' };

  const parentsResult = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', normalizedCommit]);
  if (parentsResult.error || parentsResult.status !== 0) return { ok: false, code: 'COMMIT_PARENTS_UNKNOWN' };
  const parts = String(parentsResult.stdout || '').trim().split(/\s+/).filter((part) => part.length > 0);
  const parents = parts.slice(1);
  if (parents.length !== 1) return { ok: false, code: 'COMMIT_NOT_EXACTLY_ONE_PARENT' };
  const actualParent = parents[0].toLowerCase();
  if (!SHA_RE.test(actualParent)) return { ok: false, code: 'COMMIT_PARENT_SHA_INVALID' };
  if (actualParent !== String(claimedPreHead || '').toLowerCase()) return { ok: false, code: 'PARENT_PRE_HEAD_MISMATCH' };

  const diffResult = runGit(repoRoot, ['diff', '--name-status', '--no-renames', '-z', actualParent, normalizedCommit]);
  if (diffResult.error || diffResult.status !== 0) return { ok: false, code: 'COMMIT_DIFF_UNKNOWN' };
  const actualChangedPaths = sortedUnique(parseNameStatusZ(diffResult.stdout));
  const claimedChangedPathsSorted = sortedUnique(claimedChangedPaths);
  if (!pathsEqual(actualChangedPaths, claimedChangedPathsSorted)) return { ok: false, code: 'CHANGED_PATHS_MISMATCH' };

  return { ok: true, actualParent, actualChangedPaths };
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

  const binding = verifyCommittedChangeBinding(
    repoRoot, normalizedCommit, receipt.executionEvidence.preHead, receipt.executionEvidence.changedPaths,
  );
  if (!binding.ok) return stop(binding.code);
  const { actualParent, actualChangedPaths } = binding;

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

// Read-only, DIAGNOSTIC-ONLY historical evidence triage. This exists for the
// narrow case where a genuine historic commit's final receipt and matching
// COMPLETED runner result both independently and currently re-verify as
// content-consistent with the actual repository, but the receipt's bound
// research evidence is now aged past its own maxEvidenceAgeMs window, so
// verifyQualifiedCommitReceipt's unmodified verifyFinalReceipt call correctly
// STOPs on CURRENT re-evaluation (it recomputes research freshness against
// the real current clock every time, by design -- see implementation-route-
// receipt.mjs / research-gate.mjs). That STOP is CORRECT and is never
// relaxed, bypassed, or re-decided here, and this function NEVER forges a
// past "now" to manufacture a fresh research PASS for old evidence.
//
// This function instead answers a strictly narrower, read-only question:
// "does the current actual committed change set in this exact repository
// still match what the final receipt claims AND what an actual qualified-
// agent runner result already recorded as COMPLETED, independent of whether
// today's research freshness window has since lapsed?" A positive result is
// explicitly labeled DIAGNOSTIC ONLY, never implies current merge authority,
// and never claims to prove who historically typed the commit: a mutable
// saved JSON receipt/result file and a Git commit timestamp are both
// editable after the fact and are never, by themselves, proof of actual
// Claude authorship. originalWriterProven and currentMergeAuthorized are
// therefore always false on every path, including the positive one.
export function triageHistoricalCommitEvidence({
  repoRoot, repository, commit, finalReceipt, runnerResult, preImplementationReceipt,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) {
    return stop('REPO_ROOT_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!repository || typeof repository !== 'object' || Array.isArray(repository) ||
      !safeToken(repository.owner) || !safeToken(repository.name)) {
    return stop('REPOSITORY_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!SHA_RE.test(commit || '')) return stop('COMMIT_SHA_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  const normalizedCommit = commit.toLowerCase();

  // --- final receipt: shape + identity binding, never its own PASS text alone ---
  if (!finalReceipt || typeof finalReceipt !== 'object' || Array.isArray(finalReceipt)) {
    return stop('FINAL_RECEIPT_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (finalReceipt.result !== 'PASS') return stop('FINAL_RECEIPT_NOT_PASS', { originalWriterProven: false, currentMergeAuthorized: false });
  if (!finalReceipt.executor || finalReceipt.executor.routeType !== 'qualified-agent') {
    return stop('FINAL_RECEIPT_ROUTE_TYPE_NOT_QUALIFIED_AGENT', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!finalReceipt.repository || finalReceipt.repository.owner !== repository.owner ||
      finalReceipt.repository.name !== repository.name) {
    return stop('FINAL_RECEIPT_REPOSITORY_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (finalReceipt.implementationHead !== normalizedCommit) {
    return stop('FINAL_RECEIPT_IMPLEMENTATION_HEAD_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  const finalEvidence = finalReceipt.executionEvidence;
  if (!finalEvidence || typeof finalEvidence !== 'object' || Array.isArray(finalEvidence) ||
      !SHA_RE.test(finalEvidence.preHead || '') ||
      !CHANGE_SET_SHA256_RE.test(finalEvidence.changeSetSha256 || '') ||
      !Array.isArray(finalEvidence.changedPaths)) {
    return stop('FINAL_RECEIPT_EXECUTION_EVIDENCE_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }

  // The research envelope must be WELL-FORMED (shape only). This deliberately
  // never calls evaluateResearchGateBound / blocksSourceWrite: doing so would
  // re-decide the research gate's result against the current clock (exactly
  // what verifyFinalReceipt already does, correctly, and which this function
  // must never duplicate or launder into a fresh PASS for aged evidence).
  const researchShapeErrors = validateResearchEnvelopeShape(finalReceipt.research);
  if (researchShapeErrors.length > 0) {
    return stop('FINAL_RECEIPT_RESEARCH_ENVELOPE_MALFORMED', {
      errors: researchShapeErrors, originalWriterProven: false, currentMergeAuthorized: false,
    });
  }
  if (!Array.isArray(finalReceipt.allowedScope) || finalReceipt.allowedScope.length === 0 ||
      !finalReceipt.allowedScope.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    return stop('FINAL_RECEIPT_ALLOWED_SCOPE_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }

  // The research envelope's raw evidenceBinding must be bound EXACTLY to this
  // final receipt's own task/repository/scope and to its own research.context
  // proposal/constraints/digest. validateResearchEnvelopeShape above only
  // confirms gross shape (evidence is an object; context is well-formed); it
  // never confirms evidenceBinding's substantive identity fields, so without
  // this an unrelated repository/task/scope could otherwise be swapped into
  // evidenceBinding while finalReceipt's own top-level fields still look
  // correct. This is diagnostic re-verification only and never re-decides
  // research freshness/outcome -- that stays exclusively verifyFinalReceipt's
  // job, unmodified, and current human top conditions stay governed only by
  // validateResearchContextShape (via validateResearchEnvelopeShape above),
  // untouched here.
  const researchContext = finalReceipt.research.context;
  const evidenceBinding = finalReceipt.research.evidence && typeof finalReceipt.research.evidence === 'object'
    ? finalReceipt.research.evidence.evidenceBinding
    : undefined;
  if (!evidenceBinding || typeof evidenceBinding !== 'object' || Array.isArray(evidenceBinding)) {
    return stop('FINAL_RECEIPT_RESEARCH_EVIDENCE_BINDING_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!safeToken(evidenceBinding.taskId) || evidenceBinding.taskId !== finalReceipt.taskId) {
    return stop('RESEARCH_EVIDENCE_BINDING_TASK_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  const bindingRepository = evidenceBinding.repository;
  if (!bindingRepository || typeof bindingRepository !== 'object' || Array.isArray(bindingRepository) ||
      bindingRepository.owner !== repository.owner || bindingRepository.name !== repository.name) {
    return stop('RESEARCH_EVIDENCE_BINDING_REPOSITORY_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!Array.isArray(evidenceBinding.scope) ||
      !pathsEqual(sortedUnique(evidenceBinding.scope), sortedUnique(finalReceipt.allowedScope))) {
    return stop('RESEARCH_EVIDENCE_BINDING_SCOPE_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (typeof evidenceBinding.proposalId !== 'string' || evidenceBinding.proposalId !== researchContext.proposalId) {
    return stop('RESEARCH_EVIDENCE_BINDING_PROPOSAL_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!Array.isArray(evidenceBinding.constraints) || !Array.isArray(researchContext.constraints) ||
      !pathsEqual(sortedUnique(evidenceBinding.constraints), sortedUnique(researchContext.constraints))) {
    return stop('RESEARCH_EVIDENCE_BINDING_CONSTRAINTS_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!CHANGE_SET_SHA256_RE.test(evidenceBinding.constraintsDigestSha256 || '') ||
      computeConstraintsDigest(evidenceBinding.constraints).toUpperCase() !== String(evidenceBinding.constraintsDigestSha256).toUpperCase()) {
    return stop('RESEARCH_EVIDENCE_BINDING_DIGEST_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }

  // --- branch: reuse the existing runner helper to bind the actual current
  // local branch to exactly what the final receipt claims, instead of
  // trusting finalReceipt.branch on text alone.
  const branchCheck = verifyFeatureRepository(repoRoot, finalReceipt.branch);
  if (!branchCheck.ok) return stop(branchCheck.code, { originalWriterProven: false, currentMergeAuthorized: false });

  // --- original pre-implementation receipt, if supplied: distinguished from the final receipt, never trusted on text alone ---
  let preImplementationReceiptSummary = null;
  if (preImplementationReceipt !== undefined) {
    if (!preImplementationReceipt || typeof preImplementationReceipt !== 'object' || Array.isArray(preImplementationReceipt)) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    // A genuine pre-implementation receipt is produced BEFORE any commit
    // exists: it always carries result 'PROCEED' and a null implementationHead
    // (see decide() in implementation-route-receipt.mjs). A caller supplying a
    // relabeled final receipt here -- to manufacture two independent-looking
    // "PASS" artifacts out of one single actual event -- is rejected rather
    // than silently accepted as if it were a distinct earlier step.
    if (preImplementationReceipt.result !== 'PROCEED') {
      return stop('PRE_IMPLEMENTATION_RECEIPT_NOT_PROCEED', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (preImplementationReceipt.implementationHead !== null) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_IMPLEMENTATION_HEAD_FORBIDDEN', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (preImplementationReceipt.executionEvidence !== null) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_EXECUTION_EVIDENCE_FORBIDDEN', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (!preImplementationReceipt.executor || preImplementationReceipt.executor.routeType !== finalReceipt.executor.routeType) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_EXECUTOR_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (!preImplementationReceipt.repository || preImplementationReceipt.repository.owner !== repository.owner ||
        preImplementationReceipt.repository.name !== repository.name) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_REPOSITORY_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    // Cross-bound to the exact same task/branch/scope as the final receipt:
    // a genuinely distinct earlier pre-implementation step for THIS task
    // never carries a different task id, a different branch, or a different
    // allowed scope than the final receipt it is supposed to precede.
    if (preImplementationReceipt.taskId !== finalReceipt.taskId) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_TASK_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (preImplementationReceipt.branch !== finalReceipt.branch) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_BRANCH_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    if (!Array.isArray(preImplementationReceipt.allowedScope) ||
        !pathsEqual(sortedUnique(preImplementationReceipt.allowedScope), sortedUnique(finalReceipt.allowedScope))) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_SCOPE_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
    }
    const preResearchShapeErrors = validateResearchEnvelopeShape(preImplementationReceipt.research);
    if (preResearchShapeErrors.length > 0) {
      return stop('PRE_IMPLEMENTATION_RECEIPT_RESEARCH_ENVELOPE_MALFORMED', {
        errors: preResearchShapeErrors, originalWriterProven: false, currentMergeAuthorized: false,
      });
    }
    // Surfaced for the human reader's context only: a well-formed, correctly
    // staged pre-implementation receipt is NEVER treated as additional proof
    // of authorship or of current authorization, and its own 'PROCEED' text
    // is never re-trusted beyond this shape/identity binding.
    preImplementationReceiptSummary = {
      present: true,
      taskId: preImplementationReceipt.taskId ?? null,
      distinctFromFinalReceipt: true,
      trustedBeyondShapeAndIdentityBinding: false,
    };
  }

  // --- runner result: must be an actual COMPLETED execution, matched to the receipt's own claims ---
  if (!runnerResult || typeof runnerResult !== 'object' || Array.isArray(runnerResult)) {
    return stop('RUNNER_RESULT_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (runnerResult.result !== 'COMPLETED') {
    return stop('RUNNER_RESULT_NOT_COMPLETED', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (runnerResult.routeId !== 'claude-implementation-write') {
    return stop('RUNNER_RESULT_ROUTE_ID_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  const runnerEvidence = runnerResult.executionEvidence;
  if (!runnerEvidence || typeof runnerEvidence !== 'object' || Array.isArray(runnerEvidence) ||
      !SHA_RE.test(runnerEvidence.preHead || '') ||
      !CHANGE_SET_SHA256_RE.test(runnerEvidence.changeSetSha256 || '') ||
      !Array.isArray(runnerEvidence.changedPaths)) {
    return stop('RUNNER_RESULT_EXECUTION_EVIDENCE_INVALID', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (runnerEvidence.preHead.toLowerCase() !== finalEvidence.preHead.toLowerCase()) {
    return stop('RUNNER_FINAL_PRE_HEAD_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (runnerEvidence.changeSetSha256.toUpperCase() !== finalEvidence.changeSetSha256.toUpperCase()) {
    return stop('RUNNER_FINAL_CHANGE_SET_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!pathsEqual(sortedUnique(runnerEvidence.changedPaths), sortedUnique(finalEvidence.changedPaths))) {
    return stop('RUNNER_FINAL_CHANGED_PATHS_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  // Cross-bound to the exact same task/branch/scope as the final receipt:
  // an actual COMPLETED runner execution for a DIFFERENT task, branch, or
  // outside the final receipt's own allowed scope is never accepted as
  // evidence for THIS final receipt's claims, even if its preHead/digest/
  // paths happen to coincide.
  if (runnerResult.taskId !== finalReceipt.taskId) {
    return stop('RUNNER_FINAL_TASK_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (runnerResult.branch !== finalReceipt.branch) {
    return stop('RUNNER_FINAL_BRANCH_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  if (!changedPathsWithinScope(runnerEvidence.changedPaths, finalReceipt.allowedScope)) {
    return stop('RUNNER_FINAL_SCOPE_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }

  // --- repository identity: reuse the existing runner helper exactly as it allows today ---
  const identityCheck = verifyRepositoryIdentity(repoRoot, repository.owner, repository.name);
  if (!identityCheck.ok) return stop(identityCheck.code, { originalWriterProven: false, currentMergeAuthorized: false });

  // --- current actual committed change set: independently re-derived from the exact repository, never trusted from any receipt/result text ---
  const binding = verifyCommittedChangeBinding(repoRoot, normalizedCommit, finalEvidence.preHead, finalEvidence.changedPaths);
  if (!binding.ok) return stop(binding.code, { originalWriterProven: false, currentMergeAuthorized: false });

  const recomputed = computeChangeSetSha256(repoRoot, binding.actualParent, normalizedCommit);
  if (!recomputed) return stop('EXECUTION_EVIDENCE_UNVERIFIABLE', { originalWriterProven: false, currentMergeAuthorized: false });
  if (recomputed.changeSetSha256.toUpperCase() !== finalEvidence.changeSetSha256.toUpperCase()) {
    return stop('CHANGE_SET_DIGEST_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }
  const recomputedChangedPaths = recomputed.changedPaths;
  const claimedChangedPaths = finalEvidence.changedPaths;
  if (claimedChangedPaths.length !== recomputedChangedPaths.length ||
      claimedChangedPaths.some((changedPath, index) => changedPath !== recomputedChangedPaths[index])) {
    return stop('CHANGE_SET_DIGEST_MISMATCH', { originalWriterProven: false, currentMergeAuthorized: false });
  }

  // Everything above is CONTENT consistency only: current actual commit <->
  // final receipt claims <-> actual COMPLETED runner result, all bound to
  // this exact repository owner/name. None of it is, or is ever claimed to
  // be, proof of WHO wrote the commit. The result is therefore explicitly
  // DIAGNOSTIC ONLY, with both authorship and current merge authorization
  // hard-set to false; current merge authorization remains decided
  // exclusively by the unmodified verifyQualifiedCommitReceipt / verifyFinalReceipt
  // path against the real current clock.
  return {
    schemaVersion: 1,
    result: 'HISTORICAL_COMMIT_CONTENT_CONSISTENT_NOT_CURRENT_AUTHORIZATION',
    code: 'HISTORICAL_COMMIT_CONTENT_CONSISTENT_NOT_CURRENT_AUTHORIZATION',
    diagnosticOnly: true,
    originalWriterProven: false,
    currentMergeAuthorized: false,
    repository: { owner: repository.owner, name: repository.name },
    branch: finalReceipt.branch ?? null,
    commit: normalizedCommit,
    parent: binding.actualParent,
    changedPaths: binding.actualChangedPaths,
    preImplementationReceipt: preImplementationReceiptSummary,
    notes: [
      'This result only confirms the current actual committed change set, one-parent linkage, preHead, changed paths, and change-set digest still match the supplied final receipt and an actual COMPLETED runner result.',
      'This result does NOT prove who historically authored the commit: mutable saved JSON and Git commit timestamps are not authorship proof by themselves.',
      'This result does NOT authorize a current merge. Current merge authorization is decided exclusively by verifyQualifiedCommitReceipt / verifyFinalReceipt, unmodified, against the current clock.',
    ],
  };
}

// Returns a single commit's exact one real parent, independently re-derived
// from Git, never from any receipt or caller claim. A merge commit (more
// than one parent), a root commit (zero parents), or an unreadable commit
// all fail closed with a distinct, caller-identifiable code prefix so a
// merge/rebase/wrong-parent condition on either B or C is never conflated.
function singleParentOf(repoRoot, commitSha, codePrefix) {
  const result = runGit(repoRoot, ['rev-list', '--parents', '-n', '1', commitSha]);
  if (result.error || result.status !== 0) return { ok: false, code: `${codePrefix}_PARENTS_UNKNOWN` };
  const parts = String(result.stdout || '').trim().split(/\s+/).filter((part) => part.length > 0);
  const parents = parts.slice(1);
  if (parents.length !== 1) return { ok: false, code: `${codePrefix}_NOT_EXACTLY_ONE_PARENT` };
  const parent = parents[0].toLowerCase();
  if (!SHA_RE.test(parent)) return { ok: false, code: `${codePrefix}_PARENT_SHA_INVALID` };
  return { ok: true, parent };
}

// Narrow, opt-in, two-commit route-lineage receiver for the exact
// A(base) -> B(qualified) -> C(final direct wrapper-suffix) shape that
// PR #398/#399 require. This is NOT a general multi-agent gate: it only
// binds three ALREADY-independently-issued pieces of evidence --
// verifyQualifiedCommitReceipt(B), verifyFinalReceipt(C), and
// verifyCanonicalWrapperMetadataSuffix(B..C) -- to the exact, freshly
// re-derived current repository state, and fails closed on any mismatch,
// extra/missing commit, merge, wrong parent, scope drift, or stale evidence.
// It NEVER returns MERGE_READY and NEVER substitutes for independent
// security review, CI, test-gate, Draft Lock, or explicit human merge
// authorization: prMergeAuthorized is always false, including on success.
export function verifyCanonicalWrapperRouteLineage({
  repoRoot, repository, branch, baseHead, finalHead, qualifiedCommit, qualifiedReceipt, finalDirectReceipt,
} = {}) {
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) return stop('REPO_ROOT_INVALID');
  if (!repository || typeof repository !== 'object' || Array.isArray(repository) ||
      !safeToken(repository.owner) || !safeToken(repository.name)) {
    return stop('REPOSITORY_INVALID');
  }
  if (typeof branch !== 'string' || branch.trim().length === 0) return stop('BRANCH_INVALID');

  if (!SHA_RE.test(baseHead || '')) return stop('BASE_HEAD_INVALID');
  if (!SHA_RE.test(qualifiedCommit || '')) return stop('QUALIFIED_COMMIT_INVALID');
  if (!SHA_RE.test(finalHead || '')) return stop('FINAL_HEAD_INVALID');
  const normalizedBaseHead = baseHead.toLowerCase();
  const normalizedQualifiedCommit = qualifiedCommit.toLowerCase();
  const normalizedFinalHead = finalHead.toLowerCase();
  if (normalizedBaseHead === normalizedQualifiedCommit ||
      normalizedQualifiedCommit === normalizedFinalHead ||
      normalizedBaseHead === normalizedFinalHead) {
    return stop('HEADS_NOT_DISTINCT');
  }

  // --- current actual repository state: exact current feature branch,
  // clean working tree (including untracked), verified origin identity, and
  // exact current HEAD == C. None of this is ever trusted from caller text.
  const repoCheck = verifyFeatureRepository(repoRoot, branch);
  if (!repoCheck.ok) return stop(repoCheck.code);
  const resolvedRoot = repoCheck.resolvedRoot;

  const cleanCheck = verifyWorktreeClean(resolvedRoot);
  if (!cleanCheck.ok) return stop(cleanCheck.code);

  const identityCheck = verifyRepositoryIdentity(resolvedRoot, repository.owner, repository.name);
  if (!identityCheck.ok) return stop(identityCheck.code);

  const currentHead = readHeadSha(resolvedRoot);
  if (!currentHead) return stop('CURRENT_HEAD_UNKNOWN');
  if (currentHead !== normalizedFinalHead) return stop('CURRENT_HEAD_MISMATCH');

  // --- exact two-commit chain A -> B -> C, derived from Git, never from any
  // caller claim. Any extra, missing, merge, rebase, or wrong-parent commit
  // fails closed rather than being silently accepted.
  const existsA = runGit(resolvedRoot, ['cat-file', '-e', `${normalizedBaseHead}^{commit}`]);
  if (existsA.error || existsA.status !== 0) return stop('BASE_HEAD_NOT_FOUND');
  const existsB = runGit(resolvedRoot, ['cat-file', '-e', `${normalizedQualifiedCommit}^{commit}`]);
  if (existsB.error || existsB.status !== 0) return stop('QUALIFIED_COMMIT_NOT_FOUND');
  const existsC = runGit(resolvedRoot, ['cat-file', '-e', `${normalizedFinalHead}^{commit}`]);
  if (existsC.error || existsC.status !== 0) return stop('FINAL_HEAD_NOT_FOUND');

  const commitListResult = runGit(resolvedRoot, ['rev-list', '--reverse', `${normalizedBaseHead}..${normalizedFinalHead}`]);
  if (commitListResult.error || commitListResult.status !== 0) return stop('COMMIT_LIST_UNVERIFIABLE');
  const commits = String(commitListResult.stdout || '').split('\n').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0);
  if (commits.length !== 2) return stop('COMMIT_CHAIN_LENGTH_INVALID');
  if (commits[0] !== normalizedQualifiedCommit || commits[1] !== normalizedFinalHead) {
    return stop('COMMIT_CHAIN_ORDER_MISMATCH');
  }

  const parentB = singleParentOf(resolvedRoot, normalizedQualifiedCommit, 'QUALIFIED_COMMIT');
  if (!parentB.ok) return stop(parentB.code);
  if (parentB.parent !== normalizedBaseHead) return stop('QUALIFIED_COMMIT_PARENT_MISMATCH_BASE');

  const parentC = singleParentOf(resolvedRoot, normalizedFinalHead, 'FINAL_HEAD');
  if (!parentC.ok) return stop(parentC.code);
  if (parentC.parent !== normalizedQualifiedCommit) return stop('FINAL_HEAD_PARENT_MISMATCH_QUALIFIED');

  // --- (B) the existing qualified-agent implementation-route receipt for
  // the exact qualified commit B, reused UNMODIFIED. Branch/preHead are
  // additionally bound here against the caller's own expected branch/base,
  // since verifyQualifiedCommitReceipt itself only trusts receipt.branch for
  // its own internal verifyFinalReceipt call.
  if (!qualifiedReceipt || typeof qualifiedReceipt !== 'object' || Array.isArray(qualifiedReceipt)) {
    return stop('QUALIFIED_RECEIPT_INVALID');
  }
  if (qualifiedReceipt.branch !== branch) return stop('QUALIFIED_RECEIPT_BRANCH_MISMATCH');
  if (!qualifiedReceipt.executionEvidence || typeof qualifiedReceipt.executionEvidence !== 'object' ||
      qualifiedReceipt.executionEvidence.preHead !== normalizedBaseHead) {
    return stop('QUALIFIED_RECEIPT_PRE_HEAD_MISMATCH_BASE');
  }

  const qualifiedVerification = verifyQualifiedCommitReceipt({
    repoRoot: resolvedRoot, repository, commit: normalizedQualifiedCommit, receipt: qualifiedReceipt,
  });
  if (!qualifiedVerification || qualifiedVerification.result !== 'QUALIFIED_COMMIT_VERIFIED_NOT_MERGE_AUTHORIZATION') {
    return stop('QUALIFIED_COMMIT_VERIFICATION_FAILED', { qualifiedVerification });
  }

  // --- (C) the existing, separately issued final direct-browser receipt
  // for the exact final commit C. Route type, the exact TRIVIAL_SAFE_LOCAL_
  // EDIT exception vocabulary, and the exact single-path allowedScope are
  // all required before the receipt is even handed to the unmodified
  // verifyFinalReceipt for a fresh, current-clock re-verification (which
  // includes Instruction Clarity and the Research Gate for source-write
  // task kinds, exactly as every other final receipt).
  if (!finalDirectReceipt || typeof finalDirectReceipt !== 'object' || Array.isArray(finalDirectReceipt)) {
    return stop('FINAL_DIRECT_RECEIPT_INVALID');
  }
  if (!finalDirectReceipt.executor || finalDirectReceipt.executor.routeType !== 'direct-browser') {
    return stop('FINAL_DIRECT_ROUTE_TYPE_NOT_DIRECT_BROWSER');
  }
  const exception = finalDirectReceipt.exception;
  if (!exception || typeof exception !== 'object' || Array.isArray(exception) ||
      exception.reason !== 'TRIVIAL_SAFE_LOCAL_EDIT') {
    return stop('FINAL_DIRECT_EXCEPTION_REASON_INVALID');
  }
  if (typeof exception.justification !== 'string' || exception.justification.trim().length === 0) {
    return stop('FINAL_DIRECT_EXCEPTION_JUSTIFICATION_INVALID');
  }
  if (exception.evidenceConfirmed !== true) return stop('FINAL_DIRECT_EXCEPTION_EVIDENCE_NOT_CONFIRMED');
  if (!Array.isArray(finalDirectReceipt.allowedScope) || finalDirectReceipt.allowedScope.length !== 1 ||
      finalDirectReceipt.allowedScope[0] !== WRAPPER_TEMPLATE_PATH) {
    return stop('FINAL_DIRECT_ALLOWED_SCOPE_INVALID');
  }

  const finalVerification = verifyFinalReceipt(finalDirectReceipt, {
    owner: repository.owner, name: repository.name, branch, head: normalizedFinalHead, repoRoot: resolvedRoot,
  });
  if (!finalVerification || finalVerification.result !== 'MERGE_READY') {
    return stop('FINAL_RECEIPT_VERIFICATION_FAILED', { finalVerification });
  }

  // --- the strict, narrow B..C canonical-wrapper-description suffix proof,
  // reused UNMODIFIED. This independently re-confirms the single-commit,
  // single-line, canonical-matching wrapper description edit.
  const wrapperVerification = verifyCanonicalWrapperMetadataSuffix({
    repoRoot: resolvedRoot, fromHead: normalizedQualifiedCommit, toHead: normalizedFinalHead,
  });
  if (!wrapperVerification || wrapperVerification.result !== 'CANONICAL_WRAPPER_METADATA_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION') {
    return stop('CANONICAL_WRAPPER_SUFFIX_VERIFICATION_FAILED', { wrapperVerification });
  }

  // --- exact final A->C net changed path set: must equal the disjoint union
  // of B's real changed paths (independently recomputed by
  // verifyQualifiedCommitReceipt above) and the wrapper suffix's one real
  // changed path. Overlap, a hidden intermediate change, or any other
  // scope drift fails closed rather than being accepted on say-so.
  const qualifiedChangedPaths = sortedUnique(qualifiedVerification.changedPaths);
  const wrapperChangedPaths = sortedUnique(wrapperVerification.changedPaths);
  if (wrapperChangedPaths.length !== 1 || wrapperChangedPaths[0] !== WRAPPER_TEMPLATE_PATH) {
    return stop('WRAPPER_CHANGED_PATHS_INVALID');
  }
  if (qualifiedChangedPaths.includes(WRAPPER_TEMPLATE_PATH)) {
    return stop('QUALIFIED_CHANGED_PATHS_OVERLAP_WRAPPER_PATH');
  }

  const netDiffResult = runGit(resolvedRoot, ['diff', '--name-status', '--no-renames', '-z', normalizedBaseHead, normalizedFinalHead]);
  if (netDiffResult.error || netDiffResult.status !== 0) return stop('FINAL_NET_DIFF_UNVERIFIABLE');
  const actualNetChangedPaths = sortedUnique(parseNameStatusZ(netDiffResult.stdout));
  const expectedNetChangedPaths = sortedUnique([...qualifiedChangedPaths, ...wrapperChangedPaths]);
  if (!pathsEqual(actualNetChangedPaths, expectedNetChangedPaths)) {
    return stop('FINAL_NET_CHANGED_PATHS_MISMATCH');
  }

  return {
    schemaVersion: 1,
    result: 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION',
    code: 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION',
    repository: { owner: repository.owner, name: repository.name },
    branch,
    baseHead: normalizedBaseHead,
    qualifiedCommit: normalizedQualifiedCommit,
    finalHead: normalizedFinalHead,
    qualifiedChangedPaths,
    wrapperChangedPaths,
    finalNetChangedPaths: actualNetChangedPaths,
    prMergeAuthorized: false,
    notes: [
      'This result only proves the exact two-commit A->B->C lineage, the qualified-agent implementation-route receipt for B, the canonical-wrapper-description B..C suffix proof, and the final direct-browser TRIVIAL_SAFE_LOCAL_EDIT receipt for C.',
      'This result does NOT by itself authorize a merge. Independent security review, exact-HEAD test/CI results, Draft Lock Mode, and explicit human merge authorization remain separately required.',
    ],
  };
}

const LINEAGE_INPUT_ALLOWED_KEYS = new Set([
  'schemaVersion', 'baseHead', 'finalHead', 'qualifiedCommit', 'qualifiedReceipt', 'finalDirectReceipt',
]);

// Each documented flag below is required EXACTLY ONCE: an unknown flag, a
// missing/empty value, or ANY repeated flag (e.g. a wrong --expect-head
// followed by a correct one, relying on last-wins) all fail closed here
// rather than silently resolving to a single ambiguous "winning" value.
const LINEAGE_CLI_FLAG_TO_KEY = {
  '--lineage-input': 'lineageInputPath',
  '--repo-root': 'repoRoot',
  '--expect-owner': 'expectOwner',
  '--expect-name': 'expectName',
  '--expect-branch': 'expectBranch',
  '--expect-base': 'expectBase',
  '--expect-head': 'expectHead',
};

function parseLineageCliArgs(argv) {
  const out = {
    lineageInputPath: null, repoRoot: null, expectOwner: null, expectName: null,
    expectBranch: null, expectBase: null, expectHead: null, valid: true,
  };
  const seenFlags = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = LINEAGE_CLI_FLAG_TO_KEY[arg];
    if (key === undefined) { out.valid = false; continue; }
    const value = argv[i + 1];
    i += 1;
    if (typeof value !== 'string' || value.length === 0) { out.valid = false; continue; }
    if (seenFlags.has(arg)) { out.valid = false; continue; }
    seenFlags.add(arg);
    out[key] = value;
  }
  if (!out.lineageInputPath || !out.repoRoot || !out.expectOwner || !out.expectName ||
      !out.expectBranch || !out.expectBase || !out.expectHead) {
    out.valid = false;
  }
  return out;
}

// Machine-invokable CLI for the narrow two-commit canonical-wrapper
// lineage receiver. The JSON input file may carry ONLY the six listed
// fields (no runtime repo selection, no arbitrary privilege field); every
// expectation flag is required, and the input's own baseHead/finalHead must
// exactly match the caller's external --expect-base/--expect-head before
// verifyCanonicalWrapperRouteLineage is ever invoked, so this CLI cannot be
// used to quietly audit a different range than the one actually expected.
export function runCanonicalWrapperRouteLineageCli(argv) {
  const args = parseLineageCliArgs(argv);
  if (!args.valid) return stop('CLI_ARGUMENTS_INVALID');

  let input;
  try {
    input = JSON.parse(fs.readFileSync(path.resolve(args.lineageInputPath), 'utf8'));
  } catch {
    return stop('LINEAGE_INPUT_UNREADABLE_OR_INVALID_JSON');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return stop('LINEAGE_INPUT_INVALID');
  if (Object.keys(input).some((key) => !LINEAGE_INPUT_ALLOWED_KEYS.has(key))) {
    return stop('LINEAGE_INPUT_UNKNOWN_FIELD');
  }
  if (input.schemaVersion !== 1) return stop('LINEAGE_INPUT_SCHEMA_VERSION_INVALID');
  if (!SHA_RE.test(input.baseHead || '') || input.baseHead.toLowerCase() !== String(args.expectBase).toLowerCase()) {
    return stop('LINEAGE_INPUT_BASE_HEAD_MISMATCH_EXPECTED');
  }
  if (!SHA_RE.test(input.finalHead || '') || input.finalHead.toLowerCase() !== String(args.expectHead).toLowerCase()) {
    return stop('LINEAGE_INPUT_FINAL_HEAD_MISMATCH_EXPECTED');
  }

  return verifyCanonicalWrapperRouteLineage({
    repoRoot: path.resolve(args.repoRoot),
    repository: { owner: args.expectOwner, name: args.expectName },
    branch: args.expectBranch,
    baseHead: input.baseHead,
    finalHead: input.finalHead,
    qualifiedCommit: input.qualifiedCommit,
    qualifiedReceipt: input.qualifiedReceipt,
    finalDirectReceipt: input.finalDirectReceipt,
  });
}

function mainLineageCli() {
  const result = runCanonicalWrapperRouteLineageCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.result === 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION' ? 0 : 2;
}

const isMainLineageCli = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainLineageCli) mainLineageCli();

#!/usr/bin/env node
// Self-test: proves verifyQualifiedCommitReceipt STOPs on malformed/mismatched
// inputs using only synthetic example.invalid data. No real git repo needed.
//
// Also proves triageHistoricalCommitEvidence: (a) correctly STOPs on every
// malformed/mismatched/absent input just like verifyQualifiedCommitReceipt,
// using a REAL temporary git repository with real commits; (b) returns the
// explicit DIAGNOSTIC-ONLY positive result (originalWriterProven:false,
// currentMergeAuthorized:false) for a genuinely content-consistent historic
// commit even when its bound research evidence is now stale against the
// real current clock; and (c) never causes verifyQualifiedCommitReceipt
// itself to accept that same stale receipt as MERGE_READY -- the existing
// current-time research-staleness STOP is completely unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  verifyQualifiedCommitReceipt, triageHistoricalCommitEvidence,
  verifyCanonicalWrapperRouteLineage, runCanonicalWrapperRouteLineageCli,
} from './qualified-commit-receipt-audit.mjs';
import { computeChangeSetSha256 } from './implementation-runner.mjs';
import { evaluateReceipt } from './implementation-route-receipt.mjs';
import { computeConstraintsDigest, TRIGGER_KEYS, MINIMAL_BYPASS_CHECKLIST_IDS } from './research-gate.mjs';

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

// --- triageHistoricalCommitEvidence: real, entirely SYNTHETIC temporary Git
// repository, synthetic owner/name/origin, a real feature branch (never
// main/master), two real commits, and a content-consistent historical
// finalReceipt + matching COMPLETED runnerResult whose bound research
// evidence is already stale (assessedAtUtcMs 72h old, maxEvidenceAgeMs 24h).
// No patient/finance data is ever used; the only filesystem writes are
// inside a freshly created, owned temp directory, removed in `finally`.
function gitSetup(repoRoot, args) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`synthetic selftest repo setup failed: git ${args.join(' ')} -> ${result.error || result.stderr}`);
  }
  return result.stdout;
}

function buildSyntheticHistoricalRepo() {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qcra-selftest-repo-')));
  const owner = 'example-synthetic-owner';
  const name = 'example-synthetic-repo';
  const branch = 'feature/historical-evidence-synthetic';
  const filePath = path.join(repoRoot, 'synthetic-note.md');

  gitSetup(repoRoot, ['init']);
  gitSetup(repoRoot, ['checkout', '-b', branch]);
  gitSetup(repoRoot, ['config', 'user.email', 'synthetic-selftest@example.invalid']);
  gitSetup(repoRoot, ['config', 'user.name', 'Synthetic Selftest']);
  gitSetup(repoRoot, ['config', 'commit.gpgsign', 'false']);
  gitSetup(repoRoot, ['remote', 'add', 'origin', `https://github.com/${owner}/${name}.git`]);

  fs.writeFileSync(filePath, 'synthetic historical evidence note: initial\n', 'utf8');
  gitSetup(repoRoot, ['add', '--all']);
  gitSetup(repoRoot, ['commit', '-m', 'synthetic initial commit']);
  const parentSha = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

  fs.writeFileSync(filePath, 'synthetic historical evidence note: initial\nupdated synthetic content\n', 'utf8');
  gitSetup(repoRoot, ['add', '--all']);
  gitSetup(repoRoot, ['commit', '-m', 'synthetic second commit']);
  const headSha = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

  return { repoRoot, owner, name, branch, parentSha, headSha };
}

let historicalCases = 0;
function expectHistoricalStop(label, triageArgs) {
  historicalCases += 1;
  let result;
  try {
    result = triageHistoricalCommitEvidence(triageArgs);
  } catch (error) {
    assert.fail(`${label}: triageHistoricalCommitEvidence must never throw, threw: ${error && error.message}`);
    return;
  }
  assert.equal(result.result, 'STOP', `${label}: expected STOP result`);
  assert.equal(result.originalWriterProven, false, `${label}: originalWriterProven must be false`);
  assert.equal(result.currentMergeAuthorized, false, `${label}: currentMergeAuthorized must be false`);
}

{
  const repo = buildSyntheticHistoricalRepo();
  try {
    const taskId = 'historical-task-001';
    const proposalId = 'historical-proposal-001';
    const constraints = ['No destructive git operations.', 'Synthetic data only.'];
    const allowedScope = ['synthetic-note.md'];

    const changeSet = computeChangeSetSha256(repo.repoRoot, repo.parentSha, repo.headSha);
    assert.ok(changeSet, 'synthetic repo setup: committed change set must be computable');

    const nowUtcMs = Date.now();
    const evidenceBinding = {
      taskId,
      proposalId,
      repository: { owner: repo.owner, name: repo.name },
      scope: [...allowedScope],
      constraints: [...constraints],
      constraintsDigestSha256: computeConstraintsDigest(constraints),
      assessedAtUtcMs: nowUtcMs - (72 * 60 * 60 * 1000),
      maxEvidenceAgeMs: 24 * 60 * 60 * 1000,
    };
    const researchEvidence = {
      schemaVersion: 1,
      evidenceBinding,
      triggers: Object.fromEntries(TRIGGER_KEYS.map((key) => [key, false])),
      noTriggerAssessment: {
        reasonCode: 'LOCAL_SAFE_EDIT_NO_RISK_SIGNAL',
        justification: 'Synthetic local-only edit with no external risk signal.',
      },
      checklist: MINIMAL_BYPASS_CHECKLIST_IDS.map((id) => ({
        id,
        status: 'PASS',
        applicable: true,
        justification: `${id} evaluated for synthetic historical evidence selftest.`,
        primarySourceRef: `synthetic-source-${id}`,
      })),
    };
    const research = {
      evidence: researchEvidence,
      context: { proposalId, constraints: [...constraints], humanTopConditions: [] },
    };

    const finalReceipt = {
      schemaVersion: 1,
      result: 'PASS',
      taskId,
      taskKind: 'implementation',
      executor: { id: 'synthetic-executor', provider: 'synthetic-provider', routeType: 'qualified-agent' },
      repository: { owner: repo.owner, name: repo.name },
      branch: repo.branch,
      allowedScope: [...allowedScope],
      implementationHead: repo.headSha,
      executionEvidence: {
        preHead: repo.parentSha, changeSetSha256: changeSet.changeSetSha256, changedPaths: [...changeSet.changedPaths],
      },
      research,
    };
    const runnerResult = {
      schemaVersion: 1,
      result: 'COMPLETED',
      routeId: 'claude-implementation-write',
      taskId,
      branch: repo.branch,
      executionEvidence: {
        preHead: repo.parentSha, changeSetSha256: changeSet.changeSetSha256, changedPaths: [...changeSet.changedPaths],
      },
    };

    function baseTriageArgs() {
      return {
        repoRoot: repo.repoRoot,
        repository: { owner: repo.owner, name: repo.name },
        commit: repo.headSha,
        finalReceipt: clone(finalReceipt),
        runnerResult: clone(runnerResult),
      };
    }

    // The genuine content-consistent historical case: STOP is never issued,
    // and the result is explicitly diagnostic-only, never MERGE_READY.
    {
      historicalCases += 1;
      const result = triageHistoricalCommitEvidence(baseTriageArgs());
      assert.equal(result.result, 'HISTORICAL_COMMIT_CONTENT_CONSISTENT_NOT_CURRENT_AUTHORIZATION');
      assert.equal(result.code, 'HISTORICAL_COMMIT_CONTENT_CONSISTENT_NOT_CURRENT_AUTHORIZATION');
      assert.equal(result.originalWriterProven, false);
      assert.equal(result.currentMergeAuthorized, false);
      assert.notEqual(result.result, 'MERGE_READY');
    }

    // 1. finalReceipt.branch foreign (not the actually checked-out branch)
    {
      const args = baseTriageArgs();
      args.finalReceipt.branch = 'feature/foreign-branch-not-checked-out';
      expectHistoricalStop('historical: finalReceipt.branch foreign', args);
    }

    // 2. research.evidenceBinding.repository wrong
    {
      const args = baseTriageArgs();
      args.finalReceipt.research.evidence.evidenceBinding.repository = { owner: 'foreign-owner-example', name: 'foreign-repo-example' };
      expectHistoricalStop('historical: evidenceBinding.repository wrong', args);
    }

    // 3. taskId wrong (research.evidenceBinding.taskId)
    {
      const args = baseTriageArgs();
      args.finalReceipt.research.evidence.evidenceBinding.taskId = 'foreign-task-999';
      expectHistoricalStop('historical: evidenceBinding.taskId wrong', args);
    }

    // 4. scope wrong (research.evidenceBinding.scope)
    {
      const args = baseTriageArgs();
      args.finalReceipt.research.evidence.evidenceBinding.scope = ['unexpected-foreign-scope.md'];
      expectHistoricalStop('historical: evidenceBinding.scope wrong', args);
    }

    // 5. proposal wrong (research.evidenceBinding.proposalId)
    {
      const args = baseTriageArgs();
      args.finalReceipt.research.evidence.evidenceBinding.proposalId = 'foreign-proposal-999';
      expectHistoricalStop('historical: evidenceBinding.proposalId wrong', args);
    }

    // 6. constraints wrong (research.evidenceBinding.constraints)
    {
      const args = baseTriageArgs();
      args.finalReceipt.research.evidence.evidenceBinding.constraints = [...constraints, 'An extra unexpected constraint.'];
      expectHistoricalStop('historical: evidenceBinding.constraints wrong', args);
    }

    // 7. runner missing
    {
      const args = baseTriageArgs();
      args.runnerResult = undefined;
      expectHistoricalStop('historical: runner missing', args);
    }

    // 8. runner STOP (not COMPLETED)
    {
      const args = baseTriageArgs();
      args.runnerResult.result = 'STOP';
      expectHistoricalStop('historical: runner STOP', args);
    }

    // 9. runner digest forged
    {
      const args = baseTriageArgs();
      args.runnerResult.executionEvidence.changeSetSha256 = 'f'.repeat(64);
      expectHistoricalStop('historical: runner digest forged', args);
    }

    // 10. HEAD wrong (caller-supplied commit does not match finalReceipt.implementationHead)
    {
      const args = baseTriageArgs();
      args.commit = repo.parentSha;
      expectHistoricalStop('historical: HEAD wrong', args);
    }

    // 11. parent wrong (claimed preHead forged consistently in both receipt and
    // runner result, so it is internally self-consistent but does not match
    // the actual Git parent of the real committed change set)
    {
      const args = baseTriageArgs();
      const forgedPreHead = 'd'.repeat(40);
      args.finalReceipt.executionEvidence.preHead = forgedPreHead;
      args.runnerResult.executionEvidence.preHead = forgedPreHead;
      expectHistoricalStop('historical: parent wrong', args);
    }

    // 12. owner wrong (caller-supplied repository param foreign to the
    // receipt's own, otherwise-correct repository claim)
    {
      const args = baseTriageArgs();
      args.repository = { owner: 'foreign-owner-param-example', name: repo.name };
      expectHistoricalStop('historical: owner wrong', args);
    }
  } finally {
    // Cleanup ONLY the owned, freshly created temp repository.
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
}

// --- verifyCanonicalWrapperRouteLineage(): narrow two-commit A->B->C
// lineage receiver (Foundation Issue #262 continuation, PR #398/#399). Real,
// entirely SYNTHETIC temporary Git repositories: base A, a genuine
// qualified-agent source commit B (one test file), then an allowed
// canonical-wrapper description suffix commit C, each bound to a genuinely
// issued receipt via the existing, UNMODIFIED evaluateReceipt(). Never
// interacts with real data; only ever writes inside freshly created, owned
// temp directories, removed in `finally`.
const CANONICAL_PATH = '.agents/skills/local-ai-handoff/SKILL.md';
const WRAPPER_PATH = 'templates/.claude/skills/local-ai-handoff/SKILL.md.template';
const CANONICAL_DESCRIPTION = 'description: Canonical synced wrapper description for route-lineage selftest.';
const OLD_WRAPPER_DESCRIPTION = 'description: Old unsynced wrapper description for route-lineage selftest.';

function buildResearchEnvelope({ taskId, proposalId, repository, scope, assessedAtUtcMs, maxEvidenceAgeMs = 24 * 60 * 60 * 1000 }) {
  const constraints = ['No destructive git operations.', 'Synthetic data only.'];
  const evidenceBinding = {
    taskId,
    proposalId,
    repository: { owner: repository.owner, name: repository.name },
    scope: [...scope],
    constraints: [...constraints],
    constraintsDigestSha256: computeConstraintsDigest(constraints),
    assessedAtUtcMs,
    maxEvidenceAgeMs,
  };
  const evidence = {
    schemaVersion: 1,
    evidenceBinding,
    triggers: Object.fromEntries(TRIGGER_KEYS.map((key) => [key, false])),
    noTriggerAssessment: {
      reasonCode: 'LOCAL_SAFE_EDIT_NO_RISK_SIGNAL',
      justification: 'Synthetic local-only edit with no external risk signal.',
    },
    checklist: MINIMAL_BYPASS_CHECKLIST_IDS.map((id) => ({
      id,
      status: 'PASS',
      applicable: true,
      justification: `${id} evaluated for synthetic route-lineage selftest.`,
      primarySourceRef: `synthetic-source-${id}`,
    })),
  };
  return { evidence, context: { proposalId, constraints: [...constraints], humanTopConditions: [] } };
}

function buildInstructionClarity(taskId) {
  return {
    schemaVersion: 1,
    taskId,
    unlistedAssumptionsPresent: false,
    instructions: [{ id: 'instr-1', kind: 'INSTRUCTION', summary: 'Synthetic route-lineage selftest instruction.' }],
    ambiguities: [],
  };
}

function buildWrapperLineageRepo() {
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qcra-lineage-selftest-repo-')));
  const owner = 'example-synthetic-lineage-owner';
  const name = 'example-synthetic-lineage-repo';
  const branch = 'feature/wrapper-qualified-lineage-synthetic';
  const qualifiedFilePath = path.join(repoRoot, 'src', 'qualified-feature.txt');

  gitSetup(repoRoot, ['init']);
  gitSetup(repoRoot, ['checkout', '-b', branch]);
  gitSetup(repoRoot, ['config', 'user.email', 'synthetic-selftest@example.invalid']);
  gitSetup(repoRoot, ['config', 'user.name', 'Synthetic Selftest']);
  gitSetup(repoRoot, ['config', 'commit.gpgsign', 'false']);
  gitSetup(repoRoot, ['remote', 'add', 'origin', `https://github.com/${owner}/${name}.git`]);

  fs.mkdirSync(path.dirname(path.join(repoRoot, CANONICAL_PATH)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, CANONICAL_PATH), `---\nname: local-ai-handoff\n${CANONICAL_DESCRIPTION}\n---\n\n# Canonical\n`, 'utf8');
  fs.mkdirSync(path.dirname(path.join(repoRoot, WRAPPER_PATH)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${OLD_WRAPPER_DESCRIPTION}\n---\n\n# Wrapper\n`, 'utf8');
  gitSetup(repoRoot, ['add', '--all']);
  gitSetup(repoRoot, ['commit', '-m', 'synthetic base: canonical + wrapper']);
  const baseHead = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

  fs.mkdirSync(path.dirname(qualifiedFilePath), { recursive: true });
  fs.writeFileSync(qualifiedFilePath, 'synthetic qualified-agent source change\n', 'utf8');
  gitSetup(repoRoot, ['add', '--all']);
  gitSetup(repoRoot, ['commit', '-m', 'synthetic qualified source commit B']);
  const qualifiedCommit = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

  fs.writeFileSync(path.join(repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${CANONICAL_DESCRIPTION}\n---\n\n# Wrapper\n`, 'utf8');
  gitSetup(repoRoot, ['add', '--all']);
  gitSetup(repoRoot, ['commit', '-m', 'synthetic wrapper description suffix commit C']);
  const finalHead = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

  return { repoRoot, owner, name, branch, baseHead, qualifiedCommit, finalHead };
}

let lineageCases = 0;
function expectLineageStop(label, lineageArgs, expectedCode) {
  lineageCases += 1;
  const result = verifyCanonicalWrapperRouteLineage(lineageArgs);
  assert.equal(result.result, 'STOP', `${label}: expected STOP result`);
  assert.equal(result.code, expectedCode, `${label}: expected code ${expectedCode}`);
}

{
  const repo = buildWrapperLineageRepo();
  try {
    const repository = { owner: repo.owner, name: repo.name };
    const qualifiedTaskId = 'lineage-qualified-task-001';
    const finalTaskId = 'lineage-final-task-001';
    const qualifiedScope = ['src/qualified-feature.txt'];
    const finalScope = [WRAPPER_PATH];
    const nowUtcMs = Date.now();

    const changeSet = computeChangeSetSha256(repo.repoRoot, repo.baseHead, repo.qualifiedCommit);
    assert.ok(changeSet, 'synthetic lineage repo setup: committed change set B must be computable');

    function buildQualifiedReceipt({ proposalId = 'lineage-qualified-proposal', assessedAtUtcMs = nowUtcMs } = {}) {
      return {
        schemaVersion: 1,
        stage: 'final',
        task: { id: qualifiedTaskId, kind: 'implementation' },
        executor: { id: 'synthetic-qualified-executor', provider: 'anthropic', routeType: 'qualified-agent' },
        repository,
        branch: repo.branch,
        allowedScope: [...qualifiedScope],
        dataClass: 'source-only',
        costPolicy: 'no-new-cost',
        instructionClarity: buildInstructionClarity(qualifiedTaskId),
        research: buildResearchEnvelope({
          taskId: qualifiedTaskId, proposalId, repository, scope: qualifiedScope, assessedAtUtcMs,
        }),
        implementationHead: repo.qualifiedCommit,
        executionEvidence: {
          preHead: repo.baseHead, changeSetSha256: changeSet.changeSetSha256, changedPaths: [...changeSet.changedPaths],
        },
      };
    }

    function buildFinalDirectReceipt({
      proposalId = 'lineage-final-proposal', assessedAtUtcMs = nowUtcMs, exceptionReason = 'TRIVIAL_SAFE_LOCAL_EDIT',
      allowedScope = finalScope,
    } = {}) {
      return {
        schemaVersion: 1,
        stage: 'final',
        task: { id: finalTaskId, kind: 'implementation' },
        executor: { id: 'synthetic-direct-executor', provider: 'anthropic', routeType: 'direct-browser' },
        repository,
        branch: repo.branch,
        allowedScope: [...allowedScope],
        dataClass: 'source-only',
        costPolicy: 'no-new-cost',
        exception: {
          reason: exceptionReason,
          justification: 'Synthetic single-line canonical-wrapper description sync, no logic change.',
          evidenceConfirmed: true,
        },
        instructionClarity: buildInstructionClarity(finalTaskId),
        research: buildResearchEnvelope({
          taskId: finalTaskId, proposalId, repository, scope: allowedScope, assessedAtUtcMs,
        }),
        implementationHead: repo.finalHead,
      };
    }

    function evaluatedReceipt(rawInput) {
      const result = evaluateReceipt(rawInput);
      assert.equal(result.result, 'PASS', `synthetic receipt setup must issue a genuine PASS receipt (got ${result.result}/${result.code})`);
      return result;
    }

    const qualifiedReceipt = evaluatedReceipt(buildQualifiedReceipt());
    const finalDirectReceipt = evaluatedReceipt(buildFinalDirectReceipt());

    function baseLineageArgs() {
      return {
        repoRoot: repo.repoRoot,
        repository,
        branch: repo.branch,
        baseHead: repo.baseHead,
        finalHead: repo.finalHead,
        qualifiedCommit: repo.qualifiedCommit,
        qualifiedReceipt: clone(qualifiedReceipt),
        finalDirectReceipt: clone(finalDirectReceipt),
      };
    }

    // The genuine case: all three pieces of evidence verify together.
    {
      lineageCases += 1;
      const result = verifyCanonicalWrapperRouteLineage(baseLineageArgs());
      assert.equal(result.result, 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION', `lineage PASS case: ${JSON.stringify(result)}`);
      assert.equal(result.code, 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION');
      assert.equal(result.prMergeAuthorized, false, 'lineage PASS case must never claim merge authorization');
      assert.deepEqual(result.qualifiedChangedPaths, ['src/qualified-feature.txt']);
      assert.deepEqual(result.wrapperChangedPaths, [WRAPPER_PATH]);
      assert.deepEqual([...result.finalNetChangedPaths].sort(), ['src/qualified-feature.txt', WRAPPER_PATH].sort());
    }

    // CLI coverage: machine-invokable --lineage-input entry point, reusing
    // the exact same genuine evidence while the repository is still pristine.
    {
      const lineageInputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcra-lineage-cli-'));
      const lineageInputPath = path.join(lineageInputDir, 'lineage-input.json');
      try {
        const validInput = {
          schemaVersion: 1,
          baseHead: repo.baseHead,
          finalHead: repo.finalHead,
          qualifiedCommit: repo.qualifiedCommit,
          qualifiedReceipt: clone(qualifiedReceipt),
          finalDirectReceipt: clone(finalDirectReceipt),
        };
        const cliBaseArgs = () => [
          '--lineage-input', lineageInputPath,
          '--repo-root', repo.repoRoot,
          '--expect-owner', repo.owner,
          '--expect-name', repo.name,
          '--expect-branch', repo.branch,
          '--expect-base', repo.baseHead,
          '--expect-head', repo.finalHead,
        ];

        fs.writeFileSync(lineageInputPath, JSON.stringify(validInput), 'utf8');
        lineageCases += 1;
        const cliResult = runCanonicalWrapperRouteLineageCli(cliBaseArgs());
        assert.equal(cliResult.result, 'ROUTE_LINEAGE_VERIFIED_NOT_MERGE_AUTHORIZATION', `lineage CLI PASS case: ${JSON.stringify(cliResult)}`);

        lineageCases += 1;
        const missingFlagResult = runCanonicalWrapperRouteLineageCli(cliBaseArgs().slice(0, -2));
        assert.equal(missingFlagResult.result, 'STOP');
        assert.equal(missingFlagResult.code, 'CLI_ARGUMENTS_INVALID');

        fs.writeFileSync(lineageInputPath, JSON.stringify({ ...validInput, unexpectedField: 'nope' }), 'utf8');
        lineageCases += 1;
        const unknownFieldResult = runCanonicalWrapperRouteLineageCli(cliBaseArgs());
        assert.equal(unknownFieldResult.result, 'STOP');
        assert.equal(unknownFieldResult.code, 'LINEAGE_INPUT_UNKNOWN_FIELD');

        fs.writeFileSync(lineageInputPath, JSON.stringify({ ...validInput, baseHead: 'e'.repeat(40) }), 'utf8');
        lineageCases += 1;
        const baseMismatchResult = runCanonicalWrapperRouteLineageCli(cliBaseArgs());
        assert.equal(baseMismatchResult.result, 'STOP');
        assert.equal(baseMismatchResult.code, 'LINEAGE_INPUT_BASE_HEAD_MISMATCH_EXPECTED');

        // Synthetic negative: a wrong --expect-head followed by the actual
        // correct --expect-head (an attempted last-wins ambiguity bypass)
        // must fail closed as CLI_ARGUMENTS_INVALID, never silently resolve
        // to the trailing correct value.
        fs.writeFileSync(lineageInputPath, JSON.stringify(validInput), 'utf8');
        lineageCases += 1;
        const wrongExpectHead = 'f'.repeat(40);
        const wrongHeadThenCorrect = [
          '--lineage-input', lineageInputPath,
          '--repo-root', repo.repoRoot,
          '--expect-owner', repo.owner,
          '--expect-name', repo.name,
          '--expect-branch', repo.branch,
          '--expect-base', repo.baseHead,
          '--expect-head', wrongExpectHead,
          '--expect-head', repo.finalHead,
        ];
        const repeatedExpectHeadResult = runCanonicalWrapperRouteLineageCli(wrongHeadThenCorrect);
        assert.equal(repeatedExpectHeadResult.result, 'STOP', `lineage CLI repeated --expect-head must STOP: ${JSON.stringify(repeatedExpectHeadResult)}`);
        assert.equal(repeatedExpectHeadResult.code, 'CLI_ARGUMENTS_INVALID');

        // Synthetic negative: a repeated --lineage-input flag (even pointing
        // twice at the exact same genuine file) must also fail closed as
        // CLI_ARGUMENTS_INVALID rather than silently accept the duplicate.
        lineageCases += 1;
        const repeatedLineageInputArgv = ['--lineage-input', lineageInputPath, ...cliBaseArgs()];
        const repeatedLineageInputResult = runCanonicalWrapperRouteLineageCli(repeatedLineageInputArgv);
        assert.equal(repeatedLineageInputResult.result, 'STOP', `lineage CLI repeated --lineage-input must STOP: ${JSON.stringify(repeatedLineageInputResult)}`);
        assert.equal(repeatedLineageInputResult.code, 'CLI_ARGUMENTS_INVALID');
      } finally {
        fs.rmSync(lineageInputDir, { recursive: true, force: true });
      }
    }

    // 1. caller-expected branch does not match the actually checked-out branch.
    {
      const args = baseLineageArgs();
      args.branch = 'feature/foreign-branch-not-checked-out';
      expectLineageStop('lineage: branch foreign', args, 'BRANCH_MISMATCH');
    }

    // 2. wrong finalHead (does not match actual current HEAD). Setting
    // finalHead to the qualified commit B makes it equal to args.qualifiedCommit,
    // so the earlier distinctness check (HEADS_NOT_DISTINCT) fires before the
    // current-HEAD comparison is ever reached.
    {
      const args = baseLineageArgs();
      args.finalHead = repo.qualifiedCommit;
      expectLineageStop('lineage: finalHead wrong', args, 'HEADS_NOT_DISTINCT');
    }

    // 3. qualifiedReceipt.branch mismatch.
    {
      const args = baseLineageArgs();
      args.qualifiedReceipt.branch = 'feature/foreign-receipt-branch';
      expectLineageStop('lineage: qualifiedReceipt branch mismatch', args, 'QUALIFIED_RECEIPT_BRANCH_MISMATCH');
    }

    // 4. qualifiedReceipt.executionEvidence.preHead mismatch base.
    {
      const args = baseLineageArgs();
      args.qualifiedReceipt.executionEvidence = { ...args.qualifiedReceipt.executionEvidence, preHead: 'd'.repeat(40) };
      expectLineageStop('lineage: qualifiedReceipt preHead mismatch base', args, 'QUALIFIED_RECEIPT_PRE_HEAD_MISMATCH_BASE');
    }

    // 5. finalDirectReceipt route type is qualified-agent, not direct-browser.
    {
      const args = baseLineageArgs();
      args.finalDirectReceipt.executor = { ...args.finalDirectReceipt.executor, routeType: 'qualified-agent' };
      expectLineageStop('lineage: finalDirectReceipt route type wrong', args, 'FINAL_DIRECT_ROUTE_TYPE_NOT_DIRECT_BROWSER');
    }

    // 6. finalDirectReceipt exception reason is not TRIVIAL_SAFE_LOCAL_EDIT.
    {
      const args = baseLineageArgs();
      args.finalDirectReceipt.exception = { ...args.finalDirectReceipt.exception, reason: 'HUMAN_EXPLICIT_DIRECT' };
      expectLineageStop('lineage: finalDirectReceipt exception reason wrong', args, 'FINAL_DIRECT_EXCEPTION_REASON_INVALID');
    }

    // 7. finalDirectReceipt allowedScope is not exactly the one wrapper path.
    {
      const args = baseLineageArgs();
      args.finalDirectReceipt.allowedScope = [WRAPPER_PATH, 'extra/unapproved/path.txt'];
      expectLineageStop('lineage: finalDirectReceipt allowedScope wrong', args, 'FINAL_DIRECT_ALLOWED_SCOPE_INVALID');
    }

    // 8. finalDirectReceipt bound research evidence is stale against the real
    // current clock. The receipt was genuinely issued PASS while fresh; this
    // simulates re-verification happening after its own evidence window has
    // since lapsed, mirroring the same current-clock re-evaluation
    // verifyFinalReceipt always performs (never a forged "now").
    {
      const staleFinalDirectReceipt = clone(finalDirectReceipt);
      staleFinalDirectReceipt.research.evidence.evidenceBinding.assessedAtUtcMs = nowUtcMs - (48 * 60 * 60 * 1000);
      const args = baseLineageArgs();
      args.finalDirectReceipt = staleFinalDirectReceipt;
      expectLineageStop('lineage: finalDirectReceipt stale research', args, 'FINAL_RECEIPT_VERIFICATION_FAILED');
    }

    // 9. dirty worktree (including untracked) is refused.
    {
      const dirtyPath = path.join(repo.repoRoot, 'dirty-untracked.txt');
      fs.writeFileSync(dirtyPath, 'dirty uncommitted synthetic file\n', 'utf8');
      try {
        expectLineageStop('lineage: dirty worktree refused', baseLineageArgs(), 'WORKTREE_NOT_CLEAN');
      } finally {
        fs.rmSync(dirtyPath, { force: true });
      }
    }

    // 10. qualifiedCommit is a real commit but not the actual first commit in
    // the A..C range (wrong position in the chain) is refused.
    {
      gitSetup(repo.repoRoot, ['checkout', repo.baseHead]);
      fs.mkdirSync(path.join(repo.repoRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(repo.repoRoot, 'src', 'unrelated-side-file.txt'), 'side\n', 'utf8');
      gitSetup(repo.repoRoot, ['add', '--all']);
      gitSetup(repo.repoRoot, ['commit', '-m', 'unrelated side commit for wrong-position test']);
      const sideCommit = gitSetup(repo.repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();
      gitSetup(repo.repoRoot, ['checkout', repo.branch]);

      const args = baseLineageArgs();
      args.qualifiedCommit = sideCommit;
      expectLineageStop('lineage: qualifiedCommit wrong position in chain refused', args, 'COMMIT_CHAIN_ORDER_MISMATCH');
    }

    // 11. an extra intermediate commit between B and C is refused (chain length).
    {
      gitSetup(repo.repoRoot, ['checkout', repo.qualifiedCommit]);
      fs.writeFileSync(path.join(repo.repoRoot, 'src', 'unrelated-intermediate.txt'), 'unrelated\n', 'utf8');
      gitSetup(repo.repoRoot, ['add', '--all']);
      gitSetup(repo.repoRoot, ['commit', '-m', 'unrelated intermediate commit']);
      fs.writeFileSync(path.join(repo.repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${CANONICAL_DESCRIPTION}\n---\n\n# Wrapper\n`, 'utf8');
      gitSetup(repo.repoRoot, ['add', '--all']);
      gitSetup(repo.repoRoot, ['commit', '-m', 'wrapper suffix after unrelated intermediate commit']);
      const extraFinalHead = gitSetup(repo.repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();
      gitSetup(repo.repoRoot, ['checkout', repo.branch]);
      gitSetup(repo.repoRoot, ['reset', '--hard', extraFinalHead]);

      const args = baseLineageArgs();
      args.finalHead = extraFinalHead;
      expectLineageStop('lineage: extra intermediate commit refused', args, 'COMMIT_CHAIN_LENGTH_INVALID');

      // restore the branch to the exact original two-commit finalHead for the next test.
      gitSetup(repo.repoRoot, ['reset', '--hard', repo.finalHead]);
    }

    // 12. a merge commit (two parents) as the final head is refused, even
    // when it introduces no extra reachable commit in the A..C range (its
    // second parent is already an ancestor, A itself).
    {
      const treeOfB = gitSetup(repo.repoRoot, ['rev-parse', `${repo.qualifiedCommit}^{tree}`]).trim();
      const mergeFinalHead = gitSetup(repo.repoRoot, [
        'commit-tree', treeOfB, '-p', repo.qualifiedCommit, '-p', repo.baseHead, '-m', 'synthetic merge commit as refused final head',
      ]).trim().toLowerCase();
      gitSetup(repo.repoRoot, ['update-ref', `refs/heads/${repo.branch}`, mergeFinalHead]);
      gitSetup(repo.repoRoot, ['reset', '--hard', mergeFinalHead]);

      const args = baseLineageArgs();
      args.finalHead = mergeFinalHead;
      expectLineageStop('lineage: merge commit as final head refused', args, 'FINAL_HEAD_NOT_EXACTLY_ONE_PARENT');

      // restore the branch to the exact original two-commit finalHead.
      gitSetup(repo.repoRoot, ['update-ref', `refs/heads/${repo.branch}`, repo.finalHead]);
      gitSetup(repo.repoRoot, ['reset', '--hard', repo.finalHead]);
    }
  } finally {
    fs.rmSync(repo.repoRoot, { recursive: true, force: true });
  }
}

// Dedicated overlap scenario in its own repository: the qualified commit B
// itself also touches the wrapper template path (a body line, never its
// description), so B's real changed-path set legitimately includes the
// wrapper path. Even though verifyQualifiedCommitReceipt(B) and the B..C
// wrapper-suffix proof each independently PASS, the exact final A->C net
// changed-path set is no longer the required DISJOINT union, and this must
// be refused rather than silently accepted.
{
  lineageCases += 1;
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qcra-lineage-overlap-selftest-repo-')));
  const owner = 'example-synthetic-overlap-owner';
  const name = 'example-synthetic-overlap-repo';
  const branch = 'feature/wrapper-qualified-lineage-overlap-synthetic';
  try {
    gitSetup(repoRoot, ['init']);
    gitSetup(repoRoot, ['checkout', '-b', branch]);
    gitSetup(repoRoot, ['config', 'user.email', 'synthetic-selftest@example.invalid']);
    gitSetup(repoRoot, ['config', 'user.name', 'Synthetic Selftest']);
    gitSetup(repoRoot, ['config', 'commit.gpgsign', 'false']);
    gitSetup(repoRoot, ['remote', 'add', 'origin', `https://github.com/${owner}/${name}.git`]);

    fs.mkdirSync(path.dirname(path.join(repoRoot, CANONICAL_PATH)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, CANONICAL_PATH), `---\nname: local-ai-handoff\n${CANONICAL_DESCRIPTION}\n---\n\n# Canonical\n`, 'utf8');
    fs.mkdirSync(path.dirname(path.join(repoRoot, WRAPPER_PATH)), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${OLD_WRAPPER_DESCRIPTION}\n---\n\n# Wrapper\n`, 'utf8');
    gitSetup(repoRoot, ['add', '--all']);
    gitSetup(repoRoot, ['commit', '-m', 'synthetic overlap base: canonical + wrapper']);
    const baseHead = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'other-feature.txt'), 'synthetic qualified-agent source change\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${OLD_WRAPPER_DESCRIPTION}\n---\n\n# Wrapper updated body\n`, 'utf8');
    gitSetup(repoRoot, ['add', '--all']);
    gitSetup(repoRoot, ['commit', '-m', 'synthetic qualified source commit B also touching wrapper body']);
    const qualifiedCommit = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

    fs.writeFileSync(path.join(repoRoot, WRAPPER_PATH), `---\nname: local-ai-handoff\n${CANONICAL_DESCRIPTION}\n---\n\n# Wrapper updated body\n`, 'utf8');
    gitSetup(repoRoot, ['add', '--all']);
    gitSetup(repoRoot, ['commit', '-m', 'synthetic wrapper description suffix commit C']);
    const finalHead = gitSetup(repoRoot, ['rev-parse', 'HEAD']).trim().toLowerCase();

    const repository = { owner, name };
    const qualifiedTaskId = 'lineage-overlap-qualified-task-001';
    const finalTaskId = 'lineage-overlap-final-task-001';
    const qualifiedScope = ['src/other-feature.txt', WRAPPER_PATH];
    const finalScope = [WRAPPER_PATH];
    const nowUtcMs = Date.now();

    const changeSet = computeChangeSetSha256(repoRoot, baseHead, qualifiedCommit);
    assert.ok(changeSet, 'synthetic overlap repo setup: committed change set B must be computable');
    assert.deepEqual([...changeSet.changedPaths].sort(), [...qualifiedScope].sort(), 'overlap repo B must touch exactly the qualified file and the wrapper path');

    const qualifiedReceipt = evaluateReceipt({
      schemaVersion: 1,
      stage: 'final',
      task: { id: qualifiedTaskId, kind: 'implementation' },
      executor: { id: 'synthetic-qualified-executor', provider: 'anthropic', routeType: 'qualified-agent' },
      repository,
      branch,
      allowedScope: [...qualifiedScope],
      dataClass: 'source-only',
      costPolicy: 'no-new-cost',
      instructionClarity: buildInstructionClarity(qualifiedTaskId),
      research: buildResearchEnvelope({ taskId: qualifiedTaskId, proposalId: 'lineage-overlap-qualified-proposal', repository, scope: qualifiedScope, assessedAtUtcMs: nowUtcMs }),
      implementationHead: qualifiedCommit,
      executionEvidence: { preHead: baseHead, changeSetSha256: changeSet.changeSetSha256, changedPaths: [...changeSet.changedPaths] },
    });
    assert.equal(qualifiedReceipt.result, 'PASS', `overlap repo qualified receipt setup must PASS (got ${qualifiedReceipt.result}/${qualifiedReceipt.code})`);

    const finalDirectReceipt = evaluateReceipt({
      schemaVersion: 1,
      stage: 'final',
      task: { id: finalTaskId, kind: 'implementation' },
      executor: { id: 'synthetic-direct-executor', provider: 'anthropic', routeType: 'direct-browser' },
      repository,
      branch,
      allowedScope: [...finalScope],
      dataClass: 'source-only',
      costPolicy: 'no-new-cost',
      exception: {
        reason: 'TRIVIAL_SAFE_LOCAL_EDIT',
        justification: 'Synthetic single-line canonical-wrapper description sync, no logic change.',
        evidenceConfirmed: true,
      },
      instructionClarity: buildInstructionClarity(finalTaskId),
      research: buildResearchEnvelope({ taskId: finalTaskId, proposalId: 'lineage-overlap-final-proposal', repository, scope: finalScope, assessedAtUtcMs: nowUtcMs }),
      implementationHead: finalHead,
    });
    assert.equal(finalDirectReceipt.result, 'PASS', `overlap repo final receipt setup must PASS (got ${finalDirectReceipt.result}/${finalDirectReceipt.code})`);

    const overlapResult = verifyCanonicalWrapperRouteLineage({
      repoRoot, repository, branch, baseHead, finalHead, qualifiedCommit, qualifiedReceipt, finalDirectReceipt,
    });
    assert.equal(overlapResult.result, 'STOP', 'overlap case must STOP rather than verify lineage');
    assert.equal(overlapResult.code, 'QUALIFIED_CHANGED_PATHS_OVERLAP_WRAPPER_PATH', 'overlap case must report the exact overlap code');
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

console.log(`PASS qualified-commit-receipt-audit-selftest (${cases} legacy cases, ${historicalCases} historical-evidence cases, ${lineageCases} route-lineage cases)`);

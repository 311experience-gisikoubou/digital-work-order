#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evaluate, classifyFiles } from './verification-scope-gate.mjs';
import { issueReceipt } from './verification-evidence-receipt.mjs';

const GATE_CLI_PATH = fileURLToPath(new URL('./verification-scope-gate.mjs', import.meta.url));

assert.equal(classifyFiles(['docs/guide.md']).profile, 'DOCS_ONLY');
assert.equal(classifyFiles(['src/main.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['src-tauri/src/lib.rs']).profile, 'BACKEND_ONLY');
assert.equal(classifyFiles(['migrations/0009_x.sql']).profile, 'DB_MIGRATION');
assert.equal(classifyFiles(['Cargo.lock']).profile, 'DEPENDENCY_CHANGE');
assert.equal(classifyFiles(['src/main.ts', 'src-tauri/src/lib.rs']).profile, 'MIXED_RUNTIME');
assert.equal(classifyFiles(['.agents/skills/test-gate/SKILL.md']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['tools/portfolio-governance-audit.mjs']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['STATUS.md', 'PROJECT_CONTEXT.json']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['templates/.claude/skills/test-gate/SKILL.md.template']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['templates/AGENTS.index.md.template']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['templates/ui-reference/reproduction/FIXED_SHAPES.json.template']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['.gitignore']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['src/cli.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/cli/windows-gui-adapter.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/cli/windows-gui.ps1']).profile, 'CLI_SCRIPT');
// Issue #376: native security code must never pass the ordinary CLI gate.
const nativeFiles = [
  'src/cli/windows-hello-user-click.cpp',
  'src/cli/windows-hello-consent-policy.h',
  'src/cli/build-windows-hello-user-click.ps1',
];
for (const file of nativeFiles) {
  assert.equal(classifyFiles([file]).profile, 'NATIVE_WINDOWS_SECURITY', file);
}
assert.equal(classifyFiles(['src/cli/native-helper.cpp']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/native-task.ps1']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/issue116-session0-task.ps1']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/windows-hello-preflight.ps1']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/control-panel.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src-tauri/src/windows_hello_auth.rs']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/windows-gui.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/core/local-mcp-admission.mjs']).profile, 'CLI_SCRIPT');
const pr110Native = classifyFiles([
  ...nativeFiles,
  '.agents/skills/test-gate/verification-scope-gate.mjs',
  '.agents/skills/test-gate/verification-scope-gate-selftest.mjs',
  'docs/windows-device-trust-enrollment.md',
  'tests/windows-hello-user-click.test.mjs',
]);
assert.equal(pr110Native.profile, 'NATIVE_WINDOWS_SECURITY');
const nativeStop = evaluate({
  changedFiles: nativeFiles,
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST']
});
assert.equal(nativeStop.decision, 'STOP');
assert.equal(nativeStop.code, 'REQUIRED_CHECK_MISSING');
for (const mandatory of ['NATIVE_STATIC_AUDIT', 'NATIVE_BUILD_TEST', 'INDEPENDENT_SECURITY_REVIEW']) {
  assert(nativeStop.missingMinimumChecks.includes(mandatory), mandatory);
}
const nativeReadyForExternalEvidence = evaluate({
  changedFiles: nativeFiles,
  plannedChecks: [
    'DIFF_HYGIENE', 'NATIVE_STATIC_AUDIT', 'NATIVE_BUILD_TEST',
    'INDEPENDENT_SECURITY_REVIEW'
  ],
});
assert.equal(nativeReadyForExternalEvidence.profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(nativeReadyForExternalEvidence.decision, 'PROCEED');
// PROCEED is only scope-planning acceptance, not a native verification receipt.
assert.equal(evaluate({
  changedFiles: ['src/cli/windows-hello-user-click.cpp'],
  plannedChecks: ['DIFF_HYGIENE', 'NATIVE_STATIC_AUDIT']
}).code, 'REQUIRED_CHECK_MISSING');
assert.equal(evaluate({
  changedFiles: ['src/cli/windows-gui.ps1'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'NATIVE_BUILD_TEST']
}).code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');

assert.equal(classifyFiles(['src/gui/windows-gui.ps1']).profile, 'UNKNOWN');
// Only the two reviewed AI Job Poller scripts (poll-once.ps1 and its
// dedicated tests/ selftest) are CLI; unrelated/nested scripts stay unknown.
assert.equal(classifyFiles(['scripts/ai-job-poller/poll-once.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['scripts/ai-job-poller/tests/poller-windows-selftest.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['scripts/ai-job-poller/poll-once.ps1','scripts/ai-job-poller/tests/poller-windows-selftest.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['scripts/misc.ps1']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/ai-job-poller/nested/poll.ps1']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/ai-job-poller/notes.bin']).profile, 'UNKNOWN');
const aiPollerFiles=['scripts/ai-job-poller/poll-once.ps1','scripts/ai-job-poller/tests/poller-windows-selftest.ps1'];
let aiPollerGate=evaluate({changedFiles:aiPollerFiles,plannedChecks:['DIFF_HYGIENE','TARGETED_SELFTEST']});
assert.equal(aiPollerGate.profile, 'CLI_SCRIPT');
assert.equal(aiPollerGate.decision, 'PROCEED');
aiPollerGate=evaluate({changedFiles:aiPollerFiles,plannedChecks:['DIFF_HYGIENE','TARGETED_SELFTEST','FULL_REPOSITORY_SUITE']});
assert.equal(aiPollerGate.code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');
aiPollerGate=evaluate({changedFiles:['scripts/ai-job-poller/nested/poll.ps1'],plannedChecks:['DIFF_HYGIENE']});
assert.equal(aiPollerGate.code, 'CHANGE_SCOPE_UNKNOWN');

// Issue #376 repair: every top-level scripts/ai-job-poller/*.ps1 script
// defaults to NATIVE_WINDOWS_SECURITY (fail-closed), because any such
// script can perform the same native Windows Task Scheduler registration
// as install-poller-task.ps1 (New-ScheduledTaskPrincipal /
// Register-ScheduledTask). Only the two explicitly reviewed non-security
// scripts (poll-once.ps1 and tests/poller-windows-selftest.ps1) are exempt.
// This replaces a prior narrow "install"+"task" basename-segment matcher
// that missed naming variants such as register-poller-task.ps1 and
// task-register.ps1, incorrectly leaving them CLI_SCRIPT.
for (const file of [
  'scripts/ai-job-poller/install-poller-task.ps1',
  'scripts/ai-job-poller/register-poller-task.ps1',
  'scripts/ai-job-poller/task-register.ps1',
  'scripts/ai-job-poller/some-brand-new-script.ps1',
]) {
  assert.equal(classifyFiles([file]).profile, 'NATIVE_WINDOWS_SECURITY', file);

  // A TARGETED_SELFTEST-only plan (the ordinary CLI minimum) is insufficient
  // for any top-level poller script and must STOP, requiring all three
  // mandatory native checks.
  const targetedOnlyStop = evaluate({
    changedFiles: [file],
    plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST'],
  });
  assert.equal(targetedOnlyStop.profile, 'NATIVE_WINDOWS_SECURITY', file);
  assert.equal(targetedOnlyStop.decision, 'STOP', file);
  assert.equal(targetedOnlyStop.code, 'REQUIRED_CHECK_MISSING', file);
  for (const mandatory of ['NATIVE_STATIC_AUDIT', 'NATIVE_BUILD_TEST', 'INDEPENDENT_SECURITY_REVIEW']) {
    assert(targetedOnlyStop.missingMinimumChecks.includes(mandatory), `${file} ${mandatory}`);
  }

  // With all three mandatory native checks planned, scope-planning PROCEED
  // is possible (this is not a native verification receipt; see Issue #342).
  const allNativeChecksProceed = evaluate({
    changedFiles: [file],
    plannedChecks: ['DIFF_HYGIENE', 'NATIVE_STATIC_AUDIT', 'NATIVE_BUILD_TEST', 'INDEPENDENT_SECURITY_REVIEW'],
  });
  assert.equal(allNativeChecksProceed.profile, 'NATIVE_WINDOWS_SECURITY', file);
  assert.equal(allNativeChecksProceed.decision, 'PROCEED', file);
}
// Unaffected ordinary poller CLI (poll-once.ps1 and its dedicated test)
// remain CLI_SCRIPT, unchanged by this repair.
assert.equal(classifyFiles(['scripts/ai-job-poller/poll-once.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['scripts/ai-job-poller/tests/poller-windows-selftest.ps1']).profile, 'CLI_SCRIPT');
// Nested nested poller paths other than the one reviewed tests/ selftest
// remain UNKNOWN (fail-closed), not swept into NATIVE_WINDOWS_SECURITY.
assert.equal(classifyFiles(['scripts/ai-job-poller/nested/poll.ps1']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/ai-job-poller/tests/other-unreviewed.ps1']).profile, 'UNKNOWN');
// Unaffected native Hello case and src/cli reviewed exceptions remain correct.
assert.equal(classifyFiles(['src/cli/windows-hello-user-click.cpp']).profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(classifyFiles(['src/cli/windows-gui.ps1']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/cli/control-panel.ps1']).profile, 'CLI_SCRIPT');

// Issue #376: the existing native Job proof toolchain must never fall
// back to generic CLI, including when a proof parser/test changes alone.
const nativeProofPaths = [
  'tools/issue66-native-job-e2e.mjs',
  'tools/issue66-native-build.mjs',
  'tools/issue66-tap-result.mjs',
  'tests/issue66-native-job-driver.test.mjs',
  'tests/windows-hello-native-job.test.mjs',
];
const nativeProofChecks = [
  'DIFF_HYGIENE', 'TARGETED_SELFTEST', 'NATIVE_STATIC_AUDIT',
  'NATIVE_BUILD_TEST', 'INDEPENDENT_SECURITY_REVIEW',
];
for (const file of nativeProofPaths) {
  const files = [file];
  const classification = classifyFiles(files);
  assert.equal(classification.profile, 'NATIVE_WINDOWS_SECURITY', file);
  assert.equal(classification.flags.nativeVerification, true, file);
  assert.equal(classification.flags.cli, false, file);
  assert.equal(evaluate({ changedFiles: files, plannedChecks: nativeProofChecks }).decision, 'PROCEED', file);
  for (const missing of nativeProofChecks) {
    const result = evaluate({ changedFiles: files, plannedChecks: nativeProofChecks.filter(check => check !== missing) });
    assert.equal(result.decision, 'STOP', file + ' missing ' + missing);
    assert.equal(result.code, 'REQUIRED_CHECK_MISSING');
    assert(result.missingMinimumChecks.includes(missing), missing);
  }
  // Scope planning is not trusted native execution evidence.
  const input = {
    schemaVersion: 1, mode: 'issue', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
    changedFiles: files, profile: 'NATIVE_WINDOWS_SECURITY', scopeDecision: 'PROCEED',
    plannedChecks: nativeProofChecks,
    results: nativeProofChecks.map(check => ({ check, status: 'success', evidenceSource: 'local' })),
  };
  assert.equal(issueReceipt(input).code, 'NATIVE_SECURITY_EVIDENCE_NOT_AUTHENTICATED', file);
  const ordinaryChecks = ['DIFF_HYGIENE', 'TARGETED_SELFTEST'];
  assert.equal(issueReceipt({
    ...input, profile: 'CLI_SCRIPT', plannedChecks: ordinaryChecks,
    results: ordinaryChecks.map(check => ({ check, status: 'success', evidenceSource: 'local' })),
  }).code, 'PROFILE_FILE_SCOPE_MISMATCH', file);
}
assert.equal(classifyFiles(['TOOLS/ISSUE66-TAP-RESULT.MJS']).profile, 'NATIVE_WINDOWS_SECURITY');
// The exact five files in the pending LocalOps #116 source change.
const localOps116Files = [
  'tools/issue66-native-job-e2e.mjs', 'tools/issue66-tap-result.mjs',
  'tests/issue66-native-job-driver.test.mjs', 'tests/windows-hello-native-job.test.mjs',
  'docs/issue116-session0-one-lane-runbook.md',
];
const localOps116Checks = [...nativeProofChecks, 'DOCS_CONSISTENCY'];
const localOps116Scope = evaluate({ changedFiles: localOps116Files, plannedChecks: localOps116Checks });
assert.equal(localOps116Scope.profile, 'NATIVE_WINDOWS_SECURITY');
assert.equal(localOps116Scope.decision, 'PROCEED');
for (const missing of localOps116Checks) {
  const result = evaluate({ changedFiles: localOps116Files, plannedChecks: localOps116Checks.filter(check => check !== missing) });
  assert.equal(result.code, 'REQUIRED_CHECK_MISSING', missing);
  assert(result.missingMinimumChecks.includes(missing), missing);
}
for (const unknown of ['tools/issue66-native-job-e2e-copy.mjs', 'tools/issue67-native-job-e2e.mjs', 'tools/cleanup.mjs']) {
  assert.equal(classifyFiles([unknown]).profile, 'UNKNOWN', unknown);
  assert.equal(evaluate({ changedFiles: [...localOps116Files, unknown], plannedChecks: localOps116Checks }).code, 'CHANGE_SCOPE_UNKNOWN', unknown);
}
assert.equal(classifyFiles(['tests/core.test.mjs']).profile, 'CLI_SCRIPT');

assert.equal(classifyFiles(['src/core/audit-log.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/transport/mcp-server.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/transport/stdio-bridge.ts']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/transport/nested/local-mcp.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['src/transport/http.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['src/transport/socket-client.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['tools/rdc-singleton-launcher.mjs']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['tools/local-runner-launcher.ts']).profile, 'CLI_SCRIPT');
assert.equal(classifyFiles(['tools/cleanup.mjs']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['tests/core.test.mjs']).profile, 'CLI_SCRIPT');

// Root runtime JS is accepted only as a companion to an already-clear frontend change.
assert.equal(classifyFiles(['app.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['orders.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['index.html', 'app.js', 'orders.js']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['app/visual-snapshot.js', 'app.js', 'orders.js']).profile, 'FRONTEND_ONLY');

// Tooling/backend/test-like root JS remains fail-closed even beside a frontend anchor.
assert.equal(classifyFiles(['index.html', 'server.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['index.html', 'build.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['index.html', 'config.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['index.html', 'visual.test.js']).profile, 'UNKNOWN');

let result = evaluate({
  changedFiles: [
    '.gitignore',
    'AGENTS.local.md',
    'CURRENT_STATUS.md',
    'PROJECT_CONTEXT.json',
    'README.md',
    'docs/architecture.md',
    'package.json',
    'src/cli.mjs',
    'src/core/audit-log.mjs',
    'tools/rdc-singleton-launcher.mjs',
    'tests/core.test.mjs',
  ],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'DOCS_CONSISTENCY', 'DEPENDENCY_AUDIT', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.profile, 'DEPENDENCY_CHANGE');
assert.equal(result.flags.unknown, false);
assert.equal(result.flags.cli, true);
assert.equal(result.flags.frontend, false);
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: [
    'AGENTS.local.md',
    'CURRENT_STATUS.md',
    'PROJECT_CONTEXT.json',
    'README.md',
    'docs/architecture.md',
    'package.json',
    'package-lock.json',
    'src/transport/mcp-server.mjs',
    'tests/mcp-transport.test.mjs',
    'tests/transport-dependency-boundary.test.mjs',
  ],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'DOCS_CONSISTENCY', 'DEPENDENCY_AUDIT', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.profile, 'DEPENDENCY_CHANGE');
assert.equal(result.flags.cli, true);
assert.equal(result.flags.frontend, false);
assert.equal(result.flags.unknown, false);
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['docs/guide.md'],
  plannedChecks: ['DIFF_HYGIENE', 'DOCS_CONSISTENCY'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['docs/guide.md'],
  plannedChecks: ['DIFF_HYGIENE', 'DOCS_CONSISTENCY', 'BACKEND_FULL_TEST'],
});
assert.equal(result.code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');

result = evaluate({
  changedFiles: ['src/main.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'BACKEND_FULL_TEST'],
});
assert.equal(result.code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');

result = evaluate({
  changedFiles: ['src/main.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['index.html', 'app/visual-snapshot.js', 'app.js', 'orders.js', 'scripts/visual-snapshot-frontend.test.js'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.profile, 'FRONTEND_ONLY');
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['src-tauri/src/lib.rs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['migrations/0009_x.sql'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST', 'BACKEND_FULL_TEST', 'MIGRATION_TEST', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['Cargo.lock'],
  plannedChecks: ['DIFF_HYGIENE', 'DEPENDENCY_AUDIT'],
});
assert.equal(result.code, 'REQUIRED_CHECK_MISSING');
assert.deepEqual(result.missingMinimumChecks, ['TARGETED_BACKEND_TEST', 'FULL_REPOSITORY_SUITE']);

result = evaluate({
  changedFiles: ['Cargo.lock', 'migrations/0009_x.sql'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST', 'BACKEND_FULL_TEST', 'MIGRATION_TEST', 'DEPENDENCY_AUDIT', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['package-lock.json', 'src/main.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'DEPENDENCY_AUDIT', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.decision, 'PROCEED');

result = evaluate({
  changedFiles: ['docs/guide.md'],
  plannedChecks: ['DIFF_HYGIENE', 'DOCS_CONSISTENCY', 'FULL_REPOSITORY_SUITE'],
  escalationReason: 'RELEASE_GATE',
});
assert.equal(result.decision, 'PROCEED_ESCALATED');

result = evaluate({
  changedFiles: ['weird/file.xyz'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// Root index.html is frontend; unrelated scripts/*.ts is not classified as frontend.
assert.equal(classifyFiles(['index.html']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['scripts/build-release.ts']).profile, 'UNKNOWN');

// Narrow frontend-verification-script predicate.
assert.equal(classifyFiles(['scripts/home-stage-scale.selftest.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['scripts/home-invoice-pending.selftest.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['scripts/ui-layout-smoke.check.js']).profile, 'FRONTEND_ONLY');

// Issue #339: allow exact user-facing frontend selftests, keep other scripts UNKNOWN.
for (const file of [
  'scripts/user-facing-japanese-terms.selftest.mjs',
  'scripts/user-facing-terminology.selftest.mjs',
  'scripts/user-facing-latest-copy.selftest.mjs',
]) {
  assert.equal(classifyFiles([file]).profile, 'FRONTEND_ONLY', file);
}
result = evaluate({
  changedFiles: [
    'scripts/home-layout-v7.selftest.ts',
    'scripts/user-facing-japanese-terms.selftest.mjs',
    'scripts/user-facing-terminology.selftest.mjs',
  ],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.profile, 'FRONTEND_ONLY');
assert.equal(result.decision, 'PROCEED');
for (const file of [
  'scripts/user-facing-terminology.mjs',
  'scripts/user-facing-terminology.test.mjs',
  'scripts/not-user-facing-terminology.selftest.mjs',
  'scripts/user-facing-terminology.selftest.js',
  'scripts/subdir/user-facing-copy.selftest.mjs',
  'scripts/user-facing-backend-report.selftest.mjs',
  'scripts/user-facing-cli.selftest.mjs',
  'scripts/user-facing-gateway-report.selftest.mjs',
  'scripts/user-facing-config-check.selftest.mjs',
]) {
  assert.notEqual(classifyFiles([file]).profile, 'FRONTEND_ONLY', file);
}
result = evaluate({
  changedFiles: ['scripts/user-facing-terminology.selftest.mjs', 'scripts/unknown-task.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');
// Required PASS selftest: index.html + src file + frontend-verification-script => FRONTEND_ONLY, PROCEED.
result = evaluate({
  changedFiles: ['index.html', 'src/home.ts', 'scripts/home-stage-scale.selftest.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.profile, 'FRONTEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// Negative: unknown extension with no clear purpose/semantics stays UNKNOWN/STOP.
result = evaluate({
  changedFiles: ['weird/file.xyz'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// Negative: migration change is DB_MIGRATION, not frontend-only, even alongside frontend files.
result = evaluate({
  changedFiles: ['migrations/0010_add_column.sql', 'src/home.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST', 'BACKEND_FULL_TEST', 'MIGRATION_TEST', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.profile, 'DB_MIGRATION');
assert.notEqual(result.profile, 'FRONTEND_ONLY');

// Negative: backend change is BACKEND_ONLY, not frontend-only.
result = evaluate({
  changedFiles: ['src-tauri/src/lib.rs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.notEqual(result.profile, 'FRONTEND_ONLY');

// Negative: dependency change is DEPENDENCY_CHANGE, not frontend-only, even with frontend deps.
result = evaluate({
  changedFiles: ['package-lock.json'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'DEPENDENCY_AUDIT', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.profile, 'DEPENDENCY_CHANGE');
assert.notEqual(result.profile, 'FRONTEND_ONLY');

// --- Gateway vocabulary integration -------------------------------------

// User example 1 (exact required path): gateway/viewer-core.mjs is backend.
assert.equal(classifyFiles(['gateway/viewer-core.mjs']).profile, 'BACKEND_ONLY');

// User example 2 (exact required path): gateway/viewer-server.mjs is backend.
assert.equal(classifyFiles(['gateway/viewer-server.mjs']).profile, 'BACKEND_ONLY');

// User example 3 (exact required path): gateway/receiver.mjs is backend.
assert.equal(classifyFiles(['gateway/receiver.mjs']).profile, 'BACKEND_ONLY');

// Preserved nested coverage: gateway/viewer-core/** nested runtime path is backend.
assert.equal(classifyFiles(['gateway/viewer-core/index.ts']).profile, 'BACKEND_ONLY');

// Preserved nested coverage: gateway/viewer-server/** nested runtime path is backend.
assert.equal(classifyFiles(['gateway/viewer-server/server.ts']).profile, 'BACKEND_ONLY');

// Preserved nested coverage: gateway/receiver/** nested runtime path is backend.
assert.equal(classifyFiles(['gateway/receiver/handler.ts']).profile, 'BACKEND_ONLY');

// User example 4 (dedicated test): scripts/gateway-viewer-phase8.test.mjs is backend.
assert.equal(classifyFiles(['scripts/gateway-viewer-phase8.test.mjs']).profile, 'BACKEND_ONLY');

// User example 5 (dedicated test): scripts/gateway-receiver-e2e.test.mjs is backend.
assert.equal(classifyFiles(['scripts/gateway-receiver-e2e.test.mjs']).profile, 'BACKEND_ONLY');

// Future gateway test names remain recognized by the narrow reusable predicate
// without hardcoding specific repository names.
assert.equal(classifyFiles(['scripts/gateway-sync-worker.selftest.ts']).profile, 'BACKEND_ONLY');
assert.equal(classifyFiles(['scripts/gateway-metrics-queue.spec.js']).profile, 'BACKEND_ONLY');
assert.equal(classifyFiles(['scripts/gateway.test.mjs']).profile, 'BACKEND_ONLY');

// Negative: unrelated scripts file stays UNKNOWN.
assert.equal(classifyFiles(['scripts/unrelated.js']).profile, 'UNKNOWN');

// Negative: scripts/gateway-tools.js has the gateway segment but no delimited
// test/selftest/spec semantic segment, and is not under a gateway/ directory.
assert.equal(classifyFiles(['scripts/gateway-tools.js']).profile, 'UNKNOWN');

// Negative: misleading names must not match via substring.
// "gatewayish" is not the delimited segment "gateway".
assert.equal(classifyFiles(['scripts/gatewayish-test.js']).profile, 'UNKNOWN');
// "contest" is not the delimited segment "test".
assert.equal(classifyFiles(['scripts/gateway-contest.js']).profile, 'UNKNOWN');

// Negative: singular script/** (not scripts/**) is not matched by the
// dedicated-test predicate and is not a gateway/ directory, so it remains UNKNOWN.
assert.equal(classifyFiles(['script/gateway-test.js']).profile, 'UNKNOWN');

// Frontend regression: existing frontend-only classification is unaffected.
assert.equal(classifyFiles(['src/main.ts']).profile, 'FRONTEND_ONLY');

// Backend regression: existing backend-only classification is unaffected.
assert.equal(classifyFiles(['src-tauri/src/lib.rs']).profile, 'BACKEND_ONLY');

// Mixed regression: pre-existing frontend+backend mix is still MIXED_RUNTIME.
assert.equal(classifyFiles(['src/main.ts', 'src-tauri/src/lib.rs']).profile, 'MIXED_RUNTIME');

// Gateway + frontend mixed: a gateway backend path alongside a frontend path
// is MIXED_RUNTIME, not BACKEND_ONLY or FRONTEND_ONLY.
assert.equal(classifyFiles(['gateway/receiver/handler.ts', 'src/main.ts']).profile, 'MIXED_RUNTIME');

// Precedence: dependency classification still wins over a gateway directory path.
assert.equal(classifyFiles(['gateway/package-lock.json']).profile, 'DEPENDENCY_CHANGE');

// Precedence: migration classification still wins over a gateway directory path.
assert.equal(classifyFiles(['gateway/migrations/0001_init.sql']).profile, 'DB_MIGRATION');

// Precedence: governance classification still wins over a gateway directory path.
assert.equal(classifyFiles(['.agents/gateway/notes.md']).profile, 'GOVERNANCE_ONLY');

// Precedence: docs classification still wins over a gateway dedicated test name
// when the file is actually a markdown doc, not a .js|.ts|.mjs script.
assert.equal(classifyFiles(['docs/gateway-test-notes.md']).profile, 'DOCS_ONLY');

// Backend wins over frontend viewer semantics for a gateway dedicated test:
// evaluated alongside an explicit frontend file, the set is MIXED_RUNTIME
// (backend recognized), never collapsed into FRONTEND_ONLY.
result = evaluate({
  changedFiles: ['scripts/gateway-viewer-phase8.test.mjs', 'src/main.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'MIXED_RUNTIME');
assert.equal(result.decision, 'PROCEED');

// evaluate(): gateway-only change with required backend test plan proceeds.
result = evaluate({
  changedFiles: ['gateway/receiver/handler.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// evaluate(): dedicated gateway script test alone also requires backend test plan.
result = evaluate({
  changedFiles: ['scripts/gateway-receiver-e2e.test.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// evaluate(): missing the required backend check for a gateway change stops.
result = evaluate({
  changedFiles: ['gateway/receiver/handler.ts'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.code, 'REQUIRED_CHECK_MISSING');
assert.deepEqual(result.missingMinimumChecks, ['TARGETED_BACKEND_TEST']);

// evaluate(): unrelated/unknown scripts change (vs the gateway backend case
// above) stays CHANGE_SCOPE_UNKNOWN and must STOP rather than PROCEED.
result = evaluate({
  changedFiles: ['scripts/unrelated.js'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// evaluate(): exact required path gateway/viewer-core.mjs alone proceeds
// as BACKEND_ONLY with the required backend test plan.
result = evaluate({
  changedFiles: ['gateway/viewer-core.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// evaluate(): exact required path gateway/viewer-server.mjs alone proceeds
// as BACKEND_ONLY with the required backend test plan.
result = evaluate({
  changedFiles: ['gateway/viewer-server.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// evaluate(): exact required path gateway/receiver.mjs alone proceeds
// as BACKEND_ONLY with the required backend test plan.
result = evaluate({
  changedFiles: ['gateway/receiver.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// --- Frontend anchor leakage from gateway dedicated backend tests -------
//
// A dedicated backend gateway script test must never manufacture a
// frontend companion anchor for an unrelated root JS file. Previously
// hasStrongFrontendAnchor was computed before backend classification, so
// scripts/gateway-ui.test.mjs (itself backend via
// isGatewayDedicatedScriptTest) matched FRONTEND_VERIFICATION_SCRIPT_RE's
// loose substring lookaheads ("ui", "test") and created a false anchor,
// pulling orders.js into the frontend bucket and producing MIXED_RUNTIME.

// Negative: backend-only dedicated gateway test alone stays BACKEND_ONLY.
assert.equal(classifyFiles(['scripts/gateway-ui.test.mjs']).profile, 'BACKEND_ONLY');

// Negative: a frontend-looking gateway directory path (contains "ui") is
// still backend because BACKEND_RE (gateway/ prefix) wins, and it must not
// leak a frontend anchor either.
assert.equal(classifyFiles(['gateway/ui/render.js']).profile, 'BACKEND_ONLY');

// Negative: the dedicated backend test beside an unrelated root JS file
// must NOT become MIXED_RUNTIME via a false companion anchor. With no real
// frontend anchor present, orders.js remains unclassified (UNKNOWN).
assert.equal(classifyFiles(['scripts/gateway-ui.test.mjs', 'orders.js']).profile, 'UNKNOWN');
assert.notEqual(classifyFiles(['scripts/gateway-ui.test.mjs', 'orders.js']).profile, 'MIXED_RUNTIME');

// Negative: a frontend-looking gateway directory path beside an unrelated
// root JS file must likewise not fabricate a frontend anchor.
assert.equal(classifyFiles(['gateway/ui/render.js', 'orders.js']).profile, 'UNKNOWN');
assert.notEqual(classifyFiles(['gateway/ui/render.js', 'orders.js']).profile, 'MIXED_RUNTIME');

// Positive: a genuine frontend anchor (root index.html) alongside the
// dedicated backend gateway test is correctly MIXED_RUNTIME — real
// frontend anchors are preserved, only the false ones are excluded.
assert.equal(classifyFiles(['index.html', 'scripts/gateway-ui.test.mjs']).profile, 'MIXED_RUNTIME');

// Positive: a genuine frontend anchor still allows a root JS companion to
// be classified as frontend when no gateway/backend file is involved.
assert.equal(classifyFiles(['index.html', 'orders.js']).profile, 'FRONTEND_ONLY');

// evaluate(): the backend-only dedicated gateway test case proceeds with
// the required backend test plan (no spurious FRONTEND_BUILD required).
result = evaluate({
  changedFiles: ['scripts/gateway-ui.test.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// evaluate(): the genuine mixed case (real frontend anchor + dedicated
// backend gateway test) requires both frontend and backend checks.
result = evaluate({
  changedFiles: ['index.html', 'scripts/gateway-ui.test.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'MIXED_RUNTIME');
assert.equal(result.decision, 'PROCEED');

// --- Proportionate verification regression cases (2026-10-05) ---------
result = evaluate({
  changedFiles: ['src-tauri/src/import/categories.rs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.decision, 'PROCEED');
assert.equal(result.verificationLevel, 'TARGETED');
assert.deepEqual(result.minimumChecks, ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST']);

result = evaluate({
  changedFiles: ['src/components/InvoiceBadge.tsx'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'PROCEED');
assert.equal(result.verificationLevel, 'TARGETED');
assert.equal(result.excessiveChecks.includes('FULL_REPOSITORY_SUITE'), false);

result = evaluate({
  changedFiles: ['migrations/0011_add_invoice_index.sql'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST', 'BACKEND_FULL_TEST', 'MIGRATION_TEST', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(result.decision, 'PROCEED');
assert.equal(result.verificationLevel, 'FULL');

result = evaluate({
  changedFiles: ['docs/verification-cost.md'],
  plannedChecks: ['DIFF_HYGIENE', 'DOCS_CONSISTENCY'],
});
assert.equal(result.decision, 'PROCEED');
assert.equal(result.verificationLevel, 'MINIMAL');

result = evaluate({
  changedFiles: ['docs/release-note.md'],
  plannedChecks: ['DIFF_HYGIENE', 'DOCS_CONSISTENCY', 'FULL_REPOSITORY_SUITE'],
  escalationReason: 'RELEASE_GATE',
});
assert.equal(result.decision, 'PROCEED_ESCALATED');
assert.equal(result.verificationLevel, 'FULL');

// --- scripts/real-device-* reusable frontend verification evidence -----
//
// Root-level scripts/real-device-* scripts may count as reusable frontend
// real-device verification evidence, but only when the filename also
// carries a clear verification semantic (for example "verify", "test",
// "check"). This is the real changed-file combination that motivated old
// PR #243: a root index.html plus a src frontend file plus a dedicated
// scripts/real-device-*-verify.mjs script should resolve to FRONTEND_ONLY
// and PROCEED on the existing TARGETED_FRONTEND_TEST minimum check.

// Positive: exact real-device-* naming convention with clear verification
// semantics is frontend evidence. These intentionally avoid any of the
// existing FRONTEND_VERIFICATION_SCRIPT_RE keywords (frontend/ui/browser/
// render/layout/visual/home-stage/home-invoice) so they exercise only the
// new real-device rule, not the pre-existing predicate.
assert.equal(classifyFiles(['scripts/real-device-battery-check.js']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['scripts/real-device-network-latency.test.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['scripts/real-device-cold-start.selftest.mjs']).profile, 'FRONTEND_ONLY');

// The real motivating filename may also independently satisfy the
// pre-existing frontend-verification-script predicate; both rules
// agreeing is still correct.
assert.equal(classifyFiles(['scripts/real-device-home-stage-verify.mjs']).profile, 'FRONTEND_ONLY');

// Regression: the real changed-file combination that motivated old PR #243.
result = evaluate({
  changedFiles: ['index.html', 'src/home.ts', 'scripts/real-device-home-stage-verify.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.profile, 'FRONTEND_ONLY');
assert.equal(result.decision, 'PROCEED');
assert.equal(result.flags.backend, false);
assert.equal(result.flags.unknown, false);

// Negative: a generic script that merely mentions real-device, with no
// verification semantic segment, must not be classified as frontend
// evidence and stays UNKNOWN/STOP.
assert.equal(classifyFiles(['scripts/real-device-notes.mjs']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/real-device-setup.js']).profile, 'UNKNOWN');
result = evaluate({
  changedFiles: ['scripts/real-device-notes.mjs'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// Negative: a near-miss naming convention (not the delimited "real" then
// "device" segments) is not accepted by this rule.
assert.equal(classifyFiles(['scripts/realdevice-verify.mjs']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/device-real-verify.mjs']).profile, 'UNKNOWN');

// Negative: gateway-related scripts remain fail-closed and must not be
// accidentally accepted as frontend real-device verification evidence
// merely because the filename also contains "real-device" and a
// verification-looking word.
assert.equal(classifyFiles(['scripts/real-device-gateway-check.mjs']).profile, 'UNKNOWN');
result = evaluate({
  changedFiles: ['scripts/real-device-gateway-check.mjs'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// Negative: a real-device script that is also a dedicated gateway test
// (has both a "gateway" segment and a "test"/"selftest"/"spec" semantic
// segment) remains BACKEND_ONLY via the existing gateway rule, not
// reclassified as frontend by this rule.
assert.equal(classifyFiles(['scripts/real-device-gateway-test.mjs']).profile, 'BACKEND_ONLY');
result = evaluate({
  changedFiles: ['scripts/real-device-gateway-test.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_BACKEND_TEST'],
});
assert.equal(result.profile, 'BACKEND_ONLY');
assert.equal(result.decision, 'PROCEED');

// Negative: an actual gateway/ directory path beside a real-device-named
// script is still backend, not frontend, and does not fabricate a
// frontend anchor for an unrelated root JS file.
assert.equal(classifyFiles(['gateway/receiver/handler.ts', 'orders.js']).profile, 'UNKNOWN');
assert.notEqual(classifyFiles(['gateway/receiver/handler.ts', 'orders.js']).profile, 'FRONTEND_ONLY');

// Regression: existing classifications and fail-closed behavior remain
// unaffected by this narrow extension.
assert.equal(classifyFiles(['scripts/unrelated.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['scripts/gateway-tools.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['src/main.ts']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['src-tauri/src/lib.rs']).profile, 'BACKEND_ONLY');
assert.equal(classifyFiles(['gateway/viewer-core.mjs']).profile, 'BACKEND_ONLY');

// --- CLI argument handling (--help / unknown args), bounded spawn --------
//
// --help (or -h) as the only arg must print Usage and exit 0 quickly,
// without waiting on stdin. Any other CLI arg(s) must STOP with
// ARGUMENT_INVALID quickly, without waiting on stdin either.

let cli = spawnSync(process.execPath, [GATE_CLI_PATH, '--help'], { encoding: 'utf8', timeout: 2000 });
assert.equal(cli.status, 0, `--help expected exit 0: ${cli.stdout} ${cli.stderr}`);
assert(cli.stdout.includes('Usage'), `--help expected Usage text: ${cli.stdout}`);

cli = spawnSync(process.execPath, [GATE_CLI_PATH, '-h'], { encoding: 'utf8', timeout: 2000 });
assert.equal(cli.status, 0, `-h expected exit 0: ${cli.stdout} ${cli.stderr}`);
assert(cli.stdout.includes('Usage'), `-h expected Usage text: ${cli.stdout}`);

cli = spawnSync(process.execPath, [GATE_CLI_PATH, '--unknown'], { encoding: 'utf8', timeout: 2000 });
assert.equal(cli.status, 2, `--unknown expected exit 2: ${cli.stdout} ${cli.stderr}`);
assert(cli.stdout.includes('ARGUMENT_INVALID'), `--unknown expected ARGUMENT_INVALID: ${cli.stdout}`);
assert(cli.stderr.includes('VERIFICATION_SCOPE_GATE=STOP'), `--unknown expected STOP marker on stderr: ${cli.stderr}`);

cli = spawnSync(process.execPath, [GATE_CLI_PATH, '--help', 'extra'], { encoding: 'utf8', timeout: 2000 });
assert.equal(cli.status, 2, `--help plus extra arg expected exit 2: ${cli.stdout} ${cli.stderr}`);
assert(cli.stdout.includes('ARGUMENT_INVALID'), `--help plus extra arg expected ARGUMENT_INVALID: ${cli.stdout}`);

// --- Issue #404: fixed PWA app asset classification (narrow, exact-path) --
//
// The three fixed user-facing PWA app assets reproduced in Issue #404 must
// resolve to the established FRONTEND_ONLY profile instead of the prior
// CHANGE_SCOPE_UNKNOWN STOP. This is a closed, exact-path set, not a broad
// SVG/webmanifest/JSON allowance.

assert.equal(classifyFiles(['app/icon.svg']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['app/manifest.webmanifest']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['app/manifest-demo.webmanifest']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['app/icon.svg', 'app/manifest.webmanifest', 'app/manifest-demo.webmanifest']).profile, 'FRONTEND_ONLY');

// Case-insensitive exact-path match (same convention as the existing
// native-verification exact-path set, e.g. TOOLS/ISSUE66-TAP-RESULT.MJS above).
assert.equal(classifyFiles(['APP/ICON.SVG']).profile, 'FRONTEND_ONLY');
assert.equal(classifyFiles(['App/Manifest.Webmanifest']).profile, 'FRONTEND_ONLY');

// The exact Issue #404 reproducer now reaches PROCEED with the ordinary
// frontend minimum check; no new check type is introduced.
result = evaluate({
  changedFiles: ['app/icon.svg', 'app/manifest.webmanifest', 'app/manifest-demo.webmanifest'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.profile, 'FRONTEND_ONLY');
assert.equal(result.decision, 'PROCEED');
assert.equal(result.flags.unknown, false);

// Missing the frontend minimum check still STOPs (no silent relabel to PASS).
result = evaluate({
  changedFiles: ['app/icon.svg'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'REQUIRED_CHECK_MISSING');
assert(result.missingMinimumChecks.includes('TARGETED_FRONTEND_TEST'));

// Excessive checks (e.g. a full backend suite) alongside this profile are
// still flagged, unchanged from the normal frontend-only proportionality rule.
result = evaluate({
  changedFiles: ['app/icon.svg'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST', 'BACKEND_FULL_TEST'],
});
assert.equal(result.code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');

// Negative (adversarial): this is a closed, exact-path set, not a broad
// SVG/webmanifest/JSON allowance. Similarly named but non-reproduced paths
// must remain UNKNOWN/STOP, never silently relabeled as PASS.
assert.equal(classifyFiles(['app/icon2.svg']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/icons/icon.svg']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['icon.svg']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/manifest-staging.webmanifest']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/manifest.json']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['public/manifest.webmanifest']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/other-icon.svg']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['random.svg']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['data/config.json']).profile, 'UNKNOWN');

result = evaluate({
  changedFiles: ['app/icon.svg', 'app/icon2.svg'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

result = evaluate({
  changedFiles: ['random.svg'],
  plannedChecks: ['DIFF_HYGIENE'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// Negative: existing precedence for native-security, dependency, migration,
// and other runtime kinds (backend, CLI) is preserved even when a PWA asset
// path is present in the same changeset.
assert.equal(classifyFiles(['app/icon.svg', 'package-lock.json']).profile, 'DEPENDENCY_CHANGE');
assert.equal(classifyFiles(['app/icon.svg', 'migrations/0012_x.sql']).profile, 'DB_MIGRATION');
assert.equal(classifyFiles(['app/icon.svg', 'src-tauri/src/lib.rs']).profile, 'MIXED_RUNTIME');
assert.equal(classifyFiles(['app/icon.svg', 'src/cli.mjs']).profile, 'MIXED_RUNTIME');
assert.equal(classifyFiles(['app/icon.svg', 'src/cli/windows-hello-user-click.cpp']).profile, 'NATIVE_WINDOWS_SECURITY');
// Governance classification of its own dedicated files is unaffected; a
// PWA asset alongside an unrelated governance file still resolves via the
// pre-existing (unchanged) frontend-over-governance precedence.
assert.equal(classifyFiles(['.agents/skills/test-gate/SKILL.md']).profile, 'GOVERNANCE_ONLY');
assert.equal(classifyFiles(['app/icon.svg', '.agents/skills/test-gate/SKILL.md']).profile, 'FRONTEND_ONLY');

// Negative (Codex P1 fix): a fixed PWA asset must NOT act as a "strong
// frontend anchor" that pulls an unrelated root JS companion file (e.g.
// orders.js, which is otherwise UNKNOWN on its own — see the plain
// classifyFiles(['orders.js']) assertion above) into FRONTEND_ONLY via
// ROOT_FRONTEND_JS_COMPANION_RE. Before this fix, isFoundationPwaAsset(file)
// was included in hasStrongFrontendAnchor, which silently widened
// permission: ['app/icon.svg', 'orders.js'] resolved to FRONTEND_ONLY
// instead of the correct UNKNOWN. Each of the three fixed PWA asset paths is
// checked individually alongside orders.js; the PWA asset itself is still
// classified FRONTEND_ONLY on its own (see the direct per-file assertions
// above), but orders.js must remain unclassified, so the changeset as a
// whole must fail closed to UNKNOWN / STOP CHANGE_SCOPE_UNKNOWN.
assert.equal(classifyFiles(['app/icon.svg', 'orders.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/manifest.webmanifest', 'orders.js']).profile, 'UNKNOWN');
assert.equal(classifyFiles(['app/manifest-demo.webmanifest', 'orders.js']).profile, 'UNKNOWN');

result = evaluate({
  changedFiles: ['app/icon.svg', 'orders.js'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

result = evaluate({
  changedFiles: ['app/manifest.webmanifest', 'orders.js'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

result = evaluate({
  changedFiles: ['app/manifest-demo.webmanifest', 'orders.js'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(result.decision, 'STOP');
assert.equal(result.code, 'CHANGE_SCOPE_UNKNOWN');

// --- DDB #649 reviewed proof-script exact path set (MERGE_EXISTING) ----
//
// The three source-reviewed DDB proof scripts are a tightly closed exact
// path set, not a broadened scripts/* rule. Positive: the exact three
// paths classify as CLI_SCRIPT and PROCEED with the ordinary CLI minimum
// (DIFF_HYGIENE + TARGETED_SELFTEST).

const ddb649Files = [
  'scripts/personal-release-bundle-targets.selftest.mjs',
  'scripts/personal-v101-to-v110-rollback-source-gate.mjs',
  'scripts/personal-v101-to-v110-rollback-source-gate.selftest.mjs',
];

for (const file of ddb649Files) {
  assert.equal(classifyFiles([file]).profile, 'CLI_SCRIPT', file);
  const proceed = evaluate({
    changedFiles: [file],
    plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST'],
  });
  assert.equal(proceed.profile, 'CLI_SCRIPT', file);
  assert.equal(proceed.decision, 'PROCEED', file);
  assert.equal(proceed.flags.unknown, false, file);
  assert.equal(proceed.flags.nativeSecurity, false, file);

  const missingSelftest = evaluate({
    changedFiles: [file],
    plannedChecks: ['DIFF_HYGIENE'],
  });
  assert.equal(missingSelftest.decision, 'STOP', file);
  assert.equal(missingSelftest.code, 'REQUIRED_CHECK_MISSING', file);
  assert(missingSelftest.missingMinimumChecks.includes('TARGETED_SELFTEST'), file);
}

assert.equal(classifyFiles(ddb649Files).profile, 'CLI_SCRIPT');
let ddb649AllProceed = evaluate({
  changedFiles: ddb649Files,
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST'],
});
assert.equal(ddb649AllProceed.profile, 'CLI_SCRIPT');
assert.equal(ddb649AllProceed.decision, 'PROCEED');

// Negative (spoofed): a different name, nested path, extra suffix, .ps1
// extension, or native-looking file must NOT be swept into this exact set.
// Unrelated spoofed names with no other matching rule stay UNKNOWN.
for (const spoofed of [
  'scripts/personal-release-bundle-target.selftest.mjs',
  'scripts/personal-release-bundle-targets.selftest.mjs.bak',
  'scripts/nested/personal-release-bundle-targets.selftest.mjs',
  'scripts/personal-v101-to-v110-rollback-source-gate.ps1',
  'scripts/personal-v101-to-v110-rollback-source-gate.selftest.js',
  'scripts/personal-v101-to-v110-rollback-source-gate-extra.selftest.mjs',
  'tools/personal-v101-to-v110-rollback-source-gate.mjs',
]) {
  assert.equal(classifyFiles([spoofed]).profile, 'UNKNOWN', spoofed);
  assert.notEqual(classifyFiles([spoofed]).profile, 'CLI_SCRIPT', spoofed);
}

// Negative (native-security precedence preserved): adding this narrow
// exact CLI set does not weaken native-security priority elsewhere -- a
// security/consent-named native file still classifies as
// NATIVE_WINDOWS_SECURITY, never CLI_SCRIPT.
assert.equal(
  classifyFiles(['src/cli/personal-rollback-security-consent.ps1']).profile,
  'NATIVE_WINDOWS_SECURITY',
);

// Mixed full-scope classification: the three reviewed DDB proof scripts
// alongside an unrelated frontend file resolve to MIXED_RUNTIME, and
// alongside an unrelated backend file likewise resolve to MIXED_RUNTIME,
// each requiring both the CLI and the other runtime's targeted check.
let ddb649Mixed = evaluate({
  changedFiles: [...ddb649Files, 'src/main.ts'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'TARGETED_FRONTEND_TEST'],
});
assert.equal(ddb649Mixed.profile, 'MIXED_RUNTIME');
assert.equal(ddb649Mixed.decision, 'PROCEED');

ddb649Mixed = evaluate({
  changedFiles: [...ddb649Files, 'src-tauri/src/lib.rs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'TARGETED_BACKEND_TEST'],
});
assert.equal(ddb649Mixed.profile, 'MIXED_RUNTIME');
assert.equal(ddb649Mixed.decision, 'PROCEED');

// Mixed full-scope with an unknown file present: the UNKNOWN file still
// forces CHANGE_SCOPE_UNKNOWN/STOP even beside the three reviewed scripts,
// confirming the exact path set does not broaden tolerance for sibling
// unreviewed scripts/* files in the same change.
ddb649Mixed = evaluate({
  changedFiles: [...ddb649Files, 'scripts/unrelated-personal-task.mjs'],
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST'],
});
assert.equal(ddb649Mixed.decision, 'STOP');
assert.equal(ddb649Mixed.code, 'CHANGE_SCOPE_UNKNOWN');

// Excessive-checks precedence: planning FULL_REPOSITORY_SUITE for the
// ordinary CLI_SCRIPT profile without an escalation reason is unjustified.
let ddb649Excessive = evaluate({
  changedFiles: ddb649Files,
  plannedChecks: ['DIFF_HYGIENE', 'TARGETED_SELFTEST', 'FULL_REPOSITORY_SUITE'],
});
assert.equal(ddb649Excessive.code, 'EXCESSIVE_CHECKS_UNJUSTIFIED');

// --- Foundation Issue #404 / DWO Issue #162: reviewed DWO frontend asset
// and test exact-path set (bounded 16 positive / 9 negative) -------------
//
// Six exact DWO frontend assets and ten exact DWO frontend tests are a
// closed, exact-path set, not a broad assets/*.png, manifest*.webmanifest,
// or tests/*.test.js allowance. Positive: each of the sixteen exact paths
// resolves to FRONTEND_ONLY.

const dwo162PositivePaths = [
  'assets/approved-teeth-lower-20261021.png',
  'assets/approved-teeth-upper-20261021.png',
  'assets/pwa-icon-180.png',
  'assets/pwa-icon-192.png',
  'assets/pwa-icon-512.png',
  'manifest.webmanifest',
  'tests/all-expansion-responsive.test.js',
  'tests/approved-layout-contract.test.js',
  'tests/approved-reference-source.test.js',
  'tests/date-insurance-compact-spacing.test.js',
  'tests/expanded-fields-data-integrity.test.js',
  'tests/ipad-adaptive-clinic-lab.test.js',
  'tests/ipad-home-screen-webapp.test.js',
  'tests/ipad-safari-native-date-overflow.test.js',
  'tests/preview-sample-data.test.js',
  'tests/shade-selector-compact-layout.test.js',
];
assert.equal(dwo162PositivePaths.length, 16);
for (const file of dwo162PositivePaths) {
  assert.equal(classifyFiles([file]).profile, 'FRONTEND_ONLY', file);
}

// Negative (adversarial): a different suffix, nested directory, extra
// extension, unreviewed numeral, dev/config manifest variant, or unreviewed
// test name must NOT be swept into this exact set and must remain UNKNOWN.
const dwo162NegativePaths = [
  'assets/other-icon-180.png',
  'assets/pwa-icon-1024.png',
  'assets/pwa-icon-180.png.bak',
  'assets/nested/pwa-icon-180.png',
  'manifest-dev.webmanifest',
  'config.webmanifest',
  'tests/unknown-scope.test.js',
  'tests/native-auth.test.js',
  'tests/ipad-home-screen-webapp.e2e.js',
];
assert.equal(dwo162NegativePaths.length, 9);
for (const file of dwo162NegativePaths) {
  assert.equal(classifyFiles([file]).profile, 'UNKNOWN', file);
  assert.notEqual(classifyFiles([file]).profile, 'FRONTEND_ONLY', file);
}

console.log('verification-scope-gate selftest: PASS');

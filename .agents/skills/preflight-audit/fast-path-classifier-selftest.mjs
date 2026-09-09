#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const classifierArg = process.argv[2];
if (!classifierArg) throw new Error('classifier path required');
const classifierPath = resolve(classifierArg);
const classifier = await import(pathToFileURL(classifierPath).href);

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const impactKeys = [
  'production', 'network', 'realDevice', 'installOrAdoption',
  'dependency', 'securitySensitive', 'authOrCredential', 'mergeAuthority',
  'workflowOrDeployment', 'databaseOrMigration', 'externalDataRoute',
  'recurringCost', 'lifecycle', 'businessPolicy', 'architecture',
];

function impacts(overrides = {}) {
  return Object.fromEntries(impactKeys.map(key => [key, overrides[key] ?? false]));
}
function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceComplete: true,
    changeClass: 'routine',
    dataMode: 'source-only',
    executionScope: 'local-dev',
    impacts: impacts(),
    changedFiles: ['src/ui/label.ts'],
    ...overrides,
  };
}
function expectDecision(evidence, decision, reason = null) {
  const report = classifier.classifyChange(evidence);
  assert(report.decision === decision, `${decision} expected, got ${report.decision}`);
  if (reason) assert(report.reasons.includes(reason), `missing reason ${reason}`);
  return report;
}

const fast = expectDecision(fixture(), 'FAST_PATH', 'ALL_FAST_PATH_CONDITIONS_MET');
assert(fast.evidenceValid === true, 'fast evidence should be valid');
assert(fast.requiredChecks.includes('SECURITY_PREFLIGHT'), 'fast path must retain security preflight');
assert(fast.requiredChecks.includes('TARGETED_TESTS'), 'fast path must retain targeted tests');
assert(fast.requiredChecks.includes('GIT_DIFF_CHECK'), 'fast path must retain diff check');
assert(fast.requiredChecks.includes('MERGE_AUTHORIZATION_IF_MERGING'), 'merge authorization must remain');
assert(fast.skippedChecks.includes('FULL_SELFTEST_SUITE_HEAVY_FLOW_ONLY'), 'fast path should skip only heavy-flow-only full suite');
assert(!fast.skippedChecks.includes('FULL_SELFTEST_SUITE'), 'generic full-suite requirement must not be waived');
assert(fast.skippedChecks.includes('OPERATION_PREFLIGHT_MULTI_STEP_ONLY'), 'fast path should skip only multi-step-only operation preflight');
assert(!fast.skippedChecks.includes('OSS_PRIOR_ART_SCAN'), 'OSS review must retain its own trigger');
assert(!fast.skippedChecks.includes('INDEPENDENT_REVIEW'), 'independent review must retain its own trigger');
assert(!fast.skippedChecks.includes('HISTORICAL_GIT_AUDIT'), 'history audit must retain its own trigger');

expectDecision(fixture({ changeClass: 'implementation' }), 'FAST_PATH');
expectDecision(fixture({ changeClass: 'configuration' }), 'FAST_PATH');
expectDecision(fixture({ dataMode: 'synthetic' }), 'FAST_PATH');
expectDecision(fixture({ dataMode: 'public' }), 'FAST_PATH');
expectDecision(fixture({ evidenceComplete: false }), 'FULL_GATE', 'EVIDENCE_INCOMPLETE');
expectDecision(fixture({ changeClass: 'architecture' }), 'FULL_GATE', 'CHANGE_CLASS_REQUIRES_FULL_GATE');
expectDecision(fixture({ dataMode: 'real' }), 'FULL_GATE', 'DATA_MODE_REQUIRES_FULL_GATE');
expectDecision(fixture({ executionScope: 'network' }), 'FULL_GATE', 'EXECUTION_SCOPE_REQUIRES_FULL_GATE');
const impactReasons = {
  production: 'PRODUCTION_IMPACT', network: 'NETWORK_IMPACT', realDevice: 'REAL_DEVICE_IMPACT',
  installOrAdoption: 'INSTALL_OR_ADOPTION_IMPACT', dependency: 'DEPENDENCY_IMPACT',
  securitySensitive: 'SECURITY_SENSITIVE_IMPACT', authOrCredential: 'AUTH_OR_CREDENTIAL_IMPACT',
  mergeAuthority: 'MERGE_AUTHORITY_IMPACT', workflowOrDeployment: 'WORKFLOW_OR_DEPLOYMENT_IMPACT',
  databaseOrMigration: 'DATABASE_OR_MIGRATION_IMPACT', externalDataRoute: 'EXTERNAL_DATA_ROUTE_IMPACT',
  recurringCost: 'RECURRING_COST_IMPACT', lifecycle: 'LIFECYCLE_IMPACT',
  businessPolicy: 'BUSINESS_POLICY_IMPACT', architecture: 'ARCHITECTURE_IMPACT',
};
for (const key of impactKeys) {
  expectDecision(fixture({ impacts: impacts({ [key]: true }) }), 'FULL_GATE', impactReasons[key]);
}

const sensitivePaths = [
  ['src/auth/login.ts', 'SENSITIVE_PATH_SECURITY'],
  ['src/authentication/login.ts', 'SENSITIVE_PATH_SECURITY'],
  ['src/authorization/policy.ts', 'SENSITIVE_PATH_SECURITY'],
  ['src/security.ts', 'SENSITIVE_PATH_SECURITY'],
  ['src/db/query.ts', 'SENSITIVE_PATH_DATABASE'],
  ['src/db.ts', 'SENSITIVE_PATH_DATABASE'],
  ['.github/workflows/test.yml', 'SENSITIVE_PATH_WORKFLOW'],
  ['.gitlab-ci.yml', 'SENSITIVE_PATH_WORKFLOW'],
  ['deploy.yml', 'SENSITIVE_PATH_WORKFLOW'],
  ['Dockerfile.prod', 'SENSITIVE_PATH_WORKFLOW'],
  ['compose.yaml', 'SENSITIVE_PATH_WORKFLOW'],
  ['.agents/skills/final-pr-audit/gate.mjs', 'SENSITIVE_PATH_MERGE_GATE'],
  ['.agents/skills/preflight-audit/fast-path-classifier.mjs', 'SENSITIVE_PATH_GOVERNANCE_GATE'],
  ['.agents/skills/preflight-audit/SKILL.md', 'SENSITIVE_PATH_GOVERNANCE_GATE'],
  ['.agents/skills/preflight-audit/nested/gate.mjs', 'SENSITIVE_PATH_GOVERNANCE_GATE'],
  ['package-lock.json', 'SENSITIVE_PATH_DEPENDENCY'],
  ['bun.lock', 'SENSITIVE_PATH_DEPENDENCY'],
  ['Pipfile.lock', 'SENSITIVE_PATH_DEPENDENCY'],
  ['src/App.csproj', 'SENSITIVE_PATH_DEPENDENCY'],
  ['setup.py', 'SENSITIVE_PATH_DEPENDENCY'],
  ['pubspec.yaml', 'SENSITIVE_PATH_DEPENDENCY'],
];
for (const [path, reason] of sensitivePaths) {
  expectDecision(fixture({ changedFiles: [path] }), 'FULL_GATE', reason);
}

const invalidMissingImpact = fixture();
delete invalidMissingImpact.impacts.network;
let invalid = expectDecision(invalidMissingImpact, 'FULL_GATE', 'IMPACTS_INCOMPLETE');
assert(invalid.evidenceValid === false, 'missing impact must invalidate evidence');
invalid = expectDecision({ ...fixture(), unexpected: true }, 'FULL_GATE', 'EVIDENCE_UNKNOWN_FIELD');
assert(invalid.evidenceValid === false, 'unknown top field must invalidate evidence');
invalid = expectDecision(fixture({ impacts: { ...impacts(), unexpected: false } }), 'FULL_GATE', 'IMPACTS_UNKNOWN_FIELD');
assert(invalid.evidenceValid === false, 'unknown impact field must invalidate evidence');
invalid = expectDecision(fixture({ changedFiles: ['src/a.ts', 'src/a.ts'] }), 'FULL_GATE', 'CHANGED_FILES_DUPLICATE');
assert(invalid.evidenceValid === false, 'duplicate files must invalidate evidence');
invalid = expectDecision(fixture({ changedFiles: ['../outside.ts'] }), 'FULL_GATE', 'CHANGED_FILE_PATH_INVALID');
assert(invalid.evidenceValid === false, 'parent traversal must invalidate evidence');
invalid = expectDecision(fixture({ changedFiles: [] }), 'FULL_GATE', 'CHANGED_FILES_INVALID');
assert(invalid.evidenceValid === false, 'empty changed files must invalidate evidence');

const manyNormalFiles = Array.from({ length: 250 }, (_, i) => `src/ui/file-${i}.ts`);
expectDecision(fixture({ changedFiles: manyNormalFiles }), 'FAST_PATH');
invalid = expectDecision(fixture({ changedFiles: ['./src/a.ts'] }), 'FULL_GATE', 'CHANGED_FILE_PATH_INVALID');
assert(invalid.evidenceValid === false, 'non-canonical dot path must invalidate evidence');

const parsedBom = classifier.parseInput(`\uFEFF${JSON.stringify(fixture())}`);
assert(parsedBom.value?.schemaVersion === 1, 'BOM JSON should parse');
assert(classifier.parseInput('{bad').error === 'INPUT_JSON_INVALID', 'malformed JSON must fail closed');
assert(classifier.parseInput('x'.repeat(classifier.MAX_INPUT_BYTES + 1)).error === 'INPUT_TOO_LARGE', 'oversized input must fail closed');
function runCli(payload) {
  return spawnSync(process.execPath, [classifierPath], {
    encoding: 'utf8', input: payload, maxBuffer: 1024 * 1024,
  });
}

let cli = runCli(JSON.stringify(fixture()));
assert(cli.status === 0, `fast CLI should exit 0: ${cli.stderr}`);
assert(cli.stderr.includes('FAST_PATH_CLASSIFIER=FAST_PATH'), 'fast CLI status line missing');
assert(JSON.parse(cli.stdout).decision === 'FAST_PATH', 'fast CLI JSON mismatch');

cli = runCli(JSON.stringify(fixture({ changedFiles: ['src/security/policy.ts'] })));
assert(cli.status === 0, `valid full-gate CLI should exit 0: ${cli.stderr}`);
assert(cli.stderr.includes('FAST_PATH_CLASSIFIER=FULL_GATE'), 'full CLI status line missing');
assert(JSON.parse(cli.stdout).decision === 'FULL_GATE', 'full CLI JSON mismatch');

cli = spawnSync(process.execPath, [classifierPath, '--unknown'], { encoding: 'utf8', input: JSON.stringify(fixture()), maxBuffer: 1024 * 1024 });
assert(cli.status === 2, 'unknown CLI option must fail closed');
assert(JSON.parse(cli.stdout).reasons[0] === 'CLI_ARGUMENT_INVALID', 'unknown CLI reason mismatch');

cli = spawnSync(process.execPath, [classifierPath, 'positional'], { encoding: 'utf8', input: JSON.stringify(fixture()), maxBuffer: 1024 * 1024 });
assert(cli.status === 2, 'positional CLI arg must fail closed');

cli = runCli('{bad');
assert(cli.status === 2, 'invalid CLI evidence must exit 2');
assert(cli.stderr.includes('FAST_PATH_CLASSIFIER=FULL_GATE'), 'invalid CLI must identify full gate');
const invalidCliReport = JSON.parse(cli.stdout);
assert(invalidCliReport.evidenceValid === false, 'invalid CLI evidenceValid mismatch');
assert(invalidCliReport.reasons[0] === 'INPUT_JSON_INVALID', 'invalid CLI reason mismatch');

console.log('fast-path-classifier selftest: PASS');

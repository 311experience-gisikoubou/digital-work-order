#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const selectorArg = process.argv[2];
if (!selectorArg) throw new Error('selector path required');
const selectorPath = resolve(selectorArg);
const selector = await import(pathToFileURL(selectorPath).href);
const impactKeys = [
  'production','network','realDevice','installOrAdoption','dependency','securitySensitive','authOrCredential','mergeAuthority',
  'workflowOrDeployment','databaseOrMigration','externalDataRoute','recurringCost','lifecycle','businessPolicy','architecture',
];
function impacts(overrides = {}) {
  return Object.fromEntries(impactKeys.map(key => [key, overrides[key] ?? false]));
}
function fixture(changedFiles, overrides = {}) {
  return { schemaVersion:1, evidenceComplete:true, changeClass:'implementation', dataMode:'source-only', executionScope:'local-dev', impacts:impacts(), changedFiles, ...overrides };
}
function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}
function select(files, overrides = {}) {
  return selector.selectSelftests(fixture(files, overrides));
}
const operationCodeOnly = select([
  '.agents/skills/preflight-audit/operation-preflight.mjs',
  '.agents/skills/preflight-audit/operation-preflight-selftest.mjs',
  'CHANGELOG.md','VERSION',
]);
assert(operationCodeOnly.selection === 'IMPACT_SCOPED', 'operation code-only change should be impact scoped');
assert(operationCodeOnly.commands.length === operationCodeOnly.selectedTests.length, 'commands must match selected test count');
assert(operationCodeOnly.commands.every((item,i) => item.id === operationCodeOnly.selectedTests[i] && item.argv[0] === 'node'), 'commands must align with selected tests');
for (const id of ['merge-authorization','merge-execution','fast-path','security-preflight','full-gate-selector','operation-preflight']) {
  assert(operationCodeOnly.selectedTests.includes(id), `missing operation/core test ${id}`);
}
for (const id of ['claude-runner','foundation-update','stagnation','project-context','foundation-bootstrap']) {
  assert(!operationCodeOnly.selectedTests.includes(id), `unrelated slow test selected: ${id}`);
}

const operationWithSharedDoc = select([
  '.agents/skills/preflight-audit/operation-preflight.mjs',
  '.agents/skills/preflight-audit/SKILL.md',
]);
assert(operationWithSharedDoc.selection === 'FULL_SUITE', 'preflight shared instruction file must use full suite');
assert(operationWithSharedDoc.reasons.includes('HIGH_COUPLING_PATH_REQUIRES_FULL_SUITE'), 'preflight shared instruction reason missing');
const routing = select(['.agents/skills/preflight-audit/ai-task-router.mjs']);
for (const id of ['ai-provider-inventory','ai-task-router','provider-qualification','provider-readiness']) {
  assert(routing.selectedTests.includes(id), `routing group missing ${id}`);
}
const foundation = select(['.agents/skills/foundation-sync-audit/foundation-update.mjs']);
for (const id of ['foundation-sync','foundation-bootstrap','foundation-update','foundation-remote-plan']) {
  assert(foundation.selectedTests.includes(id), `foundation group missing ${id}`);
}
const mixedHandoffDoc = select([
  '.agents/skills/preflight-audit/operation-preflight.mjs',
  '.agents/skills/handoff/SKILL.md',
]);
assert(mixedHandoffDoc.selection === 'FULL_SUITE', 'handoff skill documentation must use full suite');
assert(mixedHandoffDoc.reasons.includes('HIGH_COUPLING_PATH_REQUIRES_FULL_SUITE'), 'handoff skill documentation reason missing');

const mergeDoc = select([
  '.agents/skills/preflight-audit/operation-preflight.mjs',
  '.agents/skills/final-pr-audit/SKILL.md',
]);
assert(mergeDoc.selection === 'FULL_SUITE', 'merge-control documentation must use full suite');
assert(mergeDoc.reasons.includes('HIGH_COUPLING_PATH_REQUIRES_FULL_SUITE'), 'merge-control documentation reason missing');
const declaredImpact = select(
  ['.agents/skills/preflight-audit/operation-preflight.mjs'],
  { impacts: impacts({ dependency:true }) },
);
assert(declaredImpact.selection === 'FULL_SUITE', 'declared impact must use full suite');
assert(declaredImpact.reasons.includes('DECLARED_IMPACT_REQUIRES_FULL_SUITE'), 'declared impact reason missing');
const architectureImpact = select(
  ['.agents/skills/preflight-audit/operation-preflight.mjs'],
  { impacts: impacts({ architecture:true }) },
);
assert(architectureImpact.selection === 'FULL_SUITE', 'architecture impact must use full suite');

const unknown = select(['.agents/skills/preflight-audit/new-unknown-gate.mjs']);
assert(unknown.selection === 'FULL_SUITE', 'unknown governance path must use full suite');
assert(unknown.reasons.includes('UNMAPPED_CHANGED_PATH_REQUIRES_FULL_SUITE'), 'unknown path reason missing');
const highCoupling = select(['.agents/skills/preflight-audit/fast-path-classifier.mjs']);
assert(highCoupling.selection === 'FULL_SUITE', 'fast-path classifier change must use full suite');
assert(highCoupling.selectedTests.length === 21 && highCoupling.commands.length === 21, 'full suite must include all 21 selftests');
assert(highCoupling.reasons.includes('HIGH_COUPLING_PATH_REQUIRES_FULL_SUITE'), 'high coupling reason missing');

const docsOnly = select(['CHANGELOG.md','VERSION']);
assert(docsOnly.selection === 'FULL_SUITE', 'metadata-only governance change must not self-authorize narrow tests');
assert(docsOnly.reasons.includes('NO_MAPPED_IMPLEMENTATION_CHANGE'), 'metadata-only reason missing');
const skillOnly = select(['.agents/skills/preflight-audit/SKILL.md']);
assert(skillOnly.selection === 'FULL_SUITE', 'skill-only governance change must use full suite');
const incomplete = select(
  ['.agents/skills/preflight-audit/operation-preflight.mjs'],
  { evidenceComplete:false },
);
assert(incomplete.selection === 'FULL_SUITE' && incomplete.evidenceValid === true, 'incomplete evidence must safely use full suite');
const invalid = selector.selectSelftests({ schemaVersion:1 });
assert(invalid.selection === 'FULL_SUITE' && invalid.evidenceValid === false, 'invalid evidence must fail closed');

const cli = spawnSync(
  process.execPath,
  [selectorPath],
  { input:JSON.stringify(fixture(['.agents/skills/preflight-audit/operation-preflight.mjs'])), encoding:'utf8' },
);
assert(cli.status === 0, `selector CLI should pass: ${cli.stderr}`);
assert(JSON.parse(cli.stdout).selection === 'IMPACT_SCOPED', 'CLI selection mismatch');
const badCli = spawnSync(process.execPath, [selectorPath,'--bogus'], { input:'{}', encoding:'utf8' });
assert(badCli.status === 2, 'unsupported CLI args must exit 2');
console.log('full-gate-selftest-selector selftest: PASS');

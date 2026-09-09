#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const SCHEMA_VERSION = 1;
export const MAX_INPUT_BYTES = 64 * 1024;

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'evidenceComplete', 'changeClass', 'dataMode',
  'executionScope', 'impacts', 'changedFiles',
]);
const IMPACT_KEYS = [
  'production', 'network', 'realDevice', 'installOrAdoption',
  'dependency', 'securitySensitive', 'authOrCredential', 'mergeAuthority',
  'workflowOrDeployment', 'databaseOrMigration', 'externalDataRoute',
  'recurringCost', 'lifecycle', 'businessPolicy', 'architecture',
];
const FAST_CHANGE_CLASSES = new Set(['routine', 'configuration', 'implementation']);
const ALLOWED_CHANGE_CLASSES = new Set([
  ...FAST_CHANGE_CLASSES, 'architecture', 'install-adoption',
  'external-data-route', 'recurring-cost', 'lifecycle-responsibility',
  'workflow-impact', 'business-policy',
]);
const FAST_DATA_MODES = new Set(['source-only', 'synthetic', 'public']);
const ALLOWED_DATA_MODES = new Set([...FAST_DATA_MODES, 'real', 'protected']);
const ALLOWED_EXECUTION_SCOPES = new Set([
  'local-dev', 'interactive', 'real-device', 'network', 'production',
]);
const FAST_REQUIRED_CHECKS = [
  'SECURITY_PREFLIGHT', 'TARGETED_TESTS', 'GIT_DIFF_CHECK',
  'MERGE_AUTHORIZATION_IF_MERGING',
];
const FAST_SKIPPED_CHECKS = [
  'OPERATION_PREFLIGHT_MULTI_STEP_ONLY', 'FULL_SELFTEST_SUITE_HEAVY_FLOW_ONLY',
];
const FULL_REQUIRED_CHECKS = ['EXISTING_FULL_GATE_FLOW', 'MERGE_AUTHORIZATION_IF_MERGING'];

const SENSITIVE_PATH_RULES = [
  ['SENSITIVE_PATH_SECURITY', /(^|\/)(auth|authentication|authorization|oauth|security|credentials?|secrets?|permissions?)(?:[._-][^/]*)?(\/|$)|(^|\/)\.env(?:\.|$)/i],
  ['SENSITIVE_PATH_DATABASE', /(^|\/)(db|database|migrations?|schema)(?:[._-][^/]*)?(\/|$)|\.sql$/i],
  ['SENSITIVE_PATH_WORKFLOW', /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)\.circleci\/|(^|\/)azure-pipelines\.ya?ml$|(^|\/)Jenkinsfile$|(^|\/)bitbucket-pipelines\.ya?ml$|(^|\/)(deploy|deployment|infra|terraform|k8s|kubernetes|helm)(?:[._-][^\/]*)?(\/|$)|(^|\/)Dockerfile(?:\.[^\/]+)?$|(^|\/)(?:docker-)?compose(?:\.[^\/]+)?\.ya?ml$/i],
  ['SENSITIVE_PATH_MERGE_GATE', /(^|\/)\.agents\/skills\/final-pr-audit(\/|$)/i],
  ['SENSITIVE_PATH_GOVERNANCE_GATE', /(^|\/)\.agents\/skills\//i],
  ['SENSITIVE_PATH_DEPENDENCY', /(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.(?:toml|lock)|pyproject\.toml|poetry\.lock|uv\.lock|requirements[^/]*\.txt|Pipfile(?:\.lock)?|Gemfile(?:\.lock)?|go\.(?:mod|sum)|composer\.(?:json|lock)|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.lockfile|[^/]+\.csproj|Directory\.Packages\.props|packages\.lock\.json|setup\.(?:py|cfg)|pubspec\.(?:yaml|lock)|mix\.(?:exs|lock)|Package\.(?:swift|resolved))$/i],
];

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(object, allowed) {
  return Object.keys(object).every(key => allowed.has(key));
}
function validRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && !value.includes('\\') && !value.includes('\0')
    && !value.startsWith('/') && !/^[A-Za-z]:\//.test(value)
    && !value.split('/').some(part => part === '..' || part === '.' || part === '');
}
function invalidReport(code) {
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceValid: false,
    decision: 'FULL_GATE',
    reasons: [code],
    requiredChecks: FULL_REQUIRED_CHECKS,
    skippedChecks: [],
  };
}

export function validateEvidence(evidence) {
  if (!isObject(evidence)) return 'EVIDENCE_SHAPE_INVALID';
  if (!exactKeys(evidence, TOP_LEVEL_KEYS)) return 'EVIDENCE_UNKNOWN_FIELD';
  if (evidence.schemaVersion !== SCHEMA_VERSION) return 'EVIDENCE_SCHEMA_UNSUPPORTED';
  if (typeof evidence.evidenceComplete !== 'boolean') return 'EVIDENCE_COMPLETE_FLAG_INVALID';
  if (!ALLOWED_CHANGE_CLASSES.has(evidence.changeClass)) return 'CHANGE_CLASS_INVALID';
  if (!ALLOWED_DATA_MODES.has(evidence.dataMode)) return 'DATA_MODE_INVALID';
  if (!ALLOWED_EXECUTION_SCOPES.has(evidence.executionScope)) return 'EXECUTION_SCOPE_INVALID';
  if (!isObject(evidence.impacts)) return 'IMPACTS_INVALID';
  if (!exactKeys(evidence.impacts, new Set(IMPACT_KEYS))) return 'IMPACTS_UNKNOWN_FIELD';
  if (Object.keys(evidence.impacts).length !== IMPACT_KEYS.length) return 'IMPACTS_INCOMPLETE';
  if (IMPACT_KEYS.some(key => typeof evidence.impacts[key] !== 'boolean')) return 'IMPACT_FLAG_INVALID';
  if (!Array.isArray(evidence.changedFiles) || evidence.changedFiles.length === 0) return 'CHANGED_FILES_INVALID';
  if (evidence.changedFiles.some(path => !validRepoPath(path))) return 'CHANGED_FILE_PATH_INVALID';
  if (new Set(evidence.changedFiles).size !== evidence.changedFiles.length) return 'CHANGED_FILES_DUPLICATE';
  return null;
}

function sensitivePathReasons(changedFiles) {
  const reasons = new Set();
  for (const path of changedFiles) {
    for (const [code, pattern] of SENSITIVE_PATH_RULES) {
      if (pattern.test(path)) reasons.add(code);
    }
  }
  return [...reasons];
}
export function classifyChange(evidence) {
  const validationError = validateEvidence(evidence);
  if (validationError) return invalidReport(validationError);

  const reasons = [];
  if (!evidence.evidenceComplete) reasons.push('EVIDENCE_INCOMPLETE');
  if (!FAST_CHANGE_CLASSES.has(evidence.changeClass)) reasons.push('CHANGE_CLASS_REQUIRES_FULL_GATE');
  if (!FAST_DATA_MODES.has(evidence.dataMode)) reasons.push('DATA_MODE_REQUIRES_FULL_GATE');
  if (evidence.executionScope !== 'local-dev') reasons.push('EXECUTION_SCOPE_REQUIRES_FULL_GATE');

  const impactReasonCodes = {
    production: 'PRODUCTION_IMPACT', network: 'NETWORK_IMPACT', realDevice: 'REAL_DEVICE_IMPACT',
    installOrAdoption: 'INSTALL_OR_ADOPTION_IMPACT', dependency: 'DEPENDENCY_IMPACT',
    securitySensitive: 'SECURITY_SENSITIVE_IMPACT', authOrCredential: 'AUTH_OR_CREDENTIAL_IMPACT',
    mergeAuthority: 'MERGE_AUTHORITY_IMPACT', workflowOrDeployment: 'WORKFLOW_OR_DEPLOYMENT_IMPACT',
    databaseOrMigration: 'DATABASE_OR_MIGRATION_IMPACT', externalDataRoute: 'EXTERNAL_DATA_ROUTE_IMPACT',
    recurringCost: 'RECURRING_COST_IMPACT', lifecycle: 'LIFECYCLE_IMPACT',
    businessPolicy: 'BUSINESS_POLICY_IMPACT', architecture: 'ARCHITECTURE_IMPACT',
  };
  for (const key of IMPACT_KEYS) {
    if (evidence.impacts[key]) reasons.push(impactReasonCodes[key]);
  }
  reasons.push(...sensitivePathReasons(evidence.changedFiles));

  if (reasons.length > 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      evidenceValid: true,
      decision: 'FULL_GATE',
      reasons: [...new Set(reasons)],
      requiredChecks: FULL_REQUIRED_CHECKS,
      skippedChecks: [],
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    evidenceValid: true,
    decision: 'FAST_PATH',
    reasons: ['ALL_FAST_PATH_CONDITIONS_MET'],
    requiredChecks: FAST_REQUIRED_CHECKS,
    skippedChecks: FAST_SKIPPED_CHECKS,
  };
}
export function parseInput(raw) {
  const text = String(raw ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) return { error: 'INPUT_TOO_LARGE' };
  const jsonText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  let parsed;
  try { parsed = JSON.parse(jsonText); } catch { return { error: 'INPUT_JSON_INVALID' }; }
  return { value: parsed };
}

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_INPUT_BYTES) return { error: 'INPUT_TOO_LARGE' };
    chunks.push(chunk);
  }
  return parseInput(chunks.join(''));
}

function validateCliArgs(argv) {
  if (argv.length === 0) return null;
  if (argv.length === 1 && argv[0] === '--pretty') return null;
  return 'CLI_ARGUMENT_INVALID';
}

async function main() {
  const cliError = validateCliArgs(process.argv.slice(2));
  if (cliError) {
    const report = invalidReport(cliError);
    console.log(JSON.stringify(report));
    console.error(`FAST_PATH_CLASSIFIER=${report.decision}`);
    process.exitCode = 2;
    return;
  }
  const input = await readStdin();
  const report = input.error ? invalidReport(input.error) : classifyChange(input.value);
  console.log(JSON.stringify(report, null, process.argv.includes('--pretty') ? 2 : 0));
  console.error(`FAST_PATH_CLASSIFIER=${report.decision}`);
  if (!report.evidenceValid) process.exitCode = 2;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) await main();

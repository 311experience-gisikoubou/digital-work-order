#!/usr/bin/env node
// production-readiness-preflight.mjs
//
// Dependency-free, read-only, local/repository-scoped checks that the
// Phase 5-8 cloud/gateway repository contracts described in cloud/README.md
// and gateway/README.md have not drifted, and that no production runtime
// config/secret file has been accidentally tracked at an obvious path.
//
// This script performs NO network access and NO cloud CLI calls. It never
// mutates any file. It never prints file contents or secret-like values.
//
// See docs/production-activation-runbook.md Stage 0.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_CORS_ORIGIN = 'https://311experience-gisikoubou.github.io';
const EXPECTED_CORS_METHOD = 'PUT';
const EXPECTED_CORS_RESPONSE_HEADERS = ['Content-Type', 'Range', 'X-Goog-Hash'];
const EXPECTED_CORS_MAX_AGE_CEILING = 3600;
const EXPECTED_LIFECYCLE_AGE_DAYS = 30;
const EXPECTED_FUNCTIONS_CODEBASE = 'relay';
const EXPECTED_FUNCTIONS_RUNTIME = 'nodejs22';

const OBVIOUS_SECRET_PATH_CANDIDATES = [
  '.firebaserc',
  'cloud/.firebaserc',
  'gateway/gateway-config.json',
  'gateway/sender-registry.json',
];

const SHALLOW_SCAN_DIRS = ['.', 'cloud', 'gateway', 'gateway/windows'];

// Extension-aware runtime secret/config artifact patterns.
// These intentionally require a runtime-data extension (e.g. .json) so that
// legitimate tracked *source* scripts whose filename merely contains a
// secret-related word (for example gateway/windows/protect-receiver-secrets.ps1)
// are never matched. Only actual generated/runtime artifacts are flagged.
const SUSPICIOUS_FILENAME_PATTERNS = [
  /^.*service[-_]?account.*\.json$/i,
  /^.*adminsdk.*\.json$/i,
  /^.*\.dpapi\.json$/i,
  /^.*receiver-secrets.*\.json$/i,
  /^.*recipient-backup.*\.json$/i,
  /^.*credential.*\.json$/i,
];

function pass(id, message) {
  return { id, status: 'PASS', message };
}

function stop(id, message) {
  return { id, status: 'STOP', message };
}

// ---- pure contract checks (exported for selftest) ----

export function checkFirebaseJson(json) {
  if (!json || typeof json !== 'object') {
    return stop('firebase-json', 'cloud/firebase.json is missing or not an object');
  }
  const fn = json.functions;
  if (!fn || typeof fn !== 'object') {
    return stop('firebase-json', 'cloud/firebase.json has no functions block');
  }
  if (fn.codebase !== EXPECTED_FUNCTIONS_CODEBASE) {
    return stop('firebase-json', 'cloud/firebase.json functions.codebase drifted from "relay"');
  }
  if (fn.runtime !== EXPECTED_FUNCTIONS_RUNTIME) {
    return stop('firebase-json', 'cloud/firebase.json functions.runtime drifted from "nodejs22"');
  }
  return pass('firebase-json', 'functions.codebase=relay, functions.runtime=nodejs22');
}

export function checkStorageLifecycle(json) {
  if (!json || !Array.isArray(json.rule) || json.rule.length !== 1) {
    return stop('storage-lifecycle', 'cloud/storage-lifecycle.json does not have exactly one rule');
  }
  const rule = json.rule[0];
  if (!rule || !rule.action || rule.action.type !== 'Delete') {
    return stop('storage-lifecycle', 'cloud/storage-lifecycle.json rule action is not Delete');
  }
  if (!rule.condition || rule.condition.age !== EXPECTED_LIFECYCLE_AGE_DAYS) {
    return stop('storage-lifecycle', 'cloud/storage-lifecycle.json condition.age drifted from 30');
  }
  return pass('storage-lifecycle', 'Delete age=30 emergency lifecycle rule intact');
}

export function checkStorageCors(json) {
  if (!Array.isArray(json) || json.length !== 1) {
    return stop('storage-cors', 'cloud/storage-cors.json does not have exactly one CORS entry');
  }
  const entry = json[0];
  if (
    !entry ||
    !Array.isArray(entry.origin) ||
    entry.origin.length !== 1 ||
    entry.origin[0] !== EXPECTED_CORS_ORIGIN
  ) {
    return stop('storage-cors', 'cloud/storage-cors.json origin is not exactly the production GitHub Pages origin');
  }
  if (!Array.isArray(entry.method) || entry.method.length !== 1 || entry.method[0] !== EXPECTED_CORS_METHOD) {
    return stop('storage-cors', 'cloud/storage-cors.json method is not exactly ["PUT"]');
  }
  if (!Array.isArray(entry.responseHeader)) {
    return stop('storage-cors', 'cloud/storage-cors.json responseHeader is missing');
  }
  const actual = [...entry.responseHeader].sort();
  const expected = [...EXPECTED_CORS_RESPONSE_HEADERS].sort();
  const headersMatch =
    actual.length === expected.length && actual.every((header, index) => header === expected[index]);
  if (!headersMatch) {
    return stop('storage-cors', 'cloud/storage-cors.json responseHeader drifted from the expected safe header set');
  }
  if (
    typeof entry.maxAgeSeconds !== 'number' ||
    !Number.isFinite(entry.maxAgeSeconds) ||
    entry.maxAgeSeconds <= 0 ||
    entry.maxAgeSeconds > EXPECTED_CORS_MAX_AGE_CEILING
  ) {
    return stop('storage-cors', 'cloud/storage-cors.json maxAgeSeconds is missing or outside the expected bound');
  }
  return pass('storage-cors', 'production origin, PUT-only, expected safe headers/maxAge intact');
}

export function checkDenyAllRules(text, label) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return stop(label, `${label} is missing or empty`);
  }
  const allowMatches = text.match(/allow\s+[a-zA-Z,\s]+:\s*if\s+[^;]+;/g) || [];
  if (allowMatches.length !== 1) {
    return stop(label, `${label} does not have exactly one allow rule`);
  }
  const isDenyAll = /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(allowMatches[0]);
  if (!isDenyAll) {
    return stop(label, `${label} allow rule is not deny-all`);
  }
  return pass(label, 'deny-all client rule intact');
}

export function checkGatewayConfigExample(json) {
  if (!json || typeof json !== 'object') {
    return stop('gateway-config-example', 'gateway/gateway-config.example.json is missing or not an object');
  }
  if (typeof json.relayEndpoint !== 'string' || !json.relayEndpoint.includes('REPLACE_WITH')) {
    return stop(
      'gateway-config-example',
      'gateway/gateway-config.example.json relayEndpoint is not a non-secret placeholder'
    );
  }
  if (json.activeRecipientKeyId !== null) {
    return stop('gateway-config-example', 'gateway/gateway-config.example.json activeRecipientKeyId is not null');
  }
  if (json.inboxRoot !== null) {
    return stop('gateway-config-example', 'gateway/gateway-config.example.json inboxRoot is not null');
  }
  const forbiddenKeyPattern = /(token|passphrase|secret|privatekey|serviceaccount|credential)/i;
  const trackedKeys = Object.keys(json).filter((key) => forbiddenKeyPattern.test(key));
  if (trackedKeys.length > 0) {
    return stop(
      'gateway-config-example',
      'gateway/gateway-config.example.json contains an unexpected secret-shaped key'
    );
  }
  return pass('gateway-config-example', 'template remains non-secret/template-shaped');
}

export function findObviousSecretPaths(repoRoot) {
  const findings = [];

  for (const candidate of OBVIOUS_SECRET_PATH_CANDIDATES) {
    const fullPath = join(repoRoot, candidate);
    if (existsSync(fullPath)) {
      findings.push(stop('tracked-secret-path', `tracked production-config/secret-shaped path present: ${candidate}`));
    }
  }

  for (const dir of SHALLOW_SCAN_DIRS) {
    const fullDir = join(repoRoot, dir);
    let entries;
    try {
      entries = readdirSync(fullDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (SUSPICIOUS_FILENAME_PATTERNS.some((pattern) => pattern.test(entry.name))) {
        const relPath = dir === '.' ? entry.name : `${dir}/${entry.name}`;
        findings.push(stop('tracked-secret-path', `secret-shaped filename present at obvious path: ${relPath}`));
      }
    }
  }

  if (findings.length === 0) {
    findings.push(pass('tracked-secret-path', 'no production runtime config/secret file found at obvious paths'));
  }

  return findings;
}

// ---- argument parsing (exported for selftest) ----

export function parseArgs(argv) {
  let repoRoot;
  let pretty = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--pretty') {
      pretty = true;
      continue;
    }
    if (arg === '--repo-root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('malformed argument: --repo-root requires a value');
      }
      repoRoot = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      const value = arg.slice('--repo-root='.length);
      if (!value) {
        throw new Error('malformed argument: --repo-root= requires a value');
      }
      repoRoot = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return { repoRoot, pretty };
}

// ---- file loading helpers ----

function readJsonFileSafe(repoRoot, relPath, findings, checkId) {
  const fullPath = join(repoRoot, relPath);
  let raw;
  try {
    raw = readFileSync(fullPath, 'utf8');
  } catch {
    findings.push(stop(checkId, `${relPath} is missing or unreadable`));
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch {
    findings.push(stop(checkId, `${relPath} is not valid JSON`));
    return undefined;
  }
}

function readTextFileSafe(repoRoot, relPath, findings, checkId) {
  const fullPath = join(repoRoot, relPath);
  try {
    return readFileSync(fullPath, 'utf8');
  } catch {
    findings.push(stop(checkId, `${relPath} is missing or unreadable`));
    return undefined;
  }
}

// ---- top-level orchestration (exported for selftest) ----

export function runPreflight(repoRoot) {
  const findings = [];

  if (!repoRoot || typeof repoRoot !== 'string') {
    return {
      status: 'STOP',
      findings: [stop('repo-root', 'repo root is missing or invalid')],
      nextHumanGates: nextHumanGatesList(),
    };
  }

  let repoRootStat;
  try {
    repoRootStat = statSync(repoRoot);
  } catch {
    return {
      status: 'STOP',
      findings: [stop('repo-root', 'repo root path does not exist')],
      nextHumanGates: nextHumanGatesList(),
    };
  }
  if (!repoRootStat.isDirectory()) {
    return {
      status: 'STOP',
      findings: [stop('repo-root', 'repo root path is not a directory')],
      nextHumanGates: nextHumanGatesList(),
    };
  }

  const firebaseJson = readJsonFileSafe(repoRoot, 'cloud/firebase.json', findings, 'firebase-json');
  if (firebaseJson !== undefined) {
    findings.push(checkFirebaseJson(firebaseJson));
  }

  const lifecycleJson = readJsonFileSafe(repoRoot, 'cloud/storage-lifecycle.json', findings, 'storage-lifecycle');
  if (lifecycleJson !== undefined) {
    findings.push(checkStorageLifecycle(lifecycleJson));
  }

  const corsJson = readJsonFileSafe(repoRoot, 'cloud/storage-cors.json', findings, 'storage-cors');
  if (corsJson !== undefined) {
    findings.push(checkStorageCors(corsJson));
  }

  const firestoreRulesText = readTextFileSafe(repoRoot, 'cloud/firestore.rules', findings, 'firestore-rules');
  if (firestoreRulesText !== undefined) {
    findings.push(checkDenyAllRules(firestoreRulesText, 'firestore-rules'));
  }

  const storageRulesText = readTextFileSafe(repoRoot, 'cloud/storage.rules', findings, 'storage-rules');
  if (storageRulesText !== undefined) {
    findings.push(checkDenyAllRules(storageRulesText, 'storage-rules'));
  }

  const gatewayConfigExampleJson = readJsonFileSafe(
    repoRoot,
    'gateway/gateway-config.example.json',
    findings,
    'gateway-config-example'
  );
  if (gatewayConfigExampleJson !== undefined) {
    findings.push(checkGatewayConfigExample(gatewayConfigExampleJson));
  }

  findings.push(...findObviousSecretPaths(repoRoot));

  const status = findings.every((finding) => finding.status === 'PASS') ? 'PASS' : 'STOP';

  return {
    status,
    findings,
    nextHumanGates: nextHumanGatesList(),
  };
}

function nextHumanGatesList() {
  return [
    'Stage 1 (HUMAN_APPROVAL_REQUIRED / HUMAN_INTERACTIVE): confirm exact Firebase/Google Cloud project and Blaze billing identity',
    'Stage 2 (HUMAN_APPROVAL_REQUIRED / HUMAN_INTERACTIVE): configure spend controls (budget alert amount is a human business decision)',
    'Stage 3 (HUMAN_APPROVAL_REQUIRED / HUMAN_INTERACTIVE): confirm exact dedicated relay bucket name and location before any bucket command',
    'Stage 4 (HUMAN_APPROVAL_REQUIRED / HUMAN_INTERACTIVE): grant least-privilege runtime IAM',
    'Stage 5 (HUMAN_INTERACTIVE): generate receiver token hash/key id and protect with Windows DPAPI CurrentUser on the lab PC',
    'Stage 8 (HUMAN_INTERACTIVE): register the Windows Scheduled Task as the DPAPI-owning user',
    'Stage 9 (HUMAN_APPROVAL_REQUIRED): decide backup target and retention policy (intentionally unresolved)',
    'Stage 10 (HUMAN_APPROVAL_REQUIRED): explicitly authorize real-data go-live',
  ];
}

// ---- CLI entry point ----

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const result = {
      status: 'STOP',
      findings: [stop('args', error.message)],
      nextHumanGates: nextHumanGatesList(),
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }

  const repoRoot = resolve(args.repoRoot ?? defaultRepoRoot());
  const result = runPreflight(repoRoot);
  const output = args.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
  process.stdout.write(`${output}\n`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}

function defaultRepoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

const isDirectRun = (() => {
  try {
    return resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}

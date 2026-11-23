#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const inventoryArg = process.argv[2];
const routerArg = process.argv[3];
if (!inventoryArg || !routerArg) throw new Error('inventory and router paths required');

const inventoryUrl = pathToFileURL(resolve(inventoryArg)).href;
const routerUrl = pathToFileURL(resolve(routerArg)).href;
const { buildInventory, conservativeCodexCapacity, resolveProviderCommand, observeGenericCli } = await import(inventoryUrl);
const { validateRoute, routeTask } = await import(routerUrl);

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function codex(overrides = {}) {
  return {
    cliStatus: 'AVAILABLE',
    version: 'Codex 1.2.3 extra text',
    capacity: {
      status: 'AVAILABLE',
      source: 'codex_app_server_account_rateLimits_read',
      primary: { remainingPercent: 80 },
      secondary: { remainingPercent: 60 },
    },
    ...overrides,
  };
}

function claude(overrides = {}) {
  return {
    cliStatus: 'AVAILABLE',
    version: 'Claude Code 2.3.4',
    auth: { status: 'AUTHENTICATED', subscriptionType: 'pro' },
    capacity: { status: 'UNAVAILABLE' },
    ...overrides,
  };
}

function generic(cliStatus = 'UNAVAILABLE', overrides = {}) {
  return {
    cliStatus,
    version: cliStatus === 'AVAILABLE' ? 'Gemini 3.4.5' : null,
    reason: cliStatus === 'AVAILABLE' ? null : 'cli_not_found',
    ...overrides,
  };
}

function built(overrides = {}) {
  return buildInventory({
    codex: codex(),
    claude: claude(),
    gemini: generic(),
    antigravity: generic(),
    codexBillingAuth: { status: 'AUTHENTICATED', method: 'CHATGPT', subscriptionType: null },
    claudeBillingAuth: { status: 'AUTHENTICATED', method: 'CLAUDE_AI', subscriptionType: 'pro' },
    generatedAt: '2026-09-08T00:00:00.000Z',
    ...overrides,
  });
}

// Run only the new safety property when reusing already-passed legacy tests.
if (process.argv[4] === '--antigravity-no-probe-only') {
  const checks = runAntigravityNoProbeRegression();
  console.log('antigravity no-probe regression: PASS (' + checks.length + ' checks; legacy tests not run)');
  process.exit(0);
}

{
  const capacity = conservativeCodexCapacity(codex().capacity);
  assert(capacity.status === 'AVAILABLE' && capacity.remainingPercent === 60, 'codex capacity must use conservative measured minimum');
  assert(conservativeCodexCapacity({ status: 'UNAVAILABLE' }).status === 'UNAVAILABLE', 'unavailable capacity must stay unavailable');
  assert(conservativeCodexCapacity({ status: 'AVAILABLE', primary: { remainingPercent: 150 }, secondary: { remainingPercent: 60 } }).status === 'UNAVAILABLE', 'out-of-range capacity must fail closed');
  assert(conservativeCodexCapacity({ status: 'AVAILABLE', primary: { remainingPercent: NaN }, secondary: { remainingPercent: 60 } }).status === 'UNAVAILABLE', 'malformed measured window must fail closed');
}

{
  const inventory = built();
  assert(inventory.routes.length === 4, 'four route records expected');
  for (const route of inventory.routes) {
    assert(route.availability === 'UNAVAILABLE', `${route.id} must remain unavailable until execution and cost boundaries are verified`);
    assert(route.safetyStatus === 'UNKNOWN', `${route.id} safety must remain unknown`);
    assert(route.incrementalCost === 'UNKNOWN', `${route.id} cost must remain unknown`);
  }
  const codexRoute = inventory.routes.find((route) => route.id === 'codex-prompt');
  const claudeRoute = inventory.routes.find((route) => route.id === 'claude-prompt');
  assert(codexRoute.capacity.remainingPercent === 60, 'codex measured capacity may still be recorded');
  assert(claudeRoute.capacity.status === 'UNAVAILABLE', 'claude capacity must not be guessed');
  assert(inventory.observations.codex.authMethod === 'CHATGPT', 'codex auth method evidence should be retained');
  assert(inventory.observations.claude.authMethod === 'CLAUDE_AI', 'claude auth method evidence should be retained');
  assert(inventory.observations.claude.routeReason === 'metered_extra_usage_boundary_unverified', 'claude route must record why cost remains unknown');
}

{
  const inventory = built({
    gemini: generic('AVAILABLE'),
    antigravity: generic('AVAILABLE'),
  });
  for (const id of ['gemini-prompt', 'antigravity-prompt']) {
    const route = inventory.routes.find((item) => item.id === id);
    assert(route.availability === 'UNAVAILABLE', `${id} must stay unavailable without verified prompt adapter`);
    assert(route.incrementalCost === 'UNKNOWN', `${id} cost must stay unknown`);
    assert(route.capacity.status === 'UNAVAILABLE', `${id} capacity must stay unavailable`);
  }
}

{
  const inventory = built();
  for (const route of inventory.routes) {
    assert(validateRoute(route).length === 0, `${route.id} must satisfy router schema`);
    assert(route.allowedDataClasses.every((value) => ['source-only', 'synthetic', 'public'].includes(value)), `${route.id} must only allow safe data classes`);
    assert(route.permissions.length === 1 && route.permissions[0] === 'source-read', `${route.id} must claim source-read only`);
  }
}

{
  const inventory = built();
  const task = {
    id: 'review-1', kind: 'review', objective: 'Review source-only diff.',
    requiredCapabilities: ['review'], requiredPermissions: ['source-read'],
    executionEnvironment: 'prompt-cli', dataClass: 'source-only',
    costPolicy: 'no-new-cost', independentReviewRequired: false,
    forbiddenAuthorities: ['merge', 'production'], allowedScope: ['diff'],
    forbiddenScope: ['real-data'], doneConditions: ['review returned'],
    requiredTests: [], returnFormat: 'verdict',
  };

  const result = routeTask({ schemaVersion: 1, task, routes: inventory.routes });
  assert(result.result === 'STOP' && result.code === 'NO_EXECUTOR_AVAILABLE', 'inventory must not auto-route without verified execution/cost boundaries');
}

{
  const inventory = built({
    codex: codex({ version: '1.2.3-SECRET', secretMarker: 'DO_NOT_EMIT', binaryPath: 'C:\\secret\\codex.exe' }),
    claude: claude({ version: '2.3.4+TOKEN', token: 'DO_NOT_EMIT_TOO' }),
    gemini: generic('UNAVAILABLE', { reason: 'secret-reason' }),
    generatedAt: 'not-a-date SECRET',
  });
  const output = JSON.stringify(inventory);
  assert(!output.includes('DO_NOT_EMIT') && !output.includes('SECRET') && !output.includes('TOKEN'), 'arbitrary provider/version/timestamp strings must not leak');
  assert(!output.includes('binaryPath') && !output.includes('token') && !output.includes('secret-reason'), 'unapproved fields/reasons must not leak');
  assert(inventory.generatedAt === null, 'invalid generatedAt must fail closed');
  assert(inventory.observations.codex.version === '1.2.3', 'version suffix must be stripped');
  assert(inventory.observations.claude.version === '2.3.4', 'build suffix must be stripped');
  assert(inventory.observations.gemini.routeReason === 'cli_not_found', 'unknown reason must use safe fallback');
}

{
  const inventory = built({ openAiApiKeyPresent: true, anthropicApiKeyPresent: true });
  assert(inventory.observations.codex.apiKeyEnvPresent === true, 'OpenAI API key presence may be exposed only as boolean');
  assert(inventory.observations.claude.apiKeyEnvPresent === true, 'Anthropic API key presence may be exposed only as boolean');
  assert(inventory.routes.every((route) => route.incrementalCost === 'UNKNOWN'), 'API-key presence cannot promote cost evidence');
}

// Narrow, offline, Issue #251 scope: antigravity CLI *discovery* only.
// These tests never call a model and never touch real user account config;
// they redirect LOCALAPPDATA/APPDATA to disposable temp fixture directories
// and restore the original env vars afterward (finally-guarded).
if (process.platform === 'win32') {
  const savedLocalAppData = process.env.LOCALAPPDATA;
  const savedAppData = process.env.APPDATA;
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy251-selftest-'));
  try {
    {
      // Windows alias selection: the fixed agy.exe candidate is preferred for kind === 'antigravity'.
      const localAppData = path.join(fixtureRoot, 'alias-selected', 'Local');
      const appData = path.join(fixtureRoot, 'alias-selected', 'Roaming');
      const agyExe = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      fs.mkdirSync(path.dirname(agyExe), { recursive: true });
      fs.writeFileSync(agyExe, '');
      process.env.LOCALAPPDATA = localAppData;
      process.env.APPDATA = appData;
      const desc = resolveProviderCommand('antigravity');
      assert(desc != null, 'antigravity resolver must select the fixed agy.exe candidate when present');
      assert(desc.file === agyExe, 'antigravity resolver must prefer the known Windows user-local agy.exe path');
      assert(Array.isArray(desc.prefix) && desc.prefix.length === 0, 'agy.exe is a native executable and needs no shell prefix');
      const geminiDesc = resolveProviderCommand('gemini');
      assert(geminiDesc == null || geminiDesc.file !== agyExe, 'the existing gemini resolver must stay distinct and never alias to agy.exe');
    }

    {
      // Candidate absence fallback: no agy.exe present, prior antigravity.cmd path is still used.
      const localAppData = path.join(fixtureRoot, 'fallback', 'Local');
      const appData = path.join(fixtureRoot, 'fallback', 'Roaming');
      const legacyCmd = path.join(appData, 'npm', 'antigravity.cmd');
      fs.mkdirSync(path.dirname(legacyCmd), { recursive: true });
      fs.writeFileSync(legacyCmd, '@echo off\n');
      process.env.LOCALAPPDATA = localAppData;
      process.env.APPDATA = appData;
      const desc = resolveProviderCommand('antigravity');
      assert(desc != null, 'antigravity resolver must fall back to the prior npm path when agy.exe is absent');
      assert(desc.prefix.includes(legacyCmd), 'fallback descriptor must still target the prior antigravity.cmd candidate');
    }

    {
      // Invalid/shadow selection: a directory shadowing the expected agy.exe filename
      // must never be selected as an executable (fail closed on the shadowed candidate
      // itself). Unrelated real-PATH fallbacks on the test host are out of scope here.
      const localAppData = path.join(fixtureRoot, 'shadow', 'Local');
      const appData = path.join(fixtureRoot, 'shadow', 'Roaming');
      const shadowAgyExe = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      fs.mkdirSync(shadowAgyExe, { recursive: true });
      process.env.LOCALAPPDATA = localAppData;
      process.env.APPDATA = appData;
      const desc = resolveProviderCommand('antigravity');
      assert(!desc || desc.file !== shadowAgyExe, 'a directory shadowing agy.exe must never be selected as the runnable executable');
    }
  } finally {
    if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = savedLocalAppData;
    if (savedAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = savedAppData;
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

{
  // Discovering/running the CLI is not the same as qualifying the automatic route.
  // Even with a present, "working" agy.exe, antigravity-prompt must stay UNQUALIFIED.
  const inventory = built({
    antigravity: {
      cliStatus: 'AVAILABLE',
      version: 'agy 1.1.11',
      reason: null,
    },
  });
  const route = inventory.routes.find((item) => item.id === 'antigravity-prompt');
  assert(route.availability === 'UNAVAILABLE', 'antigravity-prompt must remain unqualified for automatic dispatch');
  assert(inventory.observations.antigravity.cliStatus === 'AVAILABLE', 'CLI discovery evidence (agy.exe found/working) may still be recorded');
  assert(inventory.observations.antigravity.routeReason === 'prompt_adapter_not_verified', 'discovery alone must not promote the route; adapter/auth/cost/tool boundaries remain unverified');
}

function runAntigravityNoProbeRegression() {
  const checks = [];
  const check = (id, condition) => { assert(condition, id); checks.push(id); };
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-no-probe-'));
  const marker = path.join(fixtureRoot, 'synthetic-marker.txt');
  const sentinel = path.join(fixtureRoot, 'synthetic-version.mjs');
  try {
    // Trusted local Node fixture only, never an installed provider or user profile.
    fs.writeFileSync(sentinel, "import fs from 'node:fs'; fs.writeFileSync(process.argv[2], 'synthetic'); console.log('1.2.3');\n");
    const descriptor = { file: process.execPath, prefix: [sentinel, marker] };
    const blocked = observeGenericCli('antigravity', 3000, descriptor);
    check('found-not-authorized', blocked.cliStatus === 'UNAVAILABLE' && blocked.version === null);
    check('explicit-no-probe-reason', blocked.reason === 'version_probe_not_authorized');
    check('descriptor-not-executed', !fs.existsSync(marker));
    // Explicit null avoids default PATH discovery; this is not a no-process claim.
    const absent = observeGenericCli('antigravity', 3000, null);
    check('missing-remains-distinct', absent.cliStatus === 'UNAVAILABLE' && absent.reason === 'cli_not_found');
    const inventory = built({ antigravity: blocked });
    check('blocked-reason-retained', inventory.observations.antigravity.routeReason === 'version_probe_not_authorized'
      && inventory.observations.antigravity.cliStatus === 'UNAVAILABLE'
      && inventory.observations.antigravity.version === null);
    const route = inventory.routes.find(item => item.id === 'antigravity-prompt');
    check('qualification-not-promoted', route.availability === 'UNAVAILABLE'
      && route.safetyStatus === 'UNKNOWN' && route.incrementalCost === 'UNKNOWN'
      && route.capacity.status === 'UNAVAILABLE');
    // Positive control proves the sentinel is runnable and other-kind behavior is
    // unchanged. This starts exactly one synthetic Node child, not Gemini/agy.
    const control = observeGenericCli('gemini', 3000, descriptor);
    check('other-provider-path-preserved', control.cliStatus === 'AVAILABLE'
      && control.version === '1.2.3' && fs.readFileSync(marker, 'utf8') === 'synthetic');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  check('synthetic-fixture-cleaned', !fs.existsSync(fixtureRoot));
  return checks;
}

runAntigravityNoProbeRegression();

console.log('ai-provider-inventory selftest: PASS');

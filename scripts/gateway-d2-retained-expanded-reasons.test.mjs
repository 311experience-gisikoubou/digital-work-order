// Issue #172 / 2026-11-18: ONE new regression property only.
// This test invokes ONLY the isolated PowerShell error-code classifier extracted from
// the checked-in script. It does not start the D2 receiver, Node adapter, DPAPI,
// synthetic encrypted job, Google Drive, or any already-tested functional path.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('new allowed crypto/retained failure categories are classified literally; injected arbitrary text remains UNKNOWN', async () => {
  const source = await fs.readFile(path.resolve('gateway/windows/run-d2-retained-trial.ps1'), 'utf8');
  const list = source.match(/\$script:D2RetainAllowedChildFailureReasons = @\([\s\S]*?\r?\n\)/)?.[0];
  assert.ok(list, 'existing closed literal allowlist must be present');
  const start = source.indexOf('function Get-D2RetainedChildFailureReason {');
  const end = source.indexOf('# Invokes exactly one native child process', start);
  assert.ok(start !== -1 && end > start, 'extract existing classifier function only');
  const classifier = source.slice(start, end);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-reason-enum-'));
  try {
    const script = [
      'Set-StrictMode -Version Latest',
      "$ErrorActionPreference = 'Stop'",
      list,
      classifier,
      '$r = [ordered]@{}',
      "$r.BackupAuth = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: CRYPTO_BACKUP_AUTH_FAILED'",
      "$r.Decrypt = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: CRYPTO_DECRYPT_FAILED'",
      "$r.Content = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: D2_RETAIN_CONTENT_REJECTED'",
      "$r.Malformed = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: CRYPTO_BACKUP_AUTH_FAILED token=secret_DO_NOT_LEAK /private/a.json'",
      "$r.Forged = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: CRYPTO_DUMP_SECRET_TOKEN'",
      "$r.Injection = Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: CRYPTO_BACKUP_AUTH_FAILED; Invoke-Expression secret_DO_NOT_LEAK'",
      '$r | ConvertTo-Json -Compress',
    ].join('\r\n');
    const file = path.join(dir, 'classify-only.ps1');
    await fs.writeFile(file, script, 'utf8');
    const run = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file,
    ], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
    assert.equal(run.status, 0, 'isolated reason classifier must run successfully');
    const output = String(run.stdout) + String(run.stderr);
    assert.doesNotMatch(output, /secret_DO_NOT_LEAK|\/private\/a\.json|Invoke-Expression|CRYPTO_DUMP_SECRET_TOKEN|\[d2-trial\]/);
    const value = JSON.parse(run.stdout.trim());
    assert.deepEqual(value, {
      BackupAuth: 'CRYPTO_BACKUP_AUTH_FAILED',
      Decrypt: 'CRYPTO_DECRYPT_FAILED',
      Content: 'D2_RETAIN_CONTENT_REJECTED',
      Malformed: 'UNKNOWN',
      Forged: 'UNKNOWN',
      Injection: 'UNKNOWN',
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

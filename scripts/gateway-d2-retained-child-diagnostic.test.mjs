// Issue #172: error-15 child-diagnostic repair for gateway/windows/run-d2-retained-trial.ps1
// (Windows PowerShell 5.1).
//
// Evidence being repaired: a real, already-merged, source-only retain launcher invocation on a
// real lab PC reported only "[d2-retain] status=error-15" -- the launcher discards the Node
// child's own stdout/stderr entirely, so the exact reason the child failed/threw was UNKNOWN.
// This test proves the NEW, narrow boundary added to repair that: the launcher may now surface
// exactly one already-classified, allowlisted (or the literal 'UNKNOWN') reason token alongside
// the unchanged "status=error-15" line -- and never any other substring of the child's own
// output, however that output is shaped. This is the one genuinely new property added by this
// change; it does not re-test config/secrets schema validation, DPAPI restore, or any other
// gate already covered by the existing suite -- those gates are only exercised here, unchanged,
// as the minimum necessary plumbing to actually reach the code-15 boundary.
//
// This test never invokes a real lab receiver, real DPAPI secrets file, a Scheduled Task,
// Google Drive, real ciphertext, or any patient data. The only DPAPI material involved is a
// throwaway, synthetic, CurrentUser-scope SecureString this test builds and discards itself
// (the exact same already-established `ConvertFrom-SecureString` pattern
// `protect-receiver-secrets.ps1` already uses -- not a new format). The "Node adapter" this test
// points the launcher at is never the real gateway/drive-relay-d2-adapter.mjs; it is a tiny,
// synthetic, temporary stand-in script this test writes and deletes itself, used only to make
// the already-merged child-process boundary deterministically fail in three controlled shapes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

function hasPowerShell() {
  try {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true });
    return !probe.error && probe.status === 0;
  } catch { return false; }
}

const scriptPath = path.resolve('gateway/windows/run-d2-retained-trial.ps1');

test(
  'Issue #172: run-d2-retained-trial.ps1 surfaces ONLY an allowlisted (or literal UNKNOWN) ' +
  'reason token alongside the unchanged status=error-15 line, never any other substring of the ' +
  'Node child\'s own stdout/stderr -- a well-formed allowlisted fatal code is permitted, a ' +
  'malformed/disallowed/pattern-injection fatal line and an unrelated raw crash (containing ' +
  'token/path-looking text) are both rejected down to the literal UNKNOWN, and the sanitized ' +
  'exit code remains the scalar integer 15 in every case',
  { skip: !hasPowerShell() },
  async () => {
    const scriptSource = await fs.readFile(scriptPath, 'utf8');

    // Belt-and-suspenders source invariants for the new boundary itself (not a re-test of the
    // already-covered gates above it): the allowlist is closed/literal, the reason is only ever
    // extracted from the one anchored adapter fatal-line shape, and the native child launch is
    // the only place ErrorActionPreference is temporarily relaxed, always restored afterward.
    assert.match(scriptSource, /\$script:D2RetainAllowedChildFailureReasons = @\(/);
    assert.match(scriptSource, /'D2_RETAIN_BACKUP_READ_FAILED'/);
    assert.match(scriptSource, /'D2_RETAIN_WAIT_TIMEOUT'/);
    assert.match(scriptSource, /'D2_TRIAL_FAILED'/);
    assert.match(scriptSource, /\^\\\[d2-trial\\\] fatal: \(\[A-Z0-9_\]\+\)\\s\*\$/);
    assert.match(scriptSource, /\$ErrorActionPreference = 'Continue'/);
    assert.match(scriptSource, /\$ErrorActionPreference = \$previousEap/);
    assert.doesNotMatch(scriptSource, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/i);
    assert.doesNotMatch(scriptSource, /Register-ScheduledTask|schtasks/i);

    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-d2-diag-'));
    try {
      const passphrase = 'SyntheticTestPassphraseValue12345';
      const recipientKeyId = 'rk_test0000000000000000';
      const secretsPath = path.join(base, 'secrets.json');
      const backupPath = path.join(base, 'backup.json');
      const configPath = path.join(base, 'retain-config.json');

      await fs.writeFile(backupPath, JSON.stringify({ recipientKeyId }));
      await fs.writeFile(configPath, JSON.stringify({
        schemaVersion: 1,
        expectedJobId: 'job_' + 'a'.repeat(64),
        syncRoot: path.join(base, 'sync'),
        inboxRoot: path.join(base, 'inbox'),
        recipientBackupPath: backupPath,
      }, null, 2));

      // Synthetic CurrentUser-scope DPAPI secrets file, built once here with the exact same
      // established `ConvertFrom-SecureString` shape `protect-receiver-secrets.ps1` already
      // writes -- not a new format, and not the real lab secrets file. This is the minimum
      // necessary plumbing to let the launcher reach the Node-child boundary under test; its
      // own schema/DPAPI gate is already covered by the existing suite and is not re-asserted
      // here beyond requiring this one-time setup to succeed.
      const buildSecrets = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        [
          "$pass = ConvertTo-SecureString -String '" + passphrase + "' -AsPlainText -Force",
          "$token = ConvertTo-SecureString -String 'SyntheticUnusedTokenValueABCDEFGHIJ' -AsPlainText -Force",
          "$obj = [ordered]@{ version = 1; receiverTokenProtected = (ConvertFrom-SecureString $token); backupPassphraseProtected = (ConvertFrom-SecureString $pass); recipientKeyId = '" + recipientKeyId + "' }",
          "$obj | ConvertTo-Json -Compress | Set-Content -LiteralPath '" + secretsPath.replace(/'/g, "''") + "' -Encoding UTF8 -NoNewline",
        ].join('; '),
      ], { windowsHide: true, encoding: 'utf8' });
      assert.equal(buildSecrets.status, 0, 'synthetic CurrentUser DPAPI secrets fixture setup must succeed: ' + buildSecrets.stderr);

      function runLauncher(adapterPath) {
        return spawnSync('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
          '-File', scriptPath,
          '-ConfigPath', configPath,
          '-SecretsPath', secretsPath,
          '-NodePath', process.execPath,
          '-AdapterPath', adapterPath,
        ], { windowsHide: true, encoding: 'utf8' });
      }

      // Scenario A: the ONE permitted shape -- an exact, anchored, allowlisted adapter fatal
      // line. This is the literal, already-existing adapter code this launcher may surface.
      const adapterKnownPath = path.join(base, 'adapter-known.mjs');
      await fs.writeFile(adapterKnownPath, [
        "process.stderr.write('[d2-trial] fatal: D2_RETAIN_WAIT_TIMEOUT\\n');",
        'process.exitCode = 1;',
      ].join('\n'));
      const runKnown = runLauncher(adapterKnownPath);
      const outputKnown = String(runKnown.stdout) + String(runKnown.stderr);
      assert.equal(runKnown.status, 15, 'a known allowlisted adapter fatal code must still exit the scalar integer 15: ' + outputKnown);
      assert.match(outputKnown, /\[d2-retain\] status=error-15 reason=D2_RETAIN_WAIT_TIMEOUT/);
      assert.doesNotMatch(outputKnown, /\[d2-trial\]/, 'the child\'s own raw fatal line must never appear verbatim, even when its code is allowlisted');

      // Scenario B: a malformed/pattern-injection fatal line (extra trailing text defeats the
      // anchor), a well-formed-but-NOT-allowlisted fatal code (proves a code is never accepted
      // by pattern alone), and an unrelated raw stdout leak containing token/path-looking text.
      // None of this may ever reach this launcher's own output; the sanitized result collapses
      // to the literal UNKNOWN, never to any of the attempted substrings.
      const secretToken = 'sk_live_abcDEF1234567890';
      const secretPath = '/var/secrets/receiverTokenProtected.json';
      const disallowedCode = 'D2_RETAIN_EXFIL_TOKEN_LEAK_ATTEMPT';
      const adapterMaliciousPath = path.join(base, 'adapter-malicious.mjs');
      await fs.writeFile(adapterMaliciousPath, [
        `process.stdout.write('synthetic leaked secret token=${secretToken} path=${secretPath}\\n');`,
        "process.stderr.write('[d2-trial] fatal: D2_RETAIN_WAIT_TIMEOUT and now leaking /var/secrets/backupPassphraseProtected.pem\\n');",
        `process.stderr.write('[d2-trial] fatal: ${disallowedCode}\\n');`,
        'process.exitCode = 1;',
      ].join('\n'));
      const runMalicious = runLauncher(adapterMaliciousPath);
      const outputMalicious = String(runMalicious.stdout) + String(runMalicious.stderr);
      assert.equal(runMalicious.status, 15, 'a malicious/disallowed child output must still exit the scalar integer 15: ' + outputMalicious);
      assert.match(outputMalicious, /\[d2-retain\] status=error-15 reason=UNKNOWN/);
      assert.doesNotMatch(outputMalicious, /\[d2-trial\]/);
      assert.doesNotMatch(outputMalicious, new RegExp(secretToken));
      assert.doesNotMatch(outputMalicious, /receiverTokenProtected|backupPassphraseProtected/);
      assert.doesNotMatch(outputMalicious, /\/var\/secrets/);
      assert.doesNotMatch(outputMalicious, new RegExp(disallowedCode), 'a well-formed but non-allowlisted code must never be echoed, even though it matches the anchor shape');

      // Scenario C: no adapter fatal line at all -- an unrelated raw uncaught crash (as Node
      // itself would print, including this synthetic script's own temp file path and a
      // token-looking substring). This must also collapse to UNKNOWN, never leak the path/token
      // or any Node stack-trace text into this launcher's own sanitized output.
      const crashToken = 'ZZTOPSECRETTOKEN999';
      const crashPath = '/opt/should-not-leak/secret.pem';
      const adapterCrashPath = path.join(base, 'adapter-crash.mjs');
      await fs.writeFile(adapterCrashPath, `throw new Error('synthetic crash containing token ${crashToken} and path ${crashPath}');\n`);
      const runCrash = runLauncher(adapterCrashPath);
      const outputCrash = String(runCrash.stdout) + String(runCrash.stderr);
      assert.equal(runCrash.status, 15, 'an unrelated raw child crash must still exit the scalar integer 15: ' + outputCrash);
      assert.match(outputCrash, /\[d2-retain\] status=error-15 reason=UNKNOWN/);
      assert.doesNotMatch(outputCrash, new RegExp(crashToken));
      assert.doesNotMatch(outputCrash, new RegExp(crashPath.replace(/\//g, '\\/')));
      assert.doesNotMatch(outputCrash, /adapter-crash\.mjs/, 'the child\'s own script path must never leak into this launcher\'s sanitized output');
      assert.doesNotMatch(outputCrash, /at file:|Node\.js v/, 'a raw Node stack trace must never leak into this launcher\'s sanitized output');
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  }
);

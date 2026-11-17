// Issue #172: minimal focused regression for the UTF-8 config-read repair in
// gateway/windows/run-d2-retained-trial.ps1 (Windows PowerShell 5.1).
//
// Evidence being repaired: on Windows PowerShell 5.1, a BOM-less UTF-8 JSON config containing
// non-ASCII characters failed `Get-Content -Raw | ConvertFrom-Json` (PS 5.1's `-Raw` without an
// explicit `-Encoding` falls back to the system ANSI codepage for a BOM-less file, corrupting
// non-ASCII bytes before ConvertFrom-Json ever sees them) while the exact same read-only file
// passed with `Get-Content -Raw -Encoding UTF8 | ConvertFrom-Json`. This test proves the fixed
// launcher now parses such a config successfully and reaches the NEXT fail-closed boundary
// (absent SecretsPath => 11), never the config-parse failure (10) that occurred before the fix.
//
// This test never reads, reproduces, or touches the real config/secrets/inbox/job/backup
// evidence described in the issue. It builds its own synthetic, temporary, schema-valid
// fixture only, invokes the real (current worktree) PowerShell source once as a bounded
// non-interactive child process, and deletes everything it created.
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

test(
  'Issue #172: run-d2-retained-trial.ps1 parses a BOM-less UTF-8 JSON config with a Japanese ' +
  'non-ASCII path segment correctly and fails closed only at the absent SecretsPath (11), ' +
  'never at config parse/shape (10) as it did before the -Encoding UTF8 repair',
  { skip: !hasPowerShell() },
  async () => {
    const scriptPath = path.resolve('gateway/windows/run-d2-retained-trial.ps1');
    const scriptSource = await fs.readFile(scriptPath, 'utf8');
    // Belt-and-suspenders source invariants: this single-concern test must never be able to
    // reach a real receiver, decryption, Node transfer, scheduled task, or network call, by
    // construction of the source itself (not just by this one run's control flow below).
    assert.doesNotMatch(scriptSource, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/i);
    assert.doesNotMatch(scriptSource, /Register-ScheduledTask|schtasks/i);
    assert.match(
      scriptSource,
      /Get-Content -LiteralPath \$ConfigPath -Raw -Encoding UTF8 -ErrorAction Stop/,
      'the ConfigPath read must explicitly specify -Encoding UTF8'
    );

    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dwo-d2-utf8-'));
    try {
      const japaneseSegment = '日本語フォルダ';
      const syncRoot = path.join(base, japaneseSegment, 'sync');
      const inboxRoot = path.join(base, japaneseSegment, 'inbox');
      const recipientBackupPath = path.join(base, japaneseSegment, 'backup.json');
      const configPath = path.join(base, 'retain-config.json');
      // Intentionally never created: the launcher must reach -- and fail closed at -- the
      // absent-SecretsPath boundary (11), never actually read/parse/touch a secrets file.
      const secretsPath = path.join(base, 'secrets-absent.json');

      const config = {
        schemaVersion: 1,
        expectedJobId: 'job_' + 'a'.repeat(64),
        syncRoot,
        inboxRoot,
        recipientBackupPath,
      };
      const configJson = JSON.stringify(config, null, 2);
      const configBuffer = Buffer.from(configJson, 'utf8');
      // Buffer.from(str, 'utf8') never prepends a byte-order mark; explicitly assert that here
      // so this fixture can never silently drift into the (already-passing) BOM case.
      assert.notEqual(configBuffer[0], 0xef, 'the synthetic config fixture must be written without a UTF-8 BOM');
      await fs.writeFile(configPath, configBuffer);

      const secretsPresentBefore = await fs.access(secretsPath).then(() => true, () => false);
      assert.equal(secretsPresentBefore, false, 'the synthetic SecretsPath must be absent before invoking the launcher');

      const run = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          // Scoped solely to this single child process invocation -- never a machine/user-wide
          // Set-ExecutionPolicy change, never persisted beyond this one process's lifetime.
          '-ExecutionPolicy', 'Bypass',
          '-File', scriptPath,
          '-ConfigPath', configPath,
          '-SecretsPath', secretsPath,
        ],
        { windowsHide: true, encoding: 'utf8' }
      );

      const output = String(run.stdout) + String(run.stderr);
      assert.equal(
        run.status,
        11,
        'a correctly UTF-8-decoded, schema-valid, non-ASCII config must parse cleanly and fail ' +
        'closed only at the absent SecretsPath (11); before the fix this read as 10 ' +
        '(config parse/shape failure) on Windows PowerShell 5.1. stdout/stderr: ' + output
      );
      assert.match(output, /status=error-11/);
      assert.doesNotMatch(output, /status=error-10/);
      assert.doesNotMatch(output, /ProtectedData|Unprotect|SecureString/);
      assert.doesNotMatch(output, new RegExp(japaneseSegment), 'stdout/stderr must never echo a path, per the script\'s own sanitized-status contract');

      const secretsPresentAfter = await fs.access(secretsPath).then(() => true, () => false);
      assert.equal(secretsPresentAfter, false, 'the launcher must never create/touch the absent synthetic secrets fixture');
      const backupPresentAfter = await fs.access(recipientBackupPath).then(() => true, () => false);
      assert.equal(backupPresentAfter, false, 'the launcher must never reach/create the recipient backup fixture once secrets are absent -- no decryption/transfer path can run');
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  }
);

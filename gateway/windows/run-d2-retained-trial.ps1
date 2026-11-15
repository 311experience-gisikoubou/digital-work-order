<#
Issue #172: bounded D2 "Windows logon receiver" -- retained-only trial launcher (source only).

Scope / boundary (read before any real use):
  - This script ONLY invokes the Node retain CLI: node gateway/drive-relay-d2-adapter.mjs
    --retain-config=<ConfigPath>  [--retain-timeout-ms=<RetainTimeoutMs>]
    It never passes the separate ACK-path config flag, never constructs/forwards an Apps
    Script control endpoint, never reads, sets, or forwards any receiver-bearer environment
    variable or token. There is no ACK, no deletion, and no network call anywhere in this
    script.
  - The only secret this script ever touches is a CurrentUser-scope DPAPI-protected recipient
    backup passphrase, read from an explicitly provided, operator-provisioned synthetic
    secrets file (-SecretsPath). The passphrase is set into DWO_RECIPIENT_BACKUP_PASSPHRASE
    only for the duration of the single node child process below, and is always cleared
    (finally) regardless of outcome. Nothing here ever echoes/logs the passphrase, the raw
    DPAPI blob, or any filesystem path/exception text -- only a small set of sanitized,
    closed status codes are ever written to stdout.
  - This script performs exactly one synchronous invocation of the Node adapter. The adapter
    itself owns the single bounded (missing-file-only) wait/retry authority (Issue #172 /
    finding A6); this script never polls or retries on its own, and never runs as a daemon.
  - This script never registers, modifies, or queries a Scheduled Task, never requests
    elevation, never runs as SYSTEM/admin, and never reboots or shuts down the machine. Wiring
    this script to an actual Windows "on logon" trigger requires a SEPARATE, explicitly
    human-authorized Task Scheduler registration step that is intentionally OUT OF SCOPE here.
  - Only synthetic, dedicated, operator-provisioned paths/config/secrets are ever expected.
    This script never hardcodes a real path, key, or job id.

Config schema (-ConfigPath, JSON; matches the Node adapter's --retain-config= exactly):
  { "schemaVersion": 1, "expectedJobId": "job_<64 hex>", "syncRoot": "<path>",
    "inboxRoot": "<path>", "recipientBackupPath": "<path>" }

Secrets schema (-SecretsPath, JSON; operator-provisioned, never tracked in the repository):
  { "schemaVersion": 1, "recipientKeyId": "rk_...", "backupPassphraseProtected": "<base64>" }
  `backupPassphraseProtected` is the recipient-backup passphrase, UTF-8 encoded and protected
  with [System.Security.Cryptography.ProtectedData]::Protect(..., $null, CurrentUser), then
  base64-encoded. `recipientKeyId` must match the recipientKeyId already present (in plain
  text -- it is not itself secret) inside the recipient backup file the config points at;
  this is checked BEFORE any DPAPI call, so a wrong secrets file never even reaches DPAPI.

Exit codes (sanitized; stdout/stderr never contain a path, stack trace, or secret):
  0  = adapter reported a stored/already-stored outcome.
  10 = config path/read/parse/shape/timeout-argument failure.
  11 = secrets path/read/parse/shape failure.
  12 = secrets recipientKeyId does not match the recipient backup's recipientKeyId.
  13 = DPAPI unprotect failure (wrong machine/user context, or a corrupt protected blob).
  14 = the Node adapter script could not be found.
  15 = the Node child process exited non-zero (includes the adapter's own bounded-wait
       timeout, a rejected/corrupt job, or any other adapter-reported failure).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ConfigPath,
  [Parameter(Mandatory = $true)][string]$SecretsPath,
  [string]$NodePath = 'node',
  [string]$AdapterPath,
  [int]$RetainTimeoutMs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Status([string]$Code) {
  Write-Output ("[d2-retain] status=" + $Code)
}

# Invokes exactly one native child process and returns ONLY a scalar [int] exit code -- never
# the child's own stdout/stderr. (FINAL AUDIT REPAIR: a prior version let the native command's
# stdout flow directly into this script's own function-return pipeline; PowerShell then folds
# that leaked output together with the real return value into an array, so a caller doing
# `$exitCode = Invoke-D2RetainedTrial ...` got back e.g. `@('some native output line', 0)`
# instead of the scalar `0`, breaking every downstream `-eq`/`-ne` exit-code comparison and the
# final `exit $exitCode`.) `2>&1` merges the child's stderr into the same captured stream so
# neither stream is ever written to this function's own output; `$null = ...` discards the
# whole captured collection without ever logging it. `$LASTEXITCODE` is captured immediately
# afterward, before any other statement can overwrite it, and is force-cast to `[int]` so this
# function can never itself return anything but a single scalar integer.
function Invoke-D2RetainedNodeChild {
  param(
    [Parameter(Mandatory = $true)][string]$NodePath,
    [string[]]$NodeArgs
  )
  $null = & $NodePath @NodeArgs 2>&1
  return [int]$LASTEXITCODE
}

# All real work happens inside this function and returns a small closed exit-code integer;
# it never calls `exit` itself, so the `finally` below always runs before the script's own
# single top-level `exit` call, on every outcome (success, every failure, or a thrown error).
function Invoke-D2RetainedTrial {
  param(
    [string]$ConfigPath,
    [string]$SecretsPath,
    [string]$NodePath,
    [string]$AdapterPath,
    [System.Nullable[System.Int32]]$RetainTimeoutMs
  )

  if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { return 10 }
  try { $configRaw = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop } catch { return 10 }
  try { $config = $configRaw | ConvertFrom-Json -ErrorAction Stop } catch { return 10 }
  if ($null -eq $config) { return 10 }
  $requiredConfigKeys = @('schemaVersion', 'expectedJobId', 'syncRoot', 'inboxRoot', 'recipientBackupPath')
  $configProps = @($config.PSObject.Properties.Name)
  if ($configProps.Count -ne $requiredConfigKeys.Count) { return 10 }
  foreach ($key in $requiredConfigKeys) { if ($configProps -notcontains $key) { return 10 } }
  if ($config.schemaVersion -ne 1) { return 10 }
  if ($config.expectedJobId -notmatch '^job_[0-9a-f]{64}$') { return 10 }
  foreach ($key in @('syncRoot', 'inboxRoot', 'recipientBackupPath')) {
    if (-not ($config.$key -is [string]) -or [string]::IsNullOrEmpty($config.$key)) { return 10 }
  }

  if ($null -ne $RetainTimeoutMs) {
    if ($RetainTimeoutMs -le 0 -or $RetainTimeoutMs -gt 180000) { return 10 }
  }

  if (-not (Test-Path -LiteralPath $SecretsPath -PathType Leaf)) { return 11 }
  try { $secretsRaw = Get-Content -LiteralPath $SecretsPath -Raw -ErrorAction Stop } catch { return 11 }
  try { $secrets = $secretsRaw | ConvertFrom-Json -ErrorAction Stop } catch { return 11 }
  if ($null -eq $secrets) { return 11 }
  $requiredSecretsKeys = @('schemaVersion', 'recipientKeyId', 'backupPassphraseProtected')
  $secretsProps = @($secrets.PSObject.Properties.Name)
  if ($secretsProps.Count -ne $requiredSecretsKeys.Count) { return 11 }
  foreach ($key in $requiredSecretsKeys) { if ($secretsProps -notcontains $key) { return 11 } }
  if ($secrets.schemaVersion -ne 1) { return 11 }
  if (-not ($secrets.recipientKeyId -is [string]) -or $secrets.recipientKeyId -notmatch '^rk_[A-Za-z0-9_-]+$') { return 11 }
  if (-not ($secrets.backupPassphraseProtected -is [string]) -or [string]::IsNullOrEmpty($secrets.backupPassphraseProtected)) { return 11 }

  $backupPath = $config.recipientBackupPath
  if (-not [System.IO.Path]::IsPathRooted($backupPath)) {
    $configDir = Split-Path -Parent (Resolve-Path -LiteralPath $ConfigPath)
    $backupPath = [System.IO.Path]::GetFullPath((Join-Path $configDir $backupPath))
  }
  if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) { return 10 }
  try { $backup = (Get-Content -LiteralPath $backupPath -Raw -ErrorAction Stop) | ConvertFrom-Json -ErrorAction Stop } catch { return 10 }
  if ($null -eq $backup) { return 10 }
  if (@($backup.PSObject.Properties.Name) -notcontains 'recipientKeyId') { return 10 }
  if (-not ($backup.recipientKeyId -is [string])) { return 10 }

  # The recipientKeyId is not itself secret (it is a public key fingerprint); checking it here,
  # in plain text, before any DPAPI call, means a wrong/stale secrets file never reaches DPAPI.
  if ($backup.recipientKeyId -ne $secrets.recipientKeyId) { return 12 }

  if ([string]::IsNullOrEmpty($AdapterPath)) {
    $AdapterPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'drive-relay-d2-adapter.mjs'
  }
  if (-not (Test-Path -LiteralPath $AdapterPath -PathType Leaf)) { return 14 }

  # Declared up front (Set-StrictMode is active) so the `finally` below can always safely
  # reference and clear them, even on a failure path that returns before they are assigned.
  $protectedBytes = $null
  $passphraseBytes = $null
  $passphrase = $null

  try {
    try {
      $protectedBytes = [System.Convert]::FromBase64String($secrets.backupPassphraseProtected)
    } catch { return 11 }

    try {
      $passphraseBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $protectedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    } catch { return 13 }

    $passphrase = [System.Text.Encoding]::UTF8.GetString($passphraseBytes)
    if ([string]::IsNullOrEmpty($passphrase) -or $passphrase.Length -lt 12) { return 13 }

    # This script itself never reads, sets, clears, or otherwise references any receiver-bearer
    # environment variable anywhere -- and the retained-only Node CLI it invokes never reads
    # one either, so none can ever reach the ACK path through this script, by construction
    # rather than by scrubbing the child's inherited environment.
    $env:DWO_RECIPIENT_BACKUP_PASSPHRASE = $passphrase

    $nodeArgs = @($AdapterPath, ('--retain-config=' + $ConfigPath))
    if ($null -ne $RetainTimeoutMs) {
      $nodeArgs += ('--retain-timeout-ms=' + $RetainTimeoutMs)
    }

    # A single synchronous child invocation (Issue #172 / finding A6): the Node adapter owns
    # the only bounded wait; this call either returns (success or the adapter's own bounded
    # failure/timeout) or node itself cannot be launched at all -- both are reported only as
    # the one sanitized code 15 below, never as raw exception text. Invoke-D2RetainedNodeChild
    # (above) guarantees $nodeExitCode is always a single scalar [int], never the child's own
    # stdout/stderr folded into an array.
    try {
      $nodeExitCode = Invoke-D2RetainedNodeChild -NodePath $NodePath -NodeArgs $nodeArgs
    } catch { return 15 }
    if ($nodeExitCode -ne 0) { return 15 }
    return 0
  } finally {
    # Always clear the one secret this script ever holds, on every outcome (success, every
    # failure above, or an unexpected exception) -- never left in this process's environment,
    # and never inherited by any further child beyond the single node invocation above.
    if (Test-Path Env:\DWO_RECIPIENT_BACKUP_PASSPHRASE) { Remove-Item Env:\DWO_RECIPIENT_BACKUP_PASSPHRASE }
    $passphrase = $null
    $passphraseBytes = $null
    $protectedBytes = $null
  }
}

$timeoutArg = $null
if ($PSBoundParameters.ContainsKey('RetainTimeoutMs')) { $timeoutArg = $RetainTimeoutMs }

$exitCode = Invoke-D2RetainedTrial -ConfigPath $ConfigPath -SecretsPath $SecretsPath -NodePath $NodePath -AdapterPath $AdapterPath -RetainTimeoutMs $timeoutArg

if ($exitCode -eq 0) { Write-Status 'ok' } else { Write-Status ('error-' + $exitCode) }
exit $exitCode

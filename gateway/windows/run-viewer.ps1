param(
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "gateway-config.json"),
  [int]$Port = 4850
)

$ErrorActionPreference = 'Stop'

# Phase 8 viewer: localhost-only, read-only. This wrapper needs no receiver
# secrets and sets no DWO_RECEIVER_TOKEN / DWO_RECIPIENT_BACKUP_PASSPHRASE.
# It only reads the existing gateway-config.json to resolve inboxRoot, the
# same directory Phase 6/7's run-receiver.ps1 already writes verified jobs
# into.

$viewerScript = Join-Path (Split-Path -Parent $PSScriptRoot) "viewer.mjs"
if (-not (Test-Path -LiteralPath $viewerScript)) {
  throw "viewer.mjs not found."
}

# gateway-config.json is optional here: if it is missing, the viewer falls
# back to the same default inbox location the receiver uses.
$args = @($viewerScript, "--port=$Port")
if (Test-Path -LiteralPath $ConfigPath) {
  $args += "--config=$ConfigPath"
}

& node @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

# node viewer.mjs prints only the localhost URL (e.g. http://127.0.0.1:4850/)
# to stdout above. This script intentionally prints nothing else, so no
# order/job data is ever written to the console by this wrapper.

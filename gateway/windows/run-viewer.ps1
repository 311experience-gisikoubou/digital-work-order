param(
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "gateway-config.json"),
  [int]$Port = 4850,
  [string]$ManualRoot = ""
)

$ErrorActionPreference = 'Stop'

# Phase 8 viewer: localhost-only. The verified Gateway inbox remains read-only.
# U13 can optionally add a separate local manual PDF/video root; associations
# are stored in local app state, never by modifying the source PDF/video files.
$viewerScript = Join-Path (Split-Path -Parent $PSScriptRoot) "viewer.mjs"
if (-not (Test-Path -LiteralPath $viewerScript)) {
  throw "viewer.mjs not found."
}

# gateway-config.json is optional: if missing, the viewer uses the same
# default inbox location as the receiver. ManualRoot is also optional.
$args = @($viewerScript, "--port=$Port")
if (Test-Path -LiteralPath $ConfigPath) {
  $args += "--config=$ConfigPath"
}
if (-not [string]::IsNullOrWhiteSpace($ManualRoot)) {
  $resolvedManualRoot = [IO.Path]::GetFullPath($ManualRoot)
  $args += "--manual-root=$resolvedManualRoot"
}

& node @args
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

# node viewer.mjs prints only the localhost URL. No order/job data is written
# to the console by this wrapper.

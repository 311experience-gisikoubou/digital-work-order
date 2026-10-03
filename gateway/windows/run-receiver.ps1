param(
  [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "gateway-config.json"),
  [string]$SecretsPath = "$env:LOCALAPPDATA\DigitalWorkOrderGateway\receiver-secrets.dpapi.json",
  [switch]$Once
)

$ErrorActionPreference = 'Stop'

function Convert-SecureStringToPlainText([Security.SecureString]$SecureValue) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

if (-not (Test-Path -LiteralPath $SecretsPath)) {
  throw "Receiver secrets file not found. Run protect-receiver-secrets.ps1 first."
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Gateway config file not found."
}

$secret = Get-Content -LiteralPath $SecretsPath -Raw | ConvertFrom-Json
if ($secret.version -ne 1 -or -not $secret.receiverTokenProtected -or -not $secret.backupPassphraseProtected) {
  throw "Receiver secrets file is invalid."
}

$tokenSecure = ConvertTo-SecureString $secret.receiverTokenProtected
$passSecure = ConvertTo-SecureString $secret.backupPassphraseProtected
$tokenPlain = Convert-SecureStringToPlainText $tokenSecure
$passPlain = Convert-SecureStringToPlainText $passSecure

$receiverScript = Join-Path (Split-Path -Parent $PSScriptRoot) "receiver.mjs"
if (-not (Test-Path -LiteralPath $receiverScript)) {
  throw "receiver.mjs not found."
}

try {
  $env:DWO_RECEIVER_TOKEN = $tokenPlain
  $env:DWO_RECIPIENT_BACKUP_PASSPHRASE = $passPlain
  $args = @($receiverScript, "--config=$ConfigPath")
  if (-not $Once) {
    $args += "--watch"
  }
  & node @args
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Remove-Item Env:DWO_RECEIVER_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:DWO_RECIPIENT_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
  $tokenPlain = $null
  $passPlain = $null
}

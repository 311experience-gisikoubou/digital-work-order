param(
  [Parameter(Mandatory=$true)]
  [string]$RecipientBackupPath,
  [string]$OutputPath = "$env:LOCALAPPDATA\DigitalWorkOrderGateway\receiver-secrets.dpapi.json"
)

$ErrorActionPreference = 'Stop'

function Convert-ToBase64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

if (-not (Test-Path -LiteralPath $RecipientBackupPath)) {
  throw "Recipient backup file not found."
}

$backup = Get-Content -LiteralPath $RecipientBackupPath -Raw | ConvertFrom-Json
if (-not $backup.recipientKeyId -or -not ($backup.recipientKeyId -match '^rk_[A-Za-z0-9_-]+$')) {
  throw "Recipient backup does not contain a valid recipientKeyId."
}

$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($tokenBytes)
$rng.Dispose()
$token = Convert-ToBase64Url $tokenBytes

$sha = [System.Security.Cryptography.SHA256]::Create()
$hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($token))
$sha.Dispose()
$tokenHash = -join ($hashBytes | ForEach-Object { $_.ToString('x2') })

$secureToken = ConvertTo-SecureString $token -AsPlainText -Force
$backupPassphrase = Read-Host "Recipient backup passphrase" -AsSecureString
if ($backupPassphrase.Length -eq 0) {
  throw "Backup passphrase is required."
}

$payload = [ordered]@{
  version = 1
  receiverTokenProtected = ConvertFrom-SecureString $secureToken
  backupPassphraseProtected = ConvertFrom-SecureString $backupPassphrase
  recipientKeyId = [string]$backup.recipientKeyId
}

$dir = Split-Path -Parent $OutputPath
if ($dir) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
$json = $payload | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($OutputPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))

[Array]::Clear($tokenBytes, 0, $tokenBytes.Length)
[Array]::Clear($hashBytes, 0, $hashBytes.Length)
$token = $null

Write-Host "Receiver secrets protected with Windows DPAPI CurrentUser."
Write-Host "Secrets file: $OutputPath"
Write-Host "Configure the cloud runtime with:"
Write-Host "DWO_RECEIVER_KEY_ID=$($backup.recipientKeyId)"
Write-Host "DWO_RECEIVER_TOKEN_SHA256=$tokenHash"
Write-Host "The receiver token itself was not printed."

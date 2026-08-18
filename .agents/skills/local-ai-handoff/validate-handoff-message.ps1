<#
.SYNOPSIS
    Validates a Local AI Handoff message file before it is acted upon.
    Mechanically enforces the two guards that V1 only checked by hand:
    duplicate message_id and HEAD SHA drift.

.DESCRIPTION
    Every handoff message must carry two required fields:
      - message_id : a unique identifier for this message.
      - head_sha    : the repository's HEAD SHA at the moment this
                       message was created.

    This script performs two checks and nothing else:

      1. Duplicate message_id
         Scans every other message file under
         .ai-handoff/runtime/{inbox,outbox,processed}/ in the target
         repository. If any other file declares the same message_id,
         validation fails. (inbox/outbox/processed are scanned, not a
         separate log file, so there is nothing extra to keep in sync.)

      2. HEAD SHA drift
         Compares the message's embedded head_sha against the
         repository's actual current HEAD (`git rev-parse HEAD`). If
         they differ, the approved target/content/risk this message
         was written against may no longer hold, and validation fails.

    This script only validates. It does not invoke Codex, does not move
    or edit any file, and does not decide what happens on failure — the
    caller (the orchestrating AI) must stop and report, not guess a
    recovery.

.PARAMETER MessagePath
    Path to the handoff message file to validate.

.PARAMETER RepoRoot
    Path to the repository root. Used to resolve .ai-handoff/runtime/
    and to read the current HEAD SHA.

.OUTPUTS
    stdout "OK" and exit code 0 on success.
    stderr with a specific reason and a non-zero exit code on failure:
      2 = message file or repository root not found
      3 = a required field (message_id or head_sha) is missing
      4 = duplicate message_id
      5 = HEAD SHA drift

.EXAMPLE
    & .\validate-handoff-message.ps1 -MessagePath $msg -RepoRoot $repo
    if ($LASTEXITCODE -ne 0) {
        # Stop. Do not invoke Codex. Report the failure reason to the human.
    }
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$MessagePath,

    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Fail {
    param([int]$Code, [string]$Reason)
    # Write directly to stderr rather than Write-Error: combined with
    # $ErrorActionPreference = 'Stop', Write-Error becomes a terminating
    # exception and can prevent the explicit `exit $Code` below from
    # ever running, or propagate past this script into the caller's
    # session. A plain stderr write plus `exit` keeps the exit code the
    # single source of truth for callers.
    [Console]::Error.WriteLine($Reason)
    exit $Code
}

if (-not (Test-Path -LiteralPath $MessagePath)) {
    Fail 2 "Message file not found: $MessagePath"
}

if (-not (Test-Path -LiteralPath $RepoRoot)) {
    Fail 2 "Repository root not found: $RepoRoot"
}

$resolvedMessagePath = (Resolve-Path -LiteralPath $MessagePath).Path
$content = Get-Content -Raw -LiteralPath $resolvedMessagePath

$messageIdMatch = [regex]::Match($content, '(?m)^-\s*message_id:\s*`([^`]+)`')
if (-not $messageIdMatch.Success) {
    Fail 3 "Message is missing the required 'message_id' field: $resolvedMessagePath"
}
$messageId = $messageIdMatch.Groups[1].Value

$headShaMatch = [regex]::Match($content, '(?m)^-\s*head_sha:\s*`([^`]+)`')
if (-not $headShaMatch.Success) {
    Fail 3 "Message is missing the required 'head_sha' field: $resolvedMessagePath"
}
$embeddedSha = $headShaMatch.Groups[1].Value

# --- Guard 1: duplicate message_id ------------------------------------

$runtimeRoot = Join-Path $RepoRoot '.ai-handoff\runtime'
$searchDirs = @('inbox', 'outbox', 'processed') |
    ForEach-Object { Join-Path $runtimeRoot $_ } |
    Where-Object { Test-Path -LiteralPath $_ }

$duplicates = @()
foreach ($dir in $searchDirs) {
    $files = Get-ChildItem -LiteralPath $dir -Filter '*.md' -File -ErrorAction SilentlyContinue
    foreach ($f in $files) {
        if ($f.FullName -eq $resolvedMessagePath) { continue }
        $otherContent = Get-Content -Raw -LiteralPath $f.FullName
        $otherMatch = [regex]::Match($otherContent, '(?m)^-\s*message_id:\s*`([^`]+)`')
        if ($otherMatch.Success -and $otherMatch.Groups[1].Value -eq $messageId) {
            $duplicates += $f.FullName
        }
    }
}

if ($duplicates.Count -gt 0) {
    Fail 4 "Duplicate message_id '$messageId' already exists in: $($duplicates -join ', ')"
}

# --- Guard 2: HEAD SHA drift -------------------------------------------

Push-Location $RepoRoot
try {
    $currentSha = (git rev-parse HEAD).Trim()
} finally {
    Pop-Location
}

if ($embeddedSha -ne $currentSha) {
    Fail 5 "HEAD SHA drift detected. Message was created at head_sha=$embeddedSha, repository is now at $currentSha. The approved target/content/risk may no longer hold; re-approval is required before proceeding."
}

Write-Output "OK"
exit 0

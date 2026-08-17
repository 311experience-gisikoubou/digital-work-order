---
name: local-ai-handoff
description: Use when handing off state, audit results, or next instructions between local AI CLIs on the same PC (Claude Code and Codex CLI in V1), so the human does not have to copy and paste between them. Also covers Japanese requests such as Claudeからcodexへ引き継ぎ, ローカルhandoff, codexに渡す, or codexの結果をclaudeへ. Does not apply to the browser-based ChatGPT/GPT, which has no local file access and continues to use the existing [AI_HANDOFF] GitHub PR-comment channel (see OPERATIONS.md); do not invent a new GPT-specific handoff format.
---

# Local AI Handoff (V1: Claude ↔ Codex)

Use this skill to pass state, audit results, and next-step instructions between local AI CLIs running against the same repository checkout, without the human copying and pasting between chat windows.

## Scope (V1)

- **Claude ↔ Codex**: in scope. Both run locally against the same repository and can read/write local files.
- **Gemini / Antigravity**: not wired into the default flow in V1. `antigravity chat --mode agent <prompt>` exists and can read local files, so this skill's file protocol is written to extend to it later, but nothing in V1 invokes it automatically. Do not add Gemini to the live routing without an explicit decision to do so.
- **GPT (browser)**: out of scope for this skill entirely. GPT has no local file access. Continue using the existing `[AI_HANDOFF]` GitHub PR-comment convention (`OPERATIONS.md`) for anything GPT needs to see. Do not create a parallel GPT-specific local format.

## Runtime Layout (per application repository)

The live runtime lives in the application repository being worked on, never in `ai-dev-foundation` itself (`ai-dev-foundation` holds only this skill definition and the adoption template — see `templates/.ai-handoff/README.md.template`).

```
.ai-handoff/
├─ README.md
└─ runtime/
   ├─ outbox/      # newly written messages, not yet delivered to the reader
   ├─ inbox/        # messages delivered and waiting for the addressed AI to read
   └─ processed/    # messages already read and acted upon (kept as an audit trail, not deleted)
```

`.ai-handoff/runtime/` holds working state, not permanent history. Whether an application repository tracks it in git or excludes it via `.gitignore` is that repository's own decision (see "Adoption" below) — this skill does not assume either.

## Message Lifecycle

1. The sending AI writes a message to `runtime/outbox/<ISO8601-UTC>-<from>-to-<to>.md` (for example, `20260817T235900Z-claude-to-codex.md`). The filename's `<from>-to-<to>` makes the direction explicit regardless of which folder the file is later found in.
2. Before the addressed AI is invoked, the file is moved from `outbox/` to `inbox/`. This is a deliberate, visible step (not automatic), so there is always a clear record of what has been handed off versus what is still pending.
3. The addressed AI reads from `inbox/`, acts on it, and — when it produces a result the other side needs — writes its own message to `outbox/` (for the return trip) using the same naming convention.
4. Once a message has been read and acted upon, it is moved from `inbox/` to `processed/`. Do not delete processed messages; they are the audit trail for what was handed off and when.

## Message Content

Reuse the `handoff` skill's format and required sections (repository, path, branch, HEAD, upstream, working tree, completed work, recent PR, confirmed specs, unfinished items, next steps, blockers, `要補足` for unknowns) rather than inventing a second content schema. A local-ai-handoff message *is* a `handoff` skill output, written to a file in `runtime/outbox/` instead of pasted into a chat.

## Codex Detection (no hardcoded paths, no PATH changes)

Codex CLI's executable lives at a per-build, hash-named path (`%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`) that changes across installs. Never hardcode a specific hash in instructions, scripts, or documentation. Use the bundled `detect-codex.ps1` in this skill's directory to resolve the current path at run time:

```powershell
$codexPath = & "<this skill's directory>\detect-codex.ps1"
if ($LASTEXITCODE -ne 0) {
    # Codex CLI is not installed on this machine; stop and report, do not guess a fallback path.
}
```

This script only detects and prints a path. It does not modify PATH or any environment variable.

## Invoking Codex Non-Interactively

Codex CLI supports non-interactive execution via `codex exec`, confirmed from `codex.exe exec --help` on this machine:

```powershell
& $codexPath exec -C "<repository root>" -o "<runtime/outbox output file>" "<prompt, e.g. referencing the inbox message path>"
```

- `-C <dir>` sets the working root so Codex operates on the correct repository.
- `-o <file>` writes Codex's final message to a file, which can be placed directly under `runtime/outbox/`.
- Do not add `--dangerously-bypass-approvals-and-sandbox` or `--approve-for-me` as part of this skill's default invocation. Doing so would weaken the human-approval floor in `CORE.md` and `OPERATIONS.md`'s Human Confirmation Points. Leave Codex's approval policy at its configured default unless the human has explicitly requested otherwise for a specific task.

Actually invoking Codex is a repository operation like any other and follows the same `OPERATIONS.md` Human Confirmation Points — this skill documents the command, it does not make invoking another agentic AI process an unattended default action.

## Safety Constraints

- Do not write secrets, tokens, credentials, personal information, or real data into any `.ai-handoff/` file (`CORE.md`).
- This channel exists to reduce copy-paste friction. It must never become a way to route around `OPERATIONS.md`'s Human Confirmation Points (spec/value judgment, real-device judgment, high-risk or destructive changes, unexpected diff, NG/UNKNOWN, LOOP DETECTED, changed approval scope, merge). A handoff message that would trigger one of those still stops for human confirmation, regardless of which AI produced or received it.

## Adoption (per application repository)

1. Copy `templates/.ai-handoff/README.md.template` into the target repository as `.ai-handoff/README.md`.
2. Create `.ai-handoff/runtime/{outbox,inbox,processed}/` in that repository.
3. Decide, in that repository's `AGENTS.local.md`, whether `.ai-handoff/runtime/` is git-tracked or excluded via `.gitignore`, and record the decision there. This skill does not decide it for the repository.
4. Record the adoption in that repository's `.agents/sync-log.md`, consistent with how other common skills are synced.

## Application-Specific Configuration

Whether `.ai-handoff/runtime/` is tracked in git, and any repository-specific constraints on what may be written to it, are recorded in that application repository's `AGENTS.local.md`. This skill names no specific repository.

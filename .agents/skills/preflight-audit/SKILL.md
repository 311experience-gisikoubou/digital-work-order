---
name: preflight-audit
description: Use before starting implementation, fixes, refactoring, UI changes, docs changes, or design changes in digital-work-order, especially when the user asks to implement, fix, change, add, update, investigate before editing, or perform preflight. Confirm branch safety, upstream, HEAD, working tree, untracked files, unpushed commits, AGENTS.md, AGENTS.local.md, docs/design.md, intended scope, related code/callers, protected areas, cost risk, and secrets risk. Stop before editing when the branch is main, scope is unclear, unexpected diffs exist, requirements conflict with the source of truth, destructive operations are needed, added cost may occur, or sensitive information may be exposed.
---

# Preflight Audit

Use before changing code, UI, docs, or behavior.

## Required Checks

- Confirm repository root.
- Confirm current branch, upstream, and HEAD.
- Confirm the branch is not `main`.
- Confirm working tree status.
- Confirm untracked files.
- Confirm whether local commits are ahead of upstream.
- Read `AGENTS.md`.
- Read `AGENTS.local.md`.
- Read `docs/design.md` when business or screen behavior may be affected.
- Identify the requested change target files.
- Inspect related code and callers before editing.
- Identify the expected change scope.
- Identify unexpected existing diffs.
- Identify forbidden or high-care areas from `AGENTS.md`, `AGENTS.local.md`, and `docs/design.md`.
- Confirm whether the user requested audit-only or read-only work.
- Confirm that the implementation is not based on guessed requirements.
- Confirm additional-cost risk.
- Confirm secrets, tokens, credentials, and personal-information exposure risk.

## digital-work-order Impact Areas

When relevant, check `docs/design.md` and related code for effects on:

- `localStorage` persistence behavior
- Handwriting behavior
- Touch and pointer handling
- Apple Pencil behavior
- PDF and print behavior
- Calendar behavior
- Insurance / self-pay switching
- Clasp behavior
- Tooth number behavior
- Holiday judgment
- Surcharge judgment

Do not duplicate those specifications in this skill. Use `docs/design.md` as the source of truth.

## Stop Conditions

- The current branch is `main`.
- The working tree has unexplained or unconfirmed changes.
- The requested scope is unclear.
- Requirements conflict with `docs/design.md` or current code.
- The implementation would require destructive operations.
- Additional cost, paid service usage, or automatic billing may be involved.
- Secrets, tokens, credentials, personal information, or production data may be exposed.
- The user requested audit-only or read-only work.

## Output

Report:

- Skill used
- Whether work may proceed
- Current Git state
- Expected change scope
- Relevant files and callers inspected
- Impact areas
- Risks
- Blockers or stop reason
- Minimal implementation approach, if proceeding is allowed

Do not make changes until the audit supports proceeding.

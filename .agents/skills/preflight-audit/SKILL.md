---
name: preflight-audit
description: Use before starting implementation, bug fixes, refactoring, UI changes, backend changes, or design changes, especially when the user says implement, fix, change, refactor, add, update, or investigate before editing. Confirm repository state, branch safety, relevant docs/code/tests, intended change scope, migration need, forbidden areas, cost risk, and stop on dirty worktrees, main-branch work, unclear scope, specification conflicts, data risk, or possible additional cost.
---

# Preflight Audit

Use before changing code, UI, backend behavior, tests, docs, or design.

## Required Checks

- Repository root
- Current branch
- HEAD
- Upstream
- Local `main` and `origin/main`
- Working tree status
- Untracked files
- Stash state
- Relevant design documents
- Relevant code
- Existing tests
- Expected changed files
- Whether migration is needed
- Forbidden areas
- Specification conflicts

## Stop Conditions

- Working tree has unconfirmed changes.
- Current branch is `main`.
- Target scope is unclear.
- Requirements conflict with existing design or code.
- Data loss or destructive operation risk exists.
- Additional cost, paid service, external API, or automatic billing may be involved.

## Output

Report:

- 使用スキル
- Whether work may proceed
- Current state
- Expected change scope
- Risks
- Stop reason, or implementation approach

Do not make changes until the audit supports proceeding.

## Application-Specific Configuration

This skill's checks and stop conditions do not change based on any application's technology stack. Repository-specific detail — forbidden areas, the business-specification "Source of Truth", and expected file layout — comes from that repository's `AGENTS.local.md`.

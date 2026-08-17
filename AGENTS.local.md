# digital-work-order Local Rules

This repository contains the digital dental work order application.

## Required Reading (Local)

- Read `docs/learnings.md` and `docs/session-handoff.md` at the start of work, when they exist.

## Project Context

- The source of truth for business and screen behavior is `docs/design.md`.
- Do not duplicate detailed specifications here. Refer to `docs/design.md` before changing behavior.
- The main verification environment is iPad Safari.
- Apple Pencil use is an important target interaction.
- The app is currently centered on HTML, CSS, and JavaScript.
- The repository currently has no DB, SQLite, or migration system.
- The app uses `localStorage`.
- PDF and print behavior are implemented in the repository.
- Touch, pointer, and handwriting behavior are implemented in the repository.

## Basic Verification

- Run `node --check` for changed JavaScript files when applicable.
- Run `git diff --check` before reporting implementation completion.
- Confirm the changed file list.
- Confirm there are no unintended diffs.

## Changes That Usually Need Real-Device UI Checks

- Handwriting
- Apple Pencil behavior
- Finger operation
- Touch or pointer handling
- Pinch zoom
- PDF or print behavior
- Calendar behavior
- Insurance / self-pay switching
- Clasp behavior
- Tooth number behavior
- Visible layout changes

## Important Protection Targets

The following are not permanently forbidden to change, but changes require checking `docs/design.md`, reviewing the impact area, and performing the necessary verification, including real-device checks when appropriate.

- `localStorage` persistence behavior
- Handwriting save structure
- PDF handling
- Clasp behavior
- Tooth numbers and tooth chart behavior
- Holiday judgment
- Surcharge judgment

## Repository-Local Git And Work Rules

These rules are repository-local. Where this section and the shared foundation's general Git safety principles differ, this section takes precedence for this repository.

- Do not force push, under any circumstances, in this repository. This is a repository-local rule that is stricter than the foundation's conditional allowance (force push permitted only with explicit permission): in this repository, force push is not permitted even with explicit permission.
- Use one branch for one purpose.

## Independent Third-Party Audit

Antigravity CLI / Gemini may be used as an independent third-party reviewer when the cost of overlooking an error is high. It is not required for every change.

Typical use cases include important design changes, broad-impact changes, security-sensitive changes, complex state or data consistency, database / transaction / migration related work if introduced in the future, and final independent review before a high-risk PR.

The primary implementation agent remains responsible for its own audit and tests. A third-party review does not replace `test-gate`, `final-pr-audit`, or human device verification.

Do not expose secrets, tokens, personal information, or production data to an external review process. Use only currently available tooling that does not create additional cost.

## Roles And Default Flow

- Do not change already-established automated flows, AI role assignments, or human-confirmation scope based on in-conversation guesses.
- Default roles for this repository:
  - Local implementation and local Git operations: Codex
  - GitHub PR audit and merge management: GPT
  - Real-device UI/PDF verification and high-risk operation judgment: Human
- Default flow: preflight → implementation → test-gate → commit/push/PR → final-pr-audit.
- High-risk operations (merge, deletion, direct changes to `main`, force push, etc.) require human confirmation as described in `AGENTS.md`. For force push specifically, the stricter rule in "Repository-Local Git And Work Rules" above applies in this repository: force push is not permitted even with confirmation.
- If a decision is NG, UNKNOWN, or not determinable, do not proceed on a guess. Stop and report.
- AI agents do not auto-update `AGENTS.md`, `AGENTS.local.md`, or `docs/learnings.md`. An AI may propose improvements; changes are applied only after human approval.

## Future Skills

The following skills are expected to be useful after they are introduced into `.agents/skills/`:

- `preflight-audit`
- `test-gate`
- `final-pr-audit`
- `post-merge-verification`
- `handoff`
- `manual-ui-smoke-test`

Until those skills exist in this repository or are available in the current environment, treat them as planned workflow names, not installed tools.

`migration-safety` is not part of the normal workflow for this repository. Reconsider it only if DB, schema migration, or migration-equivalent behavior is introduced.

## Local AI Handoff

- `.ai-handoff/` implements the `local-ai-handoff` skill from `ai-dev-foundation`. V1 scope is Claude Code ↔ Codex CLI only; the browser-based GPT continues to use the existing GitHub `[AI_HANDOFF]` PR-comment channel, and Gemini/Antigravity is an extension point only, not wired in.
- `.ai-handoff/runtime/` is **not git-tracked** in this repository. It is excluded via `.gitignore` (`.ai-handoff/runtime/`). Only `.ai-handoff/README.md` is tracked.
- Handoff messages must not contain secrets, tokens, personal information, or production data, and must not be used to route around this repository's existing human-confirmation requirements (real-device UI checks, high-risk operations, `AGENTS.md`'s Git safety rules).
- Actually invoking Codex CLI (via `detect-codex.ps1` and `codex exec`) is a repository operation like any other; it is not run unattended without the operator's awareness.

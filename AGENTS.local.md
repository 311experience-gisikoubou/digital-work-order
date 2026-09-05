# digital-work-order Local Rules

This repository contains the digital dental work order application.

## Required Reading (Local)

- Read `CURRENT_STATUS.md` at the start of work; it is the current-state checkpoint for this repository.
- Read `docs/learnings.md` when it exists. Treat `docs/session-handoff.md` as historical handoff context, not as the current-state source of truth.

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

## Debug & Automated Verification

- For debugging, PDF/print regressions, layout regressions, or deciding
  whether a real-device check is actually necessary, use the
  `debug-verification` skill (`.agents/skills/debug-verification/SKILL.md`).
- It runs an automated-first verification workflow before requesting a human
  check, and applies a three-question check before any real-device or manual
  confirmation request. It specializes "Human Decision Boundary" above for
  that recurring situation; it does not replace it.
- Protected data for this repository is defined above in "Important
  Protection Targets"; `debug-verification` does not redefine it.
- This is a repository-local skill, not yet synchronized from
  `ai-dev-foundation` — the same treatment as `manual-ui-smoke-test`.

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

## Human Decision Boundary

- Technical correctness and safety must be assessed by the AI workflow, not delegated to the human merely as a formality.
- Before requesting human approval, the AI must complete the applicable technical checks: scope/diff review, specification consistency, tests, unintended-change review, Git state review, and risk assessment.
- Do not ask the human to approve code, Git state, tests, architecture, migrations, security, or other technical matters that require engineering knowledge unless there is no reliable way for the AI to determine them. If undeterminable, report `UNKNOWN` and explain why instead of converting uncertainty into a human approval request.
- Human confirmation should be limited to matters that genuinely require human judgment, especially:
  - whether the business intent and requested behavior are correct;
  - real-device look, feel, usability, and other perceptual judgments when applicable;
  - permission for high-risk or irreversible operations such as merge or deletion.
- A final audit report should lead with a plain-language result such as `PASS`, `NG`, or `UNKNOWN`, followed by only the human decisions that remain. Technical evidence may be included as supporting detail, but must not be presented as homework the human must understand before approving.
- When the technical audit is `PASS` and no real-device or business judgment remains, the human should normally be asked only whether to authorize the high-risk operation.

## Learning Gate

- AI must evaluate a learning candidate when any of the following occurs:
  - the user corrects the AI's process, safety judgment, role assignment, or explanation;
  - the same class of mistake, failed attempt, or avoidable confusion occurs more than once;
  - a new safety rule, reusable development rule, or reliable efficiency improvement is discovered;
  - the user cannot reasonably judge a technical risk because the explanation assumes engineering knowledge.
- Important candidates should be surfaced when discovered. At the end of a development session, surface at most 3 unresolved candidates.
- Each candidate must include: trigger condition, proposed learning, and reason it is worth retaining.
- Do not save, append, or promote a candidate automatically. Human approval is required before changing `docs/learnings.md`, `AGENTS.local.md`, or shared rules.
- Before asking a non-engineer to make a technical judgment, explain in plain language what could go wrong, whether work should stop now, and what decision is actually needed from the human.
- Do not turn ordinary one-off implementation details into permanent rules. Prefer reusable, generalizable lessons.

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

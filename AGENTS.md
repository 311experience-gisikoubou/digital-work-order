# Agent Operating Rules

This file is the common entry point for AI agents working in this repository.

## Required Reading

- Read this file first.
- Read `AGENTS.local.md` for digital-work-order specific rules.
- Read `docs/learnings.md` and `docs/session-handoff.md` at the start of work, when they exist.
- Treat `docs/design.md` as the source of truth for business and screen behavior.
- Common skills may be used after `.agents/skills/` is introduced.
- Do not assume a skill exists unless it has actually been installed in this repository or is available in the current environment.
- Do not change already-established automated flows, AI role assignments, or human-confirmation scope based on in-conversation guesses.

## Git And Work Rules

- Do not commit directly to `main`.
- Do not force push.
- Use one branch for one purpose.
- Use one PR for one purpose.
- If the user asks for audit, investigation, or read-only work only, do not change files.
- Do not silently fix, delete, or revert unexpected changes.
- Do not implement behavior from guesswork. Confirm requirements or report uncertainty.
- Check the impact area before making changes.
- Prefer one change followed by one appropriate verification.
- After implementation, run static checks or tests appropriate to the changed files.
- Before PR work or final handoff, audit the diff and safety of the change.
- For changes that affect visible behavior or device interaction, include human real-device UI verification when needed.
- Do not cause additional paid service usage or install paid services without explicit approval.
- Do not expose secrets, tokens, credentials, or personal information in output, commits, logs, or test artifacts.

## Independent Third-Party Audit

Antigravity CLI / Gemini may be used as an independent third-party reviewer when the cost of overlooking an error is high. It is not required for every change.

Typical use cases include important design changes, broad-impact changes, security-sensitive changes, complex state or data consistency, database / transaction / migration related work if introduced in the future, and final independent review before a high-risk PR.

The primary implementation agent remains responsible for its own audit and tests. A third-party review does not replace `test-gate`, `final-pr-audit`, or human device verification.

Do not expose secrets, tokens, personal information, or production data to an external review process. Use only currently available tooling that does not create additional cost.

## Roles And Default Flow

- Default roles for this repository:
  - Local implementation and local Git operations: Codex
  - GitHub PR audit and merge management: GPT
  - Real-device UI/PDF verification and high-risk operation judgment: Human
- Default flow: preflight → implementation → test-gate → commit/push/PR → final-pr-audit.
- High-risk operations (merge, deletion, direct changes to `main`, force push, etc.) follow the human-confirmation rules under "Git And Work Rules" above.
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

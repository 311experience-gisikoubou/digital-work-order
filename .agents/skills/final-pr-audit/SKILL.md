---
name: final-pr-audit
description: Use after implementation and before PR creation, push approval, final completion reports, or when the user asks for final review, PR audit, merge readiness, or whether it is safe to proceed in digital-work-order. Verify branch, upstream, HEAD, base branch, origin/main diff, commit count, working tree, changed files, scope, docs/design.md consistency, AGENTS.md and AGENTS.local.md compliance, test-gate results, unrun checks, secrets risk, dangerous operations, added-cost risk, high-risk app areas, manual device confirmation need/result, and blockers. Treat Antigravity CLI / Gemini only as an optional independent third-party review for high-risk work, not as a replacement for primary audit, tests, or human device checks.
---

# Final PR Audit

Use when work is complete, before PR creation, before approving push, or when the user asks for final confirmation.

## Required Checks

- Confirm current branch, upstream, and HEAD.
- Confirm base branch.
- Compare the work against `origin/main` when relevant.
- Confirm commit count.
- Confirm working tree status.
- Confirm changed files.
- Confirm all changes are within the requested scope.
- Confirm there are no violations of `AGENTS.md` or `AGENTS.local.md`.
- Confirm consistency with `docs/design.md` when behavior or screen specifications are affected.
- Confirm the implementation report matches the actual diff.
- Confirm `test-gate` results for this change, when available.
- Confirm unrun or unavailable checks are clearly reported.
- Run or verify `git diff --check` unless already reported for the same final state.
- Confirm no force push, destructive operation, or unsafe Git operation is being requested.
- Confirm added-cost risk.
- Confirm secrets, tokens, credentials, personal information, and production data are not introduced.
- Confirm whether manual device confirmation is required and whether it has been completed.
- Identify blockers.

## High-Risk Impact Areas

When relevant, check `docs/design.md` and the diff for effects on:

- `localStorage` persistence behavior
- PDF and print behavior
- Touch and pointer handling
- Apple Pencil behavior
- Calendar behavior
- Insurance / self-pay switching
- Clasp behavior
- Tooth number behavior
- Holiday judgment
- Surcharge judgment

## Independent Third-Party Audit

Antigravity CLI / Gemini may be considered for high-risk independent review.

- It is not required for every change.
- It does not replace the primary implementation agent's audit or tests.
- It does not replace human device confirmation.
- Do not expose secrets, tokens, credentials, personal information, or production data.
- Use only tooling that is currently available and does not create additional cost.

## PR Description Audit

When PR title and body are available, confirm:

- The title and body describe the actual diff.
- Summary, included, not-included, and verification sections match implementation fact.
- No unimplemented feature is described as complete.
- No unrun test is described as passing.
- Branches, SHAs, commit counts, and changed files match the audited state.
- Known issues, unverified items, and blockers are not omitted.

If PR information is unavailable locally, state that limitation instead of guessing.

## Stop Conditions

- Current branch or base branch is unclear.
- Changed files exceed the requested scope.
- The diff conflicts with `docs/design.md`.
- `AGENTS.md` or `AGENTS.local.md` is violated.
- Required verification failed or was not run.
- A material security or privacy risk is unresolved.
- Added-cost risk is unresolved.
- Required manual device confirmation is missing.
- PR description materially misstates the diff.

## Output

Report:

- Final judgment
- Git state
- Diff scope
- Specification fit
- Verification results
- Security and privacy review result
- Added-cost review result
- PR description consistency result, if applicable
- Manual device confirmation status
- Blockers
- Readiness to proceed
- Operations not performed

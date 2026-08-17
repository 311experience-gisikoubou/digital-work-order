---
name: test-gate
description: Use after implementation, fixes, refactoring, UI changes, backend changes, or migration changes, including Japanese requests such as 実装後の検証, 修正後のテスト, 必要テストの選択, 型チェック相当, selftest, build, migration test, 実機確認, 未実施確認, or テストゲート, when the user asks to select or run required verification, confirm a type-check equivalent, run a selftest, run a build, run a migration test, confirm on a real device, or otherwise gate completion on tests. Select and run only the verification commands that exist for this repository, as defined in its application-local configuration, record success/failure/unrun/unneeded/unavailable/interrupted status for each, stop on failures, and never treat unrun or unavailable checks as passing.
---

# Test Gate

Use after changes are made and the user asks to choose, run, or confirm required verification.

## Required Workflow

- Inspect changed files and changed content to determine which verification categories apply.
- Select only the verification required for the change type; do not run unrelated checks.
- Confirm generated-output or data-write risk before running any command that may create files or modify a database.
- Run lighter checks before heavier checks.
- Stop when a required earlier check fails, is interrupted, times out, or cannot run.
- Separate automated checks from real-device or manual confirmation.
- Do not mark work complete until every required check is `success` or explicitly `unneeded`.
- Record every check as exactly one of: `success`, `failure`, `unrun`, `unneeded`, `unavailable`, or `interrupted`.

## Verification Categories

The categories below are common. The actual commands, and which categories apply, are repository-specific and must come from that repository's `AGENTS.local.md` ("Repository Commands"), not invented or guessed.

- `git diff --check`
- Format check
- Lint check
- Type check
- Unit test
- Integration test
- Build
- Selftest — a lightweight, repository-specific self-check distinct from the full test suite, when one exists
- Migration-specific test, when the change touches schema or migrations (see `migration-safety`)

Do not invent a command that is not listed in `AGENTS.local.md`, and do not assume a category exists there if it is not listed.

## Selection Rules

- Documentation-only changes: run `git diff --check`; verify encoding, heading/frontmatter structure, links, and content consistency as relevant. Mark build/test as `unneeded` when not required.
- Changes confined to one part of the stack (for example, only the interface layer or only the backend layer): run `git diff --check`, any selftest relevant to that layer, then that layer's format/lint/type-check/build/test commands as listed in `AGENTS.local.md`.
- Changes spanning multiple parts of the stack: run the checks that apply to each affected part.
- Migration changes: also use `migration-safety`; verify existing migrations remain unchanged, run the repository's migration tests, and check fresh-apply, upgrade-from-existing, and integrity coverage.
- Real-device or manual changes: report that confirmation separately from automated checks. If required and not performed, do not mark complete.

## Default Order

Run only required checks, normally in this order:

1. `git diff --check`
2. Selftest, when relevant
3. Format check
4. Lint check
5. Type check
6. Unit / integration test
7. Build
8. Migration-specific tests
9. Real-device or manual confirmation

If changing the order, explain why.

## Known-Failure and Regression Triage

- When a verification check fails, determine whether the failure is a known failure that already existed before this change, or a new regression introduced by this change.
- Base that determination on a comparison against the pre-change state (for example, the same check run against the code before the change, or a previously recorded known-failure record), not on assumption.
- If it cannot be determined with confidence whether a failure is known or new, do not guess; report it as undetermined and treat it as a regression until shown otherwise.
- Do not use the existence of a known failure as a reason to stop checking for, or to overlook, an unrelated new regression.
- Even when a failure is confirmed known, confirm this change did not alter its cause or scope (for example, whether it now fails for an additional reason, or affects a different set of checks).
- Proceeding despite a known failure is only acceptable once it is confirmed known against the pre-change state; report the basis and evidence for that determination in the output.

## Result Counting

- For each verification run, tally counts as precisely as the tool allows: succeeded, failed, skipped, and not run.
- When a test runner or check tool reports its own counts, use those reported counts as the basis rather than estimating.
- When multiple test suites or check runs are executed, report counts per suite as well as the total; do not collapse them into a single combined number that hides which suite a failure came from.
- Do not report an estimated or assumed count as if it were a confirmed count.
- If a count cannot be obtained, report that it is unavailable and state why, rather than omitting it silently.
- A summary such as "all passed" is not sufficient on its own when a specific count is obtainable; report the actual numbers.
- When a check is re-run after a failure, report the final run's result together with the count of failures observed before it, so a fixed failure and a first-time failure are not indistinguishable in the report.

## Stop Conditions

- Required test fails.
- Test is interrupted or times out.
- Required command does not exist in `AGENTS.local.md`.
- Required command cannot run.
- Unexpected generated files appear.
- Unexpected tracked diff appears.
- Working tree becomes dirty unexpectedly.
- Migration checksum or line-ending state is unclear.
- Required real-device or manual confirmation is not performed.
- A command is unknown.
- A verification failure is confirmed to be a new regression rather than a known, pre-existing failure.
- Any paid service, external API, automatic billing, or added dependency may be involved.

## Do Not Do

- Do not guess commands.
- Do not add dependencies or packages.
- Do not fix failing tests unless the user asks for a fix.
- Do not modify migrations, application code, or docs as part of the gate.
- Do not create PRs, merge, delete branches, commit, push, rebase, reset, force, or change Git configuration.
- Do not infer real-device or manual success.
- Do not report unrun checks as passing.

## Output

Report:

- Skills used
- Changed files and selected verification
- Commands run, working directory, and status
- Checks marked `unneeded` and why
- Checks marked `unrun`, `unavailable`, or `interrupted` and why
- For any failed check: whether it is a known, pre-existing failure or a new regression, and the evidence for that determination
- Verification counts (succeeded/failed/skipped/not run) per suite and in total, or why a count is unavailable
- Generated-output or data-write risk
- Real-device or manual confirmation status
- Whether completion is allowed
- Blockers

## Application-Specific Configuration

The exact commands for format, lint, type check, unit/integration test, build, selftest, and migration test — and which of these categories apply at all — come from that repository's `AGENTS.local.md` ("Repository Commands"). This skill names no specific language, package manager, or framework.

---
name: test-gate
description: Use after implementation, fixes, refactoring, UI changes, backend changes, or migration changes, including Japanese requests such as 実装後の検証, 修正後のテスト, 必要テストの選択, 型チェック相当, selftest, build, migration test, 実機確認, 未実施確認, or テストゲート, when the user asks to select or run required verification, confirm a type-check equivalent, run a selftest, run a build, run a migration test, confirm on a real device, or otherwise gate completion on tests. Select and run only the verification commands that exist for this repository, as defined in its application-local configuration, record success/failure/unrun/unneeded/unavailable/interrupted status for each, stop on failures, and never treat unrun or unavailable checks as passing.
---

# Test Gate

Use after changes are made and the user asks to choose, run, or confirm required verification.

## Evidence Location

Before selecting checks, identify where the audited change exists and where verification can actually execute.

- If the audited head exists in a local workspace, use that workspace and record its exact head/state.
- If the audited head was created remotely and no local workspace participated, do not require an unrelated local checkout merely to satisfy habit. Use exact remote-head content and machine-readable GitHub/remote evidence where the check can be reproduced equivalently.
- If both local and remote paths participated, prove both refer to the same audited head.
- An alternative verification counts as `success` only when it operates on the exact audited source or canonical diff and is technically equivalent to the required property. Record the evidence source and do not claim a literal command ran when it did not.
- If equivalence cannot be established, mark the check `unavailable` or `unrun`; never upgrade it to success.
- Do not make a non-engineer human relay command output between tools when an accessible machine-readable source can provide the evidence.

## Required Workflow

- Inspect changed files and changed content to determine which verification categories apply.
- Select only the verification required for the change type; do not run unrelated checks.
- Confirm generated-output or data-write risk before running any command that may create files or modify a database.
- Run lighter checks before heavier checks.
- Stop when a required earlier check fails, is interrupted, times out, or cannot run without an accepted equivalent verification path.
- Separate automated checks from real-device or manual confirmation.
- Do not mark work complete until every required check is `success` or explicitly `unneeded`.
- Record every check as exactly one of: `success`, `failure`, `unrun`, `unneeded`, `unavailable`, or `interrupted`.

## Verification Categories

The categories below are common. The actual commands, and which categories apply, are repository-specific and must come from that repository's `AGENTS.local.md` ("Repository Commands"), not invented or guessed.

- Diff hygiene (`git diff --check` locally, or a technically equivalent canonical remote-diff check for remote-only work)
- Format check
- Lint check
- Type check
- Unit test
- Integration test
- Build
- Selftest — a lightweight, repository-specific self-check distinct from the full test suite, when one exists
- Migration-specific test, when the change touches schema or migrations (see `migration-safety`)

Do not invent a repository command that is not listed in `AGENTS.local.md`, and do not assume a category exists there if it is not listed. An equivalent remote check is allowed only for the property it genuinely verifies; it does not create a nonexistent repository command.

## Selection Rules

- Documentation-only changes: verify diff hygiene; verify encoding, heading/frontmatter structure, links, and content consistency as relevant. Mark build/test as `unneeded` when not required.
- Changes confined to one part of the stack (for example, only the interface layer or only the backend layer): verify diff hygiene, any selftest relevant to that layer, then that layer's format/lint/type-check/build/test commands as listed in `AGENTS.local.md`.
- Changes spanning multiple parts of the stack: run the checks that apply to each affected part.
- Migration changes: also use `migration-safety`; verify existing migrations remain unchanged, run the repository's migration tests, and check fresh-apply, upgrade-from-existing, and integrity coverage.
- Real-device or manual changes: report that confirmation separately from automated checks. If required and not performed, do not mark complete.
- For a remote-only audited head, exact-head selftests may run in an isolated temporary environment only if the required files are fetched from that exact head and the test's behavior does not depend on omitted repository state. Record this as remote-head reconstructed verification, not repository-local execution.

## Real-Device Preparation Gate

Before asking a human to begin real-device or other manual verification, prepare the verification so the human is confirming behavior rather than designing the test on the fly.

Before the first human action, run the dependency-free preparation gate:

```text
node .agents/skills/test-gate/real-device-preparation-gate.mjs --manual-verification required --sample-data required --sample-data-prepared yes --sample-data-preparer ai-workflow --sample-data-source dev-preload --approved-test-environment yes --human-sample-data-entry no --ui-path-verified yes --manual-started no
```

Use the values that match the actual verification. The gate is fail-closed:

- `PROCEED`: the real-device/manual preparation prerequisites are satisfied.
- `STOP`: do not ask the human to start or continue. Return to AI-side preparation and resolve the reported prerequisite first.

When sample/test data is required, `--sample-data-preparer` must be `ai-workflow`, `system`, or `provider`, and `--sample-data-source` must identify a prepared safe source such as `seed`, `fixture`, `dev-preload`, or `existing-test-data`. `--human-sample-data-entry yes` is always a stop condition for sample/test-data creation during REAL_DEVICE/manual verification.

Preparation-gate self-test:

```text
node .agents/skills/test-gate/real-device-preparation-gate-selftest.mjs .agents/skills/test-gate/real-device-preparation-gate.mjs
```

- Report the estimated duration before the first manual action, together with the fixed total number of manual checks and the current/remaining counts. The estimate is a planning aid, not a guarantee, but it must be shown before verification starts.
- Identify and prepare the required sample/test data in the approved non-production environment before the human check begins. Prefer existing seed/fixture/test data and reuse a single safe sample across checks where practical. Do not use production or real-person data merely because test data is missing.
- Prove the intended test environment/data source is the approved non-production one when the repository has such a distinction. Complete any repository-specific safety prerequisite before inviting human interaction.
- Inspect the actual UI/source and use labels and control names that really exist. Prepare the first human action in the same wording and order the UI presents it; do not invent intermediate fields or ask the human to discover the path.
- If required sample data, environment proof, or an expected UI control is missing, do not start or continue the manual check. Mark the check `unrun` or `interrupted` as appropriate, return to preparation, and resolve the prerequisite first.
- Do not make the human create or type sample/test data as part of REAL_DEVICE/manual verification. Required sample/test data must be prepared before the human check by the AI workflow, system, or verified provider through a seed, fixture, dev preload, or existing safe test-data route. A human-only UI write is not an exception for creating sample/test data: if no safe preparation route exists, keep the manual verification `unrun` and return to preparation. Human interaction may still be used for the actual behavior, visual, or operation-feel confirmation once the prepared sample state is ready.
- Preparation steps are not extra verification items. Do not silently increase the announced check count during execution. If new evidence reveals that the original check plan is insufficient, stop, explain the reason, and re-plan before continuing.
- Keep manual verification limited to properties that genuinely require a human/real device; continue to prefer automated evidence for backend logic, DTOs, persisted values, calculations, and other reproducible properties.

## Default Order

Run only required checks, normally in this order:

1. Diff hygiene
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
- Required repository command does not exist in `AGENTS.local.md` and no accepted property-equivalent check applies.
- Required check cannot run and no technically equivalent evidence path exists.
- Unexpected generated files appear in a workspace that was actually used.
- Unexpected tracked diff appears in a workspace that was actually used.
- A local working tree used for the audited change becomes dirty unexpectedly.
- Migration checksum or line-ending state is unclear.
- Required real-device or manual confirmation is not performed.
- `real-device-preparation-gate` returns `STOP`.
- A required real-device/manual preparation prerequisite is missing: the applicable time estimate/check counts, sample/test data, approved environment proof, or verified UI path is not ready.
- The human would need to create or type sample/test data for REAL_DEVICE/manual verification.
- A sample-data gap or UI-path mismatch is discovered after manual verification has started; stop and return to preparation rather than improvising through it.
- A command or proposed equivalent is unknown.
- A verification failure is confirmed to be a new regression rather than a known, pre-existing failure.
- Any paid service, external API, automatic billing, or added dependency may be involved.

## Do Not Do

- Do not guess commands.
- Do not add dependencies or packages merely to satisfy the gate.
- Do not fix failing tests unless the user asks for a fix.
- Do not modify migrations, application code, or docs as part of the gate.
- Do not create PRs, merge, delete branches, commit, push, rebase, reset, force, or change Git configuration.
- Do not infer real-device or manual success.
- Do not begin real-device/manual verification before reporting the applicable duration estimate and fixed check count.
- Do not ask the human to create, type, or improvise sample/test data during REAL_DEVICE/manual verification; prepare it first through an AI/system/provider route or keep the check `unrun`.
- Do not ask the human to discover UI controls during a verification already in progress.
- Do not guess UI labels or steps; verify them from the actual UI/source first.
- Do not report unrun or unavailable checks as passing.
- Do not require an unrelated local working tree or stash when the audited head was produced and verified entirely through another evidence path.

## Output

Report:

- Skills used
- Evidence source(s): local / remote-only / mixed
- Audited head SHA when available
- Changed files and selected verification
- Commands or equivalent checks run, execution location, and status
- Checks marked `unneeded` and why
- Checks marked `unrun`, `unavailable`, or `interrupted` and why
- For any failed check: whether it is a known, pre-existing failure or a new regression, and the evidence for that determination
- Verification counts (succeeded/failed/skipped/not run) per suite and in total, or why a count is unavailable
- Generated-output or data-write risk
- Real-device or manual confirmation status
- For required real-device/manual verification: preparation-gate result, estimated duration, fixed total/current/remaining check counts, sample/test-data readiness and preparer/source, approved environment/data-source status, whether human sample-data entry is forbidden/absent, and the first verified UI action before the human check starts
- Whether completion is allowed
- Blockers

## Application-Specific Configuration

The exact commands for format, lint, type check, unit/integration test, build, selftest, and migration test — and which of these categories apply at all — come from that repository's `AGENTS.local.md` ("Repository Commands"). This skill names no specific language, package manager, or framework.

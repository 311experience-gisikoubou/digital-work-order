---
name: test-gate
description: Use after implementation, fixes, refactoring, UI changes, docs changes, or verification requests in digital-work-order. Select and run only checks that exist for this repository, such as node --check for changed JavaScript, git diff --check, git status --short, changed-file review, and static HTML/CSS/DOM reference checks when relevant. Do not assume build, lint, formatter, automated test, dependency manifest, or lockfile checks exist. Separate automated/static checks from iPad Safari, Apple Pencil, and other human device confirmation, and never report unrun checks as passing.
---

# Test Gate

Use after changes are made and verification is requested.

## Required Workflow

- Inspect changed files and changed content.
- Select only checks required for the change type.
- Run lighter checks before heavier checks.
- Use only commands that exist or are directly applicable to this repository.
- Stop when a required check fails, times out, is interrupted, or cannot run.
- Separate automated/static checks from human device confirmation.
- Do not mark work complete until every required check is `success` or explicitly `unneeded`.
- Record every check as exactly one of: `success`, `failure`, `unrun`, `unneeded`, `unavailable`, or `interrupted`.

## digital-work-order Basic Checks

- Run `node --check <file>` for changed JavaScript files when applicable.
- Run `git diff --check`.
- Run `git status --short`.
- Review the changed file list.
- Confirm there are no unintended diffs.

## HTML / CSS Static Checks

When HTML or CSS changes may affect behavior, inspect as relevant:

- id and class references
- script references and loading order
- DOM elements referenced from JavaScript
- CSS selector scope and affected UI areas

## Existing-Only Checks

Run the following only if they actually exist in this repository:

- Lint
- Formatter
- Build
- Automated tests
- Dependency manifest checks
- Lockfile checks

Do not invent commands and do not assume a category exists.

## Manual Device Confirmation

Human device confirmation is separate from this skill's automated/static checks.

Report one of:

- `manual device check required`
- `manual device check completed`
- `manual device check not yet completed`
- `manual device check unneeded`

For iPad Safari, Apple Pencil, touch, pointer, pinch zoom, PDF/print, calendar, insurance / self-pay, clasp, tooth number, or layout changes, state whether human device confirmation is needed.

If `manual-ui-smoke-test` is introduced in the future, delegate detailed manual UI procedures to that skill.

## Stop Conditions

- A required check fails.
- A required check times out or is interrupted.
- A required command is unavailable.
- Unexpected files or diffs appear.
- Working tree state becomes unclear.
- A required manual device confirmation is not yet completed.
- A command is unknown or guessed.
- Any added-cost, external-service, or sensitive-information risk appears.

## Do Not Do

- Do not guess commands.
- Do not add dependencies or packages.
- Do not fix failures unless the user asks for a fix.
- Do not modify application code, docs, or tests as part of the gate.
- Do not create PRs, merge, delete branches, commit, push, rebase, reset, force, or change Git configuration.
- Do not infer manual device success.
- Do not report unrun checks as passing.

## Output

Report:

- Skill used
- Changed files
- Selected verification
- Commands run, working directory, and status
- Checks marked `unneeded` and why
- Checks marked `unrun`, `unavailable`, or `interrupted` and why
- Failed checks and whether they block completion
- Generated-output or data-write risk
- Manual device confirmation status
- Whether completion is allowed
- Blockers

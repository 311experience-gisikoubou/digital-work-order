---
name: final-pr-audit
description: Use after implementation and before PR creation, merge, or final completion reports, or when the user asks for a final review, PR audit, merge readiness check, or whether it is safe to proceed. Verify base/head branch and SHA, commit count, changed files, diff scope, migration and dependency-manifest diffs, design consistency, report consistency, the repository's format/lint/type-check/build/selftest verification, generated tracked diffs, real-device status, GitHub information limits, and blockers, and separate audit approval from merge execution.
---

# Final PR Audit

Use when work is complete or the user asks for final confirmation.

## Required Checks

- Base and head branch
- Base and head SHA
- Commit count
- Changed files
- Scope-outside changes — anything changed outside what the task called for, and anything inside the repository's forbidden scope (see `AGENTS.local.md`)
- Migration diffs, if any (see `migration-safety`)
- Dependency-manifest and lockfile diffs, if the repository has any (the specific file names are repository-specific — see `AGENTS.local.md`)
- Consistency with the repository's design documentation (its "Source of Truth")
- Consistency with the implementation report already given to the user
- `git diff --check`
- The repository's format, lint, type-check, build, and selftest verification, as defined in `AGENTS.local.md`
- The results already recorded by `test-gate` for this change
- Security-relevant changes (see "Security Review" below)
- Consistency between the PR description and the actual change (see "PR Description Audit" below)
- Real-device or manual confirmation status
- Blockers

## Security Review

Confirm, independently of the other checks:

- No secrets, credentials, tokens, personal information, or real data are introduced into tracked files or the PR description.
- Whether the change affects authentication, authorization, or permission handling, and whether that effect was intended.
- Whether the change adds a new external call, external service, or external dependency.
- Whether input handling, output handling, or logging introduced or changed by this change could leak sensitive information or accept unsafe input.
- Whether the change could cause data destruction, information disclosure, or an unintended increase in privilege.
- Consistency with the repository's `AGENTS.local.md` "Data and Security" section.
- Any security-relevant point that could not be verified — state it explicitly rather than assuming it is safe.

A material, unresolved security risk, or a security question that cannot be verified, is a Blocker. This review names no specific framework, vulnerability scanner, or command; use whatever the repository's `AGENTS.local.md` designates, if any.

## PR Description Audit

When the PR title and body are available, confirm:

- The title and body describe what the diff actually contains, not what was originally planned.
- Sections such as Summary, Included, Not included, and Verification match implementation fact.
- No unimplemented feature is described as complete, and no test that was not run is described as passing.
- Stated changed-file counts, commit counts, version, branch, and SHAs match what was independently verified in this audit.
- No known issue, unverified item, or Blocker is omitted from the description.
- If the PR description cannot be obtained, state that limitation explicitly, and separate what was confirmed from local Git state from what could not be checked.

A material mismatch between the PR description and the actual diff is a Blocker. This audit does not modify the PR description; it only reports mismatches.

## Command Notes

- Build output directories may be updated by a build command; verify tracked files remain unchanged afterward.
- For a migration checksum failure, first check for raw-byte or line-ending differences before treating it as a logic failure.
- If GitHub PR data is unavailable locally, list browser-confirmation items instead of guessing.
- Audit approval is not merge execution.
- For post-implementation verification execution and result tracking, use `test-gate`; final PR audit checks the `test-gate` results rather than re-running everything from scratch.
- For actual post-merge verification and local `main` synchronization, use `post-merge-verification`.

## Output

Report:

- Final judgment
- Git state
- Diff scope
- Specification fit
- Verification results
- Security review result
- PR description consistency result
- Real-device confirmation
- Blockers
- Merge readiness
- Operations not performed

## Application-Specific Configuration

The exact build/test/lint/type-check commands, dependency-manifest file names, migration conventions, and forbidden scope come from that repository's `AGENTS.local.md` — specifically its "Repository Commands", "Forbidden Scope", and "Migration Rules" sections. This skill names no specific language, package manager, or framework.

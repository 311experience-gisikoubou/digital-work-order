---
name: final-pr-audit
description: Use after implementation and before PR creation, merge, or final completion reports, or when the user asks for a final review, PR audit, merge readiness check, or whether it is safe to proceed. Verify base/head branch and SHA, commit count, changed files, diff scope, migration and dependency-manifest diffs, design consistency, report consistency, the repository's format/lint/type-check/build/selftest verification, generated tracked diffs, real-device status, GitHub information limits, and blockers; then complete safe mechanical pre-merge preparation so the only normal human action left is explicit merge approval.
---

# Final PR Audit

Use when work is complete or the user asks for final confirmation.

## Evidence Source Selection

Before checking merge readiness, identify where the audited change was actually created and verified. Do not require unrelated local-machine evidence merely because a local checkout may exist somewhere.

- **Local-workspace change:** if the audited change was created, tested, or staged in a local checkout, verify the relevant local repository root, branch/HEAD, upstream, working tree, untracked files, stash state, and alignment with the remote/PR head.
- **GitHub/remote-only change:** if the audited change was created directly on the remote branch and no local checkout participated in producing or testing that audited head, use GitHub/remote evidence: exact base/head SHA, merge-base, changed-file list, canonical PR/compare diff, PR state, mergeability, review/CI status, and exact-head file contents or tests. Do not block on an unrelated local working tree or stash.
- **Mixed change:** if both local and remote paths participated, verify both and prove they refer to the same audited head.
- Never substitute weaker evidence merely for convenience. If a required property cannot be proven from the actual execution location or an equivalent independent source, mark it `unavailable`/`UNKNOWN`; do not call it PASS.
- Human relay work is not an evidence source. Do not ask a non-engineer human to copy technical state between tools when an accessible machine-readable source exists.

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
- Diff hygiene: use `git diff --check` when the audited head exists in the local execution workspace; for remote-only work, inspect the canonical PR/compare diff with an equivalent whitespace/conflict-marker check and record that it is an equivalent remote diff-hygiene check rather than claiming the literal local command ran
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
- If some evidence source is unavailable, state that limitation explicitly and separate what was independently confirmed from what could not be checked. Do not describe remote-only verification as local verification, or vice versa.

If the mismatch is purely mechanical and the correct value is already proven by exact audit evidence — for example a stale verification checkbox/result, count, SHA, or status line — update the PR description automatically, then re-fetch and re-audit it. This is safe technical record maintenance, not a human value decision.

Do not automatically rewrite semantic intent, scope, requirements, risk acceptance, or business claims. A material semantic mismatch, or any mismatch whose correct wording cannot be proven from existing evidence, is a Blocker and must not be papered over by editing the PR text.

## PR Creation State

Avoid creating a Draft PR merely as a routine intermediate state.

- If the implementation is complete, required `test-gate` checks are PASS, required real-device/manual checks are PASS or explicitly unneeded, and there is no known Blocker or unresolved human value decision, create the PR as ready for review from the start.
- Use Draft only when the PR is intentionally opened before required gates are complete, while a known Blocker remains, or while a genuine human value/ownership decision is still unresolved.
- Do not use Draft solely to preserve a ritualized `Draft → Ready` step. Removing an unnecessary state transition is preferred when it does not weaken any safety or human-approval boundary.
- Ready-for-review state does not authorize merge. The final human merge approval remains mandatory.
- If an existing PR is legitimately Draft and later becomes complete, the AI-owned Draft→Ready preparation and route-fallback rules below still apply.

## Pre-Merge Preparation Ownership

After the audit itself passes, continue automatically through all safe, reversible, mechanical preparation needed to reach `PREPARED_FOR_MERGE`. Do not stop merely to ask the human to perform GitHub housekeeping.

AI-owned preparation includes, when applicable:

- update mechanically stale PR verification/status text using already-proven evidence;
- mark a Draft PR ready for review when all required audit/test/manual gates have passed and no unresolved human value decision remains;
- re-fetch PR metadata after any PR metadata mutation;
- verify the PR is open, the audited head SHA is unchanged, base is still the intended branch, and mergeability/review/required-CI state has no blocker;
- post or update the repository's machine-readable audit/handoff status when its local rules require one;
- clear only technical/mechanical pre-merge blockers that are safe, reversible, in-scope, and already authorized by the approved development direction.

These actions do **not** require separate human approval. Draft/ready state, PR bookkeeping, status retrieval, evidence comparison, and equivalent safe Git/GitHub housekeeping are technical workflow state, not the final ownership decision.

The normal human confirmation point is **merge authorization**. Treat the user's explicit merge approval as the final ownership stamp that allows the approved PR scope to enter `main`. Do not merge merely because `PREPARED_FOR_MERGE` was reached.

## Merge Authorization Persistence

Once the user has explicitly authorized merge for a PR, do not invalidate that authorization merely because the PR HEAD changes during AI-owned technical correction.

HEAD change requires a fresh audit of the current HEAD. It does **not** by itself require another merge approval.

Before merge after an already-authorized PR has changed, run `merge-authorization-gate.mjs` with explicit classifications for:

- whether merge approval exists;
- whether this is still the same PR;
- whether the purpose is unchanged;
- whether the user-visible/business specification is unchanged;
- whether the security/privacy/data boundary is unchanged;
- whether the risk boundary is unchanged;
- whether the latest current-HEAD audit is PASS/FAIL/UNKNOWN;
- whether HEAD changed.

The gate returns:

- `PERSIST`: the existing merge authorization remains valid. If all other merge gates pass, proceed without asking the user to approve merge again.
- `REAUTHORIZE`: the approval scope changed or no approval exists. Human merge authorization is required.
- `STOP`: current-HEAD audit is failed/unknown or required classification is missing. Do not merge, but do not ask for merge approval merely to clear a technical audit blocker.

Typical AI-owned corrections that may preserve authorization after fresh audit include CI fixes, lint/format fixes, test fixes, audit-remediation fixes, mechanical documentation/status corrections, and implementation corrections that do not change the approved purpose/specification/safety/risk boundary.

Reauthorization is required when the approved substance changes, including a different PR, changed purpose, changed user-visible/business specification, changed security/privacy/data boundary, or changed risk boundary. Classify substance from evidence; do not label a semantic change as mechanical merely to preserve authorization.

Example:

```text
node .agents/skills/final-pr-audit/merge-authorization-gate.mjs --approved yes --same-pr yes --same-purpose yes --same-spec yes --same-safety-boundary yes --same-risk-boundary yes --latest-audit pass --head-changed yes
```

Gate self-test:

```text
node .agents/skills/final-pr-audit/merge-authorization-gate-selftest.mjs .agents/skills/final-pr-audit/merge-authorization-gate.mjs
```

### `PREPARED_FOR_MERGE` criteria

Report `PREPARED_FOR_MERGE=yes` only when all applicable conditions are proven:

- final audit result is PASS;
- required `test-gate` and real-device/manual checks are PASS or explicitly unneeded;
- PR description is consistent with verified facts;
- PR is not Draft;
- fresh GitHub metadata confirms the PR is open and has no known mergeability/review/required-CI blocker;
- the current HEAD is the HEAD covered by the latest PASS audit;
- if merge was already authorized before a HEAD change, `merge-authorization-gate` returns `PERSIST`; otherwise valid explicit merge authorization is still required before merge;
- no unresolved human value/ownership decision remains;
- no technical housekeeping step is being delegated to the non-engineer human.

If any condition is not proven, report `PREPARED_FOR_MERGE=no` and state the machine-resolvable blocker or genuine human decision separately.

## Execution-Route Failure

If an AI/tool/connector path fails while performing an already-authorized safe technical preparation step:

1. diagnose the failing route without changing the approved target, diff, SHA, or risk;
2. try another available and permitted machine-readable/execution route consistent with repository rules;
3. follow the approved-operation route-fallback rules (`L-0012` and, for GitHub-specific failures, `L-0010`) rather than repeating the same broken path;
4. do not convert the route failure into non-engineer relay work such as "click Ready for review", "copy this SHA", "run this Git command", or "paste the output back" merely because that is easier;
5. if no permitted machine route remains, stop with `EXECUTION_PATH_BLOCKED`, describe the tooling limitation, and keep the technical ownership on the AI workflow. Do not mislabel the user as a technical decider.

A route failure does not create a new human value decision. Human involvement is appropriate only if the underlying target/scope/risk changes or another genuine confirmation point applies.

## Command Notes

- Build output directories may be updated by a build command; verify tracked files remain unchanged afterward when a local workspace was used.
- For a migration checksum failure, first check for raw-byte or line-ending differences before treating it as a logic failure.
- If GitHub PR data is unavailable, mark GitHub-only checks unavailable rather than guessing or turning them into human browser homework when another machine-readable route can be used.
- Audit approval and pre-merge preparation are not merge execution.
- For post-implementation verification execution and result tracking, use `test-gate`; final PR audit checks the `test-gate` results rather than re-running everything from scratch.
- For actual post-merge verification and any required local `main` synchronization, use `post-merge-verification`.

## Output

Report:

- Final judgment
- `PREPARED_FOR_MERGE=yes|no`
- Evidence source(s): local / remote-only / mixed
- Git state relevant to those source(s)
- Diff scope
- Specification fit
- Verification results, distinguishing literal commands from equivalent remote checks
- Security review result
- PR description consistency result
- Real-device confirmation
- Mechanical pre-merge preparation performed
- Merge authorization state: new approval required / `PERSIST` / `REAUTHORIZE` / `STOP`
- Route fallback performed, if any
- Blockers
- Merge readiness
- The remaining human action only when actually needed by the authorization state
- Operations not performed

## Application-Specific Configuration

The exact build/test/lint/type-check commands, dependency-manifest file names, migration conventions, forbidden scope, and repository-specific PR status conventions come from that repository's `AGENTS.local.md` — specifically its "Repository Commands", "Forbidden Scope", "Migration Rules", and PR/GitHub sections. This skill names no specific language, package manager, or framework.
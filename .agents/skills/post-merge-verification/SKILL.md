---
name: post-merge-verification
description: Use after a GitHub PR has been merged, including Japanese requests such as PRマージ後の確認, Squash and merge後の確認, local main同期, origin/main確認, merge commit確認, 親SHA確認, tree一致確認, ff-only同期, or branch削除可否判断. Verify the merge result and local main synchronization, identify the actual merge method used, and stop on unclear PR data, unexpected branch/upstream, parent SHA mismatch, tree mismatch, an unexpected merge method, non-clean working tree, non-fast-forward sync, or any cost risk.
---

# Post-Merge Verification

Use after a PR has already been merged on the remote host and the user asks to verify the merge result or synchronize local `main`.

## Required Checks

- Current branch
- HEAD
- Upstream
- Working tree status
- Stash state
- `git fetch origin`
- Post-merge `origin/main` SHA
- The actual merge method used (squash merge, merge commit, or rebase merge), determined from the post-merge commit's parent count and message — not assumed from what the user expected or requested
- Parent SHA(s) of the post-merge commit
- Tree equality with the pre-merge work branch or expected head, checked independently of how many parents the post-merge commit has
- Expected files exist in `origin/main` when specified
- Switch to local `main` only after content (tree) equality is confirmed
- `git pull --ff-only origin main`
- Local `main` and `origin/main` SHA equality
- Final working tree status
- Branch deletion safety judgment

## Merge Method Verification

- Confirm the number of parents on the post-merge commit before assuming it is a squash merge.
- A squash merge produces a single-parent commit; a merge commit produces two or more parents; a rebase merge replays the original commits under new SHAs. Determine which of these actually happened rather than assuming the requested method was used.
- Evaluate tree equality (content) and history shape (commit graph, parent count) as two separate checks. A merge method different from what was expected is not, by itself, a content problem if tree equality still holds.
- If the actual merge method differs from what was expected or requested, stop and report the discrepancy for the user to decide, rather than proceeding silently or rewriting history to force a match.
- Never rebase, reset, force-push, or otherwise rewrite the resulting history in order to make an unexpected merge method match what was expected.

## Do Not Do

- Do not merge PRs.
- Do not delete branches automatically.
- Do not commit, push, rebase, reset, force, or change Git configuration.
- Do not edit PR descriptions.
- Do not modify app code, documents, migrations, or package/dependency manifests.
- Do not guess GitHub PR state.
- Do not rewrite history to make an unexpected merge method match what was expected.

## Stop Conditions

- Working tree is not clean.
- Current branch or upstream is unexpected.
- `origin/main` cannot be verified.
- Work branch or expected head cannot be verified.
- The post-merge commit's parent SHA(s) do not match the expected pre-merge main SHA and, when applicable, the expected head SHA.
- The post-merge commit's tree does not match the pre-merge work branch or expected head.
- The actual merge method differs from what was expected, until the user confirms whether to proceed.
- `git pull --ff-only origin main` cannot fast-forward.
- Unexpected commits appear on `origin/main` after remote update.
- GitHub PR data is unavailable and local refs cannot verify the requested facts.
- Branch deletion lacks explicit user permission.
- Any paid service, external API, automatic billing, or added dependency may be involved.

## GitHub Information Limits

If GitHub PR state, PR body, or CI results cannot be directly obtained, say they are unavailable. Do not infer that a PR is open, merged, has a correct body, or has passing CI. Report only facts verified from `git fetch`, remote refs, commits, parent SHAs, and tree comparisons.

## Branch Deletion Rule

Do not delete branches automatically. Report "deletion possible" only when:

- The post-merge commit's tree matches the work branch, regardless of merge method.
- Local `main` matches `origin/main`.
- The working tree is clean.
- The branch has no unmerged commits.
- The user explicitly permitted deletion.

Without explicit permission, judge and report only.

## Output

Report:

- Skills used
- Starting Git state
- Post-merge commit SHA
- Post-merge commit parent SHA(s) and the merge method they indicate
- Tree equality result
- Local `main` and `origin/main` synchronization result
- Expected file existence
- Working tree status
- Branch deletion judgment and whether deletion was performed
- Operations not performed
- Blockers

## Application-Specific Configuration

This skill's checks are Git- and GitHub-mechanics only and do not depend on any application's technology stack. Repository-specific forbidden areas or additional rules, if any, are recorded in that repository's `AGENTS.local.md`.

---
name: foundation-sync-audit
description: Use when synchronizing ai-dev-foundation into an application repository, when claiming that shared rules/skills are current, or when an application behaves as if a recently merged common rule is missing. Compare synchronized source paths mechanically and fail closed on missing or stale shared files.
---

# Foundation Sync Audit

## Purpose

Verify that an application repository is actually using the intended `ai-dev-foundation` shared files before stating that the foundation is synchronized, current, applied, or effective.

This closes the gap between:

- a common rule being merged in the foundation;
- an `AGENTS.md` copy appearing current;
- the executable shared gate/skill files in the application still being older.

A version label, sync log entry, or matching `AGENTS.md` alone is not proof of a full current sync.

## Mandatory Trigger

Run this audit when any of the following applies:

- after a full or partial foundation synchronization;
- before saying an application repository is fully synchronized/current with the foundation;
- before relying on a newly merged common enforcement rule in an application repository;
- when the application behaves as if a common rule or machine gate that should exist is not active;
- during post-merge verification of a synchronization PR when the source foundation files are available;
- when a sync log and the actual shared-file contents may have drifted.

Do not ask a non-engineer human to compare files, versions, SHAs, or copied skill contents when machine-readable local or GitHub evidence is available.

## Canonical Sync Surface

For the current foundation design, the mechanically compared shared surface is:

- `AGENTS.md`
- every file that exists under foundation `.agents/skills/`

Application-owned files outside those source paths are not part of this equality check. Target-only skills may exist; they are reported as extra but do not make the shared source copy stale by themselves. If a target file uses the same path as a foundation shared file, its content must match the foundation exactly.

`AGENTS.local.md`, application business specifications, application code, local commands/configuration, secrets, tokens, real data, and other repository-local material are not synchronized by this audit.

## Machine Gate

When the source foundation checkout and target application checkout are both available locally, run:

```text
node .agents/skills/foundation-sync-audit/foundation-sync-audit.mjs --source-root <foundation-root> --target-root <application-root>
```

The gate is dependency-free and reads only the known shared source surface plus the foundation `VERSION` file.

Results:

- `PASS / FOUNDATION_SYNC_MATCH`: every source shared file exists in the target with identical content.
- `STOP / FOUNDATION_SYNC_MISSING`: one or more source shared files are absent from the target.
- `STOP / FOUNDATION_SYNC_STALE`: one or more corresponding target shared files differ from the source.
- `STOP` source/root/version errors: the comparison source cannot be trusted, so no current-sync claim is allowed.
- `INFO / FOUNDATION_TARGET_EXTRA_PRESENT`: the target has additional files under `.agents/skills/`; this is not by itself a sync failure.

Machine-gate self-test:

```text
node .agents/skills/foundation-sync-audit/foundation-sync-audit-selftest.mjs .agents/skills/foundation-sync-audit/foundation-sync-audit.mjs
```

## Remote-Only Equivalent

If the synchronization or audit is performed through GitHub/remote-only tooling and the two local checkouts are not available, use equivalent machine-readable evidence:

1. Fix the exact foundation source commit SHA and target application commit/PR head SHA.
2. Enumerate the foundation `AGENTS.md` and recursive `.agents/skills/` source files at that exact source SHA.
3. Confirm that each source path exists at the target head.
4. Compare exact blob/content identity for every source path.
5. Treat missing or different source paths as `STOP`.
6. Record the source foundation `VERSION` and source commit SHA in the synchronization evidence/log.
7. Do not treat a matching top-level `AGENTS.md`, a version string, or a sync-log statement as a substitute for file equality.

If equivalent evidence cannot be obtained, report `UNKNOWN`/`STOP`; do not convert the gap into manual copy-and-paste work for the non-engineer human.

## Partial Sync Handling

Partial synchronization is allowed only when explicitly scoped and recorded as partial. It must not be described as a full/current foundation sync.

After a partial sync:

- the changed subset may be verified as applied;
- the repository as a whole remains `PARTIAL` until the full canonical sync surface matches the selected foundation source;
- a later full audit may still detect older files left behind by earlier partial syncs.

This distinction is important because different shared skills can otherwise silently remain at different foundation versions.

## Required Output

Use a compact result such as:

```text
FOUNDATION_SYNC_AUDIT: PASS / STOP / PARTIAL / UNKNOWN
Source version: <foundation VERSION>
Source commit: <exact SHA when available>
Target head: <exact SHA when available>
Shared files checked: <count>
Missing: <count>
Stale: <count>
Target-only extras: <count>
Claim allowed: FULL_CURRENT / PARTIAL_ONLY / NO
User action: none / <only genuinely unavoidable action>
```

Do not print protected-data paths or content. The canonical shared paths are development-control files only; repository-local data is outside the audit surface.

## Stop Conditions

Do not claim `FULL_CURRENT` when:

- any foundation source shared file is missing;
- any corresponding shared file differs;
- the exact foundation source version/commit cannot be established when the workflow requires that evidence;
- only `AGENTS.md` or only a selected subset was synchronized;
- the sync log says current but the file comparison disagrees;
- the comparison itself cannot be completed with trustworthy evidence.

## Key Principle

**Synchronization is a property of the actual copied files, not a statement in a log.**

Prefer the simplest proof: exact shared-file identity at fixed source and target revisions. Do not add a new service, daemon, cloud dependency, or human maintenance step merely to perform this audit.

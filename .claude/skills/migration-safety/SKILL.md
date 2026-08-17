---
name: migration-safety
description: Use with preflight-audit for schema changes, database migrations, table recreation, NOT NULL, CHECK, UNIQUE, foreign key, data copy, or data migration requests. Verify existing migrations remain frozen, migration ordering and numbering, fresh-apply and upgrade-from-existing tests, explicit column copy, transaction boundaries, schema integrity, backup need, and environment-specific differences such as checksums or line endings, and stop on existing migration edits, data loss risk, unknown copy columns, missing tests, or unclear backup policy.
---

# Migration Safety (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/migration-safety/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

---
name: foundation-sync-audit
description: Use when synchronizing ai-dev-foundation into an application repository, when claiming that shared rules/skills are current, or when an application behaves as if a recently merged common rule is missing. Compare synchronized source paths mechanically and fail closed on missing or stale shared files.
---

# Foundation Sync Audit (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/foundation-sync-audit/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

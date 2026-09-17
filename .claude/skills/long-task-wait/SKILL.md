---
name: long-task-wait
description: Use for local long-running tasks that expose a stable task ID and read-only status function. Replace repeated short-interval status polling with a bounded local wait while preserving fail-closed task identity, timeout recovery, and no-duplicate-start rules.
---

# Long Task Wait (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/long-task-wait/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

---
name: preflight-audit
description: Use before starting implementation, bug fixes, refactoring, UI changes, backend changes, or design changes, especially when the user says implement, fix, change, refactor, add, update, or investigate before editing. Confirm repository state, branch safety, relevant docs/code/tests, intended change scope, migration need, forbidden areas, cost risk, and stop on dirty worktrees, main-branch work, unclear scope, specification conflicts, data risk, or possible additional cost.
---

# Preflight Audit (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/preflight-audit/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

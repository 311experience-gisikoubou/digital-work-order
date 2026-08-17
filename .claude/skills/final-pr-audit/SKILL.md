---
name: final-pr-audit
description: Use after implementation and before PR creation, merge, or final completion reports, or when the user asks for a final review, PR audit, merge readiness check, or whether it is safe to proceed. Verify base/head branch and SHA, commit count, changed files, diff scope, migration and dependency-manifest diffs, design consistency, report consistency, the repository's format/lint/type-check/build/selftest verification, generated tracked diffs, real-device status, GitHub information limits, and blockers, and separate audit approval from merge execution.
---

# Final PR Audit (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/final-pr-audit/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

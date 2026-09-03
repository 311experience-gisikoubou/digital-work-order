---
name: common-rule-integration-audit
description: Use before adding or changing common rules, common skills, common learnings, or cross-repository operational procedures. Search existing canonical sources first, classify the proposal as MERGE_EXISTING / NEW_COMMON / LOCAL_ONLY / REJECT / HUMAN_DECISION, and stop source-of-truth writes until required human approval.
---

# Common Rule Integration Audit (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/common-rule-integration-audit/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

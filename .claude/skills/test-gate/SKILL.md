---
name: test-gate
description: Use during and after implementation, fixes, refactoring, UI changes, backend changes, migration changes, generated-artifact work, or configuration changes, including EARLY / MILESTONE / FINAL REALITY checks and Japanese requests such as 実装途中の確認, 実装後の検証, 修正後のテスト, 必要テストの選択, selftest, build, migration test, 実機確認, 未実施確認, or テストゲート. Select proportionate objective evidence, fail closed on target/state mismatch, preserve exact-state evidence, and never treat unrun or unavailable checks as passing.
---

# Test Gate (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/test-gate/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

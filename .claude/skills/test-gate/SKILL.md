---
name: test-gate
description: Use after implementation, fixes, refactoring, UI changes, backend changes, or migration changes, including Japanese requests such as 実装後の検証, 修正後のテスト, 必要テストの選択, 型チェック相当, selftest, build, migration test, 実機確認, 未実施確認, or テストゲート, when the user asks to select or run required verification, confirm a type-check equivalent, run a selftest, run a build, run a migration test, confirm on a real device, or otherwise gate completion on tests. Select and run only the verification commands that exist for this repository, as defined in its application-local configuration, record success/failure/unrun/unneeded/unavailable/interrupted status for each, stop on failures, and never treat unrun or unavailable checks as passing.
---

# Test Gate (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/test-gate/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

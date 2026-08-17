---
name: post-merge-verification
description: Use after a GitHub PR has been merged, including Japanese requests such as PRマージ後の確認, Squash and merge後の確認, local main同期, origin/main確認, merge commit確認, 親SHA確認, tree一致確認, ff-only同期, or branch削除可否判断. Verify the merge result and local main synchronization, identify the actual merge method used, and stop on unclear PR data, unexpected branch/upstream, parent SHA mismatch, tree mismatch, an unexpected merge method, non-clean working tree, non-fast-forward sync, or any cost risk.
---

# Post-Merge Verification (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/post-merge-verification/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

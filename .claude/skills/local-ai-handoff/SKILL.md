---
name: local-ai-handoff
description: Use when handing off state, audit results, or next instructions between local AI CLIs on the same PC (Claude Code and Codex CLI in V1), so the human does not have to copy and paste between them. Also covers Japanese requests such as Claudeからcodexへ引き継ぎ, ローカルhandoff, codexに渡す, or codexの結果をclaudeへ. Does not apply to the browser-based ChatGPT/GPT, which has no local file access and continues to use the existing [AI_HANDOFF] GitHub PR-comment channel (see OPERATIONS.md); do not invent a new GPT-specific handoff format.
---

# Local AI Handoff (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`) can auto-detect this skill. It is not the source of truth.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/local-ai-handoff/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. The canonical skill's directory also contains `detect-codex.ps1`, referenced by the skill body.
4. If this wrapper's frontmatter ever conflicts with the canonical file, the canonical file wins.

Do not duplicate the canonical skill body here.

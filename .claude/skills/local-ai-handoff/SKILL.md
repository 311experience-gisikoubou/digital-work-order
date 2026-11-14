---
name: local-ai-handoff
description: Use when handing off state, audit results, or next instructions between local AI CLIs on the same PC (Claude Code and Codex CLI in V1), so the human does not have to copy and paste between them. Also covers Japanese requests such as Claudeからcodexへ引き継ぎ, ローカルhandoff, codexに渡す, or codexの結果をclaudeへ. Does not apply to the browser-based ChatGPT/GPT, which is not a local CLI participant in this protocol; for ordinary handoff it uses existing local state and read-only current GitHub source (an authorized local read-only bridge such as Remote Desktop Commander when available, otherwise already-readable canonical repository state) and never creates a GitHub PR comment just to notify other chats or report progress. The [AI_HANDOFF] GitHub PR-comment channel (see OPERATIONS.md) stays reserved for the official final PR audit result and mandatory merge-authorization receipts; do not invent a new GPT-specific handoff format and do not weaken that audit channel.
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

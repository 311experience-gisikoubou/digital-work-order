---
name: handoff
description: Use when moving digital-work-order work to a new chat, Claude Code, Codex, another AI, or another session, or when the user asks for handoff, 引き継ぎ, session transfer, continuation notes, or a context summary. Produce paste-ready Markdown with repository, local path, branch, upstream, HEAD, working tree, unpushed commits, completed work and commit SHAs, current phase, docs/design.md source of truth, available AI entrypoints and skills, real-device results, unchecked items, protected areas, next steps, blockers, and known harmless warnings. Keep facts, assumptions, and unknowns separate.
---

# Handoff

Use when the next agent or session needs enough context to continue safely.

## Output Format

Write paste-ready Markdown.

## Include

- Repository
- Local path
- Current branch
- Upstream
- HEAD
- Working tree status
- Unpushed commits
- Completed work
- Completed commit SHAs
- Current work phase
- Source of truth: `docs/design.md`
- Current AI entrypoints and available skills
- Real-device confirmation results
- Unchecked or unknown items
- Protected or high-care areas from `AGENTS.local.md` and `docs/design.md`
- Next steps
- Blockers
- Known harmless warnings
- Git workflow constraints
- AI and user role split
- Additional-cost-zero condition

## Rules

- Do not guess conversation-only details.
- Mark unknown or unavailable information as `要補足`.
- Separate facts from recommendations.
- Do not include old branch names, old SHAs, or old fallback points as fixed template content.
- Include operations not performed.
- Include blockers plainly.
- Include relevant repository-specific rules in the handoff text itself instead of assuming the next agent will read every file first.

## Output Sections

Use concise sections:

- Current State
- Completed Work
- Confirmed Specifications
- Verification And Device Checks
- Constraints
- Next Steps
- Blockers
- Unknowns / 要補足

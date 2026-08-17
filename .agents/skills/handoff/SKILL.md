---
name: handoff
description: Use when moving work to a new chat, Claude Code, Codex, another AI, or another session, or when the user asks for handoff,引き継ぎ, session transfer, context summary, or continuation notes. Produce paste-ready Markdown with repository, path, branch, HEAD, main SHA, upstream, working tree, completed work, recent PR, confirmed specs, unfinished items, real-device results, next steps, forbidden areas, Git rules, AI/user roles, zero-cost condition, and mark unknown conversation-only facts as 要補足.
---

# Handoff

Use when the next agent or session needs enough context to continue safely.

## Output Format

Write paste-ready Markdown.

## Include

- Project overview
- Repository
- Local path
- Current branch
- HEAD
- Main SHA
- Upstream
- Working tree
- Completed work
- Recent PR
- Confirmed specifications
- Unfinished items
- Real-device confirmation results
- Next work
- Forbidden areas
- Git workflow
- AI and user role split
- Additional-cost-zero condition
- What the next AI should check first

## Rules

- Do not guess conversation-only details.
- Mark unknown or unavailable information as `要補足`.
- Separate facts from recommendations.
- Include blockers and operations not performed.

## Application-Specific Configuration

Repository-specific detail — forbidden areas, the additional-cost-zero condition's specifics, and any other repository rule — is recorded in that repository's `AGENTS.local.md`. Include the relevant facts from it in the handoff document itself rather than assuming the next AI or session will read `AGENTS.local.md` unprompted.

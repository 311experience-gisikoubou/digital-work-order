---
name: debug-verification
description: Use for investigating a bug, a PDF/print regression, a layout regression, or any debugging task, and before deciding whether to request a human real-device check. Runs a staged, automated-first verification workflow (static checks, existing tests, regression checks, headless execution, PDF generation, PDF-to-image conversion, image/dimension/omission comparison, safe fixture reproduction, then real-device confirmation as the last resort), applies a three-question self-check before requesting human confirmation, caps repeated identical automated attempts, and requires representative fixtures rather than empty-data-only coverage. Use when the user asks to debug, investigate a defect, verify a PDF or print change, compare rendered output, or judge whether a real-device check is actually necessary.
---

# Debug & Automated Verification Workflow (Native Skill Wrapper)

This file exists only so Claude Code's native skill loader (`.claude/skills/`)
can auto-detect this skill. It is not the source of truth.

This is a `digital-work-order` repository-local skill. It is not yet part of
the `ai-dev-foundation` shared skill set and is not synchronized from there —
the same treatment already given to `manual-ui-smoke-test`.

## Instruction

1. First, read the canonical skill file:
   `../../../.agents/skills/debug-verification/SKILL.md`
2. Follow that file's content completely, as the single source of truth.
3. If this wrapper's frontmatter ever conflicts with the canonical file, the
   canonical file wins.

Do not duplicate the canonical skill body here.

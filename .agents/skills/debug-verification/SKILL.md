---
name: debug-verification
description: Use for investigating a bug, a PDF/print regression, a layout regression, or any debugging task, and before deciding whether to request a human real-device check. Runs a staged, automated-first verification workflow (static checks, existing tests, regression checks, headless execution, PDF generation, PDF-to-image conversion, image/dimension/omission comparison, safe fixture reproduction, then real-device confirmation as the last resort), applies a three-question self-check before requesting human confirmation, caps repeated identical automated attempts, and requires representative fixtures rather than empty-data-only coverage. Use when the user asks to debug, investigate a defect, verify a PDF or print change, compare rendered output, or judge whether a real-device check is actually necessary.
---

# Debug & Automated Verification Workflow

This is a `digital-work-order` repository-local skill. It is not yet part of the
`ai-dev-foundation` shared skill set and is not synchronized from there.
`digital-work-order` is being treated as the cultivation origin for this skill
for now — the same treatment already given to `manual-ui-smoke-test`. A future
promotion into the shared foundation is a separate decision, not implied by
this skill's existence here.

## Top-Level Principle

- Work a human does not need to do should be done by AI, whenever it can be
  confirmed or executed safely without a human.
- Protect the human's ability to spend attention on ideas, judgment calls, and
  things that feel off — not on routine technical confirmation.
- This skill specializes this repository's `Human Decision Boundary` (see
  `AGENTS.local.md`) for one recurring situation: deciding whether a
  real-device or manual check is actually required during debugging and
  verification. It does not replace `Human Decision Boundary` — where the two
  overlap, `Human Decision Boundary` is the general rule and this skill is its
  application to verification work.

## Three-Question Check Before Requesting Real-Device Or Manual Confirmation

Before asking a human to check anything by hand, answer all three questions:

1. Can the AI confirm this alone, from code, logs, or state it can already
   read?
2. Can an automated test, code audit, headless run, generated fixture, or
   generated output substitute for a human doing it by hand?
3. Does the value of a human confirming this actually outweigh the human's
   time and attention cost?

Request human confirmation only when all three point to "a human is genuinely
required." When requesting it, state up front:

- Purpose — what this confirms.
- Why a human — why AI-only or automated confirmation is not enough here.
- Steps — exactly what to do.
- PASS criteria — what result counts as PASS.

## Verification Priority Order

Attempt stages in order. Do not use a real-device check as the first
debugging tool. Stop advancing once an earlier stage already answers the
question, but do not skip a cheaper stage that could have answered it.

1. Static checks (for example `node --check`, `git diff --check`, and
   whatever this repository's `AGENTS.local.md` lists under "Basic
   Verification").
2. Existing tests, if any exist for the affected area.
3. Regression checks against nearby, related behavior.
4. Headless execution of the affected code path, where the current
   environment already supports it.
5. PDF generation, where the current environment already supports it.
6. PDF-to-image conversion, where the current environment already supports
   it.
7. Image comparison: dimensions, missing elements, obvious visual
   regressions.
8. Reproduction with a safe fixture (see "Fixture Policy").
9. Real-device or manual confirmation — last resort, gated by the
   three-question check above.

Stages 4-7 depend on tooling this repository does not currently have
installed. Where the needed local, free tooling is not already available in
the environment, mark that stage `unavailable` and continue to the next
stage — do not add a new paid service, subscription, or external API to
unblock it (see "Cost Constraints"). If a stage would need new tooling to
become available, report that as a separate, explicit decision for the human
rather than adding it silently.

## Anti-Loop

- The same hypothesis, the same change location, and the same verification
  method may be attempted automatically at most 3 times.
- If 3 attempts under one approach do not resolve or narrow the problem,
  change at least one of: the hypothesis, the code location under suspicion,
  or the verification method. Do not repeat the same combination a 4th time.
- Where a stricter anti-loop rule already applies from another skill or from
  `AGENTS.local.md`, that stricter rule governs instead.

## Fixture Policy

- Never send real production data, real patient information, or real clinic
  information to an external service.
- Prefer a fixture that safely reproduces the structural features of real
  data over an empty or trivial fixture.
- An empty-data fixture alone does not count as sufficient coverage for a
  verification that depends on content (for example PDF rendering, drawing,
  or layout).
- For PDF and drawing-related verification, include, as relevant to the
  change: multi-stroke handwriting content (`memoStrokes`), long free-text
  notes, multiple devices per order, boundary values, a maximum-count case,
  and missing/empty-field cases.
- Do not copy patient or clinic identifying information into a fixture. Use
  clearly fictitious names and values.

## Protected Data

This skill does not define its own protected-data list. Each repository
defines what is protected in its own `AGENTS.local.md`, so that this skill
can be reused as-is across repositories. For this repository, the current
definition is "Important Protection Targets" in `AGENTS.local.md`
(`localStorage` persistence behavior, handwriting save structure, PDF
handling, clasp behavior, tooth numbers and tooth chart behavior, holiday
judgment, surcharge judgment), together with "Project Context"'s note that
there is no DB or migration system here.

- Do not treat a UI or PDF fix as license to silently change any item on that
  list, its `localStorage` schema, its save/load structure, or backward
  compatibility with previously saved data.
- If a fix requires touching one of these areas, say so explicitly, check
  `docs/design.md`, and verify backward compatibility with existing saved
  data before treating it as done.

## PDF / UI Verification Checklist

When a change affects PDF, print, or rendered UI output, consider, as
relevant to the change:

- Page count
- Paper size
- Overflow
- Clipping
- Missing elements
- Page breaks
- SVG / Canvas / image rendering
- Long text content
- Empty-data content
- The fixture(s) used

Prefer generating output and comparing it against a known-good baseline over
describing the expected result from memory.

## Cost Constraints

- Do not introduce a new paid API, paid plugin, metered service, or
  subscription to unblock any stage of this workflow.
- Prefer local tooling, existing dependencies, and free-tier capability
  already available in the environment.
- If a verification stage genuinely requires something not currently
  available and not free, do not execute it. Report the gap and stop; let
  the human decide whether to introduce it.

## Git Safety

- This skill does not grant, widen, or substitute for any Git permission. It
  only decides what gets verified and how.
- A PASS from this workflow does not authorize `commit`, `push`, PR
  creation, merge, or branch deletion on its own. Those remain governed by
  `AGENTS.md`, `AGENTS.local.md` ("Repository-Local Git And Work Rules",
  "Roles And Default Flow"), and whatever the current task's instructions
  say.
- Follow the stricter of this skill and any conflicting existing Git rule.

## Relationship To Other Skills

- `preflight-audit`: run before starting the investigation or fix, as usual
  — this skill does not replace it.
- `test-gate`: stages 1-3 above are the same category of work `test-gate`
  already governs; when both apply, follow `test-gate`'s command selection
  from `AGENTS.local.md` rather than inventing new commands here.
- `manual-ui-smoke-test`: this skill's stage 9 (real-device confirmation)
  hands off to `manual-ui-smoke-test` for the actual human-facing checklist
  and PASS/FAIL/未確認 recording. This skill decides *whether* stage 9 is
  reached; `manual-ui-smoke-test` governs *how* it is run.
- `final-pr-audit`: reports whether this workflow was applied and what it
  found; it does not re-run this workflow from scratch.

## Do Not Do

- Do not treat a real-device check as the first debugging step when a
  cheaper stage could answer the same question.
- Do not mark stages 4-7 as passed when the tooling to run them does not
  exist in the current environment; mark them `unavailable` instead.
- Do not use an empty-data fixture as sufficient coverage for
  content-dependent verification.
- Do not copy real patient or clinic data into a fixture or into any output
  sent to an external tool.
- Do not repeat the same hypothesis, location, and method a 4th consecutive
  time; change the approach instead.
- Do not introduce a new paid service, subscription, or external API to
  complete a verification stage.
- Do not use a workflow PASS to justify skipping `test-gate`,
  `final-pr-audit`, or a Git safety rule.
- Do not request human confirmation without stating purpose, why-human,
  steps, and PASS criteria first.

## Output

Report:

- Which stages were run, skipped (why), or `unavailable` (why).
- The fixture(s) used, described without real patient/clinic data.
- Findings at each stage that was actually run.
- The three-question check result, if a real-device or manual request is
  being made.
- Whether stage 9 (real-device/manual) is being requested, and its purpose /
  why-human / steps / PASS criteria if so.
- Any anti-loop trigger (same approach attempted 3 times) and the changed
  approach going forward.
- Any cost-blocked stage, reported rather than executed.
- Whether this repository's protected-data areas were touched, and how
  backward compatibility was verified if so.

## Application-Specific Configuration

This skill names no specific test runner, headless tool, PDF library, or
image-comparison tool. Which of stages 1-7 are actually available, and the
exact commands for them, come from this repository's `AGENTS.local.md`.
Protected-data definitions come from that repository's own `AGENTS.local.md`,
not from this skill.

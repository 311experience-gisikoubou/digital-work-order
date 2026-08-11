---
name: manual-ui-smoke-test
description: iPad Safari / Apple Pencil を中心とした人間による実機UIスモークテスト。変更差分から必要な確認だけ選択し、PASS / FAIL / 未確認を記録する。Use when Codex needs to prepare or record human device checks for digital-work-order UI, touch, pointer, drawing, PDF/print, calendar, insurance/private switching, clasp, tooth number, layout, or localStorage behavior.
---

# Manual UI Smoke Test

## Purpose

Use this skill to confirm UI and interaction behavior that only a human can verify on a real device.

- Use iPad Safari as the primary verification environment.
- Consider Apple Pencil use.
- Do not treat this as a replacement for `test-gate`.
- Do not treat this as a replacement for `final-pr-audit`.
- Do not treat this as an automated test.
- Do not mark any item PASS unless the user actually confirmed it.

## Required Inputs

Gather or report when unavailable:

- Current branch.
- HEAD or target commit.
- Changed files.
- Diff content.
- `docs/design.md`.
- `test-gate` result, when available.
- Impact areas that require real-device confirmation.

## Scope Selection

Choose checks from the actual diff and impact area, not from fixed file names alone.

Use two layers:

- Required Change Checks: the feature or behavior changed by the current work.
- Minimal Regression Checks: nearby behavior that is likely to break because of the change.

Do not require a full-app test every time.

## Check Categories

Choose only categories that are relevant to the change.

### Drawing / Pencil

- Apple Pencil drawing.
- One-finger operation.
- Two-finger movement.
- Pinch zoom.
- Unintended page scroll while drawing.
- Save, reload, and restore.

### Touch / Pointer

- One-finger interaction.
- Two-finger interaction.
- Pointer and touch conflicts.
- Accidental operation.
- Operation blocked or stuck.

### Insurance / Private

- Insurance / private switching.
- 11 business days / 14 business days display.
- Recommended delivery date.
- Calendar display.
- Surcharge judgment when relevant.

### Calendar / Date

- Date changes.
- Recommended delivery date.
- Calendar display.
- Holiday-related display.
- Nearby checks based on the changed area.

### PDF / Print

- PDF / print operation.
- Print preview.
- Required chart, handwriting, and visible content.
- Obvious missing content or layout breakage.

### Clasp / Tooth

- Clasp operation.
- Tooth number selection.
- Display.
- Save and restore when relevant.

### Layout

- No obvious layout breakage in iPad Safari.
- Buttons can be tapped.
- Inputs are not blocked.
- Main areas are not cut off.

### localStorage

- Save.
- Reload.
- Restore.
- Existing data is not destroyed.

Do not duplicate detailed specifications in this skill. Refer to `docs/design.md` for source-of-truth behavior.

## User Checklist Format

Keep user-facing checks short.

Use this format:

```text
1. 操作：〇〇する
   期待：〇〇になる
   結果：PASS / FAIL / 未確認
```

Avoid technical terms, variable names, DOM ids, and internal implementation details in the user-facing checklist unless the user explicitly needs them.

Do not present a large checklist at once. Keep it to the minimum needed for the change.

## Result Recording

Record each item as one of:

- PASS
- FAIL
- 未確認

After all items are recorded, report one overall result:

- overall PASS
- overall FAIL
- incomplete

If any item is FAIL, normally report `overall FAIL`.

If an important item is 未確認, do not report `overall PASS`.

## FAIL Recording

For a FAIL, record at minimum:

- What the user did.
- What actually happened.
- Expected result.
- Whether it reproduces.
- Screenshot, if useful.

Add device details only when needed for diagnosis.

## Device Information

Assume the basic environment:

- iPad.
- Safari.
- Apple Pencil.

Do not ask for iPad model or OS details every time.

When a problem appears device-specific, record relevant details such as:

- iPad model.
- iPadOS.
- Safari state.
- Apple Pencil type.

## Timing

Default order:

```text
implementation
test-gate
commit / push
manual-ui-smoke-test
final-pr-audit
PR
```

Recommend manual confirmation before commit / push for high-risk UI changes such as:

- `touch-action`.
- Pointer capture.
- Apple Pencil drawing.
- HTML/CSS changes that may block input.
- Major PDF / print changes.

## Boundaries With test-gate And final-pr-audit

`test-gate` covers:

- Static checks.
- Automated checks.
- `node --check`.
- `git diff --check`.
- Diff review.

`manual-ui-smoke-test` covers:

- Real-device operation.
- Safari behavior.
- Apple Pencil behavior.
- Finger operation.
- Visual appearance.
- Touch feel.
- Actual on-screen behavior.

`final-pr-audit` covers:

- Whether manual UI check was required.
- Whether it was completed.
- PASS / FAIL / 未確認.
- Whether FAIL or 未確認 is a Blocker.

Keep detailed real-device operations in this skill.

## Do Not Do

- Do not automatically mark real-device checks PASS.
- Do not mark unconfirmed items PASS.
- Do not require a full-app test every time.
- Do not duplicate static checks already covered by `test-gate`.
- Do not proceed toward PR while ignoring real-device FAIL.
- Do not decide a FAIL cause from guesswork alone.
- Do not record secrets, tokens, personal information, or production data.
- Do not create additional cost.

## Output

Report concisely:

- Target commit / branch.
- Current confirmation scope.
- User-facing checklist.
- Each result: PASS / FAIL / 未確認.
- Overall result.
- FAIL details.
- Whether work may proceed to `final-pr-audit`.

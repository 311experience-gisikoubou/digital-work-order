# digital-work-order Local Rules

This repository contains the digital dental work order application.

## Project Context

- The source of truth for business and screen behavior is `docs/design.md`.
- Do not duplicate detailed specifications here. Refer to `docs/design.md` before changing behavior.
- The main verification environment is iPad Safari.
- Apple Pencil use is an important target interaction.
- The app is currently centered on HTML, CSS, and JavaScript.
- The repository currently has no DB, SQLite, or migration system.
- The app uses `localStorage`.
- PDF and print behavior are implemented in the repository.
- Touch, pointer, and handwriting behavior are implemented in the repository.

## Basic Verification

- Run `node --check` for changed JavaScript files when applicable.
- Run `git diff --check` before reporting implementation completion.
- Confirm the changed file list.
- Confirm there are no unintended diffs.

## Changes That Usually Need Real-Device UI Checks

- Handwriting
- Apple Pencil behavior
- Finger operation
- Touch or pointer handling
- Pinch zoom
- PDF or print behavior
- Calendar behavior
- Insurance / self-pay switching
- Clasp behavior
- Tooth number behavior
- Visible layout changes

## Important Protection Targets

The following are not permanently forbidden to change, but changes require checking `docs/design.md`, reviewing the impact area, and performing the necessary verification, including real-device checks when appropriate.

- `localStorage` persistence behavior
- Handwriting save structure
- PDF handling
- Clasp behavior
- Tooth numbers and tooth chart behavior
- Holiday judgment
- Surcharge judgment

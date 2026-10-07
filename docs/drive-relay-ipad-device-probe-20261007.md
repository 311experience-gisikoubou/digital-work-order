# Drive relay iPad Safari device probe — 2026-10-07

Status: **LOCAL CHROME 15/15 PASS / ACTUAL iPad SAFARI PENDING**

This is a synthetic-only device persistence probe. It does not upload anything to Apps Script or
Google Drive and must never be used with patient/clinic data.

## Files

- `drive-relay-device-probe.html`
- `tools/drive-relay-device-probe.js`
- `tools/drive-relay-device-probe-e2e.mjs`

The page is intentionally separate from the normal work-order UI and is not linked from the app.
It includes `noindex,nofollow`.

Its CSP blocks network connections:

`connect-src 'none'`

The page uses only same-origin JavaScript and IndexedDB.

## What it tests

The actual clinic-style browser must be able to retain the credentials needed by the existing
Media Transfer design without adding a daily login or manual secret entry.

Synthetic state contains:

- a non-extractable ECDSA P-256 private CryptoKey;
- the corresponding public JWK;
- a random synthetic bearer upload token;
- a SHA-256 digest used only to confirm the bearer value is stable after restore.

No private-key bytes or bearer value are displayed or copied in the result.

## Fail-closed behavior

If IndexedDB does not contain the expected credential state, the page returns:

`FAIL_CLOSED / PAIRING_STATE_MISSING`

It does not silently generate replacement credentials during verification.

That matches the intended production rule: browser credential loss requires explicit re-pairing
rather than an unauthenticated downgrade or silent key rotation.

## Local E2E result

`node tools/drive-relay-device-probe-e2e.mjs`

passed 15/15 checks:

- missing state fails closed;
- synthetic credential initialization succeeds;
- ECDSA private key is non-extractable;
- ECDSA private export is blocked;
- ECDSA signature verifies;
- bearer digest is stable;
- full page reload restores credentials from IndexedDB;
- restored ECDSA key remains non-extractable;
- restored ECDSA export remains blocked;
- restored ECDSA key signs/verifies;
- restored bearer is present;
- restored bearer digest remains stable;
- secure context is available on localhost;
- synthetic state can be explicitly cleared;
- cleared state fails closed instead of silently rotating.

Terminal result:

`DRIVE_RELAY_DEVICE_PROBE_E2E=PASS`

`CHECK_COUNT=15`

## Actual iPad Safari gate

After this probe page is deliberately merged/deployed to the normal GitHub Pages origin, the target
URL will be:

`https://311experience-gisikoubou.github.io/digital-work-order/drive-relay-device-probe.html`

Required real-device procedure:

1. Open the URL on the clinic-style iPad Safari.
2. Confirm the origin is the normal GitHub Pages origin and “安全な接続” is yes.
3. Tap **① 架空テストを作成** and confirm PASS.
4. Close that tab. Preferably terminate Safari once.
5. Reopen the same URL.
6. Tap **② 再開後を確認** and confirm PASS.
7. Tap **結果をコピー** and retain only the non-secret JSON summary as evidence.
8. Tap **架空テストデータを削除**.

If step 6 fails, bearer selection and the iPad key-store design remain unapproved.

## Current decision

This page is ready for the bounded real-iPad test, but deployment to GitHub Pages requires an
explicit merge of the branch/PR.

No production Apps Script write endpoint should be re-enabled merely to run this persistence gate.

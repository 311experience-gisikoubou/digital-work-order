# Drive relay upload credential comparison 窶・2026-10-07

Status: **SYNTHETIC CHROME PASS / iPad SAFARI STILL REQUIRED**

This comparison is synthetic only. It does not authorize patient/clinic data or production use.

## Purpose

Resolve the independent-review disagreement between:

- a random bearer upload token with hash-only server verification; and
- a non-extractable HMAC-SHA256 upload key.

The upload credential is only an Apps Script anti-abuse gate. The existing ECDSA sender signature
verified by the lab Gateway remains the authoritative end-to-end sender identity.

## Prototype

Files:

- `app/drive-relay-credential-probe.html`
- `scripts/drive-relay-browser-credential.test.mjs`

The test uses localhost plus a temporary headless Chrome profile and CDP. It adds no dependency,
uses no external network, writes nothing to Drive, and uses no real protected data.

## Observed results

All synthetic checks passed:

- HMAC CryptoKey provisioned as non-extractable.
- Existing-style ECDSA P-256 private CryptoKey provisioned as non-extractable.
- Both CryptoKeys survived IndexedDB storage and page reload.
- Both remained non-extractable after restore.
- Raw HMAC export was blocked.
- ECDSA private-key export was blocked.
- Restored HMAC key could still sign.
- Restored ECDSA private key could still sign.
- Restored ECDSA signature verified outside the browser.
- Bearer token persisted as readable browser data.
- Bearer server model retained only a SHA-256 verifier.
- HMAC server model had to retain the raw verification secret.
- Valid bearer request passed.
- Valid HMAC request passed.
- Replayed nonce was rejected for both.
- Same object could be retried with a fresh nonce for both.
- Stale request was rejected for both.
- Wrong bearer was rejected.
- Wrong HMAC was rejected.
- Revoked sender was rejected for both.

Result:

`DRIVE_RELAY_CREDENTIAL_PROBE=PASS`

Prototype recommendation:

`BEARER_PROVISIONAL`

## Why bearer is provisionally simpler

Both candidates provided the same tested anti-abuse behavior for expiry, replay and revocation.

HMAC has one real client-side advantage: the persisted CryptoKey can be non-extractable, so ordinary
key export is blocked.

That does not make a same-origin compromise harmless. Code running in the same origin can retrieve
the CryptoKey from IndexedDB and use it to sign without exporting its raw bytes.

HMAC also creates a server-side disadvantage: Apps Script must retain the HMAC verification secret.
The bearer design can keep only a one-way SHA-256 verifier.

Because the upload credential is not the authoritative patient-data identity boundary, the extra
HMAC secret and code are not yet justified by a demonstrated safety gain.

## Important newly confirmed gap

Phase 4 implemented Web Crypto key generation, pairing payloads, signatures, rotation and local
synthetic tests, but it did not implement the clinic iPad browser key store/UI.

Therefore browser credential persistence is not an already-existing production boundary. The Drive
relay work should build one minimal credential store that can later persist both:

- the existing non-extractable ECDSA sender private key; and
- the selected upload anti-abuse credential.

Do not create two independent key stores.

## Remaining Gate B evidence

Before bearer can be selected finally, the actual clinic-style iPad Safari / GitHub Pages origin
must prove:

1. IndexedDB persists the non-extractable ECDSA CryptoKey across reload/restart.
2. The selected upload credential persists across reload/restart.
3. Normal send remains zero-touch after one-time pairing.
4. Explicit revocation/repair is possible without patient data.
5. Browser storage loss fails closed and requires re-pairing; it must not silently downgrade auth.

Until that exact-device evidence is recorded, Gate B remains **PARTIAL PASS**, not complete.

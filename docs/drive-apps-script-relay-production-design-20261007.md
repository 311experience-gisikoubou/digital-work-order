# Google Drive + Apps Script relay — production design candidate

Date: 2026-10-07

Status: **PROVISIONAL / RESEARCH GATE NOT YET CLOSED**

This document narrows the production candidate after the successful synthetic Drive relay trial.
It does **not** authorize real patient/clinic data and does not replace the existing Phase 3-8
Media Transfer design.

## Decision

Keep the existing Media Transfer cryptography and receipt semantics.

Use Google Drive only as the durable relay store and Apps Script only as the small control/write
gateway needed to place already-encrypted relay objects into that Drive.

Do not rebuild the transfer system.

Do not add Firebase Auth, Cloudflare, another SaaS account, or a second daily clinic workflow.

## Why the existing ECDSA identity is not moved into Apps Script

The clinic sender already owns a non-extractable ECDSA P-256 private key and signs both the
Phase 4 descriptor and the existing relay authorization.

That signature remains the authoritative sender identity and MUST still be verified by the lab
Gateway before any decrypted package is accepted.

Google Apps Script does not provide a documented native WebCrypto-style ECDSA P-256 verification
helper comparable to the browser/Node implementation already used by this repository.
Importing a new cryptography library into Apps Script only to duplicate the existing signature
verification would increase code, dependencies, and audit burden.

Therefore Apps Script should not become the authoritative ECDSA verifier.

## Upload anti-abuse gate

Apps Script still needs a relay-side gate so a public web-app endpoint cannot be used to fill the
lab Drive with arbitrary objects.

Candidate:

- During the existing one-time pairing flow, provision a separate random HMAC-SHA256 upload key.
- Import the clinic copy as a non-extractable Web Crypto HMAC key and store the CryptoKey using the
  same browser-side persistence boundary used for the sender identity.
- Store the corresponding verification secret only in Apps Script Script Properties, indexed by
  the opaque sender clinic-device ID.
- Never put the secret in the repository, HTML/JavaScript bundle, URL, logs, Drive filenames, or
  transfer metadata.
- Normal clinic operation remains zero-touch after pairing.
- Revocation removes/disables the corresponding sender entry in Script Properties.
- The HMAC is a transport anti-abuse gate only. It does not replace the existing ECDSA sender
  signature.

Each mutating sender request signs a canonical body containing at minimum:

- protocol/action version
- opaque senderClinicDeviceId
- opaque jobId or create-request nonce
- object slot/name
- ciphertext SHA-256
- ciphertext byte length
- request timestamp
- one-time request nonce

Apps Script rejects:

- unknown/revoked sender
- stale timestamp
- repeated nonce
- HMAC mismatch
- malformed object name
- size/hash mismatch
- objects above the Drive-adapter limit

Retry of an identical already-stored object remains idempotent.

## Why not a normal bearer upload token

A bearer token would be simpler, and the server could keep only its SHA-256 hash. However the
plaintext token would need to be transmitted on every upload request and remain readable by the
browser application.

A non-extractable HMAC CryptoKey keeps the long-lived upload secret out of each request and makes
straightforward secret exfiltration harder while preserving zero daily clinic operations.

The HMAC key is not a new user account or login.

## Drive layout

Use one dedicated root folder owned by the existing Google account.

Example conceptual layout:

- DWO_RELAY/
  - job_<opaque-id>/
    - meta.json
    - 0000.bin
    - 0001.bin
    - ...
    - ready.json

Rules:

- folder and file names contain opaque IDs/ordinals only;
- no patient name, clinic name, workOrderRef, memo, treatment content, or media filename appears in
  Drive names;
- stored object bytes are the existing encrypted receiver-bootstrap / manifest / work-order /
  attachment chunks;
- metadata contains only the minimum opaque IDs, hashes, sizes, protocol versions, and state needed
  for retry and exact deletion;
- ready.json is written last, after every expected ciphertext object has been stored and rechecked.

The lab PC MUST NOT treat ready.json alone as proof that local Drive sync is complete.
It rechecks every expected local file size and SHA-256 and retries until complete.

The 2026-10-07 synthetic trial showed why this is required: a 4 MiB object was valid in Drive but
was not locally readable inside the trial's 30-second window; it appeared later with the exact
expected size/hash.

## Lab-PC receive flow

Reuse the existing Phase 6-8 Gateway pipeline.

The Drive adapter replaces only remote discovery/download:

1. Google Drive for desktop syncs the dedicated relay root.
2. Gateway scans only complete-looking opaque job folders.
3. Gateway reads metadata/ready marker.
4. Gateway verifies every expected ciphertext object exists locally with exact size/SHA-256.
5. Existing receiver bootstrap decrypt runs.
6. Existing Phase 4 sender signature verification runs.
7. Existing envelope decrypt and Phase 3 package verification run.
8. Existing atomic inbox persistence/receipt verification runs.
9. Only after verified local persistence may the Gateway start ACK.

Drive sync delay is a retry state, not a transfer failure and never a reason to delete remote data.

## ACK and deletion

Reuse the Phase 7 safety model:

- long-lived receiver bearer credential protected on the lab PC;
- per-job ACK capability;
- decrypt-derived ACK proof;
- ready -> deleting state transition;
- exact-object, retry-safe deletion.

Apps Script cannot rely on custom request headers, so receiver credentials must be carried in the
POST body over HTTPS and must never be logged. The Apps Script side stores only a SHA-256 verifier
for the long-lived receiver bearer.

The per-job ACK capability should remain server-issued rather than reducing the deletion gate.
A small receiver-authenticated Apps Script action may issue/rotate the capability after a ready job
exists; only its hash is retained server-side.

After a valid ACK:

1. transition job metadata from ready to deleting;
2. permanently delete each exact Drive object by file ID;
3. treat already-absent exact objects as idempotent success;
4. verify the expected objects are absent;
5. delete metadata/marker files last;
6. permanently delete the now-empty job folder;
7. only then consider the relay job finalized.

Do not use normal Trash as the final ACK behavior. Trash retains files for 30 days and consumes
storage. Permanent delete is available through the Drive API. The existing synthetic trial used
Trash only because it deliberately avoided enabling the Advanced Drive service.

If permanent deletion fails partway through, leave the job in deleting state and resume exact
deletion on the next receiver maintenance cycle. Never recreate a deleted ciphertext object during
delete-resume.

## Apps Script / Google constraints confirmed from official documentation

- Apps Script web apps support doGet/doPost and may execute as the deploying owner.
- Script execution is limited to 6 minutes per execution.
- Google documents simultaneous execution and other Apps Script quotas; limits may change.
- Script Properties are limited storage and therefore should hold only small configuration/secrets,
  not the transfer job database.
- Apps Script Utilities provides HMAC-SHA256.
- Apps Script LockService can serialize updates to shared small control state.
- The Advanced Drive service exposes the public Drive API; Drive API files.delete permanently
  deletes a user-owned file without moving it to Trash.
- Files moved to normal Drive Trash otherwise remain there for 30 days and consume storage.

Official references checked:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/guides/services/quotas
- https://developers.google.com/apps-script/reference/utilities/utilities
- https://developers.google.com/apps-script/guides/properties
- https://developers.google.com/apps-script/reference/lock/
- https://developers.google.com/apps-script/advanced/drive
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete
- https://support.google.com/drive/answer/2375102

## Cost boundary

This candidate does not require enabling Firebase Blaze, Cloudflare billing, a new paid service,
or a new clinic account.

It reuses the existing Google account/storage and Google Drive for desktop already present on the
lab PC.

Do not claim a permanent price guarantee. Google quotas, product terms, and the user's existing
storage subscription can change. Production readiness requires confirming that the expected daily
volume remains comfortably within current Apps Script/Drive limits.

## Remaining gates before implementation can be called production-ready

### A. Independent architecture review

Required because this changes an external trust/storage boundary.
The first local Codex review attempt on 2026-10-07 could not access its execution helper, and the
first Claude CLI attempt did not return a review. Do not count either as approval.

### B. HMAC pairing prototype

Using synthetic values only:

- generate/import non-extractable HMAC key in the browser;
- persist/restore it on iPad Safari;
- Apps Script verify canonical HMAC;
- expiry/replay/unknown sender/revocation tests;
- retry/idempotency tests.

### C. Permanent-delete prototype

Enable Advanced Drive service for the trial project only after confirming the exact permission
boundary.

With synthetic files:

- valid receiver auth + capability + ACK proof -> exact permanent deletion;
- wrong receiver token -> no deletion;
- wrong capability -> no deletion;
- wrong ACK proof -> no deletion;
- partial delete -> deleting state resumes safely;
- unrelated Drive files cannot be selected/deleted.

### D. Real iPad path, still synthetic

Run from the actual clinic-style iPad Safari / GitHub Pages origin:

- existing pairing state restored;
- synthetic encrypted transfer;
- HMAC-authenticated Apps Script writes;
- PC asleep/offline during send;
- PC later wakes and Drive sync completes;
- Gateway verifies/decrypts/persists;
- ACK permanently deletes only the relay job.

No patient/clinic data is used in this gate.

### E. Failure matrix

Complete the original roadmap cases:

- PC off
- PC asleep
- PC network disconnected
- clinic network interruption
- sender retry / duplicate
- Apps Script execution failure
- Drive sync delay
- partial object set
- corrupted local file
- ACK unavailable
- delete interrupted

For all cases prove: **not lost, not duplicated, retryable, and not deleted before verified receipt.**

## Production adoption rule

Adopt Google Drive + Apps Script only after gates A-E pass.

If any gate shows a structural limitation that cannot be fixed without adding substantial accounts,
billing, dependencies, clinic operations, or new trust surfaces, stop and reconsider the relay
provider instead of layering more complexity onto this design.

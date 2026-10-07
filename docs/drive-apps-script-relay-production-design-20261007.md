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

Candidates must be compared with synthetic data before one is selected:

1. a random bearer upload token provisioned during pairing, with only its SHA-256 verifier stored
   server-side; or
2. a random HMAC-SHA256 upload key provisioned during pairing.

For the HMAC candidate, import the clinic copy as a non-extractable Web Crypto HMAC key and persist
the CryptoKey in IndexedDB. Phase 4 currently defines sender key generation/pairing but does not yet
implement the iPad browser key store, so this persistence boundary is a new prototype requirement
and should later be shared with sender-identity persistence rather than duplicated.

For the bearer candidate, keep only a SHA-256 verifier server-side and persist the high-entropy
token in the same future credential store.

If HMAC is selected, store the corresponding verification secret only in Apps Script Script
Properties, indexed by the opaque sender clinic-device ID.
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

## Bearer vs HMAC decision rule

A bearer token is simpler and lets Apps Script retain only a SHA-256 verifier, but the plaintext
token is transmitted on each authenticated request and is readable by the browser application.

A non-extractable HMAC CryptoKey keeps the long-lived upload secret out of each request and makes
straightforward key export harder. However Apps Script must retain the HMAC verification secret
itself rather than only a one-way verifier. Same-origin malicious code could also use a restored
non-extractable key for signing even if it cannot export the raw key.

Therefore HMAC is not assumed to be safer overall. Select it only if the bounded synthetic
comparison shows a material client-side safety benefit that justifies the extra server-side secret
and code. Otherwise prefer the bearer variant for simplicity and hash-only server storage.

Neither option is a new user account or login.

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
- Drive API files.delete permanently deletes a user-owned file without moving it to Trash.
- Apps Script can call Google APIs directly with UrlFetchApp using ScriptApp.getOAuthToken() when
  the script has the required OAuth scopes. Therefore permanent delete does not require enabling
  the Advanced Drive service solely for files.delete; the smaller direct REST path is preferred.
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

**Completed, but it does not approve production adoption.**

The 2026-10-07 Gemini adversarial review is recorded in
`docs/drive-apps-script-relay-gemini-adversarial-20261007.md`. It agreed with preserving the
existing E2E/ECDSA and verified-ACK boundaries, but kept the overall decision at `TRIAL_REQUIRED`
because public Apps Script endpoint availability/quota abuse, credential persistence/revocation,
and HMAC-vs-bearer selection still require bounded testing.

Local Codex/Claude review attempts were not counted as approvals when their execution environments
failed or stalled.

### B. Upload credential comparison + browser persistence prototype

Using synthetic values only:

- prove a non-extractable Web Crypto credential can persist/restore through IndexedDB;
- prove the existing sender ECDSA private key can use the same persistence mechanism;
- compare bearer-token and HMAC request gates under the same expiry/replay/unknown sender/revocation
  and retry/idempotency tests;
- confirm bearer uses hash-only server storage;
- confirm HMAC requires server-side verification secret storage;
- run exact iPad Safari persistence/restore before selecting either candidate;
- select the simpler option unless the more complex option demonstrates a material safety gain.

Current evidence is recorded in
`docs/drive-relay-upload-credential-comparison-20261007.md`:

- synthetic Chrome comparison: PASS;
- provisional recommendation: bearer token;
- exact iPad Safari persistence/restore: still required;
- a standalone no-network iPad probe is prepared and locally 15/15 PASS; see
  `docs/drive-relay-ipad-device-probe-20261007.md`;
- therefore Gate B is PARTIAL PASS, not complete until the actual iPad Safari run passes.

### C. Permanent-delete prototype

Use the smallest official path: Drive REST `files.delete` through `UrlFetchApp` with
`ScriptApp.getOAuthToken()`. Do not enable the Advanced Drive service solely for this operation.

Because the Drive scope can delete files beyond the relay folder, code must fail closed unless the
exact target file ID is first proven to be a direct child of the dedicated synthetic/relay job
folder and is present in the job's expected-object list. Folder deletion must also require the
expected opaque folder ID and an empty-folder check.

With synthetic files:

- valid receiver auth + capability + ACK proof -> exact permanent deletion;
- wrong receiver token -> no deletion;
- wrong capability -> no deletion;
- wrong ACK proof -> no deletion;
- partial delete -> deleting state resumes safely;
- unrelated Drive files cannot be selected/deleted.

Current evidence is recorded in
`docs/drive-relay-permanent-delete-trial-20261007.md`:

- 22/22 synthetic checks: PASS;
- direct REST `files.delete` path: PASS;
- wrong receiver/capability/proof: no deletion;
- unrelated file ID: rejected and preserved;
- interrupted delete: resumed safely;
- trial folders: permanently removed after empty-folder checks;
- public web-app POST remained disabled throughout.

Therefore Gate C is **PASS for the bounded synthetic prototype**.

### D. Real iPad path, still synthetic

#### D1. Browser credential persistence

The standalone device probe from the actual clinic-style iPad Safari / GitHub Pages origin is
**actual PASS**: it proved the non-extractable ECDSA sender key and provisional bearer survive a
Safari close/reopen without silent rotation.

#### D2. Full synthetic relay

Only after D1 passes:

- existing pairing state restored;
- synthetic encrypted transfer;
- selected upload credential authenticates Apps Script writes (bearer is currently provisional);
- PC asleep/offline during send;
- PC later wakes and Drive sync completes;
- Gateway verifies/decrypts/persists;
- ACK permanently deletes only the relay job.

No patient/clinic data is used in either D1 or D2.

D2 currently has a local repository harness only; it is locally tested but is **not** a real D2
PASS. External Apps Script remains disabled and unmodified.

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

# Lab PC Gateway (Phase 6-8)

Phase 6 receives encrypted relay jobs on the dental laboratory Windows PC. Phase 7 acknowledges only verified local saves and removes the acknowledged relay copy. Phase 8 adds a localhost-only, read-only viewer over the same verified local inbox, plus a one-click export of the existing `digital-work-order-intake-v1` JSON for dental-delivery-billing.

The normal sequence is:

1. list pending jobs with the receiver-only API;
2. resume any already-authorized deleting job before starting a new download;
3. for a ready job, request short-lived read-only download URLs and a per-job ACK capability;
4. download every ciphertext object;
5. verify ciphertext size and SHA-256 before any decryption;
6. decrypt the receiver bootstrap with the lab recipient ECDH private key;
7. reconstruct the original Phase 4 envelope;
8. verify the registered clinic sender signature and decrypt with MediaTransferCrypto.decryptEnvelope;
9. re-run the Phase 3 package integrity checks;
10. write to an opaque temporary local directory and atomically rename the verified directory;
11. after stored or receipt-verified already-stored only, compute the decrypt-derived ACK proof and send ACK;
12. the relay transitions ready to deleting, deletes only the exact recorded ciphertext objects, verifies they are absent, then deletes the job metadata.

If ACK delivery fails after local persistence, the verified local copy remains. A later poll safely retries. If the server already entered deleting before a crash, the next poll resumes deletion without re-downloading ciphertext.

## Files

- receiver-core.mjs — provider-independent receive/download/reconstruct/decrypt flow.
- local-store.mjs — verified atomic local persistence.
- receiver.mjs — one-shot / polling daemon entry point.
- inbox-root.mjs — the single default `inboxRoot` resolution shared by receiver.mjs and the Phase 8 viewer.
- gateway-config.example.json — non-secret configuration example.
- sender-registry.example.json — local sender-registry shape.
- windows/protect-receiver-secrets.ps1 — one-time DPAPI CurrentUser protection for the receiver token and recipient-backup passphrase.
- windows/run-receiver.ps1 — decrypts the DPAPI values only in the current user process and launches the Node receiver.
- viewer-core.mjs — read-only job discovery/validation logic for Phase 8; it reads verified inbox files but never writes, renames, or deletes them.
- viewer-server.mjs — localhost-only (127.0.0.1) read-only HTTP server built on Node's `http` module.
- viewer-client.js — browser-side script served by viewer-server.mjs; builds DOM with `textContent`/`createElement` only.
- viewer-config.mjs — loads only `inboxRoot` from the existing gateway-config.json; needs no receiver secrets.
- viewer.mjs — Phase 8 viewer CLI entry point.
- delivery-intake-reuse.mjs — reuses the existing `delivery-intake-export.js` `digital-work-order-intake-v1` builder/filename convention inside the viewer.
- windows/run-viewer.ps1 — launches the viewer; needs no receiver secrets and prints only the localhost URL.

## Data boundary

The cloud receiver list and download plan do not contain patient name, clinic name, doctor name, original attachment filename, attachment ID, or workOrderRef.

The encrypted receiver bootstrap contains the Phase 4 header/descriptor/signature and part-IV mapping. Only the lab recipient private key can decrypt it.

After verification, the local inbox contains the actual work-order data because the lab PC is the intended decryption endpoint.

Local final directories use only the opaque relay jobId:

    <inbox>/<jobId>/
      manifest.json
      work-order.json
      receipt.json
      media/
        <opaque-attachment-id>.<mime-derived-extension>

No patient or clinic name is used in a directory or filename.

The per-job ACK capability is not written to the local inbox or logs. A second ACK proof is computed only after successful decryption from the opaque job ID, descriptor SHA-256 and workOrderRef. The cloud stores only a second SHA-256 verifier for that proof. A stolen long-lived receiver token by itself therefore cannot initiate deletion of a ready job.

## Recipient private key

Phase 4 recipient private keys are never stored as plaintext key files. The gateway reads the existing encrypted recipient backup JSON and restores it only after the backup passphrase is supplied through the DPAPI-protected secret path.

Key rotation is supported: put the encrypted backup files for the active and required decrypt-only keys in recipientBackupPaths, then set activeRecipientKeyId. Phase 6 v1 restores all listed backup files with the same DPAPI-protected backup passphrase, so configured backup files must use that same passphrase. Old decrypt-only keys must not be retired while in-flight relay jobs still reference them.

## Sender registry

The gateway needs the full public Phase 4 sender registration state so it can verify the original sender signature before accepting decrypted data.

Create a local file based on sender-registry.example.json. Never place sender private keys, recipient private keys, patient data, or clinic-identifying labels in this registry.

## One-time Windows secret setup

Copy gateway-config.example.json to gateway-config.json and set the relay URL, encrypted recipient-backup path(s), local sender-registry path, and optional inbox root.

Run from the repository root:

    powershell -ExecutionPolicy Bypass -File .\gateway\windows\protect-receiver-secrets.ps1 -RecipientBackupPath "C:\path\to\recipient-backup.json"

The setup script generates a random 32-byte receiver token, never prints the plaintext token, prompts for the recipient-backup passphrase as a SecureString, and protects both values with Windows DPAPI CurrentUser. It prints only the recipient key ID and receiver-token SHA-256 needed for cloud runtime configuration.

Do not copy the DPAPI file to another Windows account and expect it to decrypt. It is intentionally tied to the Windows user context.

## Run once

    powershell -ExecutionPolicy Bypass -File .\gateway\windows\run-receiver.ps1 -Once

## Continuous polling

    powershell -ExecutionPolicy Bypass -File .\gateway\windows\run-receiver.ps1

The default poll interval is 60 seconds. Configuration accepts 30–3600 seconds.

The gateway log reports only counts and error codes. It must not print work-order contents, patient/clinic fields, receiver tokens, backup passphrases, signed download URLs, ciphertext, or private keys.

## Automatic start

Do not create a Windows Scheduled Task until a real production relay has been explicitly configured and one harmless synthetic end-to-end run has passed on the actual lab PC.

When automatic start is later enabled, run the task as the same Windows user that created the DPAPI secrets. Do not run it as SYSTEM, because CurrentUser DPAPI values are deliberately user-bound.

## Failure behavior

The receiver is fail-closed:

- wrong receiver token → no list/download;
- wrong or retired recipient key → no bootstrap decryption;
- ciphertext size/hash mismatch → no decryption/local commit;
- sender registry missing/revoked/signature mismatch → no local commit;
- Phase 3 package mismatch → no local commit;
- local write failure → temporary directory is removed and no ACK is sent;
- existing matching final receipt → safe already-stored result, then ACK can be retried;
- wrong ACK capability or decrypt-derived proof → no cloud deletion;
- ACK network failure after local persistence → local data is retained and the next poll retries safely;
- deletion failure after ready → deleting transition → job metadata remains and the next poll resumes exact-object deletion without downloading again;
- unrelated bucket objects are never selected by prefix or wildcard.

The relay's 30-day lifecycle remains the abandoned-job safety net. Normal Phase 7 operation deletes the acknowledged ciphertext immediately after verified local persistence.

## Phase 8: localhost viewer and delivery/billing handoff

Phase 8 adds a read-only viewer over the exact same verified `inboxRoot` directory tree that Phase 6/7 already write. It does not add a database, a second application, or any new external dependency.

### Run it

    powershell -ExecutionPolicy Bypass -File .\gateway\windows\run-viewer.ps1

or directly:

    node .\gateway\viewer.mjs --config=.\gateway\gateway-config.json --port=4850

The script and the CLI print only the localhost URL (for example `http://127.0.0.1:4850/`) to stdout. They never print job counts, work-order fields, or patient/clinic data. `run-viewer.ps1` sets no `DWO_RECEIVER_TOKEN` / `DWO_RECIPIENT_BACKUP_PASSPHRASE` and needs no receiver secrets; it only reads `gateway-config.json` to resolve `inboxRoot` via the same `inbox-root.mjs` default used by `run-receiver.ps1`.

### What it shows

- A newest-first list of received jobs with enough summary for the lab operator (received time, clinic/patient name when present, delivery date, attachment counts).
- A detail view of the intended local plaintext work-order fields, because the lab PC is the intended decryption/display endpoint for this data (see "Data boundary" above).
- Inline playback/opening of photos, video, and audio from the verified job's `media/` directory.
- A one-click download of the existing `digital-work-order-intake-v1` JSON (same builder and filename convention as `delivery-intake-export.js`) for manual import into dental-delivery-billing's existing intake screen. The viewer never writes to another repository's database or API directly.

### What it refuses to do

- Bind to anything other than `127.0.0.1`. There is no configurable non-loopback host.
- Mutate, rename, or delete anything under `inboxRoot`.
- Show a job whose `receipt.json` / `manifest.json` / `work-order.json` are missing, malformed, or mutually inconsistent (fail closed; such entries are excluded from the list and only counted).
- Serve any file that is not present in the verified manifest's attachment map; URL input never maps directly to a filesystem path.
- Infer a job or attachment from path traversal input (`..`, absolute paths, encoded slashes); job IDs and attachment IDs are validated against the existing job-id / attachment-id contracts before any filesystem access.

### Storage and backup boundary

- The Gateway inbox remains the durable received store for digital-work-order v1. There is no SQLite in digital-work-order; duplicate business-record management and long-term intake tracking remain dental-delivery-billing's existing SQLite responsibility.
- Phase 8 does not delete or archive received jobs automatically. Retention period, archive location, and access policy for the lab PC remain a separate human operational decision.
- If the inbox directory is backed up at the filesystem level, that backup contains the same plaintext protected data (patient/clinic names, media) as the inbox itself. Choosing a production backup target, retention period, and access control is a separate human policy decision; Phase 8 does not select or automate one.
- Production cloud/Windows automatic-start activation remains out of scope for Phase 8, exactly as for Phase 6/7.

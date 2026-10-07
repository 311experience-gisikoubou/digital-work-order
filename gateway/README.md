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
- Answer any request whose `Host` header is not an exact, single match for `127.0.0.1:<port>`, where `<port>` is the actual local port of the socket that accepted this specific connection (`req.socket.localPort`) — never a cached or caller-supplied value, so it is correct whether the server was started via `startViewer` or via `createViewerServer` + `server.listen(port, '127.0.0.1')` directly. No other hostname/alias, and no missing/duplicate/extra-port/trailing-dot/userinfo variant, is accepted. The request-target must be strict origin-form (starts with `/`, not `//`); this rejects both absolute-form (`GET http://host/path HTTP/1.1`) and network-path-reference (`GET //host/path HTTP/1.1`) targets, either of which could otherwise bypass a Host-only check. `Origin` (when present) must be an exact, single match for `http://127.0.0.1:<port>`. This check reads `rawHeaders` directly — not only the normalized `req.headers` — so a duplicated `Host`/`Origin` header line cannot slip past a "first value wins" normalization. An absent `Origin` is allowed (ordinary direct browser navigation/same-origin `fetch()` does not send one); a non-matching, `null`, or duplicated `Origin` is rejected. Every route runs this check before it reads anything from the inbox, and the response is always a generic `403` with no permissive CORS header. A request that omits `Host` entirely may instead receive Node's own parser-level `400` on HTTP/1.1 before reaching this check at all; that is an equally fail-closed outcome, and HTTP/1.0 (which does not require `Host`) demonstrates this server's own `403` directly.
- Serve any attachment's declared manifest MIME type inline unless it is on a small, explicit allowlist of already-supported image/video/audio types consistent with its declared `kind` (JPEG/PNG/WebP images; MP4/QuickTime video; the existing `audio/m4a`, `audio/mp4`, `audio/webm`, `audio/wav` audio types). Everything else — the generic `file` kind, HTML, SVG, JavaScript, XML, an unknown MIME, or a `kind`/MIME mismatch — is forced to `Content-Type: application/octet-stream` with `Content-Disposition: attachment; filename="<attachmentId>.bin"` (built only from the opaque `attachmentId`, never from request input or a patient/clinic field), `X-Content-Type-Options: nosniff`, and a restrictive `Content-Security-Policy: default-src 'none'; sandbox` as defense-in-depth, making the forced download inert if ever opened directly in a browser tab. This applies identically to `GET`, `HEAD`, and `206` Range responses. A verified manifest hash/signature proves the bytes were not altered in transit; it proves nothing about whether those bytes are safe to render or execute, so that trust is never extended to Content-Type selection.

### Storage and backup boundary

- The Gateway inbox remains the durable received store for digital-work-order v1. There is no SQLite in digital-work-order; duplicate business-record management and long-term intake tracking remain dental-delivery-billing's existing SQLite responsibility.
- Phase 8 does not delete or archive received jobs automatically. Retention period, archive location, and access policy for the lab PC remain a separate human operational decision.
- If the inbox directory is backed up at the filesystem level, that backup contains the same plaintext protected data (patient/clinic names, media) as the inbox itself. Choosing a production backup target, retention period, and access control is a separate human policy decision; Phase 8 does not select or automate one.
- Production cloud/Windows automatic-start activation remains out of scope for Phase 8, exactly as for Phase 6/7.


## U13: local PDF + later video association

U13 extends the existing localhost Viewer; it does **not** create a second desktop application or modify the verified Gateway inbox.

Optional configuration:

    "manualRoot": "C:\\path\\to\\manual-receive-folder",
    "relatedMediaStorePath": null

When `manualRoot` is configured, the Viewer scans only direct regular files in that one local folder (no recursion and no symlinks). A PDF is eligible only when its filename contains the explicit case ID form `KYYMMDD-NN` such as `K991231-99`. Videos use `.mov`, `.mp4`, or `.m4v`.

- Matching PDF/video case IDs are shown together automatically.
- Duplicate video copies are collapsed by SHA-256 content.
- The Viewer shows the PDF and `関連動画 N本` in the same local detail view.
- A video can be dragged from Windows Explorer onto the PDF card in the Viewer. The browser sends only filename/size/mtime metadata; no video bytes are uploaded through the drag action.
- The server resolves that metadata only against a direct regular file already present in `manualRoot`. Missing, ambiguous, traversal, or unsupported candidates fail closed.
- Manual links are stored atomically in a separate local app-state JSON containing only PDF/video SHA-256 values, case ID, and timestamp. Original filenames/full paths are not persisted in the association store.
- PDF/video source files are never copied, renamed, edited, or deleted by U13.

The default association store is under the current user's local application-data directory (`KoyoshiDWO/related-media-associations-v1.json`), intentionally outside the watched folder and Gateway inbox. Set `relatedMediaStorePath` only when a different local app-state path is intentionally needed.

For an ad-hoc run without editing config:

    powershell -ExecutionPolicy Bypass -File .\gateway\windows\run-viewer.ps1 -ManualRoot "C:\path\to\manual-receive-folder"

The drag target is the PDF card **inside the localhost Viewer**, not the PDF icon in Windows Explorer. Direct Explorer-PDF drop handling would require a Windows Shell extension and is intentionally not used. The Viewer must therefore be running and open for drag/drop. Windows automatic startup is a separate activation step and is not enabled by this change.

# Lab PC Gateway (Phase 6-7)

Phase 6 receives encrypted relay jobs on the dental laboratory Windows PC. Phase 7 acknowledges only verified local saves and removes the acknowledged relay copy.

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
- gateway-config.example.json — non-secret configuration example.
- sender-registry.example.json — local sender-registry shape.
- windows/protect-receiver-secrets.ps1 — one-time DPAPI CurrentUser protection for the receiver token and recipient-backup passphrase.
- windows/run-receiver.ps1 — decrypts the DPAPI values only in the current user process and launches the Node receiver.

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

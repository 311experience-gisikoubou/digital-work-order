# Lab PC Gateway (Phase 6)

Phase 6 receives encrypted relay jobs on the dental laboratory Windows PC.

The normal sequence is:

1. list ready jobs with the receiver-only API;
2. request short-lived read-only download URLs;
3. download every ciphertext object;
4. verify ciphertext size and SHA-256 before any decryption;
5. decrypt the receiver bootstrap with the lab recipient ECDH private key;
6. reconstruct the original Phase 4 envelope;
7. verify the registered clinic sender signature and decrypt with MediaTransferCrypto.decryptEnvelope;
8. re-run the Phase 3 package integrity checks;
9. write to an opaque temporary local directory;
10. atomically rename the verified directory to the final inbox location.

Phase 6 stops after successful local persistence. It does not acknowledge or delete cloud objects. That is Phase 7.

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
- local write failure → temporary directory is removed;
- existing matching final receipt → safe already-stored result.

A failed Phase 6 receive does not delete the cloud copy. The relay's 30-day lifecycle remains the abandoned-job safety net until Phase 7 implements explicit acknowledgement and deletion.

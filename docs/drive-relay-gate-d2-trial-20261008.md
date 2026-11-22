# Gate D2 synthetic trial harness

Status: **TRIAL / repository preparation only**. This artifact does not authorize deployment, Drive configuration, public write activation, patient/clinic data, or production adoption.

`app/drive-relay-d2-trial.html` is unlinked and `noindex,nofollow`. It accepts only its own prepared `?bridge=` URL, validates it, and has one IndexedDB state record. The iPad creates only its stable, non-extractable ECDSA sender key and high-entropy bearer; the lab PC owns the recipient private key. The bridge supplies only `{recipientKeyId, publicJwk}`. Existing package, crypto, receiver-bootstrap, and transport builders create a tiny synthetic package.

The parent uses an HtmlService iframe bridge because ContentService CORS is not assumed. Apps Script serves the web-app wrapper at the exact `https://script.google.com` deployment URL, then renders the user HTML inside a nested generated sandbox host of the form `https://<lowercase letters/digits/hyphens>-script.googleusercontent.com`. The inner bridge therefore talks directly to `top`, not to the `script.google.com` wrapper parent. The GitHub page accepts the first `ready` only from that generated sandbox-origin form, then pins both that exact origin and that exact `WindowProxy` source for the request/result exchange; `script.google.com`, bare `script.googleusercontent.com`, arbitrary Googleusercontent hosts, suffix tricks, and a different source are rejected. The per-page channel remains random, and the Apps Script bridge itself accepts commands only from `top` at the exact configured GitHub parent origin. Apps Script does not expose server functions whose names end in `_` through `google.script.run`, so the HtmlService page calls the single public shim `d2Bridge(...)`, which delegates immediately to the private `d2Bridge_(...)` dispatcher; all D2 validation and mutation logic remains private behind that dispatcher. The page CSP still names only the immediate approved Google frame origins and uses no Googleusercontent wildcard. The repository Apps Script source is inert unless `D2_TRIAL_ENABLED=true` and `D2_PARENT_ORIGIN`, `D2_SYNTHETIC_ROOT_ID`, `D2_RECEIVER_BEARER_SHA256`, and `D2_RECIPIENT_PUBLIC_JSON` are configured. Pairing additionally needs `D2_PAIRING_ENABLED=true`; it stores a hash-only upload verifier and root `pairing.json` public sender registry, then closes pairing.

Drive uses opaque job/object names, hashes/sizes/bootstrap metadata, `meta.json`, and a ready marker written strictly last. Before the first ciphertext write, the server records a canonical `staging.json` **inside that job folder**, binding the descriptor, ACK proof hash, canonical relay-plan hash, complete ordered object layout, and bootstrap metadata. A partial retry must match it exactly, so a different plan or layout cannot attach to the same job ID. `meta.json` is written only after every object is reread and verified; `ready.json` binds both `planSha256` and the SHA-256 of the exact UTF-8 `meta.json` bytes. No work-order reference, names, source filenames, or plaintext payload are stored.

The adapter first verifies `ready.json`/`meta.json` bindings and every sequential `obj_NNNN.bin` size/hash before decrypt, persistence, or ACK. It accepts only the simple Apps Script `pairing.json` shape and constructs the existing sender registry from it rather than trusting a job key. It invokes ACK only after verified persistence. ACK creates a retryable deletion control record listing exact object files plus `staging.json`, `ready.json`, and `meta.json`; deletion checks each recorded ID against its exact direct parent, expected name, and file/folder type before using Drive REST `files.delete`. The job moves from `ready` to `deleting`, ciphertext/metadata are deleted before the folder, and a Script Properties tombstone containing only the job ID plus capability/proof hashes is written after the folder is gone but before the Drive control record is removed. This makes interruption after folder deletion and lost ACK responses idempotently retryable without storing raw secrets. An unrelated file leaves the folder non-empty and is never deleted. No Trash is used.

Setup/run boundary: use a dedicated synthetic Drive root; create a separate Apps Script deployment manually; set only synthetic values; prepare one GitHub Pages URL with `?bridge=`; enable pairing for one browser pair; then disable it. Send only the built-in tiny synthetic fixture. The PC may be offline; no background service is introduced. Cleanup is a separate authorized operation: disable `D2_TRIAL_ENABLED`, remove the D2-only Script Properties including ACK/deleted tombstones, remove synthetic deployment/configuration, and permanently remove only the dedicated synthetic root after confirming it contains no wanted data.

For one explicit lab-PC trial run (not a daemon), invoke `node gateway/drive-relay-d2-adapter.mjs --config=<synthetic-config.json>`. The config accepts only `schemaVersion`, `syncedJobDir`, `inboxRoot`, `recipientBackupPath`, and `appsScriptEndpoint`; paths are relative to the config file. The synthetic receiver bearer and recipient-backup passphrase must be supplied only through `DWO_D2_RECEIVER_BEARER` and `DWO_RECIPIENT_BACKUP_PASSPHRASE`. Node fetch explicitly follows the Apps Script `ContentService` redirect. The command prints only an opaque status/error code, never either secret or work-order content.

Status boundary: **D1 actual iPad PASS. A dedicated synthetic-only Apps Script/Drive D2 deployment is configured for the external trial. The first live pairing attempt exposed the wrapper/sandbox routing problem and the second diagnosis proved one remaining cause: `google.script.run` does not expose the private `d2Bridge_` function, so the ready message arrives but the `getConfig` call cannot execute. This patch adds only the client-callable `d2Bridge` shim and keeps the validated dispatcher private. The external D2 rerun, PC-offline retention proof, receiver persistence, ACK, and exact permanent-delete proof are still pending. Production adoption and Gate E are NOT complete.**

## Issue #172: bounded D2 "Windows logon receiver" -- retained-only path (source only)

Status: **source-only preparation, not run against the real/production second synthetic job**.
No task registration, no reboot, no ACK/delete, and no merge happened as part of this change.
The existing, already-retained second synthetic job on the actual Drive was not accessed,
read, or modified while writing this path, and none of this was exercised against real files,
real DPAPI secrets, a network, or Task Scheduler.

This adds a second, separate, retained-only way to receive the *one* bounded second synthetic
job described above -- without the Apps Script control endpoint, without ACK/deletion, and
without ever reading the receiver bearer. It exists for a later, separately authorized
"receive on Windows logon" trial, not for production use:

- `gateway/drive-relay-d2-adapter.mjs` gained `receiveD2RetainedJob` (and the
  `waitForD2RetainedReady` / `runD2RetainedTrialOnce` / `--retain-config=` CLI pieces it is
  built from), reusing the exact same verified decrypt (`decryptD2Job`, extracted from the
  unchanged ACK path's `processD2SyncedJob`), `persistVerifiedPackage`, and `verifyD2LocalJob`
  building blocks the existing ACK path already uses. `processD2SyncedJob`, `receiveD2Job`, the
  `--config=` CLI, and their ACK/deletion-resume behavior are unchanged.
- The retained path never constructs an Apps Script control object, never calls `fetch`, and
  never reads `DWO_D2_RECEIVER_BEARER`. Before any local persistence it requires, in addition to
  the existing ready/meta/ciphertext verification: the exact configured `expectedJobId`
  (`job_<64 hex>`), that job directory being a direct, non-linked child of the one explicitly
  configured dedicated sync root, and the decrypted content matching the one allowed second
  built-in fixture exactly -- `workOrderRef` `dwo:223e4567-e89b-42d3-a456-426614174001`, the
  closed work-order object `{workOrderRef,trial:'D2-SYNTHETIC',createdFor:'test-only'}`, and
  exactly one `application/octet-stream` attachment whose decrypted bytes are exactly
  `[68,50,0,1]`. Anything else -- including a different real/valid ref, extra work-order
  fields, or different attachment bytes -- is rejected before any store, even if it decrypted
  and verified cryptographically without any other error.
- A repeat of the exact same job reuses the existing receipt/manifest verification (never a
  shortcut that only checks the receipt): it still decrypts and verifies the full package
  against the exact existing local manifest, and a corrupted or conflicting existing local
  record is rejected (fail closed) rather than ever being overwritten.
- `--retain-config=<path>` accepts only a closed `{schemaVersion:1, expectedJobId, syncRoot,
  inboxRoot, recipientBackupPath}` config (absolute, normalized paths; `syncRoot`/`inboxRoot`
  must not overlap). It never scans for jobs -- only the exact configured job directory is ever
  read. A symlink/junction at the job directory, at the local inbox job directory, or at its
  `media/` directory is rejected via `lstat` + realpath containment; the dedicated Drive sync
  root itself is only ever presence/type-checked (never rejected for being a reparse point),
  since the mounted Drive folder itself may legitimately carry reparse attributes. Only the
  recipient-backup passphrase is read from the environment
  (`DWO_RECIPIENT_BACKUP_PASSPHRASE`); no path, secret, or payload is ever written to
  stdout/stderr -- only a small closed set of `D2_RETAIN_*` codes.
- The one bounded-wait authority is `waitForD2RetainedReady`: it polls, against a monotonic
  deadline (default/maximum 180s, boundedly overridable via `--retain-timeout-ms=` for a short
  test run), only for files that are genuinely *missing* (`ENOENT`). Anything present but wrong
  -- a link, a malformed/mismatched `ready.json`/`meta.json`, a layout that is not this
  fixture's exact four-object shape, an over-sized object, or a size/hash mismatch -- terminates
  immediately instead of being retried. The deadline bounds this wait loop; it is not a promise
  that no underlying filesystem call can ever itself block.

`gateway/windows/run-d2-retained-trial.ps1` is a new, separate, source-only launcher for a
future *manually invoked* trial run: it only ever calls `--retain-config=`, reads a
CurrentUser-scope DPAPI-protected recipient-backup passphrase from an explicitly provided,
operator-provisioned synthetic secrets file (never the receiver bearer), performs exactly one
synchronous Node child invocation (no polling loop of its own -- the bounded wait above is the
only wait authority), clears the passphrase from its own process environment in `finally` on
every outcome, and never logs a path, secret, or exception. It never registers a Scheduled
Task, never requests elevation, and never reboots. **Wiring this script to an actual Windows
"run at logon" trigger requires a separate, explicitly human-authorized Task Scheduler
registration step, which this change intentionally does not perform.**

The dedicated sync root, inbox root, recipient-backup file, and synthetic secrets file are all
operator-provisioned outside this repository; no real path, key, job id, or secret is stored in
any tracked file. This path assumes a trusted local operator-provisioned configuration and a
single, non-hostile, non-concurrently-mutated filesystem during a run -- it is not a guarantee
against a concurrently hostile actor racing the same files on disk.

### FINAL AUDIT REPAIR (same four files, no scope expansion)

Two concrete defects found in manual adversarial review of the prior candidate were fixed,
source-only, within the same four files:

1. `run-d2-retained-trial.ps1`'s `Invoke-D2RetainedTrial` previously invoked the node child
   directly (`& $NodePath @nodeArgs`), so the child's own stdout flowed into that function's
   success-output pipeline; PowerShell then folded the leaked output together with the real
   `return` value into an array (e.g. `@('some native line', 0)`), corrupting `$exitCode` into a
   non-scalar and breaking every downstream exit-code comparison and the final `exit $exitCode`.
   The node invocation is now an isolated helper, `Invoke-D2RetainedNodeChild`, that redirects
   the child's stderr into the same captured stream as its stdout and discards the whole
   collection into `$null` without ever logging it, then returns only a freshly captured,
   explicitly `[int]`-cast `$LASTEXITCODE`. A regression test extracts this exact helper
   function, verbatim, from the real script source and runs it in an isolated harness against
   two fake "node" executables (one exiting 0 with stdout/stderr, one exiting 7 with
   stdout/stderr) -- asserting a single scalar `Int32` exit code and that neither fake child's
   output ever reaches the harness's own captured output. No DPAPI call and no real secret are
   involved in this regression.
2. `receiveD2RetainedJob`'s sync/inbox root overlap check used `realOrResolved`, which fell back
   to a purely lexical `path.resolve` on *any* `fs.realpath` failure (not only a missing leaf) --
   so a sync root that did not exist yet at the time of that first check (the ordinary case,
   since Drive has not synced it yet) could later turn out, once materialized, to be a
   symlink/junction alias directly into the local inbox root, without ever being caught.
   `realOrResolved` now walks up to the *nearest existing* ancestor, `realpath`s only that
   existing ancestor (resolving any symlink/junction already present on it), and rejoins the
   still-missing trailing components lexically; any non-`ENOENT` access failure on an existing
   ancestor now fails closed instead of falling back. The root-overlap comparison itself
   (`pathOverlaps`) was also rewritten to compare resolved paths one filesystem *component* at a
   time (case-insensitively on Windows) instead of a raw string/`startsWith('..')` check on
   `path.relative`'s output. The overlap check is now performed a second time, with both roots
   re-resolved through the real filesystem, immediately after `waitForD2RetainedReady` confirms
   the sync root/job actually exist and strictly before any decrypt or persist -- closing the
   window above. A new local-root link guard (`assertLocalRootNotLinked`) also rejects the local
   inbox root itself being a symlink/junction (the dedicated Drive sync root remains exempt from
   this, exactly as before, since it may legitimately carry reparse attributes). A new regression
   test creates the sync root as a symlink into the inbox root only *after* the bounded wait has
   already started polling, and asserts the call is rejected with `D2_RETAIN_ROOT_OVERLAP` with
   no decrypt/persist ever having happened. `waitForD2RetainedReady`'s bounded-wait default clock
   was also switched from `Date.now` to the monotonic `performance.now`, and its per-iteration
   sleep is now capped to whatever time actually remains before the deadline -- it remains the
   single bounded-wait authority; this is not a new wait mechanism and not a guarantee that an
   underlying filesystem call can never itself block past the deadline.

All prior tests for this Issue (and the full existing suite) were preserved and re-run against
this candidate; no real job, DPAPI, Google Drive, task registration, network, or ACK/delete was
touched while making or testing this repair, and nothing was committed or pushed.

### FINAL COMPATIBILITY REPAIR (same four files, no scope expansion)

A prior candidate's `run-d2-retained-trial.ps1` demanded a *second*, incompatible secrets-file
shape -- `{schemaVersion:1, recipientKeyId, backupPassphraseProtected}` with a raw base64
`[System.Security.Cryptography.ProtectedData]::Protect`/`Unprotect` blob for
`backupPassphraseProtected` -- instead of reusing the one already-established secrets-file
format the existing, unmodified `protect-receiver-secrets.ps1` already produces and the existing,
unmodified `run-receiver.ps1` already restores: `{version:1, receiverTokenProtected,
backupPassphraseProtected, recipientKeyId}`, both protected fields written via
`ConvertFrom-SecureString` under CurrentUser-scope DPAPI. A synthetic counterexample generated in
that exact established format, with a fictional passphrase, demonstrated the incompatibility
directly: it was rejected with exit code 11 even though it was a perfectly well-formed,
already-deployed secrets file. This was a compatibility defect in the new launcher, not a reason
to regenerate or alter any live/production receiver secret.

The launcher is fixed, source-only, within the same four files:

- `run-d2-retained-trial.ps1`'s secrets-shape check now accepts exactly the one established
  four-key `{version:1, receiverTokenProtected, backupPassphraseProtected, recipientKeyId}`
  shape -- no new or second format, and no migration path. The raw-base64
  `ProtectedData.Unprotect` handling is removed entirely. `backupPassphraseProtected` is restored
  using the same already-established `ConvertTo-SecureString` pattern `run-receiver.ps1` already
  uses, via a new `Convert-D2RetainedSecureStringToPlainText` helper built from the identical
  `SecureStringToBSTR` / `PtrToStringBSTR` / `ZeroFreeBSTR` marshaling `run-receiver.ps1`'s own
  `Convert-SecureStringToPlainText` already uses; the restored `SecureString` is disposed, and
  the resulting plaintext passphrase is still cleared in `finally` on every outcome, exactly as
  before. `receiverTokenProtected` is required to be present, as a non-empty string, purely
  because it is part of the one shared established schema -- it is never unprotected, read,
  used, or logged anywhere in this script, since the retained-only path never needs or forwards a
  receiver bearer. The `recipientKeyId` plain-text match against the recipient backup file is
  still checked before any SecureString/DPAPI call, so a wrong or mismatched secrets file still
  never reaches DPAPI. `run-receiver.ps1` and `protect-receiver-secrets.ps1` themselves are
  unchanged.
- A new `Invoke-D2RetainedNodeChildScoped` wrapper around the existing, unchanged
  `Invoke-D2RetainedNodeChild` now also guarantees the single node child invocation can never
  inherit this host process's own `DWO_D2_RECEIVER_BEARER` / `DWO_RECEIVER_TOKEN` values, if
  either already happens to be set in the parent shell: both are temporarily removed -- never
  logged, unprotected, or otherwise inspected, only their existing raw string values are held
  locally so they can be restored -- immediately before the single child invocation and restored
  immediately afterward, via `finally`, on every outcome (success, the child failing, or node
  itself failing to launch).
- A new isolated regression extracts both `Invoke-D2RetainedNodeChild` and
  `Invoke-D2RetainedNodeChildScoped`, verbatim from the real script source, into an isolated
  harness and proves, against sentinel (non-secret) environment values and a harmless fake
  "node" executable, that the child never observes either value and that the parent process's
  own environment is restored exactly afterward -- no DPAPI, config, or real secrets file
  anywhere in that test.
- A new focused, real-executable regression generates a freshly created synthetic CurrentUser
  DPAPI `SecureString` (via the real `ConvertTo-SecureString`/`ConvertFrom-SecureString`
  cmdlets) and a temporary, entirely fictional backup/config/secrets fixture -- never any
  actual/production job, secret, Drive data, task registration, reboot, ACK/delete, or network
  call -- then invokes the real script against a harmless fake child executable. It confirms: the
  correct passphrase reaches the fake child without the script's own stdout/stderr ever exposing
  it or either sentinel receiver-bearer/token value; a successful run yields the scalar exit code
  0; a failing fake child surfaces as the one sanitized code 15; a `recipientKeyId` mismatch
  (wrong key) fails with code 12 before the child ever runs; and a malformed secrets file (a
  missing required key) fails with code 11 before the child ever runs.

All prior tests for this Issue (and the full existing suite) were preserved and re-run once
against this changed candidate; no real job, DPAPI secret, Google Drive, Task Scheduler
registration, reboot, ACK/delete, network call, or production data was touched while making or
testing this repair, and nothing was committed or pushed.

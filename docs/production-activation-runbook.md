# Production Activation Runbook (Media Transfer Phase 5-8)

## Purpose and scope

This runbook sequences the human-authenticated production activation steps for the
Phase 5-8 media-transfer relay/receiver/viewer architecture described in
`cloud/README.md` and `gateway/README.md`. Those two files remain the implementation
source of truth for exact commands, file contracts, and safety invariants; this
runbook only orders the work into stages and states who/what may execute each stage.

**No stage in this runbook, and no file added or changed by this PR, changes any
production Firebase project, Google Cloud project, billing configuration, IAM
binding, DPAPI secret, Windows Scheduled Task, backup target, or real patient/clinic
data.** Everything executable by this PR is read-only, local, and uses only
synthetic fixtures. Every stage that touches a real cloud project, real billing,
real IAM, real DPAPI material, a real Scheduled Task, a real backup target, or real
data is explicitly marked below and requires a separate, explicit human action
after this PR merges.

## How to read the per-stage markers

Each stage below has exactly one marker:

- `AI_SAFE_PREP` — An AI agent may perform this work directly: it is read-only,
  local/repository-scoped, and uses no network or cloud credentials.
- `HUMAN_APPROVAL_REQUIRED` — A human must make and record an explicit decision
  (for example: exact project ID, exact bucket name, budget policy, backup
  retention policy) before any execution, AI-assisted or otherwise, may proceed.
- `HUMAN_INTERACTIVE` — The action requires a human physically present at an
  authenticated console, the lab PC, or a browser session with human credentials
  (for example: Firebase/Google Cloud console login, Windows DPAPI prompt,
  Scheduled Task registration GUI/CLI run as the lab Windows user). An AI agent
  must not perform this step even with approval, because it requires human
  possession of credentials/session/physical access.
- `AFTER_APPROVAL_AI_CAN_EXECUTE` — Once the preceding `HUMAN_APPROVAL_REQUIRED`
  decision is recorded and the preceding `HUMAN_INTERACTIVE` step is complete, an
  AI agent may run the exact, already-reviewed command from `cloud/README.md` /
  `gateway/README.md` on behalf of the human, scoped only to the confirmed
  project/bucket/function, with no broader or wildcard scope.

## Stage 0 — Repo/local readiness

**Marker: `AI_SAFE_PREP`**

- Run `node tools/production-readiness-preflight.mjs --repo-root <repo>` (optionally
  `--pretty`) and confirm the result is `PASS`.
- Run `node tools/production-readiness-preflight-selftest.mjs` and confirm all
  selftest cases pass.
- Review `cloud/README.md` and `gateway/README.md` in full; this runbook does not
  restate their exact commands or safety invariants.
- This stage changes nothing outside the repository and requires no cloud
  credentials.

## Stage 1 — Exact Firebase/Google Cloud project and billing identity

**Marker: `HUMAN_APPROVAL_REQUIRED`, then `HUMAN_INTERACTIVE`**

- A human decides and records, outside this repository, the exact target Firebase
  project ID / Google Cloud project ID that will host the relay function, and
  confirms it is dedicated to this relay (not shared with an unrelated
  application).
- A human confirms, by logging into the Firebase/Google Cloud console directly,
  that Blaze billing is the intended plan for that project and is already enabled
  or is being enabled intentionally by that human.
- **Current billing fact (verified externally on 2026-10-03):** Blaze is a
  pay-as-you-go plan. Re-check the official Firebase/Google Cloud billing
  documentation immediately before activation, because plan mechanics and
  available controls can change.
- No business budget amount (yen or otherwise) is specified by this runbook or by
  any file in this PR. Selecting a budget amount is a separate human business
  decision, not a technical default.

## Stage 2 — Spend controls

**Marker: `HUMAN_APPROVAL_REQUIRED`, then `HUMAN_INTERACTIVE`**

- A human configures a Google Cloud budget alert on the confirmed billing account,
  choosing the yen amount and notification channel as a business decision. This
  runbook does not select that amount.
- **Current billing fact (verified externally on 2026-10-03):** budget alerts are
  notification-only; they do not stop or cap spend by themselves. Firebase does
  offer a Cloud Functions spend cap control (in Preview, as of the verification
  date) that can halt further invocations, but it is not an instantaneous/hard cap
  because usage reporting that feeds it has latency, so real spend can exceed the
  configured cap for a window before it takes effect.
- Re-check the official Firebase/Google Cloud documentation for the current state
  of budgets vs. spend caps immediately before activation, since this is an
  evolving product area and the Preview status, exact mechanics, or latency
  characteristics may have changed since 2026-10-03.
- A human decides whether the Cloud Functions spend cap (if still offered and
  suitable) is enabled for the relay function, and records that decision. This
  runbook does not choose it on the human's behalf.

## Stage 3 — Dedicated relay bucket: location, UBLA, public access prevention, soft delete, lifecycle, CORS

**Marker: `HUMAN_APPROVAL_REQUIRED` for the exact bucket name, then `HUMAN_INTERACTIVE` for creation, then `AFTER_APPROVAL_AI_CAN_EXECUTE` for the remaining confirmed-bucket configuration commands**

- A human chooses and records the exact, globally unique bucket name dedicated to
  this relay (never a bucket shared with unrelated application data), and
  confirms the Tokyo (`asia-northeast1`) location requirement from
  `cloud/README.md`.
- A human (or, once the human has approved the exact bucket name, an AI agent
  acting on that approval) creates the bucket using the exact command already
  documented in `cloud/README.md` ("Bucket creation"), with
  uniform-bucket-level-access and public-access-prevention enabled at creation
  time.
- **Current Cloud Storage fact (verified externally on 2026-10-03):** soft delete
  is enabled by default for newly created buckets, with a 7-day default retention
  duration. This design intentionally disables soft delete only on this one
  dedicated, short-lived relay bucket, and only after the exact bucket name has
  been confirmed per this stage — never by a wildcard or by reusing an unrelated
  bucket. Re-check the official Cloud Storage soft-delete documentation
  immediately before activation, since default behavior and retention duration
  can change.
- After the exact bucket is confirmed and created, an AI agent may run the
  already-reviewed, bucket-scoped commands from `cloud/README.md` for: disabling
  soft delete on that one bucket, applying `cloud/storage-lifecycle.json` (30-day
  emergency deletion upper bound), and applying `cloud/storage-cors.json` (GitHub
  Pages production origin, `PUT` only). No command in this stage may use a
  wildcard bucket pattern or target more than the one confirmed bucket name.

## Stage 4 — Least-privilege runtime IAM

**Marker: `HUMAN_APPROVAL_REQUIRED`, then `HUMAN_INTERACTIVE`**

- A human selects the Cloud Functions runtime service account and grants it only
  the narrowest practical permissions described in `cloud/README.md` ("Phase 6/7
  receiver IAM"): `storage.objects.get`, `storage.objects.delete` scoped to the
  dedicated relay bucket, and `iam.serviceAccounts.signBlob` on the intended
  signing service account only.
- A human explicitly decides whether a predefined role (e.g. Service Account Token
  Creator) is acceptable given its broader scope, or whether a narrower custom
  role is used instead. This is a human policy decision, not an AI default.
- No service-account JSON private key is created or downloaded at any point; the
  runtime continues to use attached managed identity / Application Default
  Credentials, per `cloud/README.md`.
- IAM changes must be performed by a human with console/gcloud access authorized
  for that project; an AI agent must not apply IAM bindings even with prior
  approval, because this is a security-sensitive, hard-to-safely-verify-from-text
  action that requires a human to confirm the exact principal and project context
  interactively.

## Stage 5 — Receiver token hash/key id and DPAPI CurrentUser protection

**Marker: `HUMAN_INTERACTIVE`**

- On the actual lab Windows PC, a human runs
  `gateway/windows/protect-receiver-secrets.ps1` as documented in
  `gateway/README.md` ("One-time Windows secret setup"). This generates the
  random receiver token, protects it and the recipient-backup passphrase with
  Windows DPAPI CurrentUser, and prints only the recipient key ID and the
  receiver-token SHA-256 digest.
- The human then configures `DWO_RECEIVER_KEY_ID` and `DWO_RECEIVER_TOKEN_SHA256`
  as Cloud Functions runtime configuration for the confirmed project (Stage 1),
  per `cloud/README.md` ("Phase 6/7 receiver authentication is also runtime-only
  configuration").
- This step is DPAPI-CurrentUser-bound to the specific Windows user account and
  machine; an AI agent must not perform it, generate a token on the human's
  behalf, or handle the plaintext token or passphrase at any point.

## Stage 6 — Scoped deploy

**Marker: `AFTER_APPROVAL_AI_CAN_EXECUTE`**

- Once Stages 1-5 are complete and recorded, deploy using the exact scoped
  commands already documented in `cloud/README.md` ("Deployment"):
  `firebase deploy --only functions:relay --config firebase.json` from `cloud/`,
  and, if the pending-job index has not yet been applied, the documented
  `firebase deploy --only firestore:indexes --config firebase.json`.
- Deployment must target only the confirmed project from Stage 1 and must never
  use an unscoped `firebase deploy` against a project that may contain unrelated
  Firebase resources.
- The deny-all `cloud/firestore.rules` and `cloud/storage.rules` are applied only
  after confirming the selected project/database/bucket are dedicated to this
  relay, per `cloud/README.md`.

## Stage 7 — Synthetic production-path end-to-end verification

**Marker: `AFTER_APPROVAL_AI_CAN_EXECUTE` for triggering a synthetic run, `HUMAN_INTERACTIVE` for the lab-PC portion**

- Using only synthetic, non-real data (no patient name, no real clinic identity),
  exercise the full Phase 5-7 path once against the now-deployed relay: signed
  upload, receiver discovery/download/decrypt/verify/local-save, and ACK-triggered
  exact-object deletion, exactly as already implemented and tested in
  `cloud/relay-core.mjs`, `cloud/receiver-core.mjs`, and `gateway/receiver-core.mjs`.
- The lab-PC side of this run (invoking `gateway/windows/run-receiver.ps1 -Once`)
  requires a human present at the lab PC, consistent with Phase 8's existing
  harmless-smoke precedent described in `CURRENT_STATUS.md`.
- Confirm no unrelated bucket object was touched and that the job's ciphertext and
  metadata were removed only after verified local persistence.

## Stage 8 — Windows Scheduled Task registration

**Marker: `HUMAN_INTERACTIVE`**

- Only after Stage 7 passes, a human registers a Windows Scheduled Task to run
  `gateway/windows/run-receiver.ps1` under the same Windows user account that
  created the Stage 5 DPAPI secrets, per `gateway/README.md` ("Automatic start").
  It must not run as `SYSTEM`.
- An AI agent must not register, modify, or enable a Scheduled Task; Scheduled
  Task registration is explicitly excluded from AI execution regardless of prior
  approval.

## Stage 9 — Backup and retention policy

**Marker: `HUMAN_APPROVAL_REQUIRED` (decision intentionally left unresolved by this runbook)**

- `gateway/README.md` ("Storage and backup boundary") already states that backup
  target, retention period, and access control for the lab-PC inbox are a
  separate human operational decision. This runbook does not select a backup
  target or a retention duration, and intentionally leaves both unresolved here as
  well.
- A human must record the chosen backup target and retention period, and the
  access control around any backup copy, as a distinct decision before or
  independent of go-live. This runbook neither blocks on a specific choice nor
  proposes a default.

## Stage 10 — Explicit real-data go-live

**Marker: `HUMAN_APPROVAL_REQUIRED`**

- A human explicitly authorizes switching from synthetic verification to real
  patient/clinic data flowing through the deployed relay/receiver/viewer.
- This authorization must be recorded outside of, or as an explicit decision
  within, the normal product status/change-tracking process (e.g.
  `CURRENT_STATUS.md`), separate from and after all of Stages 1-9.
- No file in this PR performs, schedules, or defaults to this authorization.

## Summary table

| Stage | Topic | Marker |
|---|---|---|
| 0 | Repo/local readiness | AI_SAFE_PREP |
| 1 | Exact project + billing identity | HUMAN_APPROVAL_REQUIRED → HUMAN_INTERACTIVE |
| 2 | Spend controls | HUMAN_APPROVAL_REQUIRED → HUMAN_INTERACTIVE |
| 3 | Dedicated relay bucket config | HUMAN_APPROVAL_REQUIRED → HUMAN_INTERACTIVE → AFTER_APPROVAL_AI_CAN_EXECUTE |
| 4 | Least-privilege runtime IAM | HUMAN_APPROVAL_REQUIRED → HUMAN_INTERACTIVE |
| 5 | Receiver token hash/key id + DPAPI | HUMAN_INTERACTIVE |
| 6 | Scoped deploy | AFTER_APPROVAL_AI_CAN_EXECUTE |
| 7 | Synthetic production-path E2E | AFTER_APPROVAL_AI_CAN_EXECUTE / HUMAN_INTERACTIVE |
| 8 | Scheduled Task | HUMAN_INTERACTIVE |
| 9 | Backup/retention policy | HUMAN_APPROVAL_REQUIRED (unresolved) |
| 10 | Real-data go-live | HUMAN_APPROVAL_REQUIRED |

## Explicit non-change statement

This PR adds documentation and read-only, repository-local tooling only. It does
not create, modify, or delete any Firebase project, Google Cloud project, billing
account, budget, IAM binding, Cloud Storage bucket, Firestore/Storage rule
deployment, DPAPI secret, Windows Scheduled Task, backup configuration, or
real-data record. Stages 1-10 above remain entirely unexecuted until a human
completes them in order, outside of this PR.

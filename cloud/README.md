# Phase 5 cloud relay setup

This directory contains the production-shaped relay implementation for encrypted media-transfer envelopes.
It is intentionally not deployed by repository tests or by the application itself.

## Safety boundary

Do not deploy until a human has verified all of the following in the target Google/Firebase project:

- Blaze billing is intentionally enabled for the selected project.
- The project and bucket are the intended production resources.
- The bucket location is `asia-northeast1` (Tokyo).
- Current Firebase / Google Cloud terms and the current Japanese medical-information handling requirements have been reviewed.
- Budget alerts and operational monitoring are configured.
- No real patient or clinic data is used for setup testing.

Never commit a service-account JSON key, refresh token, access token, Firebase Admin credential, or other secret.
Cloud Functions and local administrative tools must use managed identity / Application Default Credentials.

## Data boundary

The browser never receives Firebase Admin credentials or direct bucket credentials.
The relay accepts a Phase 4 signed descriptor plus a separately signed relay upload plan.
Only encrypted ciphertext objects are uploaded to Cloud Storage.

Bucket object names have the form:

```text
relay/v1/<opaque-job-id>/o/<ordinal>.bin
```

They do not contain patient names, clinic names, doctor names, original file names, workOrderRef, or attachment IDs.
Firestore relay job documents contain only opaque sender/recipient key IDs, hashes, byte counts, status, and opaque object specs.

## Bucket creation

From an authenticated administrator shell, choose a unique bucket name and create a dedicated temporary relay bucket:

```bash
gcloud storage buckets create gs://BUCKET_NAME \
  --location=asia-northeast1 \
  --uniform-bucket-level-access \
  --public-access-prevention
```

Do not reuse a bucket that stores unrelated application data.

## Disable Soft Delete for this temporary relay bucket

This relay is intentionally short-lived. After confirming the correct bucket:

```bash
gcloud storage buckets update --clear-soft-delete gs://BUCKET_NAME
```

Disabling Soft Delete means newly deleted objects cannot be recovered. This is intentional only for the dedicated relay bucket.
Do not apply the command to unrelated buckets or with wildcards.

## 30-day emergency lifecycle limit

Apply the repository lifecycle configuration:

```bash
gcloud storage buckets update gs://BUCKET_NAME \
  --lifecycle-file=cloud/storage-lifecycle.json
```

The 30-day lifecycle rule is an emergency upper bound, not the normal deletion path.
Normal deletion after the lab PC has received, decrypted, hash-verified, and locally saved the case belongs to Phase 7.
Cloud Storage lifecycle actions are asynchronous, so applications must not depend on deletion occurring at an exact timestamp.

## Browser upload CORS

Apply the dedicated bucket CORS file:

```bash
gcloud storage buckets update gs://BUCKET_NAME --cors-file=cloud/storage-cors.json
```

The production origin is limited to `https://311experience-gisikoubou.github.io`.
The relay HTTP function performs its own origin check as well.

## Firestore and Storage client rules

`firestore.rules` and `storage.rules` deny all direct browser reads and writes.
The server-side relay uses privileged managed credentials, not client rules.

Deploy these rules only to the intended project after confirming that the project does not share those rule files with unrelated applications.

## Function runtime

The cloud package uses Node.js 22 with:

- `firebase-functions 7.4.0`
- `firebase-admin 14.5.0`
- `@google-cloud/storage 8.2.0`

Set the relay bucket name as runtime environment configuration:

```text
DWO_RELAY_BUCKET=BUCKET_NAME
```

Optional:

```text
DWO_RELAY_ALLOWED_ORIGIN=https://311experience-gisikoubou.github.io
```

Do not place those values in source if the deployment environment provides managed configuration.

## Sender registry

The relay reads the Firestore collection `relaySenderRegistry`.
Each document ID is the opaque Phase 4 `clinicDeviceId`.
A document must contain only the public registration state required by `cloud/relay-core.mjs`:

```json
{
  "version": "dwo-sender-registry-v1",
  "clinicDeviceId": "dev_...",
  "status": "active",
  "pairedRecipientKeyId": "rk_...",
  "activeSigningKey": {
    "signingKeyId": "sk_...",
    "publicJwk": {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "..."
    },
    "activatedAt": 0
  },
  "updatedAt": 0
}
```

Never upload a sender private key, recipient private key, encrypted private-key backup, patient data, or clinic-identifying label into this collection.
Sender registration/revocation must be performed from an authenticated lab-admin path, not from the public browser.

## Deployment

Deployment is a human-authenticated production operation and is intentionally not executed by Phase 5 tests.

After the safety checks above, use `cloud/` as the Firebase project directory. Deploy the relay function by itself first; do not use an unscoped deploy command against a project that may contain unrelated Firebase resources:

```bash
cd cloud
firebase deploy --only functions:relay --config firebase.json
```

The deny-all Firestore/Storage rule files are repository safety templates. Apply them only after confirming that the selected Firebase project/database/bucket are dedicated to this relay and that no unrelated application would be affected.

The exported HTTPS function is named `relay` and runs in `asia-northeast1`.
Configure the resulting HTTPS URL in the application at runtime; do not hard-code project-specific URLs into the repository.

## Phase boundaries

Phase 5: signed upload to temporary cloud relay.

Phase 6: lab PC automatic discovery/download/decryption/local save.

Phase 7: receiver acknowledgement and immediate cloud deletion after successful local persistence.

The 30-day lifecycle rule remains a fail-safe for abandoned relay objects.

# Google Drive + Apps Script relay synthetic trial — 2026-10-07

## Status

**SYNTHETIC TRIAL: PASS WITH REMAINING PRODUCTION GATES**

This record captures only the synthetic relay trial. It does not authorize production use or real patient/clinic data.

## Scope

Target repository: `311experience-gisikoubou/digital-work-order`

Trial path:

`synthetic sender -> existing Apps Script web app -> Google Drive -> lab PC Google Drive for desktop -> hash verification -> ACK -> active-folder removal`

No patient name, clinic name, work-order data, real media, billing data, or other protected data was used.

The Apps Script trial endpoint was updated from the prior connectivity probe to `dwo-drive-relay-trial-v1`. The trial accepts only bounded synthetic objects up to 4 MiB and stores them only under `DWO_RELAY_TRIAL_SYNTHETIC_ONLY`.

## Observed results

| Check | Result | Evidence |
|---|---|---|
| Existing Apps Script deployment updated | PASS | GET returned `version=dwo-drive-relay-trial-v1`, `trialOnly=true`, `maxBytes=4194304` |
| 64 KiB store | PASS | Drive returned `stored`; returned size and SHA-256 matched sender |
| 64 KiB lab-PC receipt | PASS | Google Drive for desktop exposed the file; local SHA-256 matched sender |
| 64 KiB verified ACK | PASS | ACK returned `trashed-after-verified-ack`; active relay folder no longer contained the file |
| 64 KiB total trial runtime | PASS | 12.19 s |
| 4 MiB store | PASS | Drive returned `stored`; size 4,194,304 bytes and SHA-256 matched sender |
| 4 MiB receipt within 30 s | NOT MET | Trial poll timed out at 30 s before local verification completed |
| 4 MiB eventual lab-PC receipt | PASS | File later appeared with size 4,194,304 bytes and exact SHA-256 match |
| 4 MiB data preservation during delay | PASS | No ACK was sent after the 30 s timeout; the Drive object remained present |
| 4 MiB verified ACK after local verification | PASS | Correct ACK was accepted and active relay file disappeared |
| Wrong upload hash | PASS | Server rejected with `HASH_MISMATCH`; no active Drive file created |
| Duplicate same-object retry | PASS | Second PUT returned `already-stored` with the same Drive file ID |
| Wrong ACK hash | PASS | ACK rejected with `HASH_MISMATCH`; active file remained present |
| Correct ACK | PASS | ACK accepted; active relay file removed |
| End-of-trial active relay folder | PASS | Empty |

## What this proves

1. Apps Script can accept a bounded synthetic object and write it to the existing Google Drive account.
2. Google Drive can retain the object while the lab PC is unavailable or has not yet verified it.
3. Google Drive for desktop can later expose the object to the lab PC.
4. End-to-end SHA-256 verification works for both 64 KiB and the existing Media Transfer 4 MiB chunk size.
5. Duplicate retry can be idempotent for the same object name/content.
6. A failed or incorrect ACK does not remove the active relay object.
7. A verified ACK can remove the object from the active relay folder.

## What this does NOT prove

The following remain production gates and must not be described as complete:

- exact real-iPad Safari -> this Drive-writing deployment -> lab-PC end-to-end measurement;
- production-grade sender authentication/authorization compatible with the existing encrypted/signed Media Transfer architecture;
- permanent-deletion / retention semantics after ACK;
- retry timing suitable for Google Drive for desktop, because the 4 MiB case exceeded the trial's 30 s receipt window;
- current Apps Script / Drive quotas, terms, privacy/security constraints, and zero-additional-cost suitability for the expected production volume;
- integration of this relay adapter into the existing Phase 3-8 product code;
- real-data activation.

## Next smallest safe step

Do not replace the existing Media Transfer architecture.

Use this trial result only to continue the Research Gate and design the smallest Drive relay adapter that reuses the existing encrypted package, hash verification, receiver persistence, and ACK semantics. Resolve the remaining authentication, deletion/retention, quota, and exact-iPad evidence before production implementation or real-data testing.

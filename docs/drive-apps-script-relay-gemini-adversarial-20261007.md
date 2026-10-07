# Gemini adversarial review — Google Drive + Apps Script relay

Date: 2026-10-07

Role: independent/adversarial architecture review only.

Gemini conversation reference is retained outside this repository.

No patient, clinic, billing, or other real protected data was provided.

## Review conclusion

Gemini did **not** recommend immediate production adoption.

It considered the simplest acceptable sender-side anti-abuse choices to be:

1. a random bearer token provisioned during pairing, with only its SHA-256 verifier stored server-side; or
2. an HMAC upload key provisioned during pairing.

Gemini preferred the bearer-token variant on implementation simplicity grounds. This differs from the current candidate design, which prefers a non-extractable HMAC CryptoKey so the long-lived secret itself is not transmitted on every request.

This disagreement is intentionally preserved. It must be resolved by a bounded synthetic comparison rather than by preference.

## Points that agree with the current candidate

- Do not add ECDSA P-256 verification code/library to Apps Script merely to duplicate the existing sender-signature verification already performed by the lab Gateway.
- Keep relay content encrypted and verify the authoritative existing ECDSA sender signature at the lab PC.
- Use idempotent object naming/state so retry does not create unbounded duplicates.
- Delete only after the lab PC has completed local persistence and hash verification.
- After valid ACK, permanently delete exact Drive objects rather than leave the final production state in normal Drive Trash.
- Drive for desktop synchronization latency is nondeterministic and therefore cannot be treated as a fixed timeout failure.
- Concurrent/repeated requests need an explicit race/idempotency strategy; Apps Script LockService may be relevant for small shared-state transitions.

## Adversarial risks raised

### 1. Public Apps Script URL can still be abused before authentication

Even if HMAC/bearer validation rejects the body, an attacker who knows the public web-app URL may still cause Apps Script executions and consume execution/quota capacity.

Therefore HMAC/Bearer protects **authorized Drive writes**, but it is not a complete DDoS/rate-limiting boundary.

This is the strongest unresolved architectural risk from the review.

### 2. Drive sync latency

A valid object can exist in Drive before Google Drive for desktop exposes a fully readable local file.

This agrees with the synthetic 4 MiB observation. The receiver must retry and verify exact local size/hash rather than use a short fixed deadline.

### 3. Browser-held upload credential

Whether bearer or HMAC, a browser-side credential is exposed to the security of the application origin and device.

A non-extractable Web Crypto key reduces straightforward key export but does not make an XSS-compromised origin harmless: malicious same-origin code could potentially invoke the key for signing while it is available.

Therefore XSS/CSP/dependency minimization and revocation remain part of the security boundary.

### 4. Quota / execution constraints

Gemini highlighted Apps Script execution and quota limits as an availability risk, especially under repeated or malicious requests.

The production decision must use current official quota documentation and measured expected volume; Gemini's quota statements are not treated as primary-source facts by themselves.

## Tests Gemini specifically called for

- sustained/repeated 4 MiB uploads while remaining comfortably below Apps Script execution limits;
- concurrency/race tests for same-job retry;
- explicit idempotency around write and delete;
- crash/failure immediately before and after deletion;
- verification that wrong auth/proof can never delete;
- Drive sync-delay recovery.

## Decision impact

The review is useful because it disagrees on HMAC vs bearer but agrees on the more important boundaries:

- no production adoption yet;
- preserve existing E2E/ECDSA pipeline;
- permanent delete only after verified receipt;
- public Apps Script endpoint availability/DoS is unresolved;
- credential persistence/revocation and concurrency need synthetic testing.

Accordingly the next Research Gate result should remain **TRIAL_REQUIRED**, not ADOPT, until the applicable UNKNOWN items are tested or otherwise resolved.

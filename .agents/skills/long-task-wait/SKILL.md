---
name: long-task-wait
description: Use for local long-running tasks that expose a stable task ID and read-only status function. Replace repeated short-interval status polling with a bounded local wait while preserving fail-closed task identity, timeout recovery, and no-duplicate-start rules.
---

# Long Task Wait

Use this skill when a local runner starts a long-lived task and later exposes read-only state by stable `taskId`.

## Goal

Reduce AI -> tool -> local process round-trips without adding a daemon, service, queue, scheduler, broker, push channel, or arbitrary command executor.

The default monitoring sequence is:

```text
start -> bounded wait -> repeat bounded wait only if still running -> result
```

Do not use short-interval repeated `status` calls for continuous monitoring. Keep `status` for one-shot inspection, troubleshooting, and debugging. If a runner controls its own status output, it should include a hint that continuous monitoring uses bounded wait.

## Bounded wait contract

Import `bounded-task-wait.mjs` from a task runner and pass the runner's existing read-only status function as `readStatus`. The helper itself must never start or restart tasks and must never accept an arbitrary shell command.

A runner CLI may expose:

```text
wait <taskId> --until ready|completed --timeout-ms <N>
```

The helper polls only inside the local process. It returns when the requested meaningful state is observed, when the task fails, or when its self-timeout expires.

Foundation defaults are deliberately below the currently observed Remote Desktop Commander outer call limit:

- default self-timeout: 6000 ms;
- hard maximum self-timeout: 7000 ms;
- default local poll interval: 1000 ms;
- allowed local poll interval: 250-2000 ms.

If the outer tool limit is later measured lower, the caller must choose a correspondingly lower timeout. Do not raise the helper maximum merely to hide an outer timeout.

## Result shape

Bounded wait returns a versioned stable envelope:

```json
{
  "schemaVersion": 1,
  "taskId": "...",
  "state": "RUNNING|READY|COMPLETED|FAILED",
  "timedOut": false,
  "elapsedMs": 0,
  "pidAlive": true,
  "next": "WAIT_AGAIN|RESULT|INVESTIGATE",
  "status": {}
}
```

A self-timeout is not task failure. A still-live task returns `timedOut:true` with `next:"WAIT_AGAIN"`; call bounded wait again against the same task ID. Never restart the long task merely because a tool call or bounded wait timed out.

`READY` may come from an explicit READY state or from the caller's existing `cdpReady:true` evidence. For REAL_DEVICE/CDP, the caller remains responsible for proving readiness from local `127.0.0.1` `/json`, including the target application page (for example `localhost:1420`) and a `webSocketDebuggerUrl`. A listening port alone is not READY.

## Safety invariants

Preserve the runner's existing task ID, PID identity, workspace lock, `ALREADY_RUNNING`, atomic state/receipt writes, and fail-closed state parsing. If a task is not terminal but its validated process identity is gone, report `FAILED`/crashed through the runner's status function; do not silently convert it to timeout or restart it.

If PID reuse is a realistic ambiguity, the runner must bind process identity to existing metadata such as start time before reporting `pidAlive:true`.

State files must continue to use atomic replacement such as temporary-file write followed by rename. The bounded wait helper is read-only and does not own task state persistence.

The helper uses Node built-ins only. Do not add a dependency, external network path, cloud service, external AI transmission, production data access, patient data access, sales data access, elevated privilege, Windows Service, daemon, named pipe, WebSocket, broker, queue, scheduler, or push notification mechanism for this purpose.

## Timeout recovery interaction

This skill complements the existing `operation-preflight` timeout recovery boundary. A tool timeout means inspect/reuse the existing task first. Unknown process state fails closed; an observed running task is polled/reused; completed verification evidence is reused; repeated unchanged retries remain blocked by the existing preflight rules.

## Prior-art / implementation choice

Before extending this mechanism, check whether the active local execution tool already offers timeout-bounded process/output waiting. Prefer that existing capability when it satisfies the same safety boundary. Introduce a runner-level bounded wait only when it materially reduces cross-tool polling calls or provides domain readiness such as CDP READY that the generic process waiter cannot observe.

## Verification

Run:

```text
node .agents/skills/long-task-wait/bounded-task-wait-selftest.mjs
```

Use proportional verification. This helper does not justify application Rust/frontend full suites, repeated REAL_DEVICE runs, GitHub-hosted Actions, or unrelated refactoring by itself.

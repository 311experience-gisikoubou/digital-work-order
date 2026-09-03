---
name: preflight-audit
description: Use before implementation, fixes, refactoring, UI/backend/design changes, security-sensitive work, external-service use, data handling, installation, real-device work, network changes, or multi-step/long-running AI work. Confirm repository/data/AI/network/persistence boundaries, cost, human work burden, non-engineer operation boundaries, lifecycle impact, repeated manual work, progress communication, and whether a genuine human value decision exists. Fail closed on unsafe, unknown, destructive, externally sensitive, unnecessarily complex, improperly delegated, insufficiently communicated, or unreflected repeated-failure paths.
---

# Preflight Audit

## Operating Principle

- Safe read-only work, inspection, testing, auditing, and technical decisions should proceed automatically.
- Confidential-data access, external transmission, destructive/irreversible operations, and `UNKNOWN` real-data paths are stop conditions.
- Technical complexity belongs to the AI workflow. Do not require a non-engineer human to judge Git state, permissions, networking, command output, configuration safety, or implementation details.
- **Technical importance alone is not a human-confirmation reason.** If technical evidence can determine a safe answer inside the approved direction, AI decides and proceeds.
- Human confirmation is only for genuine value/ownership choices: human goals, business policy, recurring cost, responsibility, protected-data policy, or meaningful workflow changes.
- **Simple is Best / simplest-safe:** preserve safety, privacy, data-loss prevention, recovery, auditability, required capability, and the human goal first. Among options meeting that floor, prefer fewer dependencies, services, data routes, configuration points, manual handoffs, recurring steps, and maintenance obligations.
- Do not install/adopt ongoing software or services before lifecycle impact and ownership are clear.
- Repeated manual handoffs, relay work, approvals, or setup are structural automation candidates. Do not solve only the single instance when the pattern is recurring.
- Multi-step or long-running AI work must keep a non-engineer user oriented on current stage, meaning, next step, and whether user action is needed; do not make the user infer progress from technical logs.
- Important rules must be classified as `DECLARATION_ONLY`, `OPERATIONAL`, or `TECHNICAL_ENFORCEMENT_REQUIRED`. Do not claim enforcement that does not exist.

## Execution / Evidence Location

Before repository checks, identify where the proposed or audited change actually exists.

- **Local-workspace path:** if implementation/testing will use a local checkout, inspect that checkout's root, branch/HEAD, upstream, working tree, untracked files, stash, local/origin relationship, and relevant local-only risks.
- **Remote-only path:** if work will be created directly on a remote feature branch and no local checkout participates, use machine-readable remote evidence for branch/base/head/merge-base/diff/scope and exact-head file contents. Do not require an unrelated local working tree or stash.
- **Mixed path:** if both local and remote environments participate, inspect both and prove they refer to the same intended head before treating them as one change.
- The evidence path does not weaken safety checks. A property that cannot be proven from the actual execution location or an equivalent independent source is `UNKNOWN`/`NEEDS_CHECK`, not PASS.
- Do not turn missing tool access into non-engineer relay work when another machine-readable route exists.

## Machine Gate

When Node.js and Git are available in the local execution workspace being used for the change, run the dependency-free security gate before semantic checks.

Read-only/source investigation:

```text
node .agents/skills/preflight-audit/security-preflight.mjs --mode audit --data-mode source-only
```

Before implementation/change work:

```text
node .agents/skills/preflight-audit/security-preflight.mjs --mode change --data-mode source-only
```

Before real/confidential-data use:

```text
node .agents/skills/preflight-audit/security-preflight.mjs --mode audit --data-mode real
```

- `PROCEED`: continue automatically.
- `NEEDS_CHECK`: AI resolves using local metadata/code/settings without exposing protected data.
- `STOP`: stop the affected path; do not bypass the gate to continue.
- Machine-gate output uses counts and generic safe metadata. It must not print matched contents or raw filenames/paths because filenames and directory names can themselves contain patient, clinic, customer, or other protected identifiers.
- If raw-path inspection is needed to resolve a finding, keep it local-only and do not send the raw path to an external AI.
- For a genuinely remote-only source change, absence of a local machine-gate run is not itself a reason to involve the human. Perform the equivalent remote repository/data/external-boundary checks below and mark any property that cannot be equivalently proven as unavailable/`UNKNOWN`.

Machine-gate self-test:

```text
node .agents/skills/preflight-audit/security-preflight-selftest.mjs .agents/skills/preflight-audit/security-preflight.mjs
```

## Interactive / AI Work Operation Gate

Before asking a human to perform real-device, network, production, installation, service-adoption, or other interactive setup, run `operation-preflight.mjs`.

Also run `operation-preflight.mjs` for AI-owned work classified as `multi-step` or `long-running`, including implementation, testing, audit, and recovery work. At task start, at a material phase change, when the user's required action changes, and before retrying a failed same-class approach, send any required user-visible progress update first and then run the gate for that checkpoint. If no human operation is required, use `--estimated-user-minutes 0` and `--estimated-user-steps 0`; do not invent human work merely to satisfy the gate.

Required planning inputs:

- full contiguous human operation time and manual-step estimate;
- alternatives reviewed;
- whether the proposed path is the simplest safe path;
- work impact and safe stopping point;
- human profile/role and technical-judgment owner;
- instruction mode;
- `change-class`;
- `lifecycle-impact yes|no`;
- whether a repeated manual pattern exists;
- `ai-work-structure` as `single-step`, `multi-step`, or `long-running`;
- `progress-update-event` as `none`, `task-start`, `phase-change`, or `user-action-change`;
- `same-class-failure-count` as the number of failed **resolution interventions** already observed in the same-loop candidate before the proposed next action. Read-only investigation, log inspection, comparison, and observation do not increment this count merely because they fail to prove the hypothesis;
- `post-failure-action` as `not-applicable`, `retry-same`, `retry-materially-changed`, `root-cause-analysis`, `hypothesis-reselection`, `route-reselection`, `independent-review`, or `stop`;
- when `post-failure-action=retry-materially-changed`, `material-change-reviewed yes|no`;
- after two same-class resolution-intervention failures, a third resolution intervention also requires `forced-reflection-reviewed yes`, `reflection-recorded yes`, and `reflection-basis` as `new-observation`, `new-hypothesis`, `new-route`, `materially-changed-condition`, or `insufficient-observation`.

### Progress communication boundary

For `single-step`, `--progress-update-event none` is allowed when no progress update is needed.

For `multi-step` or `long-running`, `progress-update-event=none` is a fail-closed `STOP`. At each applicable checkpoint, the user-visible update must already have been sent and must contain all four items:

- current stage;
- why the current stage matters / its meaning;
- what happens next;
- whether user action is required, explicitly stating `none`/不要 when no action is needed.

The gate requires:

- `--progress-update-sent yes`
- `--progress-current-stage-present yes`
- `--progress-meaning-present yes`
- `--progress-next-step-present yes`
- `--progress-user-action-status-present yes`

Do not substitute speculative future completion-time promises for progress visibility. When exact duration cannot be guaranteed, communicate the work scale and current phase, such as a short check, multi-stage audit, or final verification phase.

For a non-engineer human:

- `--human-profile non-engineer`
- `--human-role operator`, `observer`, or `value-decider`; never `technical-decider`
- `--technical-judgment-owner ai-workflow`, `system`, or a verified `provider`; never `user` or `unknown`
- `--instruction-mode stepwise-ui` by default; use `stepwise-command` only when genuinely necessary and the AI will interpret the output

`stepwise-ui` names the visible screen/button/field and exact action. `stepwise-command` explains how to open the command interface, gives one exact command, and leaves diagnosis to the AI.

### Change-class boundary

Use exactly one `--change-class`:

AI-decided technical classes:

- `routine`
- `configuration`
- `implementation`
- `architecture`
- `install-adoption` when technical evidence shows the adoption is within an already approved direction, has no separate unresolved cost/data/workflow/responsibility choice, and lifecycle ownership is safely managed

Human value/ownership classes:

- `external-data-route`
- `recurring-cost`
- `lifecycle-responsibility`
- `workflow-impact`
- `business-policy`

Classify by the **highest relevant human-impact dimension**, not merely technical shape. A network implementation that changes where protected data travels is `external-data-route`, not `architecture`. An installation that introduces recurring cost is `recurring-cost`; one that changes daily work is `workflow-impact`; one that changes maintenance responsibility is `lifecycle-responsibility`.

For AI-decided technical classes, no human decision is required. If `--human-decision pending` is supplied, the gate stops with `UNNECESSARY_HUMAN_CONFIRMATION`.

For human value/ownership classes:

1. AI resolves technical facts and safety first.
2. AI compares viable options and gives a recommendation with reasons.
3. AI explains practical effects, benefits, downsides, risks, relevant cost, and relevant maintenance burden without assuming engineering knowledge.
4. `--nonengineer-explanation-ready yes` is required.
5. `--human-decision approved` is required before proceeding.

Do not request unrelated information merely because a human decision exists. For example, a `business-policy` decision with no lifecycle impact does not require maintenance-owner fields.

### Lifecycle impact and ownership

Always classify `--lifecycle-impact yes|no`.

Use `yes` when the step creates or changes ongoing software/service/configuration ownership, update requirements, recovery/troubleshooting responsibility, or safe removal/replacement responsibility. `install-adoption` and `lifecycle-responsibility` require `yes`.

When lifecycle impact is `yes`, establish:

- routine maintenance/update owner;
- recovery/troubleshooting owner;
- safe removal/replacement owner;
- expected recurring user maintenance time.

Allowed owners: `system`, `ai-workflow`, `provider`, `user`, `none`, `unknown`.

`user` or `unknown` causes `STOP` when it would make the non-engineer user the technical maintainer. `ai-workflow` is valid only when a real execution path exists; do not use it as a promise of background management. Do not impose an arbitrary universal minute threshold as a substitute for ownership analysis; the actual burden is evidence for simplest-safe and human-impact review.

### Repeated manual pattern

Always classify `--repeated-manual-pattern yes|no`.

If `yes`, the gate requires `--structural-automation-reviewed yes`. This means the AI considered the broader class of similar handoffs/work rather than only the current instance. The review may conclude safe automation is not currently possible, but that conclusion must be technically justified and safety may not be weakened merely to automate.

### Anti-loop / Forced Reflection

Always provide `--same-class-failure-count` and `--post-failure-action`; omission is fail-closed. This section is the executable semantic source in synchronized application repositories. `learnings/L-0004.md` remains the foundation-side rationale/history record and is not a runtime dependency of application repositories.

The threshold is a deliberate **forced-reflection breakpoint**, not a claim that two failures are statistically optimal.

- Count failed **resolution interventions**, not ordinary observation. Reading logs/code/settings, read-only diagnosis, comparison, reproduction for cause isolation, and independent review do not increment the count merely because they do not solve the problem.
- Treat attempts as the same-loop candidate when the cause hypothesis, solution route/principle, or repeated human operation is substantially the same. Command spelling, AI/session, minor flags, or cosmetic path changes do not reset the loop.
- No prior failed resolution intervention: `--same-class-failure-count 0 --post-failure-action not-applicable`.
- After one failed resolution intervention, a second same-method attempt is allowed if otherwise safe: `--same-class-failure-count 1 --post-failure-action retry-same`.
- After two failed resolution interventions, normal retry mode ends. `--post-failure-action retry-same` is a mandatory `STOP` with `LOOP_DETECTED_THIRD_SAME_METHOD_BLOCKED`.
- The reflection phase itself may proceed as `root-cause-analysis`, `hypothesis-reselection`, `route-reselection`, `independent-review`, or `stop`; these are not a third resolution attempt.
- Before any third resolution intervention, first externalize the forced reflection using an existing task-visible evidence channel (current progress report, PR/[AI_HANDOFF] record, or equivalent existing work record). Do not create a new long-lived source file only for this purpose.
- That reflection must state: the two failed interventions and observed results; the current hypothesis status (`否定` / `弱まった` / `未確定`); the new basis (`新しい観測` / `新しい仮説` / `別経路` / `実質的な条件変更`); and the next action.
- A third resolution intervention is represented as `retry-materially-changed` and requires `--material-change-reviewed yes --forced-reflection-reviewed yes --reflection-recorded yes` plus a valid `--reflection-basis`.
- `reflection-basis=insufficient-observation` means the third intervention is not authorized; the gate returns `OBSERVATION_INSUFFICIENT_RETURN_TO_INVESTIGATION` so work returns to observation/root-cause analysis.
- A valid reflection does **not** erase the previous two failures. It only allows one half-open-style attempt under a substantively changed basis. If that attempt fails, do not continue with the same basis; return to observation/reflection again.
- Never use forced reflection as a reason to dump technical judgment onto a non-engineer. Technical escalation order remains observation → root-cause analysis → hypothesis reselection → route reselection → independent review. Human involvement is for genuine value/ownership or real-device subjective decisions, not as a technical escape hatch.

### Stateful Stagnation / Safe Continuation

For multi-step or long-running work, use `stagnation-watch.mjs` as the stateful companion to the failure-count Forced Reflection gate. It prevents an unchanged blocker from remaining in ordinary retry/report mode merely because no one incremented `--same-class-failure-count`, and it prevents a status question from becoming a report-only terminal event when safe work is still incomplete.

Run it at task start and again at meaningful checkpoints, including before answering a status check such as “進んだ？” / “どうなった？” when the work remains incomplete. A periodic monitor may also call it. The default interval is 60 minutes, but the enforcement logic is independent of the scheduler: if several intervals elapsed without a checkpoint, the next invocation accumulates the missed unchanged checkpoints and escalates immediately.

Local checkout state is stored by default under `.git/ai-dev-foundation/stagnation/<work-id>.json`, so chat/session wording changes do not reset it. Remote-only callers can pass the previous `nextState` with `--state-json` and persist the returned `nextState` in an existing task-visible evidence channel such as the tracked Issue/PR state; do not create a separate long-lived business source merely for this runtime state.

The default `--fingerprint-scope product` fingerprints the branch plus the committed product tree and uncommitted product changes while excluding governance-only paths (`.agents/`, `.claude/`, `.github/`, `AGENTS*.md`, `CURRENT_STATUS.md`). A governance-only HEAD change does not count as product progress. Use `--fingerprint-scope all` when the work itself is foundation/governance work. Add stable `--failure-signature`, `--blocker-signature`, `--observation-signature`, and `--route-signature` values when available. A genuinely new observation or route changes the fingerprint; cosmetic wording changes do not.

Escalation is fail-closed:

- first due unchanged checkpoint: `STAGNATION_L1_ROOT_CAUSE_REQUIRED` → ordinary retry/report mode stops; return to root-cause analysis;
- second due unchanged checkpoint: `STAGNATION_L2_FORCED_REFLECTION_REQUIRED` → Forced Reflection is mandatory;
- third or later unchanged checkpoint: `STAGNATION_HARD_STOP_ROUTE_CHANGE_REQUIRED` → the same route remains blocked until a new observation/hypothesis/route/material condition changes the fingerprint;
- `workflow-status=in-progress` does not accumulate stagnation;
- a valid human gate with `--continuation-action wait-human` pauses the checkpoint clock;
- `work-state=incomplete --human-gate none --continuation-action report-only` stops with `SAFE_WORK_CONTINUATION_REQUIRED`;
- `work-state=incomplete --human-gate none --continuation-action wait-human` stops with `UNNECESSARY_HUMAN_WAIT`;
- genuine merge/production/destructive/value/ownership gates still use `human-gate=required` and may wait.

Example:

```text
node .agents/skills/preflight-audit/stagnation-watch.mjs --target-root . --work-id issue-270 --gate-phase test-gate --work-state incomplete --human-gate none --continuation-action resume --workflow-status failed --pr-state none --failure-signature migration_0001_checksum_is_unchanged --route-signature ui6c-one-shot --interval-minutes 60
```

This gate intentionally does **not** install an always-on hourly GitHub Actions workflow in every repository. A permanent per-repository schedule would add recurring runner usage and maintenance. Existing AI/tool scheduling may invoke this gate when appropriate, while missed intervals are still enforced at the next checkpoint.

Stagnation self-test:

```text
node .agents/skills/preflight-audit/stagnation-watch-selftest.mjs .agents/skills/preflight-audit/stagnation-watch.mjs
```

### Example: routine technical operation

```text
node .agents/skills/preflight-audit/operation-preflight.mjs --scope network --estimated-user-minutes 5 --estimated-user-steps 3 --alternatives-reviewed yes --simplest-safe yes --work-impact low --safe-stop yes --scheduled-window no --human-profile non-engineer --human-role operator --technical-judgment-owner ai-workflow --instruction-mode stepwise-ui --change-class routine --lifecycle-impact no --repeated-manual-pattern no --same-class-failure-count 0 --post-failure-action not-applicable --ai-work-structure single-step --progress-update-event none
```

### Example: third resolution attempt after forced reflection

```text
node .agents/skills/preflight-audit/operation-preflight.mjs --scope interactive --estimated-user-minutes 0 --estimated-user-steps 0 --alternatives-reviewed yes --simplest-safe yes --work-impact none --safe-stop yes --scheduled-window no --human-profile non-engineer --human-role observer --technical-judgment-owner ai-workflow --instruction-mode stepwise-ui --change-class implementation --lifecycle-impact no --repeated-manual-pattern no --same-class-failure-count 2 --post-failure-action retry-materially-changed --material-change-reviewed yes --forced-reflection-reviewed yes --reflection-recorded yes --reflection-basis new-observation --ai-work-structure multi-step --progress-update-event phase-change --progress-update-sent yes --progress-current-stage-present yes --progress-meaning-present yes --progress-next-step-present yes --progress-user-action-status-present yes
```

### Example: multi-step AI work with no human operation

```text
node .agents/skills/preflight-audit/operation-preflight.mjs --scope interactive --estimated-user-minutes 0 --estimated-user-steps 0 --alternatives-reviewed yes --simplest-safe yes --work-impact none --safe-stop yes --scheduled-window no --human-profile non-engineer --human-role observer --technical-judgment-owner ai-workflow --instruction-mode stepwise-ui --change-class implementation --lifecycle-impact no --repeated-manual-pattern no --same-class-failure-count 0 --post-failure-action not-applicable --ai-work-structure multi-step --progress-update-event task-start --progress-update-sent yes --progress-current-stage-present yes --progress-meaning-present yes --progress-next-step-present yes --progress-user-action-status-present yes
```

### Example: fully managed software/service adoption

```text
node .agents/skills/preflight-audit/operation-preflight.mjs --scope real-device --estimated-user-minutes 5 --estimated-user-steps 3 --alternatives-reviewed yes --simplest-safe yes --work-impact low --safe-stop yes --scheduled-window no --human-profile non-engineer --human-role operator --technical-judgment-owner ai-workflow --instruction-mode stepwise-ui --change-class install-adoption --lifecycle-impact yes --maintenance-plan-reviewed yes --maintenance-owner system --recovery-owner ai-workflow --removal-owner ai-workflow --estimated-user-maintenance-minutes-month 0 --repeated-manual-pattern no --same-class-failure-count 0 --post-failure-action not-applicable --ai-work-structure single-step --progress-update-event none
```

Use `--scheduled-window yes` only for work deliberately scheduled into a work window.

The operation gate fails closed when required inputs are absent or when, among other cases:

- alternatives were not reviewed;
- the chosen path is not the simplest safe option;
- there is no safe stopping point;
- estimated human operation exceeds 10 minutes without a scheduled window;
- estimated manual steps exceed 8 without a scheduled window;
- work impact is medium/high without a scheduled window;
- technical judgment is delegated to a non-engineer;
- expert instructions are proposed for a non-engineer;
- a genuine human value/ownership choice lacks explanation or approval;
- lifecycle impact exists but ownership is missing/unknown or makes the user the technical maintainer;
- install/adoption or lifecycle-responsibility change bypasses lifecycle review;
- a repeated manual pattern has not received structural automation review;
- same-class failure count or post-failure action is missing/invalid;
- two failed resolution interventions already occurred and the proposed next action is the same method again;
- a third resolution intervention is proposed without forced reflection and an externalized reflection record;
- the forced reflection says observation is insufficient but a retry is still proposed;
- a materially changed retry is claimed without reviewing that the change is actually material;
- multi-step/long-running work has no applicable progress update event;
- a required progress update was not actually sent;
- current stage, meaning, next step, or user-action status is missing from the required update;
- routine technical work is needlessly waiting on human confirmation.

Do not split a known long operation into artificial small steps to bypass the gate. Do not describe an installation as simple while ignoring future upkeep. Do not hide a human value choice inside a technical label, and do not turn a technical decision into a human question merely because asking is easier than investigating. Do not classify multi-stage work as `single-step` merely to bypass progress communication. Do not reset, relabel, or cosmetically alter the same-loop candidate merely to bypass forced reflection.

Operation-gate self-test:

```text
node .agents/skills/preflight-audit/operation-preflight-selftest.mjs .agents/skills/preflight-audit/operation-preflight.mjs
```

## Historical Git Audit

For protected/data-like file history, use the content-safe audit. It internally enumerates object paths and sizes but output is restricted to counts and safe aggregate metadata; raw historical filenames/paths and blob contents must not be printed.

Private repository:

```text
node .agents/skills/preflight-audit/security-history-audit.mjs --visibility private
```

Public repository:

```text
node .agents/skills/preflight-audit/security-history-audit.mjs --visibility public
```

- Historical database/backup/capture/credential-like paths are high-risk. In a public repo they are `STOP` until investigated safely.
- Historical CSV/spreadsheet/PDF/image/data-like paths are `NEEDS_CHECK`.
- Historical HTML >=512 KiB is `NEEDS_CHECK`, not proof of leakage.
- Deleted files remain detectable through reachable Git objects/refs.
- Do not open flagged historical content or send raw historical paths to an external AI merely to decide sensitivity.

History-audit self-test:

```text
node .agents/skills/preflight-audit/security-history-audit-selftest.mjs .agents/skills/preflight-audit/security-history-audit.mjs
```

## Required Semantic Checks

### Repository / change safety

Use evidence that belongs to the actual execution path.

- For local-workspace work: check repository root, branch, HEAD/upstream, local and origin main as relevant, working tree/untracked/stash, visibility, `.gitignore`, relevant design/code/tests, expected changed files, migrations, forbidden areas, and specification conflicts.
- For remote-only work: check remote feature branch/base/head SHA, merge-base, canonical compare/PR diff, changed files, visibility, relevant design/code/tests at the exact head, migrations, forbidden areas, and specification conflicts. Local working-tree/stash state is not relevant unless that local checkout participated.
- For mixed work: perform both and prove head alignment.

### Confidential-data boundary

Determine whether work can reach patient/person identifiers, clinic/customer data, orders/work contents, instructions/images/PDFs/exports/production DBs, prices/unit prices/invoices/sales/profit, credentials/tokens/session data, backups/logs/reports/cache/TEMP.

Do not inspect confidential content merely to prove safety. Prefer safe metadata such as counts, extensions, hashes, ACLs, and process/network information. Treat filenames and directory paths as potentially confidential metadata; do not send raw names/paths to an external AI unless they are already confirmed non-sensitive source-code paths required for the development task.

### AI / tool access boundary

Check whether ChatGPT, Codex, Claude/Claude Code, Gemini, local AI, IDE extensions, MCP, plugins, connectors, or agents can technically access protected locations. “The AI will not read it” is not proof. If access is possible and not safely isolated, real-data use is `UNKNOWN` or `STOP`.

### External communication boundary

Check external AI/cloud/GitHub/APIs, telemetry/analytics, update checks, RSS/fetches, package lifecycle scripts, MCP/plugin/connector communication, sync/transfer apps, and unknown destinations. If protected data could reach an external destination and safety is not proven, stop real-data use.

### Local-network boundary

Check bind/listen address, port, authentication, permissions, firewall profile/scope, SMB/share ACLs, and which LAN devices can reach the service. `LAN only` does not automatically mean safe.

### Persistence boundary

Check logs, reports, TEMP/cache, packet captures, state/session/pairing files, exports, backups, and browser storage/cache.

### Human / instruction boundary

Check whether the non-engineer human is being asked to infer safety, diagnose output, choose a protocol, compare technical identifiers, remember hidden configuration, or make a technical decision the AI can resolve. Also check the inverse: whether a genuine human value/ownership choice is being hidden inside a technical decision.

### Lifecycle / maintenance boundary

When lifecycle impact exists, check update, recovery, removal/replacement ownership, recurring user maintenance, where configuration knowledge lives, and whether the claimed AI/system/provider maintainer can actually perform the role.

## Classification

Every relevant safety item must be one of:

- `SAFE_CONFIRMED`
- `NEEDS_CHECK`
- `NEEDS_FIX`
- `UNKNOWN`

Do not say “probably safe”.

## Stop Conditions

Stop when the machine/operation gate says `STOP`, safety is `UNKNOWN` for a real-data path, confidential data may reach an external/unknown destination, destructive or production-impacting work lacks authorization, the relevant execution workspace/scope is unsafe or unclear, an unexpected diff/spec conflict exists, extra cost may occur without authorization, the non-engineer is made technical maintainer/technical decider, a genuine human value choice is unapproved, lifecycle ownership is unresolved where lifecycle impact exists, a repeated manual pattern is being handled only as another one-off workaround, `LOOP_DETECTED_THIRD_SAME_METHOD_BLOCKED` is raised after two failed resolution interventions, a third resolution intervention lacks the required forced-reflection evidence, or required progress communication for multi-step/long-running AI work is missing.

## Automatic Proceed Rule

If all applicable checks are `SAFE_CONFIRMED`, the next step is non-destructive and within approved scope, and no genuine human value/ownership choice remains unresolved, proceed automatically. Do not ask for technical confirmation merely because the work is complex.

For interactive/real-device/network/production/installation/service-adoption work, the operation gate must also be `PROCEED` before asking the human to start. For `multi-step` or `long-running` AI work, the operation gate must be `PROCEED` at task start and at each applicable phase/user-action checkpoint before continuing that phase.

## Output

Report plainly:

- 使用スキル
- `PROCEED` / `STOP` / `UNKNOWN`
- execution/evidence source(s): local / remote-only / mixed
- overall project progress when relevant
- estimated human operation time and manual-step load
- work impact and safe stopping point
- human profile/role, technical-judgment owner, instruction mode
- change class and whether a genuine human decision exists
- lifecycle-impact / lifecycle-ownership status when relevant
- repeated-manual-pattern / structural-automation-review status
- same-class failure count / post-failure action / material-change review status when relevant
- forced-reflection reviewed / reflection-recorded / reflection-basis status when a third resolution intervention is considered
- AI work structure / progress-update event and whether required progress communication is complete
- what proceeds automatically
- what is stopped and why
- current state / expected change scope
- data/external/network findings and risks
- enforcement status for newly established rules
- any genuine human decision that remains

Do not convert technical uncertainty into human homework. If undeterminable, report `UNKNOWN` and stop the affected real-data path.

## Application-Specific Configuration

These checks do not change by application stack. Repository-specific forbidden areas, business Source of Truth, protected data, file layout, and real-device conditions come from that repository's `AGENTS.local.md`.
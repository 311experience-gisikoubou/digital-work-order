#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

const gateArg = process.argv[2];
if (!gateArg) throw new Error('gate path required');
const gate = resolve(gateArg);

function run(extra) {
  return spawnSync(process.execPath, [gate, '--json', ...extra], { encoding: 'utf8' });
}
function expectStop(extra, code) {
  const r = run(extra);
  if (r.status === 0) throw new Error(`expected STOP for ${code}`);
  if (!r.stdout.includes(code)) throw new Error(`missing ${code}: ${r.stdout}`);
}
function expectProceed(extra) {
  const r = run(extra);
  if (r.status !== 0 || !r.stdout.includes('PROCEED')) {
    throw new Error(`expected PROCEED: ${r.stdout} ${r.stderr}`);
  }
}

const nonEngineerSafe = [
  '--human-profile', 'non-engineer',
  '--human-role', 'operator',
  '--technical-judgment-owner', 'ai-workflow',
  '--instruction-mode', 'stepwise-ui',
];

const progressSingle = [
  '--ai-work-structure', 'single-step',
  '--progress-update-event', 'none',
];

const progressTaskStart = [
  '--ai-work-structure', 'multi-step',
  '--progress-update-event', 'task-start',
  '--progress-update-sent', 'yes',
  '--progress-current-stage-present', 'yes',
  '--progress-meaning-present', 'yes',
  '--progress-next-step-present', 'yes',
  '--progress-user-action-status-present', 'yes',
];

const routineBase = [
  '--scope', 'network',
  '--estimated-user-minutes', '5',
  '--estimated-user-steps', '3',
  '--alternatives-reviewed', 'yes',
  '--simplest-safe', 'yes',
  '--work-impact', 'low',
  '--safe-stop', 'yes',
  '--scheduled-window', 'no',
  '--change-class', 'routine',
  '--lifecycle-impact', 'no',
  '--repeated-manual-pattern', 'no',
  '--same-class-failure-count', '0',
  '--post-failure-action', 'not-applicable',
  ...nonEngineerSafe,
  ...progressSingle,
];

const lifecycleSafe = [
  '--lifecycle-impact', 'yes',
  '--maintenance-plan-reviewed', 'yes',
  '--maintenance-owner', 'system',
  '--recovery-owner', 'ai-workflow',
  '--removal-owner', 'ai-workflow',
  '--estimated-user-maintenance-minutes-month', '0',
];

expectStop([
  '--scope', 'network',
], 'USER_TIME_ESTIMATE_REQUIRED');

expectStop([
  ...routineBase.filter((v, i, a) => !(v === '--ai-work-structure' || a[i - 1] === '--ai-work-structure')),
], 'AI_WORK_STRUCTURE_REQUIRED');

expectStop([
  ...routineBase.filter((v, i, a) => !(v === '--same-class-failure-count' || a[i - 1] === '--same-class-failure-count')),
], 'SAME_CLASS_FAILURE_COUNT_REQUIRED');

expectStop([
  ...routineBase.filter((v, i, a) => !(v === '--post-failure-action' || a[i - 1] === '--post-failure-action')),
], 'POST_FAILURE_ACTION_REQUIRED');

expectStop([
  ...routineBase,
  '--same-class-failure-count', '1',
  '--post-failure-action', 'not-applicable',
], 'POST_FAILURE_ACTION_REQUIRED_AFTER_FAILURE');

expectProceed([
  ...routineBase,
  '--same-class-failure-count', '1',
  '--post-failure-action', 'retry-same',
]);

expectStop([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'retry-same',
], 'LOOP_DETECTED_THIRD_SAME_METHOD_BLOCKED');

expectStop([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'retry-materially-changed',
], 'MATERIAL_CHANGE_REVIEW_STATUS_REQUIRED');

expectProceed([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'retry-materially-changed',
  '--material-change-reviewed', 'yes',
]);

expectProceed([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'root-cause-analysis',
]);

expectProceed([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'route-reselection',
]);

expectProceed([
  ...routineBase,
  '--same-class-failure-count', '2',
  '--post-failure-action', 'independent-review',
]);

expectStop([
  ...routineBase,
  '--alternatives-reviewed', 'no',
], 'ALTERNATIVES_NOT_REVIEWED');

expectStop([
  ...routineBase,
  '--simplest-safe', 'no',
], 'CHOSEN_PATH_NOT_SIMPLEST_SAFE');

expectStop([
  ...routineBase,
  '--human-role', 'technical-decider',
], 'NON_ENGINEER_ASSIGNED_TECHNICAL_DECISION');

expectStop([
  ...routineBase,
  '--technical-judgment-owner', 'user',
], 'TECHNICAL_JUDGMENT_DELEGATED_TO_NON_ENGINEER');

expectStop([
  ...routineBase,
  '--instruction-mode', 'expert',
], 'EXPERT_INSTRUCTIONS_FOR_NON_ENGINEER');

expectStop([
  ...routineBase,
  '--human-decision', 'pending',
], 'UNNECESSARY_HUMAN_CONFIRMATION');

expectProceed([
  ...routineBase,
]);

expectProceed([
  ...routineBase,
  '--change-class', 'architecture',
]);

expectStop([
  ...routineBase,
  '--ai-work-structure', 'multi-step',
  '--progress-update-event', 'none',
], 'PROGRESS_UPDATE_REQUIRED_FOR_COMPLEX_WORK');

expectStop([
  ...routineBase,
  '--ai-work-structure', 'multi-step',
  '--progress-update-event', 'task-start',
  '--progress-update-sent', 'no',
  '--progress-current-stage-present', 'yes',
  '--progress-meaning-present', 'yes',
  '--progress-next-step-present', 'yes',
  '--progress-user-action-status-present', 'yes',
], 'PROGRESS_UPDATE_NOT_SENT');

expectStop([
  ...routineBase,
  '--ai-work-structure', 'multi-step',
  '--progress-update-event', 'task-start',
  '--progress-update-sent', 'yes',
  '--progress-current-stage-present', 'yes',
  '--progress-meaning-present', 'no',
  '--progress-next-step-present', 'yes',
  '--progress-user-action-status-present', 'yes',
], 'PROGRESS_MEANING_REQUIRED');

expectProceed([
  ...routineBase,
  ...progressTaskStart,
]);

expectProceed([
  ...routineBase,
  '--ai-work-structure', 'long-running',
  '--progress-update-event', 'phase-change',
  '--progress-update-sent', 'yes',
  '--progress-current-stage-present', 'yes',
  '--progress-meaning-present', 'yes',
  '--progress-next-step-present', 'yes',
  '--progress-user-action-status-present', 'yes',
]);

expectStop([
  ...routineBase,
  '--ai-work-structure', 'long-running',
  '--progress-update-event', 'user-action-change',
  '--progress-update-sent', 'yes',
  '--progress-current-stage-present', 'yes',
  '--progress-meaning-present', 'yes',
  '--progress-next-step-present', 'yes',
  '--progress-user-action-status-present', 'no',
], 'PROGRESS_USER_ACTION_STATUS_REQUIRED');

expectStop([
  ...routineBase,
  '--change-class', 'install-adoption',
], 'INSTALL_ADOPTION_REQUIRES_LIFECYCLE_REVIEW');

expectProceed([
  ...routineBase,
  '--scope', 'real-device',
  '--change-class', 'install-adoption',
  ...lifecycleSafe,
]);

expectStop([
  ...routineBase,
  '--scope', 'real-device',
  '--change-class', 'install-adoption',
  ...lifecycleSafe,
  '--maintenance-owner', 'user',
], 'USER_BECOMES_TECHNICAL_MAINTAINER');

expectStop([
  ...routineBase,
  '--change-class', 'external-data-route',
  '--human-decision', 'pending',
  '--nonengineer-explanation-ready', 'yes',
], 'IMPORTANT_CHOICE_HUMAN_APPROVAL_REQUIRED');

expectStop([
  ...routineBase,
  '--change-class', 'external-data-route',
  '--human-decision', 'approved',
  '--nonengineer-explanation-ready', 'no',
], 'IMPORTANT_CHOICE_EXPLANATION_REQUIRED');

expectProceed([
  ...routineBase,
  '--change-class', 'business-policy',
  '--human-role', 'value-decider',
  '--human-decision', 'approved',
  '--nonengineer-explanation-ready', 'yes',
]);

expectStop([
  ...routineBase,
  '--change-class', 'lifecycle-responsibility',
  '--human-role', 'value-decider',
  '--human-decision', 'approved',
  '--nonengineer-explanation-ready', 'yes',
], 'LIFECYCLE_RESPONSIBILITY_REQUIRES_LIFECYCLE_REVIEW');

expectProceed([
  ...routineBase,
  '--change-class', 'lifecycle-responsibility',
  '--human-role', 'value-decider',
  '--human-decision', 'approved',
  '--nonengineer-explanation-ready', 'yes',
  ...lifecycleSafe,
]);

expectStop([
  ...routineBase,
  '--repeated-manual-pattern', 'yes',
  '--structural-automation-reviewed', 'no',
], 'REPEATED_MANUAL_PATTERN_NOT_GENERALIZED');

expectProceed([
  ...routineBase,
  '--repeated-manual-pattern', 'yes',
  '--structural-automation-reviewed', 'yes',
]);

expectStop([
  ...routineBase,
  '--estimated-user-minutes', '30',
  '--scheduled-window', 'no',
], 'LONG_USER_OPERATION_NOT_SCHEDULED');

expectProceed([
  ...routineBase,
  '--estimated-user-minutes', '30',
  '--estimated-user-steps', '12',
  '--work-impact', 'medium',
  '--scheduled-window', 'yes',
]);

console.log('operation-preflight selftest: PASS');
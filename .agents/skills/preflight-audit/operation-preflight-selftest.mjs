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
  ...nonEngineerSafe,
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

#!/usr/bin/env node
import process from 'node:process';

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const i = args.lastIndexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const scope = argValue('--scope');
const minutesRaw = argValue('--estimated-user-minutes');
const stepsRaw = argValue('--estimated-user-steps');
const alternativesReviewed = argValue('--alternatives-reviewed').toLowerCase();
const simplestSafe = argValue('--simplest-safe').toLowerCase();
const workImpact = argValue('--work-impact').toLowerCase();
const safeStop = argValue('--safe-stop').toLowerCase();
const scheduledWindow = argValue('--scheduled-window', 'no').toLowerCase();
const maintenancePlanReviewed = argValue('--maintenance-plan-reviewed').toLowerCase();
const maintenanceOwner = argValue('--maintenance-owner').toLowerCase();
const recoveryOwner = argValue('--recovery-owner').toLowerCase();
const removalOwner = argValue('--removal-owner').toLowerCase();
const recurringMinutesRaw = argValue('--estimated-user-maintenance-minutes-month');
const lifecycleImpact = argValue('--lifecycle-impact').toLowerCase();
const humanProfile = argValue('--human-profile').toLowerCase();
const humanRole = argValue('--human-role').toLowerCase();
const technicalJudgmentOwner = argValue('--technical-judgment-owner').toLowerCase();
const instructionMode = argValue('--instruction-mode').toLowerCase();
const changeClass = argValue('--change-class').toLowerCase();
const humanDecision = argValue('--human-decision').toLowerCase();
const nonEngineerExplanationReady = argValue('--nonengineer-explanation-ready').toLowerCase();
const repeatedManualPattern = argValue('--repeated-manual-pattern').toLowerCase();
const structuralAutomationReviewed = argValue('--structural-automation-reviewed').toLowerCase();
const aiWorkStructure = argValue('--ai-work-structure').toLowerCase();
const progressUpdateEvent = argValue('--progress-update-event').toLowerCase();
const progressUpdateSent = argValue('--progress-update-sent').toLowerCase();
const progressCurrentStagePresent = argValue('--progress-current-stage-present').toLowerCase();
const progressMeaningPresent = argValue('--progress-meaning-present').toLowerCase();
const progressNextStepPresent = argValue('--progress-next-step-present').toLowerCase();
const progressUserActionStatusPresent = argValue('--progress-user-action-status-present').toLowerCase();
const jsonOnly = args.includes('--json');

const findings = [];
function add(status, code, detail = {}) { findings.push({ status, code, ...detail }); }

const allowedScopes = new Set(['interactive', 'real-device', 'network', 'production']);
const allowedImpacts = new Set(['none', 'low', 'medium', 'high']);
const yesNo = new Set(['yes', 'no']);
const allowedOwners = new Set(['system', 'ai-workflow', 'provider', 'user', 'none', 'unknown']);
const allowedHumanProfiles = new Set(['non-engineer', 'engineer']);
const allowedHumanRoles = new Set(['operator', 'observer', 'value-decider', 'technical-decider']);
const allowedTechnicalJudgmentOwners = new Set(['ai-workflow', 'system', 'provider', 'user', 'unknown']);
const allowedInstructionModes = new Set(['stepwise-ui', 'stepwise-command', 'expert']);
const allowedHumanDecisions = new Set(['approved', 'pending']);
const allowedAiWorkStructures = new Set(['single-step', 'multi-step', 'long-running']);
const allowedProgressEvents = new Set(['none', 'task-start', 'phase-change', 'user-action-change']);
const allowedChangeClasses = new Set([
  'routine',
  'configuration',
  'implementation',
  'architecture',
  'install-adoption',
  'external-data-route',
  'recurring-cost',
  'lifecycle-responsibility',
  'workflow-impact',
  'business-policy',
]);
const humanDecisionClasses = new Set([
  'external-data-route',
  'recurring-cost',
  'lifecycle-responsibility',
  'workflow-impact',
  'business-policy',
]);

if (!allowedScopes.has(scope)) add('STOP', 'OPERATION_SCOPE_REQUIRED');

const hasMinutes = minutesRaw.trim() !== '';
const hasSteps = stepsRaw.trim() !== '';
const estimatedUserMinutes = hasMinutes ? Number(minutesRaw) : Number.NaN;
const estimatedUserSteps = hasSteps ? Number(stepsRaw) : Number.NaN;

if (!hasMinutes || !Number.isFinite(estimatedUserMinutes) || estimatedUserMinutes < 0) {
  add('STOP', 'USER_TIME_ESTIMATE_REQUIRED');
}
if (!hasSteps || !Number.isInteger(estimatedUserSteps) || estimatedUserSteps < 0) {
  add('STOP', 'USER_STEP_ESTIMATE_REQUIRED');
}
if (!yesNo.has(alternativesReviewed)) add('STOP', 'ALTERNATIVE_REVIEW_REQUIRED');
if (!yesNo.has(simplestSafe)) add('STOP', 'SIMPLEST_SAFE_ASSESSMENT_REQUIRED');
if (!allowedImpacts.has(workImpact)) add('STOP', 'WORK_IMPACT_REQUIRED');
if (!yesNo.has(safeStop)) add('STOP', 'SAFE_STOP_ASSESSMENT_REQUIRED');
if (!yesNo.has(scheduledWindow)) add('STOP', 'SCHEDULED_WINDOW_VALUE_INVALID');
if (!yesNo.has(lifecycleImpact)) add('STOP', 'LIFECYCLE_IMPACT_STATUS_REQUIRED');
if (!allowedHumanProfiles.has(humanProfile)) add('STOP', 'HUMAN_PROFILE_REQUIRED');
if (!allowedHumanRoles.has(humanRole)) add('STOP', 'HUMAN_ROLE_REQUIRED');
if (!allowedTechnicalJudgmentOwners.has(technicalJudgmentOwner)) add('STOP', 'TECHNICAL_JUDGMENT_OWNER_REQUIRED');
if (!allowedInstructionModes.has(instructionMode)) add('STOP', 'INSTRUCTION_MODE_REQUIRED');
if (!allowedChangeClasses.has(changeClass)) add('STOP', 'CHANGE_CLASS_REQUIRED');
if (!yesNo.has(repeatedManualPattern)) add('STOP', 'REPEATED_MANUAL_PATTERN_STATUS_REQUIRED');
if (!allowedAiWorkStructures.has(aiWorkStructure)) add('STOP', 'AI_WORK_STRUCTURE_REQUIRED');
if (!allowedProgressEvents.has(progressUpdateEvent)) add('STOP', 'PROGRESS_UPDATE_EVENT_REQUIRED');

const progressRequired = aiWorkStructure === 'multi-step' || aiWorkStructure === 'long-running';
if (progressRequired && progressUpdateEvent === 'none') {
  add('STOP', 'PROGRESS_UPDATE_REQUIRED_FOR_COMPLEX_WORK', { aiWorkStructure });
}
if (progressUpdateEvent && progressUpdateEvent !== 'none') {
  if (progressUpdateSent !== 'yes') add('STOP', 'PROGRESS_UPDATE_NOT_SENT', { progressUpdateEvent });
  if (progressCurrentStagePresent !== 'yes') add('STOP', 'PROGRESS_CURRENT_STAGE_REQUIRED');
  if (progressMeaningPresent !== 'yes') add('STOP', 'PROGRESS_MEANING_REQUIRED');
  if (progressNextStepPresent !== 'yes') add('STOP', 'PROGRESS_NEXT_STEP_REQUIRED');
  if (progressUserActionStatusPresent !== 'yes') add('STOP', 'PROGRESS_USER_ACTION_STATUS_REQUIRED');
}

if (alternativesReviewed === 'no') add('STOP', 'ALTERNATIVES_NOT_REVIEWED');
if (simplestSafe === 'no') add('STOP', 'CHOSEN_PATH_NOT_SIMPLEST_SAFE');
if (safeStop === 'no') add('STOP', 'NO_SAFE_STOP_POINT');
if (changeClass === 'install-adoption' && lifecycleImpact !== 'yes') {
  add('STOP', 'INSTALL_ADOPTION_REQUIRES_LIFECYCLE_REVIEW');
}
if (changeClass === 'lifecycle-responsibility' && lifecycleImpact !== 'yes') {
  add('STOP', 'LIFECYCLE_RESPONSIBILITY_REQUIRES_LIFECYCLE_REVIEW');
}

if (humanProfile === 'non-engineer') {
  if (humanRole === 'technical-decider') {
    add('STOP', 'NON_ENGINEER_ASSIGNED_TECHNICAL_DECISION');
  }
  if (technicalJudgmentOwner === 'user' || technicalJudgmentOwner === 'unknown') {
    add('STOP', 'TECHNICAL_JUDGMENT_DELEGATED_TO_NON_ENGINEER', { technicalJudgmentOwner });
  }
  if (instructionMode === 'expert') {
    add('STOP', 'EXPERT_INSTRUCTIONS_FOR_NON_ENGINEER');
  }
}

const importantHumanChoice = humanDecisionClasses.has(changeClass);

if (importantHumanChoice) {
  if (!allowedHumanDecisions.has(humanDecision)) {
    add('STOP', 'HUMAN_DECISION_STATUS_REQUIRED');
  }
  if (!yesNo.has(nonEngineerExplanationReady)) {
    add('STOP', 'NONENGINEER_EXPLANATION_STATUS_REQUIRED');
  }
  if (nonEngineerExplanationReady !== 'yes') {
    add('STOP', 'IMPORTANT_CHOICE_EXPLANATION_REQUIRED');
  }
  if (humanDecision !== 'approved') {
    add('STOP', 'IMPORTANT_CHOICE_HUMAN_APPROVAL_REQUIRED', { humanDecision: humanDecision || '(missing)' });
  }
} else if (humanDecision === 'pending') {
  add('STOP', 'UNNECESSARY_HUMAN_CONFIRMATION');
}

let estimatedUserMaintenanceMinutesMonth = null;
if (lifecycleImpact === 'yes') {
  const hasRecurringMinutes = recurringMinutesRaw.trim() !== '';
  const parsedRecurringMinutes = hasRecurringMinutes ? Number(recurringMinutesRaw) : Number.NaN;
  if (!yesNo.has(maintenancePlanReviewed)) add('STOP', 'MAINTENANCE_PLAN_REVIEW_REQUIRED');
  if (!allowedOwners.has(maintenanceOwner)) add('STOP', 'MAINTENANCE_OWNER_REQUIRED');
  if (!allowedOwners.has(recoveryOwner)) add('STOP', 'RECOVERY_OWNER_REQUIRED');
  if (!allowedOwners.has(removalOwner)) add('STOP', 'REMOVAL_OWNER_REQUIRED');
  if (!hasRecurringMinutes || !Number.isFinite(parsedRecurringMinutes) || parsedRecurringMinutes < 0) {
    add('STOP', 'RECURRING_USER_MAINTENANCE_ESTIMATE_REQUIRED');
  } else {
    estimatedUserMaintenanceMinutesMonth = parsedRecurringMinutes;
  }
  if (maintenancePlanReviewed === 'no') add('STOP', 'MAINTENANCE_PLAN_NOT_REVIEWED');

  const owners = [maintenanceOwner, recoveryOwner, removalOwner];
  if (owners.includes('unknown')) add('STOP', 'LIFECYCLE_OWNER_UNKNOWN');
  if (owners.includes('user')) {
    add('STOP', 'USER_BECOMES_TECHNICAL_MAINTAINER', {
      maintenanceOwner,
      recoveryOwner,
      removalOwner,
    });
  }
}

if (repeatedManualPattern === 'yes') {
  if (!yesNo.has(structuralAutomationReviewed)) {
    add('STOP', 'STRUCTURAL_AUTOMATION_REVIEW_REQUIRED');
  } else if (structuralAutomationReviewed !== 'yes') {
    add('STOP', 'REPEATED_MANUAL_PATTERN_NOT_GENERALIZED');
  }
}

if (Number.isFinite(estimatedUserMinutes) && estimatedUserMinutes > 10 && scheduledWindow !== 'yes') {
  add('STOP', 'LONG_USER_OPERATION_NOT_SCHEDULED', { estimatedUserMinutes });
}
if (Number.isInteger(estimatedUserSteps) && estimatedUserSteps > 8 && scheduledWindow !== 'yes') {
  add('STOP', 'HIGH_USER_OPERATION_LOAD_NOT_SCHEDULED', { estimatedUserSteps });
}
if ((workImpact === 'medium' || workImpact === 'high') && scheduledWindow !== 'yes') {
  add('STOP', 'WORK_IMPACT_NOT_SCHEDULED', { workImpact });
}

if (!findings.some((f) => f.status === 'STOP')) {
  add('SAFE_CONFIRMED', 'OPERATION_PLAN_ACCEPTABLE', {
    scope,
    estimatedUserMinutes,
    estimatedUserSteps,
    workImpact,
    scheduledWindow,
    humanProfile,
    humanRole,
    technicalJudgmentOwner,
    instructionMode,
    changeClass,
    importantHumanChoice,
    lifecycleImpact,
    repeatedManualPattern,
    structuralAutomationReviewed: structuralAutomationReviewed || null,
    aiWorkStructure,
    progressUpdateEvent,
    progressUpdateSent: progressUpdateEvent === 'none' ? null : progressUpdateSent,
    maintenanceOwner: lifecycleImpact === 'yes' ? maintenanceOwner : null,
    recoveryOwner: lifecycleImpact === 'yes' ? recoveryOwner : null,
    removalOwner: lifecycleImpact === 'yes' ? removalOwner : null,
    estimatedUserMaintenanceMinutesMonth,
  });
}

const result = findings.some((f) => f.status === 'STOP') ? 'STOP' : 'PROCEED';
const output = {
  result,
  scope: scope || '(missing)',
  estimatedUserMinutes: Number.isFinite(estimatedUserMinutes) ? estimatedUserMinutes : null,
  estimatedUserSteps: Number.isInteger(estimatedUserSteps) ? estimatedUserSteps : null,
  humanProfile: humanProfile || '(missing)',
  humanRole: humanRole || '(missing)',
  technicalJudgmentOwner: technicalJudgmentOwner || '(missing)',
  instructionMode: instructionMode || '(missing)',
  changeClass: changeClass || '(missing)',
  importantHumanChoice,
  lifecycleImpact: lifecycleImpact || '(missing)',
  repeatedManualPattern: repeatedManualPattern || '(missing)',
  aiWorkStructure: aiWorkStructure || '(missing)',
  progressUpdateEvent: progressUpdateEvent || '(missing)',
  progressRequired,
  findings,
};
console.log(JSON.stringify(output, null, jsonOnly ? 0 : 2));
process.exit(result === 'PROCEED' ? 0 : 2);

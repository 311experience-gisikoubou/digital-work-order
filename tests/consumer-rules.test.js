const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

require(path.join(__dirname, '..', 'consumer-rules.js'));
const { parseConsumerExportText } = globalThis.ConsumerRuleConsumer;

function validExport() {
  return {
    schemaVersion: 'consumer-export-v1',
    targetApp: 'digital-work-order',
    generatedAt: '2026-08-23T10:15:30Z',
    rules: [{
      ruleId: 'rule_0123456789abcdef0123456789abcdef',
      version: '1.0.0',
      conditionCode: 'workflow_checkpoint_is_missing',
      actionCode: 'display_review_checkpoint',
      approvedAt: '2026-08-22T10:15:30Z'
    }]
  };
}

function parse(value) {
  return parseConsumerExportText(JSON.stringify(value));
}

test('accepts one valid consumer export rule', () => {
  const result = parse(validExport());
  assert.equal(result.valid, true);
  assert.equal(result.rules.length, 1);
});

test('accepts an empty rule list', () => {
  const value = validExport();
  value.rules = [];
  assert.deepEqual(parse(value), { valid: true, rules: [] });
});

test('fails closed for a different target app', () => {
  const value = validExport();
  value.targetApp = 'other-app';
  assert.deepEqual(parse(value), { valid: false, rules: [] });
});

test('fails closed for invalid JSON', () => {
  assert.deepEqual(parseConsumerExportText('{invalid'), { valid: false, rules: [] });
});

test('fails closed for extra export or rule properties', () => {
  const extraExport = validExport();
  extraExport.extra = 'fictional';
  assert.equal(parse(extraExport).valid, false);
  const extraRule = validExport();
  extraRule.rules[0].notes = 'fictional';
  assert.equal(parse(extraRule).valid, false);
});

test('fails closed for unknown condition or action codes', () => {
  const unknownCondition = validExport();
  unknownCondition.rules[0].conditionCode = 'unknown_condition';
  assert.equal(parse(unknownCondition).valid, false);
  const unknownAction = validExport();
  unknownAction.rules[0].actionCode = 'unknown_action';
  assert.equal(parse(unknownAction).valid, false);
});

test('fails closed for invalid timestamps', () => {
  for (const timestamp of ['2026-02-31T10:00:00Z', '2026-08-23T10:15:30.000Z', '2026-08-23T10:15:30+09:00']) {
    const value = validExport();
    value.generatedAt = timestamp;
    assert.equal(parse(value).valid, false);
  }
});

test('parse failures do not throw and do not create persistence state', () => {
  assert.doesNotThrow(() => parseConsumerExportText('not-json'));
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis, 'localStorage'), false);
});

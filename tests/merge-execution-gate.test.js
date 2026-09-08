const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const selftest = path.join(
  root,
  '.agents',
  'skills',
  'final-pr-audit',
  'merge-execution-gate-selftest.mjs',
);

test('merge execution authorization gate fails closed across state drift cases', () => {
  const result = spawnSync(process.execPath, [selftest], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /merge-execution-gate selftest: PASS/);
});

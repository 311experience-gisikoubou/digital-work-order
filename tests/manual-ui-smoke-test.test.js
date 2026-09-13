import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSmokeServer, getSmokeChecklist, SMOKE_MARKER } from '../tools/manual-ui-smoke-test.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, '..');

test('manual UI smoke server exposes deterministic synthetic PDF, paper and order-loss routes', async () => {
  const preview = await createSmokeServer({ worktree: root, host: '127.0.0.1', port: 0 });
  try {
    const pdf = await fetch(`${preview.base}/?smoke=pdf`);
    const paper = await fetch(`${preview.base}/?smoke=paper`);
    const orderLoss = await fetch(`${preview.base}/?smoke=order-loss`);
    const pdfScript = await fetch(`${preview.base}/__manual-smoke-pdf.js`);
    const paperScript = await fetch(`${preview.base}/__manual-smoke-paper.js`);
    const orderLossScript = await fetch(`${preview.base}/__manual-smoke-order-loss.js`);
    const fixture = await fetch(`${preview.base}/tests/fixtures/paper-order-synthetic.png`);
    assert.equal(pdf.status, 200);
    assert.equal(paper.status, 200);
    assert.equal(orderLoss.status, 200);
    assert.match(await pdf.text(), /__manual-smoke-pdf\.js/);
    assert.match(await paper.text(), /__manual-smoke-paper\.js/);
    assert.match(await orderLoss.text(), /__manual-smoke-order-loss\.js/);
    assert.match(await pdfScript.text(), new RegExp(`${SMOKE_MARKER}:PDF`));
    assert.match(await paperScript.text(), new RegExp(`${SMOKE_MARKER}:PAPER`));
    const orderLossJs = await orderLossScript.text();
    assert.match(orderLossJs, new RegExp(`${SMOKE_MARKER}:ORDER_LOSS`));
    assert.match(orderLossJs, /SAMPLE-CLINIC/);
    assert.match(orderLossJs, /shipping-date/);
    assert.match(orderLossJs, /delivery-date/);
    assert.equal(fixture.status, 200);
  } finally {
    await new Promise(resolve => preview.server.close(resolve));
  }
});
test('manual UI smoke checklist keeps the core iPad regression set visible', () => {
  const checklist = getSmokeChecklist();
  assert.ok(checklist.some(item => item.includes('B5 PDF')));
  assert.ok(checklist.some(item => item.includes('欠損歯式')));
  assert.ok(checklist.some(item => item.includes('紙指示書')));
  assert.ok(checklist.some(item => item.includes('OCR')));
  assert.ok(checklist.some(item => item.includes('自動破棄')));
  assert.ok(checklist.some(item => item.includes('Apple Pencil')));
});

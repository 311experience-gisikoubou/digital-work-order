import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const orders = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('product code has no dormant Firebase or Firestore path', () => {
  assert.doesNotMatch(app, /firebase|firestore|gstatic/i);
  assert.doesNotMatch(orders, /firebase|firestore|gstatic/i);
  assert.doesNotMatch(index, /firebase|firestore|gstatic/i);
});

test('clinic action describes page-local order-list reflection, not external send', () => {
  assert.match(index, /id="submit-btn">受注一覧へ反映する/);
  assert.match(app, /このページの受注一覧へ反映しました/);
  assert.match(orders, /このページ内の受注データ/);
  assert.match(index, /このページ内の受注データ/);
  assert.doesNotMatch(index, /指示書を送信する/);
  assert.doesNotMatch(app, /指示書を送信しました/);
});

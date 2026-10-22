'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'app/approved-reference-layout.css'), 'utf8');
const marker = '/* Tablet input adaptation (2026-10-22).';
const markerPos = css.indexOf(marker);
const responsive = markerPos < 0 ? '' : css.slice(markerPos);

function mediaBlocks(source) {
  // Our appended stylesheet contains only three top-level @media blocks.
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const output = [];
  let cursor = 0;
  while (cursor < clean.length) {
    while (/\s/.test(clean[cursor] || '')) cursor++;
    if (cursor >= clean.length) break;
    const open = clean.indexOf('{', cursor);
    assert.notEqual(open, -1, 'each rule has an opening brace');
    const header = clean.slice(cursor, open).trim();
    assert.match(header, /^@media screen and \(pointer: coarse\)/);
    let depth = 1, index = open + 1;
    while (index < clean.length && depth > 0) {
      if (clean[index] === '{') depth++;
      if (clean[index] === '}') depth--;
      index++;
    }
    assert.equal(depth, 0, 'balanced media rule');
    output.push({ header, body: clean.slice(open + 1, index - 1) });
    cursor = index;
  }
  return output;
}

test('approved PC reference precedes the separate touch-only overrides', () => {
  assert.ok(markerPos > 0, 'separate iPad section exists');
  assert.match(css.slice(0, markerPos), /SOURCE-LOCKED 2026-10-21/);
  const blocks = mediaBlocks(responsive);
  assert.equal(blocks.length, 3);
  assert.ok(blocks.every(block => /pointer: coarse/.test(block.header)));
});

test('iPad portrait and narrow split view get a readable single-column layout', () => {
  const blocks = mediaBlocks(responsive);
  assert.match(blocks[1].header, /orientation: portrait/);
  assert.match(blocks[1].header, /max-width: 900px/);
  assert.match(blocks[1].body, /approved-second-row\s*\{\s*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(blocks[1].body, /approved-card-tooth\s*\{\s*grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(blocks[2].header, /max-width: 560px/);
});

test('touch dimensions and 16-tooth numeric chart survive orientation changes', () => {
  const body = mediaBlocks(responsive)[0].body;
  assert.match(body, /min-height: 44px !important/);
  assert.match(body, /font-size: 16px !important/);
  assert.match(body, /approved-numeric-line\s*\{\s*min-width: 770px/);
  assert.match(body, /approved-chart-numeric\s*\{[^}]*overflow-x: auto/);
  assert.match(body, /#view-lab \.order-actions button/);
});

test('orientation adaptation is CSS-only: no JS state or PDF storage changes', () => {
  const adapted = mediaBlocks(responsive).map(block => block.body).join('\n');
  assert.doesNotMatch(adapted, /localStorage|sessionStorage|indexedDB|fetch\s*\(|@media print/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pdfSource.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(match, `missing print CSS rule: ${selector}`);
  return match[1];
}

test('print page keeps absolute fallback and prefers standard JIS-B5 portrait', () => {
  const page = ruleBody('@page');
  assert.match(page, /size:\s*182mm\s+257mm\s*;/);
  assert.match(page, /size:\s*JIS-B5\s+portrait\s*;/i);
  assert.ok(page.indexOf('182mm 257mm') < page.toLowerCase().indexOf('jis-b5 portrait'));
  assert.match(page, /margin:\s*0\s*;/);
});

test('print document box remains exactly 182x257mm', () => {
  assert.match(pdfSource, /html,\s*\n\s*body\s*\{[\s\S]*?width:\s*182mm\s*;[\s\S]*?height:\s*257mm\s*;/);
});

test('two 128mm slips plus 1mm perforation fill one 257mm page', () => {
  const slip = ruleBody('.slip');
  const perforated = ruleBody('.perforated');
  assert.match(slip, /width:\s*182mm\s*;/);
  assert.match(slip, /height:\s*128mm\s*;/);
  assert.match(slip, /flex:\s*0\s+0\s+128mm\s*;/);
  assert.match(perforated, /height:\s*1mm\s*;/);
  assert.match(perforated, /flex:\s*0\s+0\s+1mm\s*;/);
  assert.equal(128 * 2 + 1, 257);
});

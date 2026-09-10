const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pdfSource.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(match, `missing print CSS rule: ${selector}`);
  return match[1];
}

test('PDF action asks for paper size and exposes B5 standard plus A4', () => {
  assert.ok(pdfSource.includes('modal-print-paper'));
  assert.ok(htmlSource.includes('id="modal-print-paper"'));
  assert.ok(htmlSource.includes("confirmPrintPaperSize('b5')"));
  assert.ok(htmlSource.includes('B5で印刷（標準）'));
  assert.ok(htmlSource.includes("confirmPrintPaperSize('a4')"));
  assert.ok(htmlSource.includes('A4で印刷'));
});

test('paper selection maps B5 and A4 to explicit page geometry', () => {
  assert.ok(pdfSource.includes("paperSize === 'a4' ? 'a4' : 'b5'"));
  assert.ok(pdfSource.includes("'210mm 297mm' : '182mm 257mm'"));
  assert.ok(pdfSource.includes("'A4 portrait' : 'JIS-B5 portrait'"));
  assert.ok(pdfSource.includes('size: ${pageSizeFallback};'));
  assert.ok(pdfSource.includes('size: ${pageSizeNamed};'));
  assert.ok(pdfSource.includes('width: ${pageWidth};'));
  assert.ok(pdfSource.includes('height: ${pageHeight};'));
});

test('two 128mm slips plus 1mm perforation remain a 257mm B5 sheet', () => {
  const slip = ruleBody('.slip');
  const perforated = ruleBody('.perforated');
  assert.match(slip, /width:\s*182mm\s*;/);
  assert.match(slip, /height:\s*128mm\s*;/);
  assert.match(slip, /flex:\s*0\s+0\s+128mm\s*;/);
  assert.match(perforated, /height:\s*1mm\s*;/);
  assert.match(perforated, /flex:\s*0\s+0\s+1mm\s*;/);
  assert.equal(128 * 2 + 1, 257);
});

test('A4 mode centers the unchanged B5 two-up content instead of stretching it', () => {
  assert.ok(pdfSource.includes('align-items: center;'));
  assert.ok(pdfSource.includes('justify-content: center;'));
  assert.doesNotMatch(ruleBody('.slip'), /width:\s*210mm/);
});

test('order list no longer claims printing is always B5 before paper choice', () => {
  assert.ok(ordersSource.includes('選択分を印刷'));
  assert.ok(!ordersSource.includes('選択分をB5印刷'));
});

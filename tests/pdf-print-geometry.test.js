const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pdfSource = fs.readFileSync(path.join(root, 'pdf.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ordersSource = fs.readFileSync(path.join(root, 'orders.js'), 'utf8');
const pdfLibSource = fs.readFileSync(
  path.join(root, 'vendor', 'pdf', 'pdf-lib-1.17.1.min.js'),
  'utf8',
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pdfSource.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}'));
  assert.ok(match, `missing print CSS rule: ${selector}`);
  return match[1];
}

function mmToPoints(mm) {
  return mm * 72 / 25.4;
}
async function generatedPdfGeometry(paperSize) {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    window: { addEventListener() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(pdfLibSource, sandbox, { filename: 'pdf-lib.min.js' });
  vm.runInContext(pdfSource, sandbox, { filename: 'pdf.js' });
  sandbox.__paperSize = paperSize;
  return vm.runInContext(`(async () => {
    const bytes = await buildFixedSizePdfBytes('', __paperSize);
    const document = await PDFLib.PDFDocument.load(bytes);
    const page = document.getPages()[0];
    return {
      pageCount: document.getPageCount(),
      width: page.getWidth(),
      height: page.getHeight(),
      spec: getFixedPdfPageSpec(__paperSize),
    };
  })()`, sandbox);
}
test('PDF action offers B5 standard plus A4', () => {
  assert.ok(pdfSource.includes('modal-print-paper'));
  assert.ok(htmlSource.includes('id="modal-print-paper"'));
  assert.ok(htmlSource.includes("confirmPrintPaperSize('b5')"));
  assert.ok(htmlSource.includes('B5 PDFを作成（標準）'));
  assert.ok(htmlSource.includes("confirmPrintPaperSize('a4')"));
  assert.ok(htmlSource.includes('A4 PDFを作成'));
});

test('vendored PDF libraries match the reviewed SHA-256 assets', () => {
  const expected = {
    'html2canvas-1.4.1.min.js': 'e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb',
    'pdf-lib-1.17.1.min.js': '0f9a5cad07941f0826586c94e089d89b918c46e5c17cf2d5a3c6f666e3bc694f',
  };
  for (const [name, hash] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(root, 'vendor', 'pdf', name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash);
  }
});

test('runtime loads only local fixed-version PDF libraries', () => {
  assert.ok(htmlSource.includes('vendor/pdf/html2canvas-1.4.1.min.js'));
  assert.ok(htmlSource.includes('vendor/pdf/pdf-lib-1.17.1.min.js'));
  assert.ok(!htmlSource.includes('cdn.jsdelivr.net'));
  assert.ok(!htmlSource.includes('unpkg.com'));
});

test('direct PDF path does not call browser print', () => {
  assert.ok(pdfSource.includes('buildFixedSizePdfBytes'));
  assert.ok(pdfSource.includes('application/pdf'));
  assert.ok(!pdfSource.includes('.print()'));
  assert.ok(!pdfSource.includes('contentWindow.print'));
  assert.ok(!pdfSource.includes('window.open('));
  assert.ok(pdfSource.includes('window.location.assign(url)'));
});
test('generated B5 PDF is exactly one 182mm x 257mm page', async () => {
  const result = await generatedPdfGeometry('b5');
  assert.equal(result.pageCount, 1);
  assert.equal(result.spec.pageWidthMm, 182);
  assert.equal(result.spec.pageHeightMm, 257);
  assert.ok(Math.abs(result.width - mmToPoints(182)) < 0.001);
  assert.ok(Math.abs(result.height - mmToPoints(257)) < 0.001);
});

test('generated A4 PDF is one A4 page with unchanged B5 content geometry', async () => {
  const result = await generatedPdfGeometry('a4');
  assert.equal(result.pageCount, 1);
  assert.equal(result.spec.pageWidthMm, 210);
  assert.equal(result.spec.pageHeightMm, 297);
  assert.equal(result.spec.contentWidthMm, 182);
  assert.equal(result.spec.contentHeightMm, 257);
  assert.ok(Math.abs(result.width - mmToPoints(210)) < 0.001);
  assert.ok(Math.abs(result.height - mmToPoints(297)) < 0.001);
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

test('order list no longer claims printing is always B5 before paper choice', () => {
  assert.ok(ordersSource.includes('選択分を印刷'));
  assert.ok(!ordersSource.includes('選択分をB5印刷'));
});

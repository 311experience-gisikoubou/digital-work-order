/* Browser-only paper candidates. No application state or storage access. */
(function (root) {
  'use strict';
  const fields = Object.freeze({ clinicName: 'clinic-name', doctorName: 'doctor-name', patientName: 'patient-name', deliveryDate: 'delivery-date' });
  const labels = { clinicName: '歯科医院名', doctorName: '担当歯科医師', patientName: '患者名', deliveryDate: '納期' };
  const aliases = { clinicName: ['歯科医院名', '医院名'], doctorName: ['担当歯科医師', '歯科医師名', '担当医'], patientName: ['患者名', '患者氏名'], deliveryDate: ['納期', '納品日'] };
  function dateValue(value) {
    const m = /^(\d{4})(?:-|\/|年)(\d{1,2})(?:-|\/|月)(\d{1,2})日?$/.exec(value);
    if (!m || Number(m[1]) < 1000) return '';
    const normalized = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const date = new Date(normalized + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : '';
  }
  function parseCandidates(text) {
    const result = Object.fromEntries(Object.keys(fields).map(key => [key, '']));
    const lines = String(text || '').normalize('NFKC').split(/\r\n|[\r\n\u2028\u2029]/);
    for (const key of Object.keys(fields)) {
      const values = [];
      // Only horizontal spacing inside known labels; never repair name characters.
      const labelPattern = aliases[key].map(label => [...label].join('[ \\t]*')).join('|');
      for (const line of lines) {
        const match = new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*[:：][ \\t]*(.*?)[ \\t]*$`).exec(line);
        // Count empty labeled occurrences too: a second occurrence is ambiguous.
        if (match) values.push(match[1]);
      }
      if (values.length !== 1 || /[:：\uFFFD]/.test(values[0]) || values[0].length > 100) continue;
      result[key] = key === 'deliveryDate' ? dateValue(values[0]) : values[0];
    }
    return result;
  }
  function copyApproved(document, candidates, approved) {
    const keys = Object.keys(fields).filter(key => approved[key] === true);
    if (!keys.length) throw new Error('no-approved-fields');
    const writes = keys.map(key => {
      const value = candidates[key];
      const control = document.getElementById(fields[key]);
      if (!control || typeof value !== 'string' || !value.trim() || value.length > 100 ||
          (key === 'deliveryDate' && dateValue(value) !== value)) throw new Error('invalid-approved-field');
      return { control, value, before: control.value };
    });
    try {
      writes.forEach(({ control, value }) => { control.value = value; });
      if (!writes.every(({ control, value }) => control.value === value)) throw new Error('readback-mismatch');
    } catch (error) {
      // Best effort restoration; any failure remains a failure, never a success.
      writes.forEach(({ control, before }) => { try { control.value = before; } catch (_) { /* keep failure */ } });
      throw error;
    }
    return keys;
  }
  function localOptions(baseURI) {
    const base = new URL('.', baseURI);
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('local-http-required');
    return { workerPath: new URL('paper-ocr-worker.js', base).href,
      corePath: new URL('vendor/ocr/tesseract-core-lstm.wasm.js', base).href,
      langPath: new URL('vendor/ocr', base).href,
      workerBlobURL: false, cacheMethod: 'none', gzip: true, logging: false };
  }
  async function recognize(file, baseURI, onWorker) {
    if (!(file instanceof Blob) || !file.type.startsWith('image/')) throw new Error('image-required');
    const worker = await root.Tesseract.createWorker('jpn', 1, {
      ...localOptions(baseURI), logger: () => {}, errorHandler: () => {}
    });
    onWorker(worker);
    try {
      const result = await worker.recognize(file, {}, { text: true, blocks: true });
      // Low-confidence lines stay unresolved. Scores never approve a field.
      const lines = (result.data.blocks || []).flatMap(block => block.paragraphs || [])
        .flatMap(paragraph => paragraph.lines || []);
      return parseCandidates(lines.filter(line => line.confidence >= 80).map(line => line.text).join('\n'));
    } finally { await worker.terminate(); }
  }
  root.PaperOCR = Object.freeze({ fields, labels, parseCandidates, dateValue, copyApproved, localOptions, recognize });
})(globalThis);

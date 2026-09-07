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
  function workingSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('invalid-image-size');
    const scale = Math.min(1, 1600 / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }
  function normalizePixels(data) {
    let low = 255, high = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      const gray = Math.round((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha + 255 * (1 - alpha));
      data[i] = data[i + 1] = data[i + 2] = gray; data[i + 3] = 255;
      low = Math.min(low, gray); high = Math.max(high, gray);
    }
    // Limit gain and leave near-flat images alone; no thresholding or sharpening.
    if (high - low < 32) return;
    const gain = Math.min(1.5, 255 / (high - low));
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(255 - (high - data[i]) * gain);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
  }
  function pendingStep(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('ocr-cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  async function preprocess(file, signal) {
    let bitmap, canvas, pixels;
    try {
      bitmap = await pendingStep(root.createImageBitmap(file).then(decoded => {
        if (signal && signal.aborted) { decoded.close(); throw new Error('ocr-cancelled'); }
        return decoded;
      }), signal);
      const size = workingSize(bitmap.width, bitmap.height);
      canvas = root.document.createElement('canvas');
      canvas.width = size.width; canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas-unavailable');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      bitmap.close(); bitmap = null;
      pixels = context.getImageData(0, 0, size.width, size.height);
      normalizePixels(pixels.data);
      context.putImageData(pixels, 0, 0);
      return await pendingStep(new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob); else reject(new Error('image-encoding-failed'));
      }, 'image/png')), signal);
    } finally {
      if (bitmap) bitmap.close();
      if (pixels) pixels.data.fill(0);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  function countLabelHits(texts) {
    let hits = 0;
    for (const raw of texts) {
      const line = String(raw || '').normalize('NFKC');
      for (const key of Object.keys(fields)) {
        const labelPattern = aliases[key].map(label => [...label].join('[ \\t]*')).join('|');
        if (new RegExp(`^[ \\t]*(?:${labelPattern})[ \\t]*[:：]`).test(line)) { hits += 1; break; }
      }
    }
    return hits;
  }
  async function recognize(file, baseURI, onWorker, options) {
    if (!(file instanceof Blob) || !file.type.startsWith('image/')) throw new Error('image-required');
    const withDiagnostics = Boolean(options && options.diagnostics);
    const controller = new AbortController();
    const worker = await root.Tesseract.createWorker('jpn', 1, {
      ...localOptions(baseURI), logger: () => {}, errorHandler: () => {}
    });
    let image;
    try {
      onWorker({ terminate: () => { controller.abort(); return worker.terminate(); } });
      image = await preprocess(file, controller.signal);
      if (controller.signal.aborted) throw new Error('ocr-cancelled');
      const result = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines = (result.data.blocks || []).flatMap(block => block.paragraphs || [])
        .flatMap(paragraph => paragraph.lines || []);
      const confidentLines = lines.filter(line => line.confidence >= 80);
      const candidates = parseCandidates(confidentLines.map(line => line.text).join('\n'));
      if (!withDiagnostics) return candidates;
      const diagnostics = Object.freeze({
        rawLineCount: lines.length,
        confidentLineCount: confidentLines.length,
        labelHitsBeforeFilter: countLabelHits(lines.map(line => line.text)),
        labelHitsAfterFilter: countLabelHits(confidentLines.map(line => line.text)),
        candidateCount: Object.values(candidates).filter(value => value !== '').length,
        fields: Object.freeze(Object.fromEntries(Object.keys(fields).map(key => [key, candidates[key] !== ''])))
      });
      return Object.freeze({ candidates, diagnostics });
    } finally { image = null; await worker.terminate(); }
  }
  root.PaperOCR = Object.freeze({ fields, labels, parseCandidates, dateValue, copyApproved, localOptions, workingSize, normalizePixels, preprocess, recognize });
})(globalThis);

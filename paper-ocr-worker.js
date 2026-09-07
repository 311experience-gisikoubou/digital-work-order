/* Restrict this OCR worker to fixed app-local static assets, including redirects.
 * Images arrive as bytes via postMessage, never as network URLs. */
'use strict';
const asset = name => new URL(`vendor/ocr/${name}`, self.location.href).href;
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, options = {}) => {
  const url = typeof input === 'string' ? new URL(input, self.location.href).href : input.url;
  if (url !== asset('jpn.traineddata.gz') || (options.method && options.method !== 'GET') || options.body) {
    return Promise.reject(new Error('OCR network request blocked'));
  }
  return nativeFetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store' });
};
const nativeImport = self.importScripts.bind(self);
self.importScripts = (...urls) => {
  if (urls.some(url => ![asset('worker.min.js'), asset('tesseract-core-lstm.wasm.js')].includes(new URL(url, self.location.href).href))) {
    throw new Error('OCR script request blocked');
  }
  nativeImport(...urls);
};
self.XMLHttpRequest = class { constructor() { throw new Error('OCR XHR blocked'); } };
self.WebSocket = class { constructor() { throw new Error('OCR socket blocked'); } };
self.importScripts(asset('worker.min.js'));

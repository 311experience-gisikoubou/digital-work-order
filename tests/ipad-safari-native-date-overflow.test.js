'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html'),css=read('app/approved-reference-layout.css'),diag=read('app/ipad-viewport-diagnostic.js');
test('iPad Safari WebKit date-width defect mitigated with zero padding and overflow clipping',()=>{
 assert.match(css,/WebKit issue 301648/);
 assert.match(css,/#approved-full-form \.approved-shipping-four > \.shipping-input-wrap:first-child\s*\{[^}]*overflow:hidden!important;/);
 assert.match(css,/#approved-full-form \.approved-shipping-four #shipping-date\s*\{[^}]*padding:0!important;[^}]*padding-inline:0!important;/);
 assert.match(css,/box-sizing:border-box!important/);
});
test('Safari receives a new CSS URL, not previously cached stylesheet',()=>{
 assert.equal((html.match(/approved-reference-layout\.css\?v=20261022-ipad-safari-date/g)||[]).length,1);
});
test('diagnostic is strictly preview-only, local to device, and opt-in',()=>{
 assert.match(diag,/get\('uiDiag'\) !== '1'/);
 assert.match(diag,/hostname\.endsWith\('\.trycloudflare\.com'\)/);
 assert.match(diag,/devicePixelRatio/);
 assert.match(diag,/window\.visualViewport/);
 assert.match(diag,/getBoundingClientRect/);
 assert.doesNotMatch(diag,/fetch\s*\(|sendBeacon\s*\(|XMLHttpRequest|localStorage|sessionStorage|patient-name|clinic-name|document\.cookie/);
 assert.equal((html.match(/app\/ipad-viewport-diagnostic\.js/g)||[]).length,1);
});

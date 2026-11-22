'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=fs.readFileSync(path.join(root,'app/preview-sample-data.js'),'utf8');
test('sample script loads after fixed approved layout without changing its original elements',()=>{
 const layoutTag='<script src="app/approved-reference-layout.js"></script>';
 const previewTag='<script src="app/preview-sample-data.js"></script>';
 assert.equal(html.split(layoutTag).length,2);
 assert.equal(html.split(previewTag).length,2);
 assert.ok(html.indexOf(layoutTag)<html.indexOf(previewTag));
});
test('synthetic autofill is opt-in and preview-origin only, never enabled in GitHub Pages production',()=>{
 assert.match(source,/get\('sample'\) === '1'/);
 assert.match(source,/hostname\.endsWith\('\.trycloudflare\.com'\)/);
 assert.match(source,/if \(!previewOnly\) return;/);
 assert.match(source,/window\.navigator\.standalone === true/);
 assert.match(source,/matchMedia\('\(display-mode: standalone\)'\)/);
});
test('keeps real saved form, drawing, clasp, and session orders untouched',()=>{
 assert.match(source,/dwo_form_draft_v1/);
 assert.match(source,/dwo_drawing_v1/);
 assert.match(source,/dwo_clasp_v1/);
 assert.match(source,/isAutomaticEmptyDraft\(savedDraft\)/);
 assert.match(source,/reason:'existing-data-protected'/);
 assert.match(source,/state\.orders\.length/);
 assert.doesNotMatch(source,/localStorage\.setItem\s*\(/);
 assert.doesNotMatch(source,/localStorage\.removeItem\s*\(/);
 assert.doesNotMatch(source,/\bsaveCurrentFormDraft\s*\(/);
 assert.doesNotMatch(source,/\bissueCurrentOrder\s*\(/);
});
test('fake patient identity, prosthetic choice, dates, missing teeth and demo notice are explicit',()=>{
 for(const value of ['【テスト】こよし歯科医院','テスト 歯科医師','【架空】山田 花子','完成','レジン床',
  'GoA','data-num="16"','data-num="46"','onShippingDateChange','架空データ／動作確認専用']) {
   assert.ok(source.includes(value),value);
 }
 assert.match(source,/calendar\.style\.display = 'none'/);
});

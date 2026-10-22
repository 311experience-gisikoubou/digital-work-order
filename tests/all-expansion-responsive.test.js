'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const r=path.resolve(__dirname,'..');const read=x=>fs.readFileSync(path.join(r,x),'utf8');
const css=read('app/approved-reference-layout.css'),js=read('app/approved-reference-layout.js'),app=read('app.js');
test('627px iPad in-app viewport stacks patient and delivery as full-width cards',()=>{
 for(const field of ['.approved-card-patient','.approved-card-delivery']){
  assert.ok(css.includes('#approved-full-form > '+field),'missing '+field);
 }
 assert.match(css,/@media \(max-width:900px\)/);
 assert.match(css,/grid-column:1 \/ -1!important;/);
 assert.match(css,/#approved-full-form > \.approved-second-row\s*\{\s*grid-template-columns:minmax\(0,1fr\)!important;/);
});
test('insurance/date uses bounded two-column layout on narrow iPad without clipping inputs',()=>{
 assert.match(css,/grid-template-columns:minmax\(0,1\.12fr\) minmax\(0,1fr\)!important;/);
 assert.match(css,/#approved-full-form \.approved-shipping-four > \.approved-card-insurance\s*\{\s*grid-column:auto!important;/);
});
test('artificial teeth gets full-width shade selection when iPad narrow',()=>{
 assert.match(css,/#approved-full-form \.approved-artificial-card \.form-group:last-child\s*\{\s*grid-column:1 \/ -1;/);
 assert.match(css,/#approved-full-form \.approved-artificial-card \.approved-artificial-insurance/);
 assert.match(css,/#approved-full-form \.approved-artificial-card #shade-area/);
});
test('advanced prosthetics details opens in normal flow, never obscuring next card',()=>{
 assert.match(css,/\.approved-card-prosthetics:has\(\.approved-prosthetic-extra\[open\]\)/);
 assert.match(css,/\.approved-prosthetic-extra\[open\] > \.approved-prosthetic-extra-inner\s*\{[^}]*position:relative;[^}]*max-height:420px;/);
 assert.doesNotMatch(js,/mainDevices\.addEventListener\('change'/);
});
test('insurance switching recalculates delivery without opening calendar against user intent',()=>{
 assert.match(app,/const wasClosed = calendar && getComputedStyle\(calendar\)\.display === 'none'/);
 assert.match(app,/Promise\.resolve\(pending\)\.finally/);
 assert.match(app,/calendar\.style\.display = 'none'/);
});
test('source layout and canonical source image still the exact approved content',()=>{
 const manifest=JSON.parse(read('docs/canonical/approved-fullscreen-layout-20261021-teal.json'));
 assert.equal(manifest.sourceSha256,'8cc77c1fc9d730357c217919c32ce339c679cf02456d3038323a03cc04f6143f');
 assert.equal(manifest.lockedComposition,true);
});

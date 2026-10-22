'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const app=read('app.js');
const draft=read('app/draft-persistence.js');
const pdf=read('pdf.js');
test('anonymous checkbox values are normalized before issue data collection',()=>{
  assert.match(app,/c\.value && c\.value !== 'on'/);
  assert.match(app,/querySelector\('\.check-label'\)/);
  assert.match(app,/const devices = getChecked\(deviceGroup\)/);
});
test('both insurance and self-pay save jaw positions and retention counts with existing data fields',()=>{
  for(const token of ['基礎床','ロー提','保持','kisosho-','rotei-','hoji-']) assert.ok(app.includes(token),token);
  assert.match(app,/devices\.push\(\.\.\.getChecked/);
  assert.match(app,/devices\.push\(`保持 \$\{raw\}`\)/);
  assert.match(draft,/selectedDetails\.has\(input\.value\)/);
  assert.match(draft,/savedRetention\.slice\(3\)/);
});
test('draft schema version and strict field contract are not changed',()=>{
  assert.match(draft,/const FORM_DRAFT_SCHEMA_VERSION = 'dwo-form-draft-v1'/);
  assert.match(draft,/devices: \[\.\.\.new Set\(\[/);
  assert.match(draft,/!hasExactObjectKeys\(form, FORM_DRAFT_FIELDS\)/);
});
test('inactive clasp, bar, rimount and shade cannot silently enter issued order',()=>{
  assert.match(app,/document\.getElementById\(`chk-clasp-\$\{insKey\}`\)\?\.checked/);
  assert.match(app,/document\.getElementById\(`chk-bar-\$\{insKey\}`\)\?\.checked/);
  assert.match(app,/rimountEnabled &&/);
  assert.match(app,/!shadeEnabled \? ''/);
});
test('B5 compact PDF exposes selected jaw and retention details without a new row',()=>{
  assert.match(pdf,/var selectedDeviceNames = Array\.isArray\(order\.devices\)/);
  assert.match(pdf,/selectedDeviceNames\.forEach\(function\(value\)/);
  assert.match(pdf,/if \(!deviceCountItems\.includes\(value\)\) deviceCountItems\.push\(value\)/);
  assert.match(pdf,/pushHtmlRow\(\s*'装置'/);
  assert.match(pdf,/R = compactR/);
});

'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const app=read('app.js'),html=read('index.html'),css=read('app/approved-reference-layout.css'),layout=read('app/approved-reference-layout.js'),draft=read('app/draft-persistence.js');
test('Both insurance and self-pay shade checkboxes preserve existing ids and options',()=>{
 for(const key of ['shade','shade-jishi']){
  assert.match(html,new RegExp('id="chk-'+key+'"'));
  assert.match(html,new RegExp('id="'+key+'-area"'));
  assert.match(html,new RegExp('id="'+key+'-other-area"'));
  assert.match(html,new RegExp('id="'+key+'-other-input"'));
  for(const val of ['A1','A2','A3','A3.5','other']) assert.ok(html.includes('data-group="'+key+'" data-val="'+val+'"'));
 }
 assert.match(layout,/heading\.htmlFor = shadeCheckboxId/);
});
test('Existing shade expanded area is raised above the lower row without moving the card',()=>{
 for(const key of ['shade-area','shade-jishi-area']){
  assert.ok(css.includes('#approved-full-form .approved-artificial-card #'+key+'.open'));
 }
 assert.match(css,/pointer-events:auto/);
 assert.match(css,/position:absolute/);
 assert.match(css,/z-index:80/);
});
test('Other opens on first tap regardless of delegated active-class timing',()=>{
 assert.equal((app.match(/area\.classList\.toggle\('open', btn\.dataset\.val === 'other'\);/g)||[]).length,2);
 assert.doesNotMatch(app,/btn\.dataset\.val === 'other' && btn\.classList\.contains\('active'\)/);
});
test('Free text shade saves, restores to the original control, without schema changes',()=>{
 assert.match(app,/shade-other-input' : 'shade-jishi-other-input/);
 assert.match(app,/shadeSel === 'other' \? shadeFreeText/);
 assert.match(draft,/shadeGroup === 'shade' \? 'shade-other-input' : 'shade-jishi-other-input'/);
 const context=JSON.parse(read('PROJECT_CONTEXT.json'));
 assert.equal(context.canonicalContract.artifacts.filter(x=>x.kind==='DESIGN'&&x.status==='CURRENT').length,1);
});

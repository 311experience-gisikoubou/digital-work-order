'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p));
const text=p=>read(p).toString('utf8');
const sha=p=>crypto.createHash('sha256').update(read(p)).digest('hex');
const spec=JSON.parse(text('docs/canonical/approved-fullscreen-layout-20261021-teal.json'));
const ctx=JSON.parse(text('PROJECT_CONTEXT.json'));
test('final teal reference exact bytes, never overwritten by an AI recreation',()=>{
 assert.equal(spec.sourceImage,'docs/canonical/assets/approved-fullscreen-teal-20261021.png');
 assert.deepEqual(spec.referenceViewport,{width:1536,height:864,pixelRatio:1});
 assert.equal(sha(spec.sourceImage),'8cc77c1fc9d730357c217919c32ce339c679cf02456d3038323a03cc04f6143f');
 assert.equal(sha(spec.sourceImage),spec.sourceSha256);
 for(const arch of ['upper','lower'])assert.equal(sha(spec.fixedToothFigures[arch].file),spec.fixedToothFigures[arch].sha256);
});
test('canonical current design points to the approved teal binary source, old 10-01 superseded',()=>{
 const design=ctx.canonicalContract.artifacts.filter(x=>x.kind==='DESIGN');
 assert.equal(design.filter(x=>x.status==='CURRENT').length,1);
 const current=design.find(x=>x.status==='CURRENT');
 assert.equal(current.id,spec.designId);
 assert.ok(current.sources.includes(spec.sourceImage));
 const old=design.find(x=>x.id==='digital-work-order-layout-20261001-v1');
 assert.equal(old.status,'SUPERSEDED');
 assert.equal(old.supersededBy,current.id);
 assert.ok(ctx.humanDecisionSync.decisions.some(x=>x.id==='U14'&&x.source==='EXPLICIT_HUMAN'&&x.artifactIds.includes(current.id)));
});
test('all original business input IDs and existing PDF / media handling are present',()=>{
 const html=text('index.html');
 for(const id of spec.preservedIds)assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 for(const f of ['app/final-issue.js','app/draft-persistence.js','pdf.js','media.js','app/tooth-state.js','tooth-chart.js','orders.js'])assert.ok(read(f).length>0,f);
 assert.match(html,/app\/approved-reference-layout\.css/);
 assert.match(html,/app\/approved-reference-layout\.js/);
});
test('layout enhancement moves original controls instead of cloning or removing them',()=>{
 const js=text('app/approved-reference-layout.js');
 assert.match(js,/row1\.append\(patientName\)/);
 assert.match(js,/row2\.append\(\.\.\.\[\.\.\.dateRow\.children\]\)/);
 assert.match(js,/lab\.append\(summary,labRow\)/);
 assert.match(js,/shipping\.append\(insurance, result\)/);
 assert.match(js,/art\.append\(ins,jishi\)/);
 assert.match(js,/second\.append\(prosthetics,options,media,remarks\)/);
 assert.match(js,/mediaDetails\.append\(actionsOfMedia\)/);
 assert.match(js,/typePicker\.open = true/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});
test('approved geometry locks first through third row and horizontal jaw and numbered chart',()=>{
 const v=spec.sourceRectanglesCssPx;
 assert.deepEqual(v.upperJawImage,[45,596,227,196]);
 assert.deepEqual(v.lowerJawImage,[285,596,236,196]);
 assert.ok(v.toothChart[0]<v.clasp[0]);
 assert.ok(v.upperJawImage[0]<v.lowerJawImage[0]);
 const css=text('app/approved-reference-layout.css');
 assert.match(css,/grid-template-columns:1\.59fr \.69fr \.94fr 1fr/);
 assert.match(css,/--approved-teal:#38b5a3/);
 assert.match(css,/iPad landscape keeps the exact approved LEFT\/RIGHT layout/);
});

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const root = path.resolve(__dirname,'..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const js=read('app/approved-layout.js');
const css=read('app/approved-layout.css');
const source=read('docs/canonical/approved-fullscreen-design-20261021.md');
const teeth=read('app/tooth-state.js');

test('approved full-form source is documented with exact approved reference fingerprint',()=>{
  assert.match(source,/a5faaaabc4c4a1bf365075b3acd55f538a6b09ce5004cbf56ec38772225a2514/);
  assert.match(source,/入力画面全体/);
  assert.match(source,/画像バイナリはこのGitHub文書やrepoに格納されていない/);
});
test('UI is loaded in original application without duplicate form inputs',()=>{
  assert.match(html,/<link rel="stylesheet" href="app\/approved-layout.css">/);
  assert.match(html,/<script src="app\/approved-layout.js"><\/script>/);
  for(const id of ['clinic-name','doctor-name','patient-name','next-appointment-date',
    'shipping-date','delivery-date','laboratory-registration-number','remarks',
    'jaw-upper','jaw-lower','toothSvg','claspToolbar','claspList',
    'draft-save-btn','draft-discard-btn','submit-btn','media-attachments']) {
      const match = html.match(new RegExp('id="'+id+'"','g')) ?? [];
      assert.equal(match.length,1, 'preserved exactly one '+id);
  }
});
test('only existing controls and tooth states are reparented rather than rewritten',()=>{
  assert.match(js,/mediaCard\.append\(media\)/);
  assert.match(js,/deliveryOptions\.append\(insurance, orderType\)/);
  assert.match(js,/modalPanel\.append\(modalHeader,legacyDrawing\)/);
  assert.match(js,/body\.append\(figures,right\)/);
  assert.match(js,/numericNode\.replaceChildren/);
  assert.match(js,/observer\.observe\(svg/);
  assert.match(js,/getToothStateSnapshot/);
});
test('FDI row order and independent total-denture button positions are defined',()=>{
  assert.match(js,/\['upper','上顎'\],\['lower','下顎'\]/);
  assert.match(js,/totalButton\('upper'\),numericLine\('upper',upperRow\),\s*numericLine\('lower',lowerRow\),totalButton\('lower'\)/);
  assert.match(css,/grid-template-columns:repeat\(8,minmax\(0,1fr\)\) 3px repeat\(8,minmax\(0,1fr\)\)/);
});
test('clasp types, details and memo start collapsed without removing original controls',()=>{
  assert.match(js,/disclosure\('クラスプ種類（選択）'/);
  assert.match(js,/disclosure\('配置したクラスプ一覧'/);
  assert.match(js,/disclosure\('クラスプの備考・手書き'/);
  assert.doesNotMatch(js,/details\.open\s*=\s*true/);
});
test('7-7 logic toggles only the specified teeth and preserves caution and tooth 8',()=>{
  assert.match(teeth,/const allMissing = teeth\.every/);
  assert.match(teeth,/toothState\[num\]\.baseState = allMissing \? 'normal' : 'missing'/);
  assert.match(teeth,/toggleCompleteDentureArch\(UPPER_DENTURE_TEETH\)/);
  assert.match(teeth,/toggleCompleteDentureArch\(LOWER_DENTURE_TEETH\)/);
});

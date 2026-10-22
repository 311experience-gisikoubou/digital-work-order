'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p));
const html=file('index.html').toString('utf8');
const manifest=JSON.parse(file('manifest.webmanifest').toString('utf8'));
const document=file('docs/ipad-home-screen-webapp.md').toString('utf8');
function pngDimensions(p){
 const b=file(p);
 assert.equal(b.subarray(1,4).toString('ascii'),'PNG','PNG header '+p);
 assert.equal(b.subarray(12,16).toString('ascii'),'IHDR','IHDR header '+p);
 return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}
test('standalone launch metadata without UI or business logic changes',()=>{
 for(const field of [
  ['name','theme-color','content','#38b5a3'],
  ['name','apple-mobile-web-app-capable','content','yes'],
  ['name','apple-mobile-web-app-status-bar-style','content','default'],
  ['name','apple-mobile-web-app-title','content','こよし技工房']
 ]){
  const [key,keyVal,attr,val]=field;
  assert.match(html,new RegExp('<meta '+key+'="'+keyVal+'" '+attr+'="'+val+'">'));
 }
 assert.equal((html.match(/rel="manifest"/g)||[]).length,1);
 assert.match(html,/<link rel="manifest" href="manifest.webmanifest">/);
 assert.match(html,/<link rel="apple-touch-icon" sizes="180x180" href="assets\/pwa-icon-180\.png">/);
});
test('GitHub Pages /digital-work-order/ origin stays unchanged and confined',()=>{
 assert.equal(manifest.display,'standalone');
 assert.equal(manifest.id,'./');
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 const base='https://311experience-gisikoubou.github.io/digital-work-order/';
 assert.equal(new URL('manifest.webmanifest',base).href,base+'manifest.webmanifest');
 assert.equal(new URL(manifest.start_url,base).href,base);
 assert.equal(new URL(manifest.scope,base).href,base);
 assert.equal(manifest.background_color,'#f5faf9');
 assert.equal(manifest.theme_color,'#38b5a3');
 assert.equal(manifest.lang,'ja');
});
test('standalone icon sizes and same-origin relative asset paths are correct',()=>{
 assert.deepEqual(pngDimensions('assets/pwa-icon-180.png'),{width:180,height:180});
 assert.deepEqual(manifest.icons.map(x=>x.sizes),['192x192','512x512']);
 for(const i of manifest.icons){
  assert.equal(i.type,'image/png');
  assert.equal(i.purpose,'any');
  assert.match(i.src,/^assets\/pwa-icon-(192|512)\.png$/);
  assert.deepEqual(pngDimensions(i.src),{
    width:Number(i.sizes.split('x')[0]),height:Number(i.sizes.split('x')[1])
  });
 }
});
test('approved visual fingerprint is unchanged',()=>{
 assert.equal(crypto.createHash('sha256').update(file('docs/canonical/assets/approved-fullscreen-teal-20261021.png')).digest('hex'),
 '8cc77c1fc9d730357c217919c32ce339c679cf02456d3038323a03cc04f6143f');
});
test('no new service worker, cache, remote relay or storage behavior',()=>{
 const pkg=file('manifest.webmanifest').toString('utf8');
 assert.doesNotMatch(html,/serviceWorker\.register|\bcaches\.open/);
 assert.doesNotMatch(pkg,/(https?:\/\/|firebase|cloudflare|service.worker|notifications|shortcuts)/i);
 assert.match(document,/Service Workerを登録せず/);
 assert.match(document,/Safariと、ホーム画面から起動するWebアプリの端末内保存データは分離される/);
 assert.match(document,/本番URL/);
});

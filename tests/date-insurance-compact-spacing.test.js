'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'app/approved-reference-layout.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
test('iPad landscape date / insurance have a safe 12px physical separation',()=>{
 assert.match(css,/#approved-full-form \.approved-shipping-four\s*\{\s*column-gap:12px!important;/);
 assert.match(css,/#approved-full-form \.approved-shipping-four #shipping-date\s*\{[^}]*box-sizing:border-box!important;[^}]*max-width:100%!important;[^}]*min-width:0!important;/);
});
test('both insurer buttons stay in the same bounded two-column segment',()=>{
 assert.match(css,/#approved-full-form \.approved-shipping-four \.approved-card-insurance \.insurance-toggle\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;[^}]*width:100%!important;/);
 assert.match(css,/#approved-full-form \.approved-shipping-four \.approved-card-insurance \.ins-btn\s*\{[^}]*min-width:0!important;[^}]*max-width:100%/);
 for(const id of ['btn-insurance','btn-jishi','shipping-date'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
});
test('only compact layout CSS changes; original insurance and shipping control IDs persist',()=>{
 assert.match(css,/@media \(min-width:901px\) and \(max-width:1200px\)/);
 assert.match(css,/#approved-full-form \.approved-shipping-four > \.approved-card-insurance\s*\{\s*grid-column:auto!important;/);
});

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import test from 'node:test'; import vm from 'node:vm'; import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { constants, createAppsScriptControl, processD2SyncedJob, readVerifiedSyncedJob, receiveD2Job, receiveD2RetainedJob, runD2RetainedTrialOnce, waitForD2RetainedReady, parseD2CliArgs } from '../gateway/drive-relay-d2-adapter.mjs';
import { persistVerifiedPackage } from '../gateway/local-store.mjs';
const require = createRequire(import.meta.url); const T = require('../media-transfer-package.js'); const C = require('../media-transfer-crypto.js'); const B = require('../media-receiver-bootstrap.js'); const R = require('../media-relay.js');
function testHookSource(source){
  assert.doesNotMatch(source,/D2TrialTestHooks/);
  const marker="document.getElementById('pair').onclick=";
  assert.equal(source.split(marker).length,2);
  return source.replace(marker,'globalThis.D2TrialTestHooks=Object.freeze({validState,validArchive,isSandboxOrigin,bridgeCall,buildJobBody,buildSecondJobBody,claimPendingJob,markAccepted,queryStatus,attemptUpload,resolvePendingJob,rotateSecondJob,send,sendSecond,pair,withBusy,getState,putState,ARCHIVE_ID,SECOND_REF,FIRST_REF});'+marker);
}
const h = bytes => createHash('sha256').update(bytes).digest('hex'); const REF = 'dwo:123e4567-e89b-42d3-a456-426614174000';
// Normalizes a value (e.g. an archive/pendingJob/body record) to a plain JSON structure before
// comparison -- avoids any dependency on which vm realm's Object/Array intrinsics a given
// nested object literal happened to be constructed with, while still requiring complete,
// exact field equality (every key/value, recursively, must still match byte-for-byte).
const jsonClone = v => JSON.parse(JSON.stringify(v));
const SANDBOX_ORIGIN='https://n-bcp4qzdfuoczg3utczw3uytot2wyafcdo5lfkuq-0lu-script.googleusercontent.com';
function fakeTimers(){let nextId=1;const timers=new Map();return{setTimeout(fn,delay){const id=nextId++;timers.set(id,{fn,delay,cleared:false});return id;},clearTimeout(id){const t=timers.get(id);if(t)t.cleared=true;},fire(id){const t=timers.get(id);if(t&&!t.cleared)t.fn();},entries(){return[...timers.entries()];}};}
// Minimal synthetic IndexedDB double: a single object store, serialized readwrite/readonly transactions
// (FIFO per call to transaction()), supporting the exact get/put-inside-onsuccess pattern this file's
// production code uses (never a general-purpose IndexedDB implementation).
// `opts.failPutId`, when given, makes any put() of a value with that id throw synchronously
// inside the transaction (simulating a second-write failure after a first write already staged)
// so real rollback can be exercised: writes are staged per-transaction and only merged into the
// shared `data` map on a genuine commit (tx._pending reaches 0 with no abort); an explicit
// tx.abort() (as the production rotateSecondJob calls on any failure) or any op throwing
// discards the whole transaction's staged writes instead of merging them -- exactly the add
// (reject on duplicate key) and all-or-nothing two-write semantics the real IndexedDB gives.
function makeFakeIndexedDB(opts={}){
  const data=new Map();let queueTail=Promise.resolve();
  const db={close(){},transaction(){
    const tx={oncomplete:null,onerror:null,onabort:null,error:null,_pending:0,_committed:false,_aborted:false};
    const overlay=new Map();
    const myTurn=queueTail;let advance;queueTail=new Promise(res=>{advance=res;});
    const settleAbort=err=>{if(tx._committed||tx._aborted)return;tx._aborted=true;tx.error=tx.error||err;if(tx.onabort)tx.onabort();advance();};
    function scheduleCheck(){queueMicrotask(()=>{if(tx._aborted||tx._committed)return;if(tx._pending===0){tx._committed=true;for(const[key,entry]of overlay){if(entry.op==='delete')data.delete(key);else data.set(key,entry.value);}if(tx.oncomplete)tx.oncomplete();advance();}});}
    function op(run){const req={result:undefined,onsuccess:null,onerror:null,error:null};tx._pending++;myTurn.then(()=>queueMicrotask(()=>{if(tx._aborted)return;try{req.result=run();}catch(err){tx._pending--;req.error=err;if(req.onerror)req.onerror();settleAbort(err);return;}tx._pending--;if(req.onsuccess)req.onsuccess();scheduleCheck();}));return req;}
    const store={
      get(key){return op(()=>overlay.has(key)?(overlay.get(key).op==='delete'?undefined:overlay.get(key).value):data.get(key));},
      put(value){return op(()=>{if(opts.failPutId&&value.id===opts.failPutId)throw Object.assign(Error('D2_TEST_FORCED_PUT_FAILURE'),{name:'D2TestForcedPutFailure'});overlay.set(value.id,{op:'put',value});return value;});},
      add(value){return op(()=>{const exists=overlay.has(value.id)?overlay.get(value.id).op!=='delete':data.has(value.id);if(exists)throw Object.assign(Error('D2_TEST_CONSTRAINT_ERROR'),{name:'ConstraintError'});overlay.set(value.id,{op:'put',value});return value;});}
    };
    tx.objectStore=()=>store;
    tx.abort=()=>settleAbort(Error('D2_TEST_TX_ABORTED'));
    return tx;
  }};
  return{open(){const req={result:db,onsuccess:null,onerror:null};queueMicrotask(()=>{if(req.onsuccess)req.onsuccess();});return req;},seed(value){data.set(value.id,value);},peek(id){return data.get(id);},erase(id){data.delete(id);}};
}
// A minimal double whose readwrite transaction always fails its write (onabort fires with a
// distinguishable error) after returning the given seeded record from get() -- used to prove
// that an aborted/erroring transaction rejects promptly instead of hanging or resolving.
function makeAbortingIndexedDB(seedValue){
  const db={close(){},transaction(){const tx={oncomplete:null,onerror:null,onabort:null,error:null};const store={get(key){const req={result:key==='sender'?seedValue:undefined,onsuccess:null,onerror:null};queueMicrotask(()=>{if(req.onsuccess)req.onsuccess();});return req;},put(){const req={result:undefined,onsuccess:null,onerror:null};queueMicrotask(()=>{tx.error=Error('SIMULATED_TX_ABORT');if(tx.onabort)tx.onabort();});return req;}};tx.objectStore=()=>store;return tx;}};
  return{open(){const req={result:db,onsuccess:null,onerror:null};queueMicrotask(()=>{if(req.onsuccess)req.onsuccess();});return req;}};
}
function readChannel(nodes){return new URL(nodes['relay-bridge'].src).searchParams.get('channel');}
function driveRound(ctx,ok,value){const channel=readChannel(ctx.nodes),source={postMessage(){}};ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok,value}});return channel;}
// Polls (real timers, not just microtasks) because production code performs genuine async
// crypto.subtle digests before the next bridge round starts; a single microtask flush is not
// reliable for that step.
async function waitForSrcChange(ctx,previousSrc){
  for(let i=0;i<2000;i++){
    const src=ctx.nodes['relay-bridge'].src;
    if(src&&src!==previousSrc)return src;
    await new Promise(r=>setTimeout(r,1));
  }
  throw new Error('D2_TEST_BRIDGE_ROUND_TIMEOUT');
}
async function driveNextRound(ctx,previousSrc,ok,value){const src=await waitForSrcChange(ctx,previousSrc);driveRound(ctx,ok,value);return src;}
function fakeMediaModules(){let n=0;return{MediaTransferPackage:{buildPackage:async()=>({})},MediaTransferCrypto:{encryptPackage:async()=>({}),generateSenderIdentity:async()=>{const key=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign']);return{clinicDeviceId:'dev_synthetic',signingKeyId:'sk_synthetic',privateKey:key.privateKey,publicJwk:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)}};}},MediaRelayTransport:{buildCreateRequest:async()=>{const descriptorSha256=h('synthetic-sender-candidate-'+(n++));return{request:{envelopeHeader:{descriptorSha256},plan:{version:'dwo-relay-plan-v1',totalBytes:16,entries:[{},{},{}]}},parts:[0,1,2].map(i=>({blob:{arrayBuffer:async()=>new Uint8Array([i+1,i+1,i+1,i+1]).buffer}}))};},canonicalJson:v=>JSON.stringify(v)},MediaReceiverBootstrap:{}};}
function buildSenderSandbox({indexedDB,bridge='https://script.google.com/macros/s/ABC_123/exec',timers}={}){
  const nodes={status:{},'relay-bridge':{src:''},pair:{},send:{},send2:{}};let onMessage=null;
  const fakeWindow={addEventListener:(type,fn)=>{if(type==='message')onMessage=fn;},removeEventListener:(type,fn)=>{if(type==='message'&&onMessage===fn)onMessage=null;}};
  const media=fakeMediaModules();
  const sandbox={CryptoKey:globalThis.CryptoKey,crypto:webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),Blob:class{constructor(parts){this._parts=parts;}},Uint8Array,Date,document:{getElementById:id=>nodes[id]},window:fakeWindow,location:{href:'https://311experience-gisikoubou.github.io/digital-work-order/app/drive-relay-d2-trial.html?bridge='+encodeURIComponent(bridge)},URL,TextEncoder,indexedDB,isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout:timers?timers.setTimeout:(()=>1),clearTimeout:timers?timers.clearTimeout:(()=>{}),MediaTransferPackage:media.MediaTransferPackage,MediaTransferCrypto:media.MediaTransferCrypto,MediaRelayTransport:media.MediaRelayTransport,MediaReceiverBootstrap:media.MediaReceiverBootstrap,globalThis:null};
  sandbox.globalThis=sandbox;
  return{sandbox,nodes,getOnMessage:()=>onMessage};
}
async function makeSenderState(overrides={}){
  const key=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  return{id:'sender',version:2,clinicDeviceId:'dev_test',signingKeyId:'sk_test',signingPrivateKey:key.privateKey,signingPublicJwk:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},uploadBearer:'A'.repeat(43),paired:true,recipientKeyId:'rk_receiver',recipientPublicJwk:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},...overrides};
}
test('browser validator executes fail-closed state checks and CSP has only exact Google origins',async()=>{const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8'),html=await fs.readFile(new URL('../app/drive-relay-d2-trial.html',import.meta.url),'utf8');class FakeCryptoKey{constructor(extractable=false,usages=['sign']){this.type='private';this.extractable=extractable;this.algorithm={name:'ECDSA',namedCurve:'P-256'};this.usages=usages;}}const nodes={status:{},'relay-bridge':{},pair:{},send:{},send2:{}};const sandbox={CryptoKey:FakeCryptoKey,crypto:{getRandomValues:v=>v,subtle:{}},document:{getElementById:id=>nodes[id]},window:{addEventListener(){},removeEventListener(){}},location:{href:'https://example.invalid/'},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout,clearTimeout,globalThis:null};sandbox.globalThis=sandbox;vm.runInNewContext(testHookSource(source),sandbox);const key=new FakeCryptoKey(),base={id:'sender',version:2,clinicDeviceId:'dev_test',signingKeyId:'sk_test',signingPrivateKey:key,signingPublicJwk:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},uploadBearer:'A'.repeat(43),paired:false},pending={status:'pending',body:{bearer:base.uploadBearer,jobId:'job_'+'a'.repeat(64),descriptorSha256:'a'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:1,entries:[{}]},objects:[{ordinal:0,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}]}},validPending3={status:'accepted',body:{bearer:base.uploadBearer,jobId:'job_'+'e'.repeat(64),descriptorSha256:'e'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}))}};assert.equal(sandbox.D2TrialTestHooks.validState(base),true);assert.equal(sandbox.D2TrialTestHooks.validState({...base,pendingJob:{...pending,body:{...pending.body,plan:{...pending.body.plan,entries:[]}}}}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,signingPrivateKey:new FakeCryptoKey(true)}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,signingPrivateKey:new FakeCryptoKey(false,['verify'])}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,uploadBearer:'A'.repeat(42)}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,paired:true}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,secondGenerationOf:'not-a-job-id'}),false);assert.equal(sandbox.D2TrialTestHooks.validState({...base,secondGenerationOf:'job_'+'a'.repeat(64)}),true);assert.equal(sandbox.D2TrialTestHooks.validArchive({id:sandbox.D2TrialTestHooks.ARCHIVE_ID,pendingJob:pending},base.uploadBearer),false);assert.equal(sandbox.D2TrialTestHooks.validArchive({id:sandbox.D2TrialTestHooks.ARCHIVE_ID,pendingJob:{...pending,status:'accepted'}},base.uploadBearer),false,'a one-object pending/accepted job is still structurally invalid (production requires >=3 objects) and must never be accepted as a valid archive');assert.equal(sandbox.D2TrialTestHooks.validArchive({id:sandbox.D2TrialTestHooks.ARCHIVE_ID,pendingJob:validPending3},base.uploadBearer),true,'a genuinely valid three-object accepted job, matching its plan entry count, must be accepted as a valid archive');assert.match(source,/MediaRelayTransport\.canonicalJson\(built\.request\.plan\)/);assert.match(html,/frame-src https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com/);assert.doesNotMatch(html,/\*\.googleusercontent/);});
test('browser bridge accepts only generated Apps Script sandbox origin and pins nested source/origin',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  let onMessage=null,posted=null,settled=false;
  const nodes={status:{},'relay-bridge':{src:''},pair:{},send:{},send2:{}};
  const bridge='https://script.google.com/macros/s/ABC_123/exec';
  const fakeWindow={addEventListener:(type,fn)=>{if(type==='message')onMessage=fn;},removeEventListener:(type,fn)=>{if(type==='message'&&onMessage===fn)onMessage=null;}};
  const sandbox={CryptoKey:class{},crypto:{getRandomValues:v=>v,subtle:{}},btoa:s=>Buffer.from(s,'binary').toString('base64'),document:{getElementById:id=>nodes[id]},window:fakeWindow,location:{href:'https://311experience-gisikoubou.github.io/digital-work-order/app/drive-relay-d2-trial.html?bridge='+encodeURIComponent(bridge)},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout:()=>1,clearTimeout:()=>{},globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(testHookSource(source),sandbox);
  const hooks=sandbox.D2TrialTestHooks,goodOrigin='https://n-bcp4qzdfuoczg3utczw3uytot2wyafcdo5lfkuq-0lu-script.googleusercontent.com';
  assert.equal(hooks.isSandboxOrigin(goodOrigin),true);
  for(const bad of ['https://script.google.com','https://script.googleusercontent.com','https://evil.googleusercontent.com','https://n-good-script.googleusercontent.com.evil.test','http://n-good-script.googleusercontent.com'])assert.equal(hooks.isSandboxOrigin(bad),false,bad);
  const promise=hooks.bridgeCall('getConfig',{synthetic:true});promise.then(()=>{settled=true;},()=>{settled=true;});
  const channel=new URL(nodes['relay-bridge'].src).searchParams.get('channel');
  const wrongSource={postMessage(){throw new Error('wrong source must not receive action');}},goodSource={postMessage:(message,origin)=>{posted={message,origin};}};
  onMessage({origin:'https://script.google.com',source:wrongSource,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(posted,null);
  onMessage({origin:goodOrigin,source:goodSource,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(posted.origin,goodOrigin);assert.equal(posted.message.action,'getConfig');assert.deepEqual(posted.message.body,{synthetic:true});
  onMessage({origin:goodOrigin,source:wrongSource,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{bad:1}}});
  await Promise.resolve();assert.equal(settled,false);
  onMessage({origin:'https://other-script.googleusercontent.com',source:goodSource,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{bad:2}}});
  await Promise.resolve();assert.equal(settled,false);
  onMessage({origin:goodOrigin,source:goodSource,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{ready:true}}});
  assert.deepEqual(await promise,{ready:true});assert.equal(settled,true);assert.equal(onMessage,null);
});

test('D2 sender separates a bounded 15s handshake timer from a 60s action timer and succeeds at the exact historical timing',async()=>{
  // Actual evidence: iframe begins 21:54:02, d2Bridge begins 21:54:04 (ready at +2s) and runs 13.694s
  // (result at +15.694s). A single 15s timer covering the whole exchange would fail this; the fix must not.
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const nodes={status:{},'relay-bridge':{src:''},pair:{},send:{},send2:{}};
  let onMessage=null;
  const fakeWindow={addEventListener:(type,fn)=>{if(type==='message')onMessage=fn;},removeEventListener:(type,fn)=>{if(type==='message'&&onMessage===fn)onMessage=null;}};
  const bridge='https://script.google.com/macros/s/ABC_123/exec';
  const timers=fakeTimers();
  const sandbox={CryptoKey:class{},crypto:{getRandomValues:v=>v,subtle:{}},btoa:s=>Buffer.from(s,'binary').toString('base64'),document:{getElementById:id=>nodes[id]},window:fakeWindow,location:{href:'https://311experience-gisikoubou.github.io/digital-work-order/app/drive-relay-d2-trial.html?bridge='+encodeURIComponent(bridge)},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(testHookSource(source),sandbox);
  const hooks=sandbox.D2TrialTestHooks;
  const promise=hooks.bridgeCall('putSyntheticJob',{x:1});
  const initial=timers.entries();assert.equal(initial.length,1);const[handshakeId,handshakeEntry]=initial[0];assert.equal(handshakeEntry.delay,15000);
  const channel=new URL(nodes['relay-bridge'].src).searchParams.get('channel'),goodSource={postMessage(){}};
  onMessage({origin:SANDBOX_ORIGIN,source:goodSource,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(timers.entries().find(([id])=>id===handshakeId)[1].cleared,true);
  const afterReady=timers.entries().filter(([id])=>id!==handshakeId);assert.equal(afterReady.length,1);const[actionId,actionEntry]=afterReady[0];assert.equal(actionEntry.delay,60000);
  timers.fire(handshakeId);let settled=false;promise.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();assert.equal(settled,false,'a cleared handshake timer must never fire');
  const expected={jobId:'job_'+'a'.repeat(64),status:'ready'};
  onMessage({origin:SANDBOX_ORIGIN,source:goodSource,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:expected}});
  assert.deepEqual(await promise,expected);
  assert.equal(timers.entries().find(([id])=>id===actionId)[1].cleared,true);
  assert.equal(onMessage,null);
});

function makeBridgeOnlySandbox(timers){
  const nodes={status:{},'relay-bridge':{src:''},pair:{},send:{},send2:{}};let onMessage=null;
  const fakeWindow={addEventListener:(type,fn)=>{if(type==='message')onMessage=fn;},removeEventListener:(type,fn)=>{if(type==='message'&&onMessage===fn)onMessage=null;}};
  const bridge='https://script.google.com/macros/s/ABC_123/exec';
  const sandbox={CryptoKey:class{},crypto:{getRandomValues:v=>v,subtle:{}},btoa:s=>Buffer.from(s,'binary').toString('base64'),document:{getElementById:id=>nodes[id]},window:fakeWindow,location:{href:'https://311experience-gisikoubou.github.io/digital-work-order/app/drive-relay-d2-trial.html?bridge='+encodeURIComponent(bridge)},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout,globalThis:null};
  sandbox.globalThis=sandbox;
  return{sandbox,nodes,getOnMessage:()=>onMessage};
}

test('D2 sender rejects a bounded handshake timeout and a separate action timeout, but never fires either while cleared',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const timers1=fakeTimers(),ctx1=makeBridgeOnlySandbox(timers1);
  vm.runInNewContext(testHookSource(source),ctx1.sandbox);
  const p1=ctx1.sandbox.D2TrialTestHooks.bridgeCall('getConfig',{});
  const[h1]=timers1.entries()[0];timers1.fire(h1);
  await assert.rejects(p1,{message:'BRIDGE_TIMEOUT'});

  const timers2=fakeTimers(),ctx2=makeBridgeOnlySandbox(timers2);
  vm.runInNewContext(testHookSource(source),ctx2.sandbox);
  const p2=ctx2.sandbox.D2TrialTestHooks.bridgeCall('getConfig',{});
  const[h2]=timers2.entries()[0],channel2=new URL(ctx2.nodes['relay-bridge'].src).searchParams.get('channel'),src2={postMessage(){}};
  ctx2.getOnMessage()({origin:SANDBOX_ORIGIN,source:src2,data:{version:'dwo-d2-bridge-v1',channel:channel2,type:'ready'}});
  const[a2]=timers2.entries().filter(([id])=>id!==h2)[0];
  timers2.fire(a2);
  await assert.rejects(p2,{message:'BRIDGE_ACTION_TIMEOUT'});
});

test('D2 sender ignores ready messages with the wrong channel or a non-sandbox origin and leaves the handshake timer armed',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const timers=fakeTimers(),ctx=makeBridgeOnlySandbox(timers);
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const promise=ctx.sandbox.D2TrialTestHooks.bridgeCall('putSyntheticJob',{});
  const[handshakeId]=timers.entries()[0],channel=new URL(ctx.nodes['relay-bridge'].src).searchParams.get('channel'),src={postMessage(){}};
  ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:src,data:{version:'dwo-d2-bridge-v1',channel:'z'.repeat(24),type:'ready'}});
  assert.equal(timers.entries().find(([id])=>id===handshakeId)[1].cleared,false);
  ctx.getOnMessage()({origin:'https://evil.googleusercontent.com',source:src,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(timers.entries().find(([id])=>id===handshakeId)[1].cleared,false);
  ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:src,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(timers.entries().find(([id])=>id===handshakeId)[1].cleared,true);
  promise.catch(()=>{});
});

test('D2 sender attemptUpload reconciles a rejected or invalid initial result via exactly one status query',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  async function run(firstOk,firstValue,secondValue,expected){
    const ctx=buildSenderSandbox({indexedDB:{}});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const body={bearer:'A'.repeat(43),jobId:'job_'+'a'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64)};
    const p=hooks.attemptUpload(body);
    const firstSrc=await driveNextRound(ctx,'',firstOk,firstValue);
    await driveNextRound(ctx,firstSrc,true,secondValue);
    assert.equal(await p,expected);
  }
  // Lost/rejected initial result, status query confirms ready for the same job.
  await run(false,undefined,{jobId:'job_'+'a'.repeat(64),status:'ready'},true);
  // Invalid (wrong-job) initial result, status query confirms deleted for the same job.
  await run(true,{jobId:'job_wrong',status:'ready'},{jobId:'job_'+'a'.repeat(64),status:'deleted'},true);
  // Rejected initial result, status query reports not-started: unconfirmed, no success claimed.
  await run(false,undefined,{jobId:'job_'+'a'.repeat(64),status:'not-started'},false);
  // Rejected initial result, malformed status response: unconfirmed, no success claimed.
  await run(false,undefined,{bad:'shape'},false);
});

test('D2 sender retains a pending job on an ambiguous status and queries status before reusing the same body on an explicit retry',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const fakeDB=makeFakeIndexedDB();fakeDB.seed(await makeSenderState());
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const firstClick=hooks.send();
  const round1=await driveNextRound(ctx,'',true,{jobId:'job_'+'z'.repeat(64),status:'ready'}); // wrong jobId -> invalid, triggers status query
  const round2=await driveNextRound(ctx,round1,true,{bad:'shape'}); // malformed status response -> unconfirmed
  await firstClick;
  const afterFirst=fakeDB.peek('sender');
  assert.equal(afterFirst.pendingJob.status,'pending');
  const jobId=afterFirst.pendingJob.body.jobId;
  const secondClick=hooks.send();
  const round3=await driveNextRound(ctx,round2,true,{jobId,status:'not-started'}); // explicit retry queries status first
  await driveNextRound(ctx,round3,true,{jobId,status:'ready'}); // then uploads the same existing body
  await secondClick;
  const afterSecond=fakeDB.peek('sender');
  assert.equal(afterSecond.pendingJob.status,'accepted');
  assert.equal(afterSecond.pendingJob.body.jobId,jobId,'retry must reuse the existing body, never a newly generated one');
});

test('D2 sender concurrent claim adopts an already-pending job rather than overwriting it with a newly generated body',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const fakeDB=makeFakeIndexedDB(),base=await makeSenderState();
  const existingBody={bearer:base.uploadBearer,jobId:'job_'+'e'.repeat(64),descriptorSha256:'e'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}))};
  fakeDB.seed({...base,pendingJob:{status:'pending',body:existingBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const newBody={...existingBody,jobId:'job_'+'f'.repeat(64),descriptorSha256:'f'.repeat(64)};
  const result=await hooks.claimPendingJob(newBody);
  assert.equal(result.pendingJob.body.jobId,existingBody.jobId);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,existingBody.jobId,'a racing writer must adopt the stored job, never overwrite it');
});

test('D2 sender guards pair and send against same-page concurrent clicks',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const fakeDB=makeFakeIndexedDB();fakeDB.seed(await makeSenderState());
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const first=hooks.withBusy(hooks.send);
  await assert.rejects(hooks.withBusy(hooks.send),{message:'D2_BUSY'});
  await waitForSrcChange(ctx,'');
  const jobId=fakeDB.peek('sender').pendingJob.body.jobId;
  driveRound(ctx,true,{jobId,status:'ready'});
  await first;
  assert.equal(fakeDB.peek('sender').pendingJob.status,'accepted');
});

// Issue #168 finding #3: pair() must finalize against the current durable state, not a
// pre-bridge snapshot, so a pendingJob a concurrent tab creates while the bridge round-trips
// are in flight is never overwritten/lost.
test('D2 sender pair() preserves a pendingJob created by a concurrent tab instead of overwriting it with a stale snapshot',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState({paired:false,recipientKeyId:undefined,recipientPublicJwk:undefined});
  const fakeDB=makeFakeIndexedDB();fakeDB.seed(base);
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const recipientJwk={kty:'EC',crv:'P-256',x:'p'.repeat(43),y:'q'.repeat(43)};
  const pairPromise=hooks.pair();
  const round1=await driveNextRound(ctx,'',true,{recipientKeyId:'rk_receiver',publicJwk:recipientJwk}); // getConfig
  // A concurrent tab claims a pending job for this exact identity while pair() is still
  // awaiting the bridge round-trips above.
  const concurrentBody={bearer:base.uploadBearer,jobId:'job_'+'c'.repeat(64),descriptorSha256:'c'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'d'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'e'.repeat(64),bytes:'AQ'}))};
  fakeDB.seed({...base,pendingJob:{status:'pending',body:concurrentBody}});
  await driveNextRound(ctx,round1,true,{status:'paired'}); // pair
  await pairPromise;
  const finalState=fakeDB.peek('sender');
  assert.equal(finalState.paired,true);
  assert.equal(finalState.recipientKeyId,'rk_receiver');
  assert.ok(finalState.pendingJob,"a racing tab's pendingJob must survive pairing completion");
  assert.equal(finalState.pendingJob.body.jobId,concurrentBody.jobId);
});

// Issue #168 finding #3/#4: markAccepted must reject a missing/mismatched job and a
// transaction that errors/aborts while committing, never hang, and never mutate the stored
// pending job when it rejects.
test('D2 sender markAccepted rejects a mismatched job and an aborted transaction without ever hanging',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState();
  {
    const fakeDB=makeFakeIndexedDB();fakeDB.seed(base);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    await assert.rejects(ctx.sandbox.D2TrialTestHooks.markAccepted('job_'+'a'.repeat(64)),{message:'PAIRING_STATE_INVALID'});
  }
  {
    const body={bearer:base.uploadBearer,jobId:'job_'+'1'.repeat(64),descriptorSha256:'1'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}))};
    const fakeDB=makeFakeIndexedDB();fakeDB.seed({...base,pendingJob:{status:'pending',body}});
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    await assert.rejects(ctx.sandbox.D2TrialTestHooks.markAccepted('job_'+'2'.repeat(64)),{message:'PAIRING_STATE_INVALID'});
    assert.equal(fakeDB.peek('sender').pendingJob.status,'pending','a mismatched jobId must never mutate the stored pending job');
  }
  {
    const body={bearer:base.uploadBearer,jobId:'job_'+'3'.repeat(64),descriptorSha256:'3'.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}))};
    const abortingDB=makeAbortingIndexedDB({...base,pendingJob:{status:'pending',body}});
    const ctx=buildSenderSandbox({indexedDB:abortingDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    await assert.rejects(ctx.sandbox.D2TrialTestHooks.markAccepted(body.jobId),{message:'SIMULATED_TX_ABORT'});
  }
});

// Issue #168 finding #3/#4 two-tab regression: a second tab's actual send(), finding an
// already-pending job left by the first tab's real put, must always query status before any
// retry and must never issue a redundant put for a terminal/ambiguous/deleting status; it may
// retry with the exact same stored body only for partial/not-started.
test('D2 sender two-tab regression: adopter queries status before any retry and only retries the same body for partial/not-started',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  function trackedDriveRound(ctx,ok,value,log){
    const channel=readChannel(ctx.nodes),source={postMessage(message){log.push(message);}};
    ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
    ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok,value}});
    return channel;
  }
  async function trackedDriveNextRound(ctx,previousSrc,ok,value,log){const src=await waitForSrcChange(ctx,previousSrc);trackedDriveRound(ctx,ok,value,log);return src;}
  async function scenario(status,expectRetry){
    const fakeDB=makeFakeIndexedDB(),base=await makeSenderState();fakeDB.seed(base);
    // Tab 1 ("creator"): a real claim + a real, successful single put via the exact production
    // functions, leaving the stored pendingJob at 'pending' (the local accepted-commit has not
    // yet happened), which is the exact durable state a second tab would observe.
    const ctxCreator=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctxCreator.sandbox);
    const creatorHooks=ctxCreator.sandbox.D2TrialTestHooks,creatorLog=[];
    const creatorBody=await creatorHooks.buildJobBody(base);
    const claimed=await creatorHooks.claimPendingJob(creatorBody);
    assert.equal(claimed.created,true);assert.equal(claimed.adopted,false);
    const uploadPromise=creatorHooks.attemptUpload(creatorBody);
    await trackedDriveNextRound(ctxCreator,'',true,{jobId:creatorBody.jobId,status:'ready'},creatorLog);
    assert.equal(await uploadPromise,true);
    assert.deepEqual(creatorLog.map(m=>m.action),['putSyntheticJob'],'creator must perform exactly one put');
    assert.equal(creatorLog[0].body.jobId,creatorBody.jobId);
    assert.equal(fakeDB.peek('sender').pendingJob.status,'pending');
    assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,creatorBody.jobId);

    // Tab 2 ("adopter"): the actual production send(), exercised end to end.
    const ctxAdopter=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctxAdopter.sandbox);
    const adopterHooks=ctxAdopter.sandbox.D2TrialTestHooks,adopterLog=[];
    const sendPromise=adopterHooks.send();
    const src=await trackedDriveNextRound(ctxAdopter,'',true,{jobId:creatorBody.jobId,status},adopterLog);
    assert.equal(adopterLog[0].action,'getSyntheticJobStatus','adopter must query status before any retry');
    assert.equal(adopterLog[0].body.jobId,creatorBody.jobId,'adopter must query the exact same job as the creator put');
    if(expectRetry)await trackedDriveNextRound(ctxAdopter,src,true,{jobId:creatorBody.jobId,status:'ready'},adopterLog);
    await sendPromise;
    assert.equal(adopterLog.length,expectRetry?2:1,`${status}: unexpected adopter bridge actions ${JSON.stringify(adopterLog.map(m=>m.action))}`);
    if(expectRetry){
      assert.equal(adopterLog[1].action,'putSyntheticJob','partial/not-started may retry exactly once');
      assert.deepEqual(adopterLog[1].body,creatorBody,'retry must reuse the exact same body, never a newly generated one');
    }
    const finalPending=fakeDB.peek('sender').pendingJob;
    assert.equal(finalPending.body.jobId,creatorBody.jobId,'same job throughout');
    return finalPending;
  }
  for(const status of ['ready','deleted']){
    const p=await scenario(status,false);
    assert.equal(p.status,'accepted',`${status} must mark the job accepted with no adopter put`);
  }
  for(const status of ['deleting','unknown']){
    const p=await scenario(status,false);
    assert.equal(p.status,'pending',`${status} must retain the pending job unresolved with no adopter put`);
  }
  for(const status of ['partial','not-started']){
    const p=await scenario(status,true);
    assert.equal(p.status,'accepted',`${status} same-body retry must mark the job accepted on success`);
  }
});

// Issue #170: bounded second synthetic job, preserving the first accepted record unchanged.
function makeJobBody(bearer,seed){return{bearer,jobId:'job_'+seed.repeat(64),descriptorSha256:seed.repeat(64),ackProofHash:'b'.repeat(64),planSha256:'c'.repeat(64),plan:{version:'dwo-relay-plan-v1',totalBytes:3,entries:[{},{},{}]},objects:[0,1,2].map(i=>({ordinal:i,size:1,ciphertextSha256:'d'.repeat(64),bytes:'AQ'}))};}
function capturedFrom(base,oldJobId){return{oldJobId,clinicDeviceId:base.clinicDeviceId,signingKeyId:base.signingKeyId,uploadBearer:base.uploadBearer,signingPublicJwk:base.signingPublicJwk,recipientKeyId:base.recipientKeyId,recipientPublicJwk:base.recipientPublicJwk};}
function captureReady(ctx){const log=[],channel=readChannel(ctx.nodes),source={postMessage(message){log.push(message);}};ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});return{channel,source,log};}
function sendResult(ctx,channel,source,ok,value){ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok,value}});}

test('fake IndexedDB double: add rejects a duplicate key and a failed/aborted transaction rolls back every staged write, not just the failing one',async()=>{
  const fakeDB=makeFakeIndexedDB();
  fakeDB.seed({id:'x',v:1});
  const db=await new Promise(ok=>{const r=fakeDB.open();r.onsuccess=()=>ok(r.result);});
  const tx=db.transaction('state','readwrite'),store=tx.objectStore('state');
  let errored=false,aborted=false;
  tx.onabort=()=>{aborted=true;};
  store.put({id:'y',v:2});
  const req=store.add({id:'x',v:3});
  req.onerror=()=>{errored=true;};
  await new Promise(r=>setTimeout(r,0));
  assert.equal(errored,true,'add must reject a key that already exists');
  assert.equal(aborted,true,'the whole transaction must abort, not just the failing request');
  assert.equal(fakeDB.peek('y'),undefined,'a put staged in the same aborted transaction must never commit either');
  assert.deepEqual(fakeDB.peek('x'),{id:'x',v:1},'the original record must be byte-for-byte untouched');
});

test('D2 sender fixed first/second synthetic refs are distinct, both pass the real transfer-package validator, and build distinct real manifests',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const nodes={status:{},'relay-bridge':{},pair:{},send:{},send2:{}};
  const sandbox={CryptoKey:class{},crypto:{getRandomValues:v=>v,subtle:{}},document:{getElementById:id=>nodes[id]},window:{addEventListener(){},removeEventListener(){}},location:{href:'https://example.invalid/'},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout,clearTimeout,globalThis:null};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(testHookSource(source),sandbox);
  const hooks=sandbox.D2TrialTestHooks;
  assert.notEqual(hooks.FIRST_REF,hooks.SECOND_REF);
  assert.equal(T.isValidWorkOrderRef(hooks.FIRST_REF),true);
  assert.equal(T.isValidWorkOrderRef(hooks.SECOND_REF),true);
  const first=await T.buildPackage(hooks.FIRST_REF,{trial:'D2-SYNTHETIC',createdFor:'test-only'},[],{crypto:webcrypto,now:()=>1});
  const second=await T.buildPackage(hooks.SECOND_REF,{trial:'D2-SYNTHETIC',createdFor:'test-only'},[],{crypto:webcrypto,now:()=>1});
  assert.notEqual(first.manifest.workOrderRef,second.manifest.workOrderRef);
  assert.notEqual(JSON.stringify(first.manifest),JSON.stringify(second.manifest));
});

test('D2 sender rotateSecondJob archives the exact first accepted job unchanged, commits exactly one distinct second pending job, rejects stale/mismatched captures, and never creates a third generation',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1');
  const fakeDB=makeFakeIndexedDB();fakeDB.seed({...base,pendingJob:{status:'accepted',body:oldBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const captured=capturedFrom(base,oldBody.jobId);
  // A stale captured bearer (identity drift) must fail closed before any write.
  await assert.rejects(hooks.rotateSecondJob({...captured,uploadBearer:'B'.repeat(43)},makeJobBody(base.uploadBearer,'2')),{message:'D2_SECOND_JOB_STATE_INVALID'});
  assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,oldBody.jobId);
  // A stale captured old job id (snapshot no longer matches the durable accepted job) must
  // also fail closed before any write.
  await assert.rejects(hooks.rotateSecondJob({...captured,oldJobId:'job_'+'z'.repeat(64)},makeJobBody(base.uploadBearer,'3')),{message:'D2_SECOND_JOB_STATE_INVALID'});
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,oldBody.jobId);
  // A captured recipient identity that no longer matches the current paired recipient (e.g. a
  // concurrent re-pair happened) must fail closed before any write, exactly like a stale
  // sender identity.
  await assert.rejects(hooks.rotateSecondJob({...captured,recipientKeyId:'rk_'+'o'.repeat(20)},makeJobBody(base.uploadBearer,'7')),{message:'D2_SECOND_JOB_STATE_INVALID'});
  assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,oldBody.jobId);
  await assert.rejects(hooks.rotateSecondJob({...captured,recipientPublicJwk:{...base.recipientPublicJwk,x:'z'.repeat(43)}},makeJobBody(base.uploadBearer,'8')),{message:'D2_SECOND_JOB_STATE_INVALID'});
  assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,oldBody.jobId);
  // A freshly built replacement whose jobId/descriptorSha256 is identical to the job being
  // archived must never be accepted as a "second" job -- it would just silently re-accept the
  // exact same job rather than rotate to a genuinely distinct one.
  await assert.rejects(hooks.rotateSecondJob(captured,{...makeJobBody(base.uploadBearer,'9'),jobId:oldBody.jobId,descriptorSha256:oldBody.descriptorSha256}),{message:'D2_SECOND_JOB_STATE_INVALID'});
  assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,oldBody.jobId);
  // The real rotation: a fresh, distinct second body committed together with an unchanged
  // archive of the first accepted job, in one transaction.
  const newBody=makeJobBody(base.uploadBearer,'4');
  const result=await hooks.rotateSecondJob(captured,newBody);
  assert.equal(result.created,true);assert.equal(result.adopted,false);
  assert.equal(result.pendingJob.status,'pending');
  assert.equal(result.pendingJob.body.jobId,newBody.jobId);
  assert.notEqual(newBody.jobId,oldBody.jobId);
  assert.notEqual(newBody.descriptorSha256,oldBody.descriptorSha256);
  assert.deepEqual(jsonClone(fakeDB.peek(hooks.ARCHIVE_ID)),jsonClone({id:hooks.ARCHIVE_ID,pendingJob:{status:'accepted',body:oldBody}}),'the archive must hold the exact prior accepted pendingJob, unchanged');
  const storedAfterRotation=fakeDB.peek('sender');
  assert.equal(storedAfterRotation.secondGenerationOf,oldBody.jobId);
  assert.deepEqual(jsonClone(storedAfterRotation.pendingJob),jsonClone({status:'pending',body:newBody}));
  // A late tab arriving after rotation (still pending) must adopt, never create a third job.
  const loserWhilePending=await hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'5'));
  assert.equal(loserWhilePending.created,false);assert.equal(loserWhilePending.adopted,true);
  assert.equal(loserWhilePending.pendingJob.body.jobId,newBody.jobId);
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,newBody.jobId,'no third job must ever be written while the second is still pending');
  // Once the second job is accepted, a late tab must still only adopt (accepted no-op), never a third.
  await hooks.markAccepted(newBody.jobId);
  const loserWhileAccepted=await hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'6'));
  assert.equal(loserWhileAccepted.created,false);assert.equal(loserWhileAccepted.adopted,true);
  assert.equal(loserWhileAccepted.pendingJob.status,'accepted');
  assert.equal(loserWhileAccepted.pendingJob.body.jobId,newBody.jobId);
  assert.deepEqual(jsonClone(fakeDB.peek(hooks.ARCHIVE_ID)),jsonClone({id:hooks.ARCHIVE_ID,pendingJob:{status:'accepted',body:oldBody}}),'the archive must remain exactly the first accepted job across further attempts');
});

test('D2 sender rotateSecondJob fails closed on an existing or malformed archive without ever overwriting it or mutating the current accepted job',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'7');
  // A legacy/malformed pre-existing archive (status 'pending', not 'accepted') seeded without
  // the marker: existence alone must still block rotation, and the archive itself must never
  // be reinterpreted, repaired, or reset.
  const malformedArchive={id:'sender-first-accepted',pendingJob:{status:'pending',body:oldBody}};
  const fakeDB=makeFakeIndexedDB();
  fakeDB.seed({...base,pendingJob:{status:'accepted',body:oldBody}});
  fakeDB.seed(malformedArchive);
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  assert.equal(hooks.ARCHIVE_ID,'sender-first-accepted');
  const captured=capturedFrom(base,oldBody.jobId);
  await assert.rejects(hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'8')),{message:'D2_SECOND_JOB_ARCHIVE_EXISTS'});
  assert.deepEqual(fakeDB.peek(hooks.ARCHIVE_ID),malformedArchive,'a pre-existing archive, even malformed, must never be reset or overwritten');
  const stillSender=fakeDB.peek('sender');
  assert.equal(stillSender.pendingJob.status,'accepted');
  assert.equal(stillSender.pendingJob.body.jobId,oldBody.jobId);
  assert.equal(stillSender.secondGenerationOf,undefined,'no marker must ever be written when rotation fails closed');
});

test('D2 sender rotateSecondJob rolls back the whole transaction -- archive and replacement together or not at all -- when the paired write fails',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'9');
  const fakeDB=makeFakeIndexedDB({failPutId:'sender'});
  fakeDB.seed({...base,pendingJob:{status:'accepted',body:oldBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const captured=capturedFrom(base,oldBody.jobId);
  await assert.rejects(hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'a')),{message:'D2_TEST_FORCED_PUT_FAILURE'});
  assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined,'the archive add must roll back when the paired replacement write fails');
  const stillSender=fakeDB.peek('sender');
  assert.equal(stillSender.pendingJob.status,'accepted');
  assert.equal(stillSender.pendingJob.body.jobId,oldBody.jobId);
  assert.equal(stillSender.secondGenerationOf,undefined);
});

test('D2 sender sendSecond never rotates while the first job is pending or unknown -- only resumes the existing status-first path or refuses outright',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  {
    const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'b');
    const fakeDB=makeFakeIndexedDB();fakeDB.seed({...base,pendingJob:{status:'pending',body:oldBody}});
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const sendPromise=hooks.sendSecond();
    await driveNextRound(ctx,'',true,{jobId:oldBody.jobId,status:'ready'});
    await sendPromise;
    const stored=fakeDB.peek('sender');
    assert.equal(stored.pendingJob.status,'accepted');
    assert.equal(stored.pendingJob.body.jobId,oldBody.jobId,'must resolve the existing first job, never rotate while it is pending');
    assert.equal(stored.secondGenerationOf,undefined);
    assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  }
  {
    const base=await makeSenderState();
    const fakeDB=makeFakeIndexedDB();fakeDB.seed(base);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    await assert.rejects(hooks.sendSecond(),{message:'D2_SECOND_JOB_REQUIRES_FIRST_ACCEPTED'});
    assert.equal(fakeDB.peek('sender').pendingJob,undefined);
    assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  }
});

test('D2 sender sendSecond end-to-end: rotates exactly once, accepts via the bridge, survives reload, never creates a third job, and a stale first-job callback cannot resurrect or overwrite it',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'c');
  const fakeDB=makeFakeIndexedDB();fakeDB.seed({...base,pendingJob:{status:'accepted',body:oldBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const sendPromise=hooks.sendSecond();
  await waitForSrcChange(ctx,'');
  const{channel,source:msgSource,log}=captureReady(ctx);
  assert.equal(log[0].action,'putSyntheticJob','the rotation itself must never call the bridge; only the already-committed second body is uploaded');
  const newJobId=log[0].body.jobId;
  assert.notEqual(newJobId,oldBody.jobId);
  sendResult(ctx,channel,msgSource,true,{jobId:newJobId,status:'ready'});
  await sendPromise;
  let stored=fakeDB.peek('sender');
  assert.equal(stored.pendingJob.status,'accepted');
  assert.equal(stored.pendingJob.body.jobId,newJobId);
  assert.equal(stored.secondGenerationOf,oldBody.jobId);
  const archived=fakeDB.peek(hooks.ARCHIVE_ID);
  assert.deepEqual(jsonClone(archived),jsonClone({id:hooks.ARCHIVE_ID,pendingJob:{status:'accepted',body:oldBody}}));
  // Reload: a fresh durable read must observe the exact same rotated+accepted state.
  const reloaded=await hooks.getState();
  assert.equal(reloaded.pendingJob.status,'accepted');
  assert.equal(reloaded.pendingJob.body.jobId,newJobId);
  assert.equal(reloaded.secondGenerationOf,oldBody.jobId);
  // Retry via the second button again: already accepted, no third job, no bridge call at all.
  const srcBeforeRetry=ctx.nodes['relay-bridge'].src;
  await hooks.sendSecond();
  assert.equal(ctx.nodes['relay-bridge'].src,srcBeforeRetry);
  assert.deepEqual(jsonClone(fakeDB.peek(hooks.ARCHIVE_ID)),jsonClone(archived));
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,newJobId);
  // The original, unchanged send button must also simply no-op once the second job is accepted.
  const srcBeforeNormalSend=ctx.nodes['relay-bridge'].src;
  await hooks.send();
  assert.equal(ctx.nodes['relay-bridge'].src,srcBeforeNormalSend,'the original send button must never resurrect the archived first job or create a third');
  // A stale accepted-callback for the archived first job must reject, never overwrite the
  // current second job (existing markAccepted job-id check, unchanged).
  await assert.rejects(hooks.markAccepted(oldBody.jobId),{message:'PAIRING_STATE_INVALID'});
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,newJobId);
  // A delayed ambiguous status answer for the archived first job's body must never trigger a
  // retry put against the current (different) durable pending job.
  const srcBeforeStale=ctx.nodes['relay-bridge'].src;
  const stalePromise=hooks.resolvePendingJob(oldBody);
  const staleRoundSrc=await driveNextRound(ctx,srcBeforeStale,true,{jobId:oldBody.jobId,status:'partial'});
  await stalePromise;
  assert.equal(ctx.nodes['relay-bridge'].src,staleRoundSrc,'no further bridge round (a retry put) may follow a stale ambiguous status for an archived job');
  assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,newJobId,'a stale delayed check for the archived job must never resurrect it as current');
});

// Issue #170 corruption guard: a second-generation marker must never fall through to creating
// a brand new first-style job (via send()) just because the real rotated pendingJob or its
// immutable archive is missing, mismatched, or still the archived job itself. Every scenario
// here must fail closed before any bridge round-trip and must leave the seeded durable record
// completely untouched.
test('D2 sender send() fails closed on a second-generation marker with a missing/mismatched archive or an inconsistent pendingJob, with no network call and no mutation',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState();
  const oldBody=makeJobBody(base.uploadBearer,'1'),newBody=makeJobBody(base.uploadBearer,'2'),otherOldBody=makeJobBody(base.uploadBearer,'3');
  async function expectFailClosed(senderRecord,archiveRecord){
    const fakeDB=makeFakeIndexedDB();
    fakeDB.seed(senderRecord);
    if(archiveRecord!==undefined)fakeDB.seed(archiveRecord);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const srcBefore=ctx.nodes['relay-bridge'].src;
    await assert.rejects(hooks.send(),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
    assert.equal(ctx.nodes['relay-bridge'].src,srcBefore,'no bridge round may ever start for a fail-closed corruption');
    assert.equal(fakeDB.peek('sender'),senderRecord,'the durable state must be preserved exactly, never reconstructed');
  }
  // (a) marker present, pendingJob is a genuinely different pending job, but the archive is
  // entirely missing.
  await expectFailClosed({...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:newBody}},undefined);
  // (b) marker present, archive present and valid and matching the marker, but there is no
  // current pendingJob at all.
  await expectFailClosed({...base,secondGenerationOf:oldBody.jobId,pendingJob:undefined},{id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}});
  // (c) marker present, but the current pendingJob is literally the same job the marker claims
  // to have rotated away from (old-ID marker, same current -- never legitimately possible).
  await expectFailClosed({...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:oldBody}},{id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}});
  // (d) marker present, pendingJob is a genuinely different job, but the archive does not
  // match the marker (wrong archived job).
  await expectFailClosed({...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:newBody}},{id:'sender-first-accepted',pendingJob:{status:'accepted',body:otherOldBody}});
});

// Issue #170: the exact same corruption guard must also stop an explicit second-button retry
// (not just the normal send() path), including the no-op accepted case.
test('D2 sender sendSecond() also fails closed on the same marker/archive corruption, before any explicit retry or no-op',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState();
  const oldBody=makeJobBody(base.uploadBearer,'4'),newBody=makeJobBody(base.uploadBearer,'5');
  const fakeDB=makeFakeIndexedDB();
  const seeded={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'accepted',body:newBody}};
  fakeDB.seed(seeded); // archive deliberately missing
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  const srcBefore=ctx.nodes['relay-bridge'].src;
  await assert.rejects(hooks.sendSecond(),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
  assert.equal(ctx.nodes['relay-bridge'].src,srcBefore,'no bridge round, not even a no-op accepted report, may happen before the archive is verified');
  assert.equal(fakeDB.peek('sender'),seeded);
});

// Issue #170 FINAL AUDIT F1: rotateSecondJob's adopted ("lost the race") branch must read the
// immutable archive from its own transaction and verify it before ever resolving as adopted --
// a racing tab's marker + genuinely distinct pending second-generation job is not enough on its
// own if that racing tab's archive write never actually landed (or landed for a different old
// job). Resolving adopted here is exactly what previously let the caller go on to query status
// (and eventually accept) against a bridge with no corresponding verified archive.
test('D2 sender rotateSecondJob refuses to adopt a marker-consistent racing second-generation state when its immutable archive is missing or mismatched',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1'),racingBody=makeJobBody(base.uploadBearer,'2'),otherOldBody=makeJobBody(base.uploadBearer,'3');
  const captured=capturedFrom(base,oldBody.jobId);
  // (a) marker matches captured.oldJobId, current pendingJob is a genuinely distinct pending
  // job -- but the archive is entirely missing.
  {
    const fakeDB=makeFakeIndexedDB();
    const racingState={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:racingBody}};
    fakeDB.seed(racingState); // archive deliberately absent
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    await assert.rejects(hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'4')),{message:'D2_SECOND_JOB_STATE_INVALID'});
    assert.deepEqual(fakeDB.peek('sender'),racingState,'the racing marker-consistent state must be left completely untouched when its archive is missing');
    assert.equal(fakeDB.peek(hooks.ARCHIVE_ID),undefined);
  }
  // (b) same marker/pending shape, but the archive that does exist archives a different old
  // job entirely (wrong archived job) -- must still refuse to adopt.
  {
    const fakeDB=makeFakeIndexedDB();
    const racingState={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:racingBody}};
    fakeDB.seed(racingState);
    fakeDB.seed({id:'sender-first-accepted',pendingJob:{status:'accepted',body:otherOldBody}});
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    await assert.rejects(hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'5')),{message:'D2_SECOND_JOB_STATE_INVALID'});
    assert.deepEqual(fakeDB.peek('sender'),racingState);
  }
  // (c) a genuine valid concurrent adoption (archive present, valid, and matching exactly) must
  // still succeed exactly as before -- the new guard must not weaken the already-covered case.
  {
    const fakeDB=makeFakeIndexedDB();
    const racingState={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:racingBody}};
    const archiveRecord={id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}};
    fakeDB.seed(racingState);
    fakeDB.seed(archiveRecord);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const result=await hooks.rotateSecondJob(captured,makeJobBody(base.uploadBearer,'6'));
    assert.equal(result.created,false);assert.equal(result.adopted,true);
    assert.equal(result.pendingJob.body.jobId,racingBody.jobId);
    assert.deepEqual(fakeDB.peek(hooks.ARCHIVE_ID),archiveRecord,'a genuine valid concurrent adoption must remain unaffected');
  }
});

// Issue #170 FINAL AUDIT F2: a legacy markerless current paired with no pendingJob but an
// archive already present (fault injection/corruption) must never fall through to creating a
// brand-new first-style job -- neither through send()'s pre-decision check nor, independently,
// through claimPendingJob's own readwrite transaction (so a stale pre-check can never be relied
// on alone). Normal legacy first send with genuinely no archive must remain exactly functional.
test('D2 sender send() and claimPendingJob both refuse a markerless legacy state when an archive is already present, with no network call and no mutation',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1');
  const archiveRecord={id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}};
  // (a) through send(): must fail closed before any bridge round and without ever building/
  // claiming a new job body.
  {
    const fakeDB=makeFakeIndexedDB();
    fakeDB.seed(base); // no marker, no pendingJob
    fakeDB.seed(archiveRecord); // fault-injected archive with no corresponding marker
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const srcBefore=ctx.nodes['relay-bridge'].src;
    await assert.rejects(hooks.send(),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
    assert.equal(ctx.nodes['relay-bridge'].src,srcBefore,'no bridge round may ever start for an inconsistent legacy/archive state');
    assert.equal(fakeDB.peek('sender'),base,'the durable state must be preserved exactly, never used to create a new job');
    assert.deepEqual(fakeDB.peek(hooks.ARCHIVE_ID),archiveRecord,'the pre-existing archive must never be reset or reinterpreted');
  }
  // (b) directly against claimPendingJob's own transaction, proving the guard is not merely a
  // pre-send check that a stale read could bypass.
  {
    const fakeDB=makeFakeIndexedDB();
    fakeDB.seed(base);
    fakeDB.seed(archiveRecord);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const newBody=makeJobBody(base.uploadBearer,'2');
    await assert.rejects(hooks.claimPendingJob(newBody),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
    assert.equal(fakeDB.peek('sender'),base,'no pendingJob must ever be created when an archive already exists for this markerless state');
    assert.deepEqual(fakeDB.peek(hooks.ARCHIVE_ID),archiveRecord);
  }
  // (c) normal legacy first send with genuinely no archive at all must remain exactly
  // functional -- the new guard must never block the already-covered ordinary case.
  {
    const fakeDB=makeFakeIndexedDB();
    fakeDB.seed(base);
    const ctx=buildSenderSandbox({indexedDB:fakeDB});
    vm.runInNewContext(testHookSource(source),ctx.sandbox);
    const hooks=ctx.sandbox.D2TrialTestHooks;
    const newBody=makeJobBody(base.uploadBearer,'3');
    const claimed=await hooks.claimPendingJob(newBody);
    assert.equal(claimed.created,true);assert.equal(claimed.adopted,false);
    assert.equal(fakeDB.peek('sender').pendingJob.body.jobId,newBody.jobId);
  }
});

// Issue #170 FINAL AUDIT: claimPendingJob's adoption branch (an already-pending/accepted
// current job) must also validate a second-generation marker against its own transaction's
// archive read before adopting -- not just the creation branch -- so a corrupted marked state
// (archive missing or mismatched) is never silently adopted by the original send() path either.
test('D2 sender claimPendingJob refuses to adopt an existing second-generation pendingJob when its immutable archive is missing',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1'),newGenBody=makeJobBody(base.uploadBearer,'2');
  const fakeDB=makeFakeIndexedDB();
  const seeded={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:newGenBody}};
  fakeDB.seed(seeded); // archive missing
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  await assert.rejects(hooks.claimPendingJob(makeJobBody(base.uploadBearer,'3')),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
  assert.equal(fakeDB.peek('sender'),seeded,'the marked state must be left completely untouched when its archive is missing');
});

// Issue #170 FINAL AUDIT: markAccepted must also refuse to commit 'accepted' into a
// second-generation state whose immutable archive has since become inconsistent, checked from
// the exact same write transaction, even though the corresponding bridge status query/upload
// (if any) may have already been dispatched and cannot itself be undone.
test('D2 sender markAccepted refuses to commit into an inconsistent second-generation marker state (missing archive) within the same write transaction',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1'),newGenBody=makeJobBody(base.uploadBearer,'2');
  const fakeDB=makeFakeIndexedDB();
  const seeded={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:newGenBody}};
  fakeDB.seed(seeded); // archive missing
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  await assert.rejects(hooks.markAccepted(newGenBody.jobId),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
  assert.equal(fakeDB.peek('sender').pendingJob.status,'pending','must never mark accepted into an inconsistently marked state');
});

// Issue #170 A3: resolvePendingJob must never retry with a body that merely matches jobId and
// bearer but differs from the exact durable record in any other field, and any retry it does
// perform must use that exact durable body, never the caller-supplied snapshot.
test('D2 sender resolvePendingJob never retries a body that only partially matches the durable pending job, and always retries with the exact durable body',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),durableBody=makeJobBody(base.uploadBearer,'6');
  const fakeDB=makeFakeIndexedDB();fakeDB.seed({...base,pendingJob:{status:'pending',body:durableBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const hooks=ctx.sandbox.D2TrialTestHooks;
  // Same jobId/bearer as the durable record, but a different planSha256 -- must never be
  // retried as though it were the exact current pending job.
  const staleBody={...durableBody,planSha256:'f'.repeat(64)};
  const log=[];
  const resolvePromise=hooks.resolvePendingJob(staleBody);
  await waitForSrcChange(ctx,'');
  const channel=readChannel(ctx.nodes),msgSource={postMessage(message){log.push(message);}};
  ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:msgSource,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:msgSource,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{jobId:durableBody.jobId,status:'not-started'}}});
  await resolvePromise;
  assert.deepEqual(log.map(m=>m.action),['getSyntheticJobStatus'],'a field mismatch against the exact durable body must stop before any retry put');
  assert.equal(fakeDB.peek('sender').pendingJob.status,'pending');
  assert.equal(fakeDB.peek('sender').pendingJob.body.planSha256,durableBody.planSha256,'the durable body must never be replaced by the caller-supplied stale body');
});

test('D2 sender refuses retry if immutable archive disappears during a dispatched status request',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1'),nextBody=makeJobBody(base.uploadBearer,'2');
  const fakeDB=makeFakeIndexedDB(),seeded={...base,secondGenerationOf:oldBody.jobId,pendingJob:{status:'pending',body:nextBody}};
  fakeDB.seed(seeded);fakeDB.seed({id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}});
  const ctx=buildSenderSandbox({indexedDB:fakeDB});vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const run=ctx.sandbox.D2TrialTestHooks.send();await waitForSrcChange(ctx,'');
  const {channel,source:msgSource,log}=captureReady(ctx);assert.equal(log[0].action,'getSyntheticJobStatus');
  const dispatched=ctx.nodes['relay-bridge'].src;fakeDB.erase('sender-first-accepted');
  sendResult(ctx,channel,msgSource,true,{jobId:nextBody.jobId,status:'partial'});await run;
  assert.equal(ctx.nodes['relay-bridge'].src,dispatched,'must not dispatch a put after losing archive');
  assert.equal(fakeDB.peek('sender'),seeded);assert.equal(fakeDB.peek('sender-first-accepted'),undefined);
});
test('D2 sender markAccepted refuses legacy orphan archive without mutation',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const base=await makeSenderState(),oldBody=makeJobBody(base.uploadBearer,'1'),nextBody=makeJobBody(base.uploadBearer,'2');
  const fakeDB=makeFakeIndexedDB(),seeded={...base,pendingJob:{status:'pending',body:nextBody}},archive={id:'sender-first-accepted',pendingJob:{status:'accepted',body:oldBody}};
  fakeDB.seed(seeded);fakeDB.seed(archive);
  const ctx=buildSenderSandbox({indexedDB:fakeDB});vm.runInNewContext(testHookSource(source),ctx.sandbox);
  await assert.rejects(ctx.sandbox.D2TrialTestHooks.markAccepted(nextBody.jobId),{message:'D2_SECOND_GENERATION_STATE_INVALID'});
  assert.equal(fakeDB.peek('sender'),seeded);assert.equal(fakeDB.peek('sender-first-accepted'),archive);
});

// Issue #170 A5: exercises the actual production buildJobBody hook with the real
// MediaTransferPackage/MediaTransferCrypto/MediaRelayTransport/MediaReceiverBootstrap modules
// and real generated keys (no fakes, no live network) -- verifying the first and second fixed
// refs produce genuinely distinct real encrypted descriptors/job ids, and that the resulting
// ackProofHash is bound to this exact real jobId/descriptor/ref via the production formula,
// independently recomputed here.
test('D2 sender buildJobBody with real crypto/package/relay modules produces distinct first/second descriptors and a correctly bound real ack proof hash',async()=>{
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  const sender=await C.generateSenderIdentity({crypto:webcrypto});
  const recipient=await C.generateRecipientIdentity('d2-trial-real-fixture-passphrase',{crypto:webcrypto});
  const nodes={status:{},'relay-bridge':{},pair:{},send:{},send2:{}};
  const sandbox={CryptoKey:globalThis.CryptoKey,crypto:webcrypto,btoa:s=>Buffer.from(s,'binary').toString('base64'),Blob:globalThis.Blob,Uint8Array,Date,document:{getElementById:id=>nodes[id]},window:{addEventListener(){},removeEventListener(){}},location:{href:'https://example.invalid/'},URL,TextEncoder,indexedDB:{},isSecureContext:true,Error,Array,Number,Object,Promise,setTimeout,clearTimeout,MediaTransferPackage:T,MediaTransferCrypto:C,MediaRelayTransport:R,MediaReceiverBootstrap:B,globalThis:null};
  sandbox.globalThis=sandbox;
  vm.runInNewContext(testHookSource(source),sandbox);
  const hooks=sandbox.D2TrialTestHooks;
  const state={signingPrivateKey:sender.privateKey,signingPublicJwk:sender.publicJwk,clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,recipientKeyId:recipient.recipientKeyId,recipientPublicJwk:recipient.publicJwk,uploadBearer:'A'.repeat(43)};
  const first=await hooks.buildJobBody(state,hooks.FIRST_REF);
  const second=await hooks.buildSecondJobBody(state);
  assert.notEqual(first.jobId,second.jobId);
  assert.notEqual(first.descriptorSha256,second.descriptorSha256);
  assert.equal(first.jobId,'job_'+first.descriptorSha256);
  assert.equal(second.jobId,'job_'+second.descriptorSha256);
  assert.ok(first.objects.length>=3,'the real transfer plan must contain at least bootstrap/manifest/work-order parts');
  assert.ok(second.objects.length>=3);
  for(const {body,ref} of [{body:first,ref:hooks.FIRST_REF},{body:second,ref:hooks.SECOND_REF}]){
    const expectedProof=h('dwo-receiver-ack-v1|'+body.jobId+'|'+body.descriptorSha256+'|'+ref);
    const expectedAckProofHash=h(expectedProof);
    assert.equal(body.ackProofHash,expectedAckProofHash,'ackProofHash must be bound to this exact real jobId/descriptor/ref via the production formula, independently recomputed');
  }
});

async function fixture() { const recipient=await C.generateRecipientIdentity('d2-passphrase',{crypto:webcrypto}); const sender=await C.generateSenderIdentity({crypto:webcrypto}); const offer=await C.createPairingOffer(recipient,{crypto:webcrypto,now:()=>1}); const response=await C.createPairingResponse(offer,sender,{crypto:webcrypto,now:()=>2}); const registry=await C.verifyPairingResponse(offer,response,{crypto:webcrypto,now:()=>3}); const marker='SYNTHETIC_CLINICAL_MARKER_NEVER_IN_RELAY_META'; const pkg=await T.buildPackage(REF,{workOrderRef:REF,trialMarker:marker},[{meta:{attachmentId:'att-123e4567-e89b-42d3-a456-426614174001',kind:'file',mime:'application/octet-stream',size:4},blob:new Blob([Uint8Array.from([1,2,3,4])])}],{crypto:webcrypto,now:()=>4,chunkSize:4}); const envelope=await C.encryptPackage(pkg,sender,recipient,{crypto:webcrypto,now:()=>5}); const built=await R.buildCreateRequest(envelope,sender,{crypto:webcrypto,now:()=>6,recipientPublicInfo:recipient,bootstrapApi:B}); return {recipient,registry,built,marker}; }
async function writeJob(f) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'d2-synced-root-')),dir=path.join(root,'job');await fs.mkdir(dir);const objects=[]; for(const [ordinal,part] of f.built.parts.entries()){const bytes=Buffer.from(await part.blob.arrayBuffer());const name=`obj_${String(ordinal).padStart(4,'0')}.bin`;await fs.writeFile(path.join(dir,name),bytes);objects.push({ordinal,name,fileId:`synthetic_${ordinal}`,size:bytes.length,ciphertextSha256:h(bytes)});} const first=f.built.request.plan.entries[0],descriptorSha256=f.built.request.envelopeHeader.descriptorSha256,planSha256=h(Buffer.from(R.canonicalJson(f.built.request.plan))),totalBytes=objects.reduce((n,o)=>n+o.size,0);const meta={version:constants.META_VERSION,state:'ready',jobId:'job_'+descriptorSha256,descriptorSha256,ackProofHash:'b'.repeat(64),planSha256,totalBytes,objects,bootstrap:{version:first.bootstrapVersion,recipientKeyId:first.recipientKeyId,ephemeralPublicJwk:first.ephemeralPublicJwk,hkdfSalt:first.hkdfSalt,iv:first.iv,ciphertextSize:objects[0].size,ciphertextSha256:objects[0].ciphertextSha256}};const metaText=JSON.stringify(meta);await fs.writeFile(path.join(dir,'meta.json'),metaText);await fs.writeFile(path.join(dir,'ready.json'),JSON.stringify({version:constants.META_VERSION,jobId:meta.jobId,state:'ready',planSha256,metaSha256:h(Buffer.from(metaText))}));return {root,dir,meta}; }
test('D2 package/envelope is buildable and relay metadata is opaque',async()=>{const f=await fixture(),{root,dir,meta}=await writeJob(f);try{const text=JSON.stringify(meta);assert.equal(text.includes(f.marker),false);assert.equal(text.includes(REF),false);assert.equal((await readVerifiedSyncedJob(dir)).blobs.length,meta.objects.length);}finally{await fs.rm(root,{recursive:true,force:true});}});
test('D2 adapter refuses incomplete or mismatched objects before persistence or ACK',async()=>{const f=await fixture(),{root,dir,meta}=await writeJob(f);let persisted=false,acked=false;try{await fs.rm(path.join(dir,meta.objects[1].name));await assert.rejects(()=>processD2SyncedJob(dir,{persist:async()=>{persisted=true;},ack:async()=>{acked=true;}}),{code:'D2_SYNC_OBJECT_MISSING'});assert.equal(persisted,false);assert.equal(acked,false);await fs.writeFile(path.join(dir,meta.objects[1].name),'wrong');await assert.rejects(()=>readVerifiedSyncedJob(dir),{code:/D2_SYNC_OBJECT_(SIZE|HASH)_MISMATCH/});}finally{await fs.rm(root,{recursive:true,force:true});}});
test('D2 receive enforces existing sender byte/object limits before reading or persisting',async()=>{
  const f=await fixture(),{root,dir,meta}=await writeJob(f);
  let persisted=0,acked=0;
  const options={persist:async()=>{persisted++;},control:{issueAckCapability:async()=>{acked++;},ack:async()=>{acked++;}}};
  const max=1024*1024;
  async function writeMeta(value){
    const text=JSON.stringify(value);
    await fs.writeFile(path.join(dir,'meta.json'),text);
    await fs.writeFile(path.join(dir,'ready.json'),JSON.stringify({version:value.version,jobId:value.jobId,state:'ready',planSha256:value.planSha256,metaSha256:h(Buffer.from(text))}));
  }
  try{
    const tooMany=structuredClone(meta);
    while(tooMany.objects.length<17){
      const ordinal=tooMany.objects.length;
      tooMany.objects.push({ordinal,name:'obj_'+String(ordinal).padStart(4,'0')+'.bin',fileId:'synthetic_extra_'+ordinal,size:1,ciphertextSha256:h(Buffer.from([0]))});
      tooMany.totalBytes++;
    }
    await writeMeta(tooMany);
    await assert.rejects(()=>processD2SyncedJob(dir,options),{code:'D2_METADATA_INVALID'});
    const tooLarge=structuredClone(meta);
    tooLarge.objects[1].size+=max+1-tooLarge.totalBytes;
    tooLarge.totalBytes=max+1;
    await writeMeta(tooLarge);
    await assert.rejects(()=>processD2SyncedJob(dir,options),{code:'D2_METADATA_INVALID'});
    await writeMeta(meta);
    await fs.truncate(path.join(dir,meta.objects[1].name),max+1);
    await assert.rejects(()=>processD2SyncedJob(dir,options),{code:'D2_SYNC_OBJECT_SIZE_MISMATCH'});
    await fs.truncate(path.join(dir,'meta.json'),max+1);
    await assert.rejects(()=>processD2SyncedJob(dir,options),{code:'D2_METADATA_INVALID'});
    assert.equal(persisted,0);assert.equal(acked,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('adapter rejects a ready/meta byte-hash mismatch before persist or ACK',async()=>{const f=await fixture(),{root,dir}=await writeJob(f);let persisted=false,acked=false;try{const marker=JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8'));marker.metaSha256='0'.repeat(64);await fs.writeFile(path.join(dir,'ready.json'),JSON.stringify(marker));await assert.rejects(()=>processD2SyncedJob(dir,{persist:async()=>{persisted=true;return{status:'stored'};},control:{issueAckCapability:async()=>{acked=true;},ack:async()=>{acked=true;}}}),{code:'D2_METADATA_INVALID'});assert.equal(persisted,false);assert.equal(acked,false);}finally{await fs.rm(root,{recursive:true,force:true});}});
test('simple Apps Script pairing JSON decrypts, then persist/issue-capability/ACK are ordered',async()=>{const f=await fixture(),{root,dir,meta}=await writeJob(f),order=[];try{const s=f.registry;await fs.writeFile(path.join(root,'pairing.json'),JSON.stringify({clinicDeviceId:s.clinicDeviceId,signingKeyId:s.activeSigningKey.signingKeyId,signingPublicJwk:s.activeSigningKey.publicJwk,recipientKeyId:s.pairedRecipientKeyId}));const result=await processD2SyncedJob(dir,{recipientKeyRingOrIdentity:f.recipient,inboxRoot:path.join(root,'inbox'),now:()=>9,persist:async(value,opts)=>{order.push('persist');assert.equal(value.workOrderRef,REF);return persistVerifiedPackage(value,opts);},control:{issueAckCapability:async id=>{order.push('issue');return{jobId:id,ackCapability:'Z'.repeat(43)};},ack:async value=>{order.push('ack');assert.equal(value.jobId,meta.jobId);assert.match(value.ackProof,/^[0-9a-f]{64}$/);return{jobId:meta.jobId,status:'deleted'};}}});assert.equal(result.status,'stored');assert.deepEqual(order,['persist','issue','ack']);}finally{await fs.rm(root,{recursive:true,force:true});}});
test('Apps Script control sends receiver bearer and raw ACK proof as JSON and rejects bad endpoint',async()=>{let body;const c=createAppsScriptControl('https://script.google.com/macros/s/ABC_123/exec','A'.repeat(43),async(_u,o)=>{body=JSON.parse(o.body);return{ok:true,json:async()=>({jobId:body.jobId,status:'deleted'})};});await c.ack({jobId:'job_'+ 'a'.repeat(64),ackCapability:'x',ackProof:'b'.repeat(64)});assert.equal(body.action,'ack');assert.equal(body.receiverBearer,'A'.repeat(43));assert.equal(body.ackProof,'b'.repeat(64));assert.throws(()=>createAppsScriptControl('https://bad.test','A'.repeat(43),async()=>{}),{code:'D2_CONTROL_CONFIG_INVALID'});});
test('actual Apps Script source parses in VM, keeps control inert, and uses ALLOWALL/exact parent',async()=>{const source=await fs.readFile(new URL('../gateway/drive-relay-d2-trial.gs',import.meta.url),'utf8'),props={getProperty:()=>null};const sandbox={ContentService:{MimeType:{JSON:'json'},createTextOutput:v=>({v,setMimeType(){return this},getContent(){return this.v}})},PropertiesService:{getScriptProperties:()=>props},Utilities:{},HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:v=>({v,setXFrameOptionsMode(x){this.x=x;return this}})},JSON,Error,encodeURIComponent};vm.runInNewContext(source,sandbox,{filename:'drive-relay-d2-trial.gs'});assert.deepEqual(JSON.parse(sandbox.doPost({postData:{contents:'{}'}}).getContent()),{ok:false,error:'D2_CONTROL_REJECTED'});assert.match(source,/setXFrameOptionsMode\(HtmlService\.XFrameOptionsMode\.ALLOWALL\)/);assert.match(source,/https:\/\/311experience-gisikoubou\.github\.io/);assert.match(source,/e\.source!==top/);assert.match(source,/top\.postMessage/);assert.match(source,/\.d2Bridge\(c,e\.data\.action,e\.data\.body\)/);assert.match(source,/function d2Bridge\(c,a,b\)\{return d2Bridge_\(c,a,b\);\}/);assert.doesNotMatch(source,/\.d2Bridge_\(c,e\.data\.action,e\.data\.body\)/);assert.doesNotMatch(source,/parent\.postMessage/);});

const b64u=b=>Buffer.from(b).toString('base64url');const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
async function fakeGateway(){const source=await fs.readFile(new URL('../gateway/drive-relay-d2-trial.gs',import.meta.url),'utf8'),rows=new Map(),props=new Map(),rootId='root id',id=(()=>{let n=0;return()=>`drive id ${++n}`})(),add=(kind,name,parent,bytes=Buffer.alloc(0))=>{const x={id:id(),kind,name,parent,bytes:Buffer.from(bytes)};rows.set(x.id,x);return x},root=add('folder','DWO_RELAY_D2_SYNTHETIC_ONLY',null),iter=a=>{let i=0;return{hasNext:()=>i<a.length,next:()=>a[i++]}};
function folder(x){return{getId:()=>x.id,getName:()=>x.name,getFilesByName:n=>iter([...rows.values()].filter(v=>v.parent===x.id&&v.kind==='file'&&v.name===n).map(file)),getFoldersByName:n=>iter([...rows.values()].filter(v=>v.parent===x.id&&v.kind==='folder'&&v.name===n).map(folder)),getFiles:()=>iter([...rows.values()].filter(v=>v.parent===x.id&&v.kind==='file').map(file)),getFolders:()=>iter([...rows.values()].filter(v=>v.parent===x.id&&v.kind==='folder').map(folder)),createFile:(n,v)=>file(add('file',n,x.id,typeof v==='string'?v:v.bytes)),createFolder:n=>folder(add('folder',n,x.id))};}
function file(x){return{getId:()=>x.id,getName:()=>x.name,getSize:()=>x.bytes.length,getBlob:()=>blob(x.bytes),setContent:v=>{x.bytes=Buffer.from(v)}};}function blob(bytes){return{bytes:Buffer.from(bytes),getBytes(){return [...this.bytes].map(x=>x>127?x-256:x)},getDataAsString(){return this.bytes.toString()}};}
const upload='upload bearer',receiver='receiver bearer',sha=v=>h(Buffer.from(String(v))),jwk={kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)};for(const [k,v] of Object.entries({D2_TRIAL_ENABLED:'true',D2_PARENT_ORIGIN:'https://311experience-gisikoubou.github.io',D2_SYNTHETIC_ROOT_ID:root.id,D2_RECEIVER_BEARER_SHA256:sha(receiver),D2_RECIPIENT_PUBLIC_JSON:JSON.stringify({recipientKeyId:'rk_receiver',publicJwk:jwk}),D2_UPLOAD_BEARER_SHA256:sha(upload),D2_PAIRING_ENABLED:'true'}))props.set(k,v);let failDelete='',failDeleteName='';const lockStats={wait:0,release:0},response=(code,text='')=>({getResponseCode:()=>code,getContentText:()=>text});const sandbox={JSON,Error,encodeURIComponent,Number,Math,Object,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,getProperties:()=>Object.fromEntries(props),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},DriveApp:{getFolderById:i=>{const x=rows.get(i);if(!x||x.kind!=='folder')throw Error('missing');return folder(x)}},MimeType:{PLAIN_TEXT:'text'},LockService:{getScriptLock:()=>({waitLock(){lockStats.wait++;},releaseLock(){lockStats.release++;}})},Utilities:{base64DecodeWebSafe:s=>[...Buffer.from(s,'base64url')].map(x=>x>127?x-256:x),newBlob:(v,_t,n)=>({bytes:Buffer.from(v),name:n,getBytes(){return [...this.bytes].map(x=>x>127?x-256:x)}}),computeDigest:(_a,b)=>[...createHash('sha256').update(Buffer.from(b.map(x=>x<0?x+256:x))).digest()].map(x=>x>127?x-256:x),DigestAlgorithm:{SHA_256:'sha'},getUuid:()=> 'a'.repeat(32)},ScriptApp:{getOAuthToken:()=> 'token'},UrlFetchApp:{fetch:(url,opt={})=>{const m=/files\/([^?]+)/.exec(url),x=m&&rows.get(decodeURIComponent(m[1]));if(opt.method==='delete'){if(!x)return response(404);if(failDelete===x.id||failDeleteName===x.name){failDelete='';failDeleteName='';return response(500);}rows.delete(x.id);return response(204);}if(!x)return response(404);return response(200,JSON.stringify({id:x.id,name:x.name,parents:x.parent?[x.parent]:[],mimeType:x.kind==='folder'?'application/vnd.google-apps.folder':'text/plain'}));}},ContentService:{MimeType:{JSON:'json'},createTextOutput:v=>({v,setMimeType(){return this},getContent(){return this.v}})},HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createHtmlOutput:v=>({v,setXFrameOptionsMode(x){this.x=x;return this}})}};vm.runInNewContext(source,sandbox,{filename:'drive-relay-d2-trial.gs'});return{g:sandbox,rows,props,lockStats,root,upload,receiver,sha,setFail:id=>{failDelete=id},setFailName:name=>{failDeleteName=name},file:(parent,name)=>[...rows.values()].find(x=>x.parent===parent.id&&x.name===name),add:(parent,name)=>add('file',name,parent.id,'unrelated')};}
async function testGateway(){const e=await fakeGateway();e.g.Utilities.newBlob=(v,_t,n)=>({bytes:Buffer.from(v),name:n,getBytes(){return [...this.bytes].map(x=>x>127?x-256:x)}});return e;}
const rawFakeGateway=fakeGateway;fakeGateway=async()=>{const e=await rawFakeGateway(),wrap=f=>{const cf=f.createFile,cd=f.createFolder,gf=f.getFoldersByName;f.createFile=(a,b)=>typeof a==='object'?cf(a.name||'blob',a):cf(a,b);f.createFolder=n=>wrap(cd(n));f.getFoldersByName=n=>{const i=gf(n);return{hasNext:()=>i.hasNext(),next:()=>wrap(i.next())}};return f},get=e.g.DriveApp.getFolderById;e.g.Utilities.newBlob=(v,_t,n)=>({bytes:Buffer.from(v),name:n,getBytes(){return [...this.bytes].map(x=>x>127?x-256:x)}});e.g.DriveApp.getFolderById=i=>wrap(get(i));return e;};
function body(env,proof='proof-a'){env.rawAckProof=proof;const descriptor='d'.repeat(64),parts=[Buffer.from('one'),Buffer.from('two'),Buffer.from('three'),Buffer.from('four')],hashes=parts.map(h),plan={version:'dwo-relay-plan-v1',totalBytes:parts.reduce((n,p)=>n+p.length,0),entries:[{slot:'receiver-bootstrap',kind:'receiver-bootstrap',iv:'iv0',size:parts[0].length,ciphertextSha256:hashes[0],bootstrapVersion:'dwo-receiver-bootstrap-v1',recipientKeyId:'rk_receiver',ephemeralPublicJwk:{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},hkdfSalt:'salt'},{slot:'manifest',kind:'manifest',iv:'iv1',size:parts[1].length,ciphertextSha256:hashes[1]},{slot:'work-order',kind:'work-order',iv:'iv2',size:parts[2].length,ciphertextSha256:hashes[2]},{slot:'attachment:att_one:0',kind:'attachment',iv:'iv3',size:parts[3].length,ciphertextSha256:hashes[3],attachmentId:'att_one',index:0}]};return{bearer:env.upload,jobId:'job_'+descriptor,descriptorSha256:descriptor,ackProofHash:h(proof),rawAckProof:proof,plan,planSha256:h(Buffer.from(canonical(plan))),objects:parts.map((v,ordinal)=>({ordinal,size:v.length,ciphertextSha256:h(v),bytes:b64u(v)}))};}
function control(env,v){return env.g.d2Control_({receiverBearer:env.receiver,...v,ackProof:v.ackProof===h(env.rawAckProof)?env.rawAckProof:v.ackProof});}
test('gateway VM: public HtmlService bridge delegates only to private D2 bridge logic',async()=>{const e=await fakeGateway(),c='A'.repeat(24),cfg=e.g.d2Bridge(c,'getConfig',{});assert.equal(cfg.recipientKeyId,'rk_receiver');assert.deepEqual(cfg.publicJwk,{kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)});assert.throws(()=>e.g.d2Bridge('short','getConfig',{}),/D2_BRIDGE_INVALID/);assert.throws(()=>e.g.d2Bridge(c,'unknown',{}),/D2_BRIDGE_ACTION_INVALID/);});
test('gateway VM: pairing is serialized and conflicting retry cannot rotate verifier',async()=>{const e=await fakeGateway(),jwk={kty:'EC',crv:'P-256',x:'x'.repeat(43),y:'y'.repeat(43)},pair={bearerSha256:e.sha(e.upload),clinicDeviceId:'dev_pair',signingKeyId:'sk_pair',signingPublicJwk:jwk,recipientKeyId:'rk_receiver'};assert.equal(e.g.d2Pair_(pair).status,'paired');assert.deepEqual(e.lockStats,{wait:1,release:1});const verifier=e.props.get('D2_UPLOAD_BEARER_SHA256');assert.throws(()=>e.g.d2Pair_({...pair,bearerSha256:'0'.repeat(64)}),/D2_PAIR_CONFLICT/);assert.deepEqual(e.lockStats,{wait:2,release:2});assert.equal(e.props.get('D2_UPLOAD_BEARER_SHA256'),verifier);assert.equal([...e.rows.values()].filter(x=>x.name==='pairing.json').length,1);});
test('gateway VM: bearer, inside-job staging, partial retry, and idempotent finalization',async()=>{const e=await fakeGateway(),b=body(e);assert.throws(()=>e.g.d2Put_({...b,bearer:'wrong'}),/D2_UPLOAD_AUTH_INVALID/);assert.equal(e.rows.size,1);const corrupt=structuredClone(b);corrupt.objects[2].bytes=b64u(Buffer.from('bad'));assert.throws(()=>e.g.d2Put_(corrupt),/D2_OBJECT_HASH_INVALID/);const job=e.file(e.root,b.jobId);assert.ok(job);assert.ok(e.file(job,'staging.json'));assert.equal(e.file(job,'meta.json'),undefined);assert.equal(e.file(job,'ready.json'),undefined);assert.equal(e.file(job,'obj_0000.bin').name,'obj_0000.bin');const changed=structuredClone(b);changed.plan.entries[3].slot='attachment:att_other:0';changed.plan.entries[3].attachmentId='att_other';changed.planSha256=h(Buffer.from(canonical(changed.plan)));assert.throws(()=>e.g.d2Put_(changed),/D2_CONFLICT/);assert.equal(e.g.d2Put_(b).status,'ready');assert.equal(e.g.d2Put_(b).status,'ready');const ready=JSON.parse(e.file(job,'ready.json').bytes);assert.equal(ready.planSha256,b.planSha256);assert.equal(ready.metaSha256,h(e.file(job,'meta.json').bytes));assert.equal([...e.rows.values()].filter(x=>x.name===b.jobId).length,1);assert.equal([...e.rows.values()].filter(x=>x.name==='meta.json').length,1);assert.equal([...e.rows.values()].filter(x=>x.name==='ready.json').length,1);e.file(job,'obj_0001.bin').bytes=Buffer.from('changed');assert.throws(()=>e.g.d2Put_(b),/D2_CONFLICT/);e.root.name='not dedicated';assert.throws(()=>e.g.d2Put_(b),/D2_ROOT_INVALID/);});
test('gateway VM: script-property headroom rejects only a new job and preserves existing partial recovery plus tombstones',async()=>{const e=await fakeGateway(),first=body(e),corrupt=structuredClone(first);corrupt.objects[2].bytes=b64u(Buffer.from('bad'));assert.throws(()=>e.g.d2Put_(corrupt),/D2_OBJECT_HASH_INVALID/);const partial=e.file(e.root,first.jobId);assert.ok(partial);e.add(e.root,'unrelated-root-file.txt');const tombKey='D2_DELETED_job_'+'f'.repeat(64),tombValue='preserve-replay-proof';e.props.set(tombKey,tombValue);for(let i=0;i<48;i++)e.props.set('FILL_'+i,'x'.repeat(8192));const second=body(e);second.descriptorSha256='e'.repeat(64);second.jobId='job_'+second.descriptorSha256;assert.throws(()=>e.g.d2Put_(second),/D2_PROPERTY_CAPACITY_EXHAUSTED/);assert.equal(e.file(e.root,second.jobId),undefined,'capacity rejection must occur before creating a Drive folder');assert.equal(e.props.get(tombKey),tombValue,'replay-prevention tombstones must never be evicted to create space');assert.equal(e.g.d2Put_(first).status,'ready','an already-started partial job remains recoverable even after the new-job guard closes');});
test('gateway VM: ACK auth, deletion resume, and staging deletion preserve unrelated root files',async()=>{const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);const job=e.file(e.root,b.jobId),stage=e.file(job,'staging.json'),rootFile=e.add(e.root,'keep.txt');assert.throws(()=>e.g.d2Control_({receiverBearer:'bad',action:'ack',jobId:b.jobId}),/D2_RECEIVER_AUTH_INVALID/);assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:'bad',ackProof:b.ackProofHash}),/D2_ACK_INVALID/);let issued=control(e,{action:'issueAckCapability',jobId:b.jobId});assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:'0'.repeat(64)}),/D2_ACK_INVALID/);issued=control(e,{action:'issueAckCapability',jobId:b.jobId});const first=e.file(job,'obj_0000.bin');e.setFail(first.id);assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}),/D2_DELETE_FAILED/);const controlFile=e.file(e.root,'control_'+b.jobId+'.json');assert.ok(controlFile);assert.equal(JSON.parse(e.file(job,'meta.json').bytes).state,'deleting');assert.throws(()=>control(e,{action:'issueAckCapability',jobId:b.jobId}),/D2_JOB_NOT_READY/);assert.equal(control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}).status,'deleted');assert.equal(e.file(e.root,b.jobId),undefined);assert.equal(e.rows.has(stage.id),false);assert.ok(e.rows.has(rootFile.id));});

test('gateway VM: folder-deleted/control-delete interruption resumes and lost ACK response is idempotent',async()=>{const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);const rootFile=e.add(e.root,'keep-after-delete.txt'),issued=control(e,{action:'issueAckCapability',jobId:b.jobId}),controlName='control_'+b.jobId+'.json';e.setFailName(controlName);assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}),/D2_DELETE_FAILED/);assert.equal(e.file(e.root,b.jobId),undefined);assert.ok(e.file(e.root,controlName));assert.ok(e.rows.has(rootFile.id));assert.equal(control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}).status,'deleted');assert.equal(e.file(e.root,controlName),undefined);assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:'B'.repeat(64),ackProof:b.ackProofHash}),/D2_ACK_INVALID/);assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:'0'.repeat(64)}),/D2_ACK_INVALID/);assert.equal(control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}).status,'deleted');assert.ok(e.rows.has(rootFile.id));});
test('gateway VM: nonempty job preserves control and doGet permits only exact parent',async()=>{const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);const job=e.file(e.root,b.jobId),extra=e.add(job,'unrelated.bin');let issued=control(e,{action:'issueAckCapability',jobId:b.jobId});assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:'0'.repeat(64)}),/D2_ACK_INVALID/);issued=control(e,{action:'issueAckCapability',jobId:b.jobId});assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:issued.ackCapability,ackProof:b.ackProofHash}),/D2_FOLDER_NOT_EMPTY/);assert.ok(e.file(e.root,'control_'+b.jobId+'.json'));assert.ok(e.rows.has(extra.id));const out=e.g.doGet({parameter:{bridge:'1',channel:'A'.repeat(24)}});assert.equal(out.x,'ALLOWALL');assert.match(out.v,/https:\/\/311experience-gisikoubou\.github\.io/);});


test('D2 status: bearer auth and malformed status requests are rejected without any mutation',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const before=[...e.rows.values()].map(r=>({id:r.id,bytes:r.bytes.toString()})),beforeProps=[...e.props.entries()];
 assert.throws(()=>e.g.d2Status_({bearer:'wrong',jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_UPLOAD_AUTH_INVALID/);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:'not-a-job',ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_STATUS_INVALID/);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:'short',planSha256:b.planSha256}),/D2_STATUS_INVALID/);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:'short'}),/D2_STATUS_INVALID/);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256,extra:1}),/D2_UPLOAD_AUTH_INVALID/);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash}),/D2_UPLOAD_AUTH_INVALID/);
 assert.deepEqual([...e.rows.values()].map(r=>({id:r.id,bytes:r.bytes.toString()})),before);
 assert.deepEqual([...e.props.entries()],beforeProps);
});
test('D2 status: exact not-started, partial, ready, deleting, and deleted outcomes, with mismatches rejected and no mutation',async()=>{
 const e=await fakeGateway(),proof='a'.repeat(64),b=body(e,proof);
 const q=(overrides={})=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256,...overrides});
 const sizeBefore=e.rows.size;
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'not-started'});
 assert.equal(e.rows.size,sizeBefore);
 const corrupt=structuredClone(b);corrupt.objects[2].bytes=b64u(Buffer.from('bad'));
 assert.throws(()=>e.g.d2Put_(corrupt),/D2_OBJECT_HASH_INVALID/);
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'partial'});
 assert.equal(e.g.d2Put_(b).status,'ready');
 const sizeAtReady=e.rows.size;
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'ready'});
 assert.equal(e.rows.size,sizeAtReady);
 assert.throws(()=>q({planSha256:'0'.repeat(64)}),/D2_STATUS_MISMATCH/);
 assert.throws(()=>q({ackProofHash:'0'.repeat(64)}),/D2_STATUS_MISMATCH/);
 const job=e.file(e.root,b.jobId),cap=control(e,{action:'issueAckCapability',jobId:b.jobId});
 e.setFail(e.file(job,'obj_0001.bin').id);
 assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}),/D2_DELETE_FAILED/);
 const sizeAtDeleting=e.rows.size;
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'deleting'});
 assert.equal(e.rows.size,sizeAtDeleting);
 assert.throws(()=>q({ackProofHash:'0'.repeat(64)}),/D2_STATUS_MISMATCH/);
 assert.equal(control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}).status,'deleted');
 const sizeAtDeleted=e.rows.size;
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'deleted'});
 assert.equal(e.rows.size,sizeAtDeleted);
 assert.throws(()=>q({ackProofHash:'0'.repeat(64)}),/D2_STATUS_MISMATCH/);
});
test('D2 status: a tampered staging binding or a tampered ciphertext object is never silently accepted as ready',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),q=()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256});
 const stage=e.file(job,'staging.json'),stageJson=JSON.parse(stage.bytes.toString());
 stage.bytes=Buffer.from(JSON.stringify({...stageJson,descriptorSha256:'0'.repeat(64)}));
 assert.throws(q,/D2_STATUS_INCONSISTENT/);
 stage.bytes=Buffer.from(JSON.stringify(stageJson));
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'ready'});
 const obj0=e.file(job,'obj_0000.bin'),orig=obj0.bytes;
 obj0.bytes=Buffer.from('tampered');
 assert.throws(q,/D2_OBJECT_VERIFY_FAILED/);
 obj0.bytes=orig;
 assert.deepEqual(JSON.parse(JSON.stringify(q())),{jobId:b.jobId,status:'ready'});
});

// Issue #168 finding #1: a tampered metadata fileId pointing at a different real Drive file
// (whose bytes still happen to match some other slot) must never verify, even when the
// attacker recomputes ready.metaSha256 so the marker/metadata binding itself still matches.
test('D2 status rejects a metadata object fileId swapped to a different real file even when ciphertext bytes still match',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),metaFile=e.file(job,'meta.json'),readyFile=e.file(job,'ready.json');
 const meta=JSON.parse(metaFile.bytes.toString());
 meta.objects[0]={...meta.objects[0],fileId:job.id};
 const metaText=JSON.stringify(meta);
 metaFile.bytes=Buffer.from(metaText);
 const ready=JSON.parse(readyFile.bytes.toString());
 readyFile.bytes=Buffer.from(JSON.stringify({...ready,metaSha256:h(Buffer.from(metaText))}));
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_OBJECT_VERIFY_FAILED/);
});
// Issue #168 finding #1: a staging ciphertext hash zeroed out must never be silently accepted
// as ready just because the authoritative metadata/ready marker still bind correctly.
test('D2 status rejects a staging object hash zeroed out even though metadata/ready still bind correctly',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),stageFile=e.file(job,'staging.json');
 const stage=JSON.parse(stageFile.bytes.toString());
 stage.objects[0]={...stage.objects[0],ciphertextSha256:'0'.repeat(64)};
 stageFile.bytes=Buffer.from(JSON.stringify(stage));
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_STATUS_INCONSISTENT/);
});
// Issue #168 finding #1: metadata truncated from four objects to three must never verify as
// ready even with a correctly recomputed ready.metaSha256, because staging's object list and
// aggregate total must still exactly match metadata.
test('D2 status rejects metadata truncated from four objects to three even with a recomputed ready.metaSha256',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),metaFile=e.file(job,'meta.json'),readyFile=e.file(job,'ready.json');
 const meta=JSON.parse(metaFile.bytes.toString());
 meta.objects=meta.objects.slice(0,3);
 meta.totalBytes=meta.objects.reduce((n,o)=>n+o.size,0);
 const metaText=JSON.stringify(meta);
 metaFile.bytes=Buffer.from(metaText);
 const ready=JSON.parse(readyFile.bytes.toString());
 readyFile.bytes=Buffer.from(JSON.stringify({...ready,metaSha256:h(Buffer.from(metaText))}));
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_STATUS_INCONSISTENT/);
});
// Issue #168 finding #2: a malformed ready marker (or any other real exception) must never be
// downgraded into an authoritative 'partial' by a catch-all.
test('D2 status never downgrades a malformed ready marker into a silent partial',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),readyFile=e.file(job,'ready.json');
 const ready=JSON.parse(readyFile.bytes.toString());
 readyFile.bytes=Buffer.from(JSON.stringify({...ready,version:'wrong-version'}));
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_READY_BINDING_INVALID/);
});
// Issue #168 finding #2: a duplicate-named file must propagate its real error, never be
// swallowed into 'partial'.
test('D2 status propagates a duplicate-name error instead of treating it as partial',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),readyFile=e.file(job,'ready.json');
 e.rows.delete(readyFile.id);
 e.add(job,'staging.json');
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_DUPLICATE_NAME/);
});
// Issue #168 finding #2: with no ready marker, a job folder with no staging at all must be
// rejected as unconfirmed, never guessed at as 'partial' or any other status.
test('D2 status treats an empty job folder with no staging as unconfirmed, not partial',async()=>{
 const e=await fakeGateway(),emptyJobId='job_'+'9'.repeat(64);
 e.g.DriveApp.getFolderById(e.root.id).createFolder(emptyJobId);
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:emptyJobId,ackProofHash:'a'.repeat(64),planSha256:'b'.repeat(64)}),/D2_STATUS_UNCONFIRMED/);
});
// Issue #168 finding #2: when metadata exists but the ready marker is missing (write
// interrupted between meta.json and ready.json), partial must validate that metadata's same
// binding and its actual Drive object list, not merely its presence.
test('D2 status reports partial when metadata exists but the ready marker is missing, validating its binding and actual objects',async()=>{
 const e=await fakeGateway(),b=body(e);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),readyFile=e.file(job,'ready.json');
 e.rows.delete(readyFile.id);
 assert.deepEqual(JSON.parse(JSON.stringify(e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}))),{jobId:b.jobId,status:'partial'});
 const metaFile=e.file(job,'meta.json'),meta=JSON.parse(metaFile.bytes.toString());
 metaFile.bytes=Buffer.from(JSON.stringify({...meta,ackProofHash:'0'.repeat(64)}));
 assert.throws(()=>e.g.d2Status_({bearer:e.upload,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256}),/D2_STATUS_UNCONFIRMED/);
});

test('D2 resume never authorizes a new deletion and recovers an existing one without reissuing capability',async()=>{
 const e=await fakeGateway(),proof='a'.repeat(64),b=body(e,proof);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),keep=e.add(e.root,'keep-resume.txt'),resume=()=>control(e,{action:'resumeAck',jobId:b.jobId,ackProof:proof});
 assert.equal(resume().status,'not-started');assert.ok(e.file(e.root,b.jobId));
 const cap=control(e,{action:'issueAckCapability',jobId:b.jobId});e.setFail(e.file(job,'obj_0001.bin').id);
 assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}),/D2_DELETE_FAILED/);
 assert.throws(()=>control(e,{action:'resumeAck',jobId:b.jobId,ackProof:'b'.repeat(64)}),/D2_ACK_INVALID/);
 assert.throws(()=>e.g.d2Control_({receiverBearer:'wrong',action:'resumeAck',jobId:b.jobId,ackProof:proof}),/D2_RECEIVER_AUTH_INVALID/);
 assert.equal(resume().status,'deleted');assert.equal(resume().status,'deleted');assert.equal(e.file(e.root,b.jobId),undefined);assert.ok(e.rows.has(keep.id));
});
test('D2 receiver restart uses verified inbox after synced folder disappears',async()=>{
 const f=await fixture(),{root,dir,meta}=await writeJob(f),synced=path.join(root,meta.jobId),inboxRoot=path.join(root,'inbox');
 await fs.rename(dir,synced);
 try{
 let issued=0,acks=0,resumes=0;
 const options={inboxRoot,recipientKeyRingOrIdentity:f.recipient,senderRegistries:[f.registry],control:{issueAckCapability:async()=>{issued++;return{jobId:meta.jobId,ackCapability:'A'.repeat(64)};},ack:async()=>{acks++;await fs.rm(synced,{recursive:true});throw Object.assign(Error('response lost'),{code:'TEST_LOST'});},resumeAck:async()=>{resumes++;return{jobId:meta.jobId,status:'deleted'};}}};
 await assert.rejects(()=>receiveD2Job(synced,options),{code:'TEST_LOST'});
 const result=await receiveD2Job(synced,options);assert.equal(result.cloudStatus,'deleted');assert.equal(result.status,'already-stored');assert.deepEqual([issued,acks,resumes],[1,1,1]);
 await fs.writeFile(path.join(inboxRoot,meta.jobId,'work-order.json'),'corrupt');
 await assert.rejects(()=>receiveD2Job(synced,options),{code:'VIEWER_WORK_ORDER_HASH_MISMATCH'});assert.equal(resumes,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('D2 ACK transport refuses incomplete and wrong-job responses',async()=>{
 const jobId='job_'+'a'.repeat(64),request={jobId,ackCapability:'A'.repeat(64),ackProof:'b'.repeat(64)};
 for(const response of [{},{jobId,status:'deleting'},{jobId:'job_'+'c'.repeat(64),status:'deleted'}]){
 const c=createAppsScriptControl('https://script.google.com/macros/s/TEST/exec','A'.repeat(43),async()=>({ok:true,json:async()=>response}));
 await assert.rejects(()=>c.ack(request),{code:'D2_ACK_RESPONSE_INVALID'});
 }
});

test('D2 full crypto through actual Apps Script control and mock Drive recovers interrupted deletion',async()=>{
 const f=await fixture(),e=await fakeGateway(),r=f.built.request,jobId='job_'+r.envelopeHeader.descriptorSha256,proof=h('dwo-receiver-ack-v1|'+jobId+'|'+r.envelopeHeader.descriptorSha256+'|'+REF),receiver='R'.repeat(43);
 e.props.set('D2_RECEIVER_BEARER_SHA256',e.sha(receiver));
 const objects=await Promise.all(f.built.parts.map(async(part,ordinal)=>{const bytes=Buffer.from(await part.blob.arrayBuffer());return{ordinal,size:bytes.length,ciphertextSha256:h(bytes),bytes:b64u(bytes)};}));
 const b={bearer:e.upload,jobId,descriptorSha256:r.envelopeHeader.descriptorSha256,ackProofHash:h(proof),plan:r.plan,planSha256:h(Buffer.from(canonical(r.plan))),objects};
 assert.equal(e.g.d2Put_(b).status,'ready');
 const job=e.file(e.root,jobId),keep=e.add(e.root,'keep-e2e.txt');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'d2-real-crypto-vm-')),synced=path.join(root,jobId),inboxRoot=path.join(root,'inbox');
 await fs.mkdir(synced);
 try{
  for(const row of e.rows.values()){if(row.parent===job.id&&row.kind==='file')await fs.writeFile(path.join(synced,row.name),row.bytes);}
  const actions=[];
  const control=createAppsScriptControl('https://script.google.com/macros/s/SYNTHETIC/exec',receiver,async(_url,o)=>{
   const request=JSON.parse(o.body);actions.push(request.action);
   const output=e.g.doPost({postData:{contents:o.body}});
   const value=JSON.parse(output.getContent());
   return{ok:true,json:async()=>value};
  });
  const opts={inboxRoot,recipientKeyRingOrIdentity:f.recipient,senderRegistries:[f.registry],control};
  e.setFail(e.file(job,'obj_0001.bin').id);
  await assert.rejects(()=>receiveD2Job(synced,opts),{code:'D2_CONTROL_REJECTED'});
  assert.ok(e.file(e.root,'control_'+jobId+'.json'));assert.equal(e.file(job,'obj_0000.bin'),undefined);
  // Simulate Drive sync after part of the ciphertext disappeared.
  await fs.rm(path.join(synced,'obj_0000.bin'));
  const result=await receiveD2Job(synced,opts);assert.equal(result.status,'already-stored');assert.equal(result.cloudStatus,'deleted');
  assert.equal(e.file(e.root,jobId),undefined);assert.ok(e.rows.has(keep.id));assert.equal(e.file(e.root,'control_'+jobId+'.json'),undefined);
  // Recovery after sync has fully disappeared uses the authenticated deletion tombstone.
  await fs.rm(synced,{recursive:true});
  const again=await receiveD2Job(synced,opts);assert.equal(again.cloudStatus,'deleted');
  assert.deepEqual(actions,['issueAckCapability','ack','resumeAck','resumeAck']);
  const order=JSON.parse(await fs.readFile(path.join(inboxRoot,jobId,'work-order.json'),'utf8'));
  assert.equal(order.workOrderRef,REF);assert.equal(order.trialMarker,f.marker);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('D2 resumed deletion refuses a moved job before deleting any remaining file',async()=>{
 const e=await fakeGateway(),proof='a'.repeat(64),b=body(e,proof);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),remaining=e.file(job,'obj_0001.bin'),cap=control(e,{action:'issueAckCapability',jobId:b.jobId});
 e.setFail(remaining.id);
 assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}),/D2_DELETE_FAILED/);
 assert.ok(e.rows.has(remaining.id));
 job.parent='outside-dedicated-root';
 assert.throws(()=>control(e,{action:'resumeAck',jobId:b.jobId,ackProof:proof}),/D2_DELETE_SCOPE_INVALID/);
 assert.ok(e.rows.has(remaining.id),'must not delete data in a folder moved outside the approved root');
});

test('D2 replay after authorized deletion must not recreate cloud data',async()=>{
 const e=await fakeGateway(),proof='a'.repeat(64),b=body(e,proof);e.g.d2Put_(b);
 const job=e.file(e.root,b.jobId),cap=control(e,{action:'issueAckCapability',jobId:b.jobId});
 const first=e.file(job,'obj_0000.bin'),second=e.file(job,'obj_0001.bin');e.setFail(second.id);
 assert.throws(()=>control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}),/D2_DELETE_FAILED/);
 assert.equal(e.file(job,'obj_0000.bin'),undefined);
 let partialError=null;try{e.g.d2Put_(b)}catch(err){partialError=err.message}
 assert.equal(e.file(job,'obj_0000.bin'),undefined,'replay recreated a previously deleted ciphertext object');
 assert.ok(partialError,'upload must reject while deletion is authorized');
});
test('D2 replay after completed deletion must not recreate cloud data',async()=>{
 const e=await fakeGateway(),proof='a'.repeat(64),b=body(e,proof);e.g.d2Put_(b);
 const cap=control(e,{action:'issueAckCapability',jobId:b.jobId});
 assert.equal(control(e,{action:'ack',jobId:b.jobId,ackCapability:cap.ackCapability,ackProof:proof}).status,'deleted');
 assert.equal(e.file(e.root,b.jobId),undefined);
 let replayError=null;try{e.g.d2Put_(b)}catch(err){replayError=err.message}
 assert.equal(e.file(e.root,b.jobId),undefined,'replay recreated a deleted cloud job');
 assert.ok(replayError,'upload must reject after deletion');
});
test('D2 duplicate sender identity fails before persistence or deletion',async()=>{
 const f=await fixture(),{root,dir}=await writeJob(f);let persisted=false,issued=false;
 try{
  await assert.rejects(()=>processD2SyncedJob(dir,{recipientKeyRingOrIdentity:f.recipient,inboxRoot:path.join(root,'inbox'),senderRegistries:{senders:[f.registry,f.registry]},persist:async()=>{persisted=true;return{status:'stored'};},control:{issueAckCapability:async()=>{issued=true;},ack:async()=>{throw Error('unexpected ACK');}}}),{code:'GATEWAY_SENDER_REGISTRY_MISSING'});
  assert.equal(persisted,false);assert.equal(issued,false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

// ============================================================
// Issue #172: bounded D2 Windows logon receiver -- retained-only path (no ACK, no network).
// ============================================================
const RETAIN_REF=constants.RETAIN_SYNTHETIC_WORK_ORDER_REF;
const RETAIN_BYTES=Buffer.from(constants.RETAIN_SYNTHETIC_ATTACHMENT_BYTES);

async function retainFixture(workOrderOverride, attachmentBytesOverride, recipientOverride) {
  const recipient = recipientOverride || await C.generateRecipientIdentity('d2-retain-fixture-passphrase', { crypto: webcrypto });
  const sender = await C.generateSenderIdentity({ crypto: webcrypto });
  const offer = await C.createPairingOffer(recipient, { crypto: webcrypto, now: () => 1 });
  const response = await C.createPairingResponse(offer, sender, { crypto: webcrypto, now: () => 2 });
  const registry = await C.verifyPairingResponse(offer, response, { crypto: webcrypto, now: () => 3 });
  const workOrder = workOrderOverride || { workOrderRef: RETAIN_REF, trial: 'D2-SYNTHETIC', createdFor: 'test-only' };
  const attachmentBytes = attachmentBytesOverride || RETAIN_BYTES;
  const pkg = await T.buildPackage(RETAIN_REF, workOrder, [
    { meta: { attachmentId: 'att-323e4567-e89b-42d3-a456-426614174002', kind: 'file', mime: 'application/octet-stream', size: attachmentBytes.length }, blob: new Blob([attachmentBytes]) }
  ], { crypto: webcrypto, now: () => 4, chunkSize: 4 });
  const envelope = await C.encryptPackage(pkg, sender, recipient, { crypto: webcrypto, now: () => 5 });
  const built = await R.buildCreateRequest(envelope, sender, { crypto: webcrypto, now: () => 6, recipientPublicInfo: recipient, bootstrapApi: B });
  return { recipient, registry, built };
}
// Writes a retained fixture directly as <syncRoot>/<jobDirName>, matching the "direct job
// child of the dedicated sync root" layout the retained path requires. `jobDirName` defaults
// to the fixture's own real jobId; a caller-supplied different name is used to exercise a
// configured expectedJobId that does not match the ciphertext actually synced under it.
async function writeRetainedJob(f, syncRoot, jobDirName) {
  const descriptorSha256 = f.built.request.envelopeHeader.descriptorSha256;
  const realJobId = 'job_' + descriptorSha256;
  const dir = path.join(syncRoot, jobDirName || realJobId);
  await fs.mkdir(dir, { recursive: true });
  const objects = [];
  for (const [ordinal, part] of f.built.parts.entries()) {
    const bytes = Buffer.from(await part.blob.arrayBuffer());
    const name = `obj_${String(ordinal).padStart(4, '0')}.bin`;
    await fs.writeFile(path.join(dir, name), bytes);
    objects.push({ ordinal, name, fileId: `synthetic_${ordinal}`, size: bytes.length, ciphertextSha256: h(bytes) });
  }
  const first = f.built.request.plan.entries[0];
  const planSha256 = h(Buffer.from(R.canonicalJson(f.built.request.plan)));
  const totalBytes = objects.reduce((n, o) => n + o.size, 0);
  const meta = { version: constants.META_VERSION, state: 'ready', jobId: realJobId, descriptorSha256, ackProofHash: 'b'.repeat(64), planSha256, totalBytes, objects, bootstrap: { version: first.bootstrapVersion, recipientKeyId: first.recipientKeyId, ephemeralPublicJwk: first.ephemeralPublicJwk, hkdfSalt: first.hkdfSalt, iv: first.iv, ciphertextSize: objects[0].size, ciphertextSha256: objects[0].ciphertextSha256 } };
  const metaText = JSON.stringify(meta);
  await fs.writeFile(path.join(dir, 'meta.json'), metaText);
  await fs.writeFile(path.join(dir, 'ready.json'), JSON.stringify({ version: constants.META_VERSION, jobId: realJobId, state: 'ready', planSha256, metaSha256: h(Buffer.from(metaText)) }));
  await fs.writeFile(path.join(syncRoot, 'pairing.json'), JSON.stringify({ clinicDeviceId: f.registry.clinicDeviceId, signingKeyId: f.registry.activeSigningKey.signingKeyId, signingPublicJwk: f.registry.activeSigningKey.publicJwk, recipientKeyId: f.registry.pairedRecipientKeyId }));
  return { dir, jobId: realJobId, meta };
}
async function withNetworkSpy(run) {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async (...args) => { called = true; throw Object.assign(Error('D2_TEST_NETWORK_FORBIDDEN'), { args }); };
  try { return { result: await run(), called }; }
  catch (error) { return { error, called }; }
  finally { globalThis.fetch = originalFetch; }
}
async function tmpRoots() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-'));
  const syncRoot = path.join(base, 'sync'), inboxRoot = path.join(base, 'inbox');
  await fs.mkdir(syncRoot, { recursive: true });
  return { base, syncRoot, inboxRoot };
}

test('D2 retained receive: valid exact fixture persists locally with no control/network and no cloudStatus field', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { jobId } = await writeRetainedJob(f, syncRoot);
    const { result, called } = await withNetworkSpy(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }));
    assert.equal(called, false, 'retained receive must never touch the network');
    assert.equal(result.status, 'stored');
    assert.equal(result.jobId, jobId);
    assert.equal(result.workOrderRef, RETAIN_REF);
    assert.equal('cloudStatus' in result, false, 'retained receive never ACKs/deletes, so it must never report a cloudStatus');
    const receipt = JSON.parse(await fs.readFile(path.join(inboxRoot, jobId, 'receipt.json'), 'utf8'));
    assert.equal(receipt.jobId, jobId);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: a repeated call preserves the exact old receipt and content unchanged, with no overwrite', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { jobId } = await writeRetainedJob(f, syncRoot);
    const run = () => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient });
    const first = await run();
    const receiptPath = path.join(inboxRoot, jobId, 'receipt.json');
    const receiptBefore = await fs.readFile(receiptPath, 'utf8');
    const statBefore = await fs.stat(receiptPath);
    const { result: second, called } = await withNetworkSpy(run);
    assert.equal(called, false);
    assert.equal(second.status, 'already-stored');
    assert.equal(second.jobId, first.jobId);
    const receiptAfter = await fs.readFile(receiptPath, 'utf8');
    const statAfter = await fs.stat(receiptPath);
    assert.equal(receiptAfter, receiptBefore, 'the exact old receipt must be byte-for-byte unchanged on repeat');
    assert.equal(statAfter.mtimeMs, statBefore.mtimeMs, 'the old receipt file must never be rewritten on repeat');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: never constructs control, never calls fetch, and rejects a caller-supplied control object', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { jobId } = await writeRetainedJob(f, syncRoot);
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient, control: { ack: async () => ({}) } }), { code: 'D2_RETAIN_CONTROL_FORBIDDEN' });
    await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId)), { code: 'ENOENT' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: wrong configured expectedJobId, wrong ref, extra work-order fields, and wrong attachment bytes are all rejected before any persistence', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    // (a) the directory name (configured expectedJobId) does not match the real synced job.
    {
      const f = await retainFixture();
      const wrongJobId = 'job_' + 'a'.repeat(64);
      await writeRetainedJob(f, syncRoot, wrongJobId);
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: wrongJobId, recipientKeyRingOrIdentity: f.recipient, timeoutMs: 500, pollIntervalMs: 20 }), { code: 'D2_RETAIN_JOB_ID_MISMATCH' });
      await assert.rejects(() => fs.stat(path.join(inboxRoot, wrongJobId)), { code: 'ENOENT' });
    }
    // (b) a different, structurally valid work-order ref (the only built-in fixture ref #1).
    {
      const sender = await C.generateSenderIdentity({ crypto: webcrypto });
      const recipient = await C.generateRecipientIdentity('d2-retain-wrong-ref', { crypto: webcrypto });
      const offer = await C.createPairingOffer(recipient, { crypto: webcrypto, now: () => 1 });
      const resp = await C.createPairingResponse(offer, sender, { crypto: webcrypto, now: () => 2 });
      const registry = await C.verifyPairingResponse(offer, resp, { crypto: webcrypto, now: () => 3 });
      const pkg = await T.buildPackage(REF, { workOrderRef: RETAIN_REF, trial: 'D2-SYNTHETIC', createdFor: 'test-only' }, [
        { meta: { attachmentId: 'att-423e4567-e89b-42d3-a456-426614174003', kind: 'file', mime: 'application/octet-stream', size: 4 }, blob: new Blob([RETAIN_BYTES]) }
      ], { crypto: webcrypto, now: () => 4, chunkSize: 4 });
      const envelope = await C.encryptPackage(pkg, sender, recipient, { crypto: webcrypto, now: () => 5 });
      const built = await R.buildCreateRequest(envelope, sender, { crypto: webcrypto, now: () => 6, recipientPublicInfo: recipient, bootstrapApi: B });
      const f2 = { recipient, registry, built };
      const { jobId } = await writeRetainedJob(f2, syncRoot);
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: recipient }), { code: 'D2_RETAIN_REF_REJECTED' });
      await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId)), { code: 'ENOENT' });
    }
    // (c) an extra work-order key beyond the exact closed {workOrderRef,trial,createdFor} set.
    {
      const f = await retainFixture({ workOrderRef: RETAIN_REF, trial: 'D2-SYNTHETIC', createdFor: 'test-only', extra: 'nope' });
      const { jobId } = await writeRetainedJob(f, syncRoot);
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }), { code: 'D2_RETAIN_CONTENT_REJECTED' });
      await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId)), { code: 'ENOENT' });
    }
    // (d) a cryptographically valid attachment whose decrypted bytes are not exactly [68,50,0,1].
    {
      const f = await retainFixture(undefined, Buffer.from([1, 2, 3, 4]));
      const { jobId } = await writeRetainedJob(f, syncRoot);
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }), { code: 'D2_RETAIN_CONTENT_REJECTED' });
      await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId)), { code: 'ENOENT' });
    }
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: corrupt/missing ciphertext objects and a conflicting pre-existing local receipt all fail closed without overwrite', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { dir, jobId, meta } = await writeRetainedJob(f, syncRoot);
    // Missing object: bounded wait must time out (missing, not malformed).
    {
      const victim = path.join(dir, meta.objects[1].name);
      const saved = await fs.readFile(victim);
      await fs.rm(victim);
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient, timeoutMs: 400, pollIntervalMs: 20 }), { code: 'D2_RETAIN_WAIT_TIMEOUT' });
      await fs.writeFile(victim, saved);
    }
    // Corrupt object (present, wrong bytes): must fail closed immediately via the real hash
    // check, never silently retried as "missing".
    {
      const victim = path.join(dir, meta.objects[1].name);
      const saved = await fs.readFile(victim);
      await fs.writeFile(victim, Buffer.from('corrupted-not-missing'));
      await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient, timeoutMs: 2000, pollIntervalMs: 20 }), error => /D2_SYNC_OBJECT_(SIZE|HASH)_MISMATCH|D2_RETAIN_OBJECT_SIZE_MISMATCH/.test(error.code));
      await fs.writeFile(victim, saved);
    }
    await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId)), { code: 'ENOENT' });
    // Now actually store it once, then corrupt only the local receipt and confirm the conflict
    // fails closed without ever overwriting the corrupted file.
    const stored = await receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient });
    assert.equal(stored.status, 'stored');
    const receiptPath = path.join(inboxRoot, jobId, 'receipt.json');
    await fs.writeFile(receiptPath, 'not json');
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }), { code: 'GATEWAY_EXISTING_JOB_CONFLICT' });
    assert.equal(await fs.readFile(receiptPath, 'utf8'), 'not json', 'a corrupted existing receipt must never be overwritten');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: rejects an overlapping sync/inbox root configuration before touching either', async () => {
  const { base } = await tmpRoots();
  const shared = path.join(base, 'shared');
  await fs.mkdir(shared, { recursive: true });
  try {
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot: shared, inboxRoot: path.join(shared, 'nested'), expectedJobId: 'job_' + 'a'.repeat(64), recipientKeyRingOrIdentity: {} }), { code: 'D2_RETAIN_ROOT_OVERLAP' });
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot: shared, inboxRoot: shared, expectedJobId: 'job_' + 'a'.repeat(64), recipientKeyRingOrIdentity: {} }), { code: 'D2_RETAIN_ROOT_OVERLAP' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: rejects a linked inbox job directory and a linked media directory before any store/verification', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  await fs.mkdir(inboxRoot, { recursive: true });
  try {
    const f = await retainFixture();
    const { jobId } = await writeRetainedJob(f, syncRoot);
    const outside = path.join(base, 'outside-target');
    await fs.mkdir(outside, { recursive: true });
    let linked = true;
    try { await fs.symlink(outside, path.join(inboxRoot, jobId), 'junction'); }
    catch { linked = false; }
    if (!linked) { return; } // symlink/junction creation unsupported in this environment; skip rather than false-fail.
    // Primarily this must be caught explicitly (D2_RETAIN_LINK_REJECTED, via lstat before any
    // store/verification); if a given platform's lstat does not flag this particular link type,
    // the unchanged local-store "already exists" conflict guard is still a safe fail-closed
    // fallback (it would never write real content through the link either way).
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }), error => error.code === 'D2_RETAIN_LINK_REJECTED' || error.code === 'GATEWAY_EXISTING_JOB_CONFLICT');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained receive: rejects a linked job directory under the sync root before reading any file inside it', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const realDir = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-outside-'));
    const { jobId } = await writeRetainedJob(f, realDir);
    let linked = true;
    try { await fs.symlink(path.join(realDir, jobId), path.join(syncRoot, jobId), 'junction'); }
    catch { linked = false; }
    if (!linked) { return; }
    // Depending on how the platform's lstat reports a directory junction, this is caught
    // either as an explicit link rejection or (if lstat itself does not flag it) by the
    // realpath-containment check once resolved -- both are a correct fail-closed rejection
    // before any store/verification, which is what this test actually requires.
    await assert.rejects(() => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient }), error => error.code === 'D2_RETAIN_LINK_REJECTED' || error.code === 'D2_RETAIN_PATH_ESCAPE');
    await fs.rm(realDir, { recursive: true, force: true });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

// FINAL AUDIT REPAIR #2: a sync root that does not exist yet when receiveD2RetainedJob first
// checks for an overlap (so it can only be ancestor-resolved, not realpath-resolved) must still
// be caught if it later turns out -- once Drive actually materializes it -- to alias directly
// into the local inbox root. The old `realOrResolved` silently fell back to a purely lexical
// resolve on ANY realpath failure (not just a missing leaf), which could miss exactly this.
test('D2 retained receive: a sync root that only becomes an inbox-root alias once Drive materializes it (mid-wait) is caught before any decrypt/persist', async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-alias-'));
  const inboxRoot = path.join(base, 'inbox');
  const syncRoot = path.join(base, 'synclink'); // deliberately does not exist at call start
  await fs.mkdir(inboxRoot, { recursive: true });
  try {
    // Feasibility probe for this platform's symlink/junction support; skip (never false-fail)
    // rather than depend on timing-sensitive link creation the environment cannot perform.
    const probeTarget = path.join(base, 'probe-target'), probeLink = path.join(base, 'probe-link');
    await fs.mkdir(probeTarget, { recursive: true });
    let linked = true;
    try { await fs.symlink(probeTarget, probeLink, 'junction'); await fs.rm(probeLink, { recursive: true, force: true }); }
    catch { linked = false; }
    if (!linked) { return; }

    const f = await retainFixture();
    // Written directly under the real inbox-root path: once the delayed symlink below exists,
    // <syncRoot>/<jobId> and <inboxRoot>/<jobId> are the exact same real path.
    const { jobId } = await writeRetainedJob(f, inboxRoot);
    const createAliasLater = (async () => {
      await new Promise(r => setTimeout(r, 150));
      await fs.symlink(inboxRoot, syncRoot, 'junction');
    })();
    try {
      await assert.rejects(
        () => receiveD2RetainedJob({ syncRoot, inboxRoot, expectedJobId: jobId, recipientKeyRingOrIdentity: f.recipient, timeoutMs: 3000, pollIntervalMs: 20 }),
        { code: 'D2_RETAIN_ROOT_OVERLAP' }
      );
    } finally { await createAliasLater; }
    // No decrypt/persist must ever have happened through either path.
    await assert.rejects(() => fs.stat(path.join(inboxRoot, jobId, 'receipt.json')), { code: 'ENOENT' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained bounded wait: distinguishes missing (retried) from malformed (terminated immediately), honors the deadline, and is monotonic-clock driven', async () => {
  const { base, syncRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const jobId = 'job_' + f.built.request.envelopeHeader.descriptorSha256;
    // Nothing exists yet -> must time out, never hang.
    await assert.rejects(() => waitForD2RetainedReady(syncRoot, jobId, { timeoutMs: 300, pollIntervalMs: 20 }), { code: 'D2_RETAIN_WAIT_TIMEOUT' });
    // Missing, then arrives mid-wait: a deferred write after the wait has already started must
    // still be observed before the deadline.
    const writePromise = (async () => { await new Promise(r => setTimeout(r, 100)); await writeRetainedJob(f, syncRoot); })();
    const ready = await waitForD2RetainedReady(syncRoot, jobId, { timeoutMs: 3000, pollIntervalMs: 20 });
    await writePromise;
    assert.equal(ready.meta.jobId, jobId);
    // Malformed metadata present (even though nothing else is missing) must terminate
    // immediately, not be retried as though it were absent.
    await fs.writeFile(path.join(syncRoot, jobId, 'meta.json'), 'not json');
    await assert.rejects(() => waitForD2RetainedReady(syncRoot, jobId, { timeoutMs: 3000, pollIntervalMs: 20 }), { code: 'D2_RETAIN_METADATA_INVALID' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained bounded wait: a four-object layout and bounded per-object size are enforced before any blob is read', async () => {
  const { base, syncRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { jobId, dir, meta } = await writeRetainedJob(f, syncRoot);
    const tamperedMeta = { ...meta, objects: meta.objects.slice(0, 3), totalBytes: meta.objects.slice(0, 3).reduce((n, o) => n + o.size, 0) };
    const metaText = JSON.stringify(tamperedMeta);
    await fs.writeFile(path.join(dir, 'meta.json'), metaText);
    await fs.writeFile(path.join(dir, 'ready.json'), JSON.stringify({ version: constants.META_VERSION, jobId, state: 'ready', planSha256: tamperedMeta.planSha256, metaSha256: h(Buffer.from(metaText)) }));
    await assert.rejects(() => waitForD2RetainedReady(syncRoot, jobId, { timeoutMs: 1000, pollIntervalMs: 20 }), { code: 'D2_RETAIN_LAYOUT_INVALID' });
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

test('D2 retained CLI: argument parsing is closed and mutually exclusive between --config= and --retain-config=', () => {
  assert.deepEqual(parseD2CliArgs(['--config=foo.json']), { mode: 'config', configPath: 'foo.json' });
  assert.deepEqual(parseD2CliArgs(['--retain-config=bar.json']), { mode: 'retain', configPath: 'bar.json', timeoutMs: undefined });
  assert.deepEqual(parseD2CliArgs(['--retain-config=bar.json', '--retain-timeout-ms=500']), { mode: 'retain', configPath: 'bar.json', timeoutMs: 500 });
  assert.throws(() => parseD2CliArgs([]), { code: 'D2_TRIAL_ARGS_INVALID' });
  assert.throws(() => parseD2CliArgs(['--config=a.json', '--retain-config=b.json']), { code: 'D2_TRIAL_ARGS_INVALID' });
  assert.throws(() => parseD2CliArgs(['--config=a.json', 'extra']), { code: 'D2_TRIAL_CONFIG_REQUIRED' });
  assert.throws(() => parseD2CliArgs(['--retain-config=']), { code: 'D2_RETAIN_CONFIG_REQUIRED' });
  assert.throws(() => parseD2CliArgs(['--retain-config=bar.json', '--retain-timeout-ms=0']), { code: 'D2_RETAIN_TIMEOUT_INVALID' });
  assert.throws(() => parseD2CliArgs(['--retain-config=bar.json', '--retain-timeout-ms=999999']), { code: 'D2_RETAIN_TIMEOUT_INVALID' });
  assert.throws(() => parseD2CliArgs(['--retain-config=bar.json', 'extra']), { code: 'D2_RETAIN_ARGS_INVALID' });
});

test('D2 retained CLI: runD2RetainedTrialOnce validates config/secret before use and never needs a receiver bearer', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const f = await retainFixture();
    const { jobId } = await writeRetainedJob(f, syncRoot);
    const configPath = path.join(base, 'retain-config.json');
    const backupPath = path.join(base, 'backup.json');
    const identity = await C.generateRecipientIdentity('d2-retain-cli-passphrase', { crypto: webcrypto });
    await fs.writeFile(backupPath, JSON.stringify(identity.backup));
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: jobId, syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));

    delete process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE;
    await assert.rejects(() => runD2RetainedTrialOnce(configPath), { code: 'D2_RETAIN_SECRET_MISSING' });

    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 2, expectedJobId: jobId, syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));
    process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE = 'd2-retain-cli-passphrase';
    await assert.rejects(() => runD2RetainedTrialOnce(configPath), { code: 'D2_RETAIN_CONFIG_INVALID' });

    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: jobId, syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'missing-backup.json' }));
    await assert.rejects(() => runD2RetainedTrialOnce(configPath), { code: 'D2_RETAIN_BACKUP_READ_FAILED' });

    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: jobId, syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));
    // The real job was encrypted for a *different* recipient identity than the one this CLI
    // backup restores, so decryption itself must fail -- proving the CLI never fabricates a
    // success, never ACKs, and never needed/used a receiver bearer anywhere in this call.
    const { error, called } = await withNetworkSpy(() => runD2RetainedTrialOnce(configPath, { timeoutMs: 3000, pollIntervalMs: 20 }));
    assert.ok(error, 'decrypting with the wrong recipient backup must fail, never silently succeed');
    assert.equal(called, false);
  } finally {
    delete process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE;
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('D2 retained CLI: runD2RetainedTrialOnce end-to-end stores the exact fixture using only the recipient-backup passphrase', async () => {
  const { base, syncRoot, inboxRoot } = await tmpRoots();
  try {
    const passphrase = 'd2-retain-e2e-passphrase';
    const recipient = await C.generateRecipientIdentity(passphrase, { crypto: webcrypto });
    const f = await retainFixture(undefined, undefined, recipient);
    const { jobId } = await writeRetainedJob(f, syncRoot);
    const configPath = path.join(base, 'retain-config.json');
    const backupPath = path.join(base, 'backup.json');
    await fs.writeFile(backupPath, JSON.stringify(recipient.backup));
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: jobId, syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));
    process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE = passphrase;
    const { result, called } = await withNetworkSpy(() => runD2RetainedTrialOnce(configPath, { timeoutMs: 3000, pollIntervalMs: 20 }));
    assert.equal(called, false);
    assert.equal(result.status, 'stored');
    assert.equal(result.jobId, jobId);
    const receipt = JSON.parse(await fs.readFile(path.join(inboxRoot, jobId, 'receipt.json'), 'utf8'));
    assert.equal(receipt.jobId, jobId);
  } finally {
    delete process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE;
    await fs.rm(base, { recursive: true, force: true });
  }
});

test('D2 retained Windows PowerShell script: source only invokes the retain CLI, reuses the established CurrentUser DPAPI secrets format, and never registers a scheduled task, forwards a receiver bearer, or logs the passphrase', async () => {
  const source = await fs.readFile(new URL('../gateway/windows/run-d2-retained-trial.ps1', import.meta.url), 'utf8');
  assert.match(source, /--retain-config=/);
  assert.doesNotMatch(source, /--config=/);
  // Must reuse the exact established ConvertTo-SecureString / CurrentUser-DPAPI restore
  // pattern (same as run-receiver.ps1), never the incompatible raw-base64 ProtectedData.Unprotect
  // format a prior candidate introduced.
  assert.match(source, /ConvertTo-SecureString\s+\$secrets\.backupPassphraseProtected/);
  assert.doesNotMatch(source, /ProtectedData\]::Unprotect/);
  assert.doesNotMatch(source, /FromBase64String\(\s*\$secrets\.backupPassphraseProtected/);
  // Forbid actual executable LocalMachine-scope DPAPI usage specifically (not the word
  // "LocalMachine" appearing at all -- the explanatory doc comment legitimately says "there is
  // no LocalMachine fallback", and that comment must not itself trip this check).
  assert.doesNotMatch(source, /-Scope\s+LocalMachine/i);
  assert.doesNotMatch(source, /DataProtectionScope\]::LocalMachine/);
  assert.doesNotMatch(source, /ProtectedData\]::(Protect|Unprotect)\([^)]*LocalMachine/);
  assert.doesNotMatch(source, /Register-ScheduledTask/i);
  assert.doesNotMatch(source, /schtasks/i);
  assert.doesNotMatch(source, /-Credential\b/);
  assert.doesNotMatch(source, /Restart-Computer|shutdown\.exe/i);
  // Forbid forwarding/setting a receiver bearer from any decrypted/new/hardcoded value; the
  // only permitted assignment to this env var anywhere is the scoped `finally` restoration of
  // whatever value the parent shell already had set before the single child invocation
  // (`$env:DWO_D2_RECEIVER_BEARER = $savedBearer`), never a credential/token forwarded to or
  // read from the child, the decrypted secrets, or any literal.
  const bearerAssignments = [...source.matchAll(/\$env:DWO_D2_RECEIVER_BEARER\s*=\s*(\S+)/g)];
  assert.ok(bearerAssignments.length > 0, 'expected the scoped restore assignment to be present');
  for (const [, rhs] of bearerAssignments) {
    assert.equal(rhs, '$savedBearer');
  }
  assert.match(source, /Remove-Item\s+Env:\\DWO_D2_RECEIVER_BEARER/);
  assert.match(source, /Remove-Item\s+Env:\\DWO_RECEIVER_TOKEN/);
  // receiverTokenProtected must be schema-checked only -- never unprotected/converted/used.
  assert.match(source, /receiverTokenProtected/);
  assert.doesNotMatch(source, /ConvertTo-SecureString\s+\$secrets\.receiverTokenProtected/);
  assert.doesNotMatch(source, /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer/i);
  assert.match(source, /finally/i);
  assert.match(source, /Remove-Item\s+Env:\\DWO_RECIPIENT_BACKUP_PASSPHRASE/);
  assert.match(source, /\$secureString\.Dispose\(\)/);
  assert.doesNotMatch(source, /Write-(Output|Host)\s*\(?\s*\$passphrase\b/i);
});

function hasPowerShell() {
  try {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true });
    return !probe.error && probe.status === 0;
  } catch { return false; }
}

test('D2 retained Windows PowerShell script: source parses cleanly under the real PowerShell parser', { skip: !hasPowerShell() }, () => {
  const scriptPath = path.resolve('gateway/windows/run-d2-retained-trial.ps1');
  const command = "$errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('" + scriptPath.replace(/'/g, "''") + "', [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { exit 1 } else { exit 0 }";
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  assert.equal(run.status, 0, 'run-d2-retained-trial.ps1 must parse with zero syntax errors');
});

test('D2 retained Windows PowerShell script: isolated synthetic fixture fails closed before any DPAPI call when secrets/config are missing or mismatched', { skip: !hasPowerShell() }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-ps-'));
  try {
    const scriptPath = path.resolve('gateway/windows/run-d2-retained-trial.ps1');
    const configPath = path.join(base, 'retain-config.json');
    const backupPath = path.join(base, 'backup.json');
    const secretsPath = path.join(base, 'secrets.json');
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: 'job_' + 'a'.repeat(64), syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));
    await fs.writeFile(backupPath, JSON.stringify((await C.generateRecipientIdentity('d2-retain-ps-passphrase', { crypto: webcrypto })).backup));

    // (a) secrets file missing entirely -- must fail before any DPAPI call.
    const missing = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-ConfigPath', configPath, '-SecretsPath', secretsPath], { windowsHide: true, encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
    assert.doesNotMatch(String(missing.stdout) + String(missing.stderr), /ProtectedData|Unprotect|SecureString/);

    // (b) secrets present (established version=1 four-key shape) but recipientKeyId mismatches
    // the real backup's -- must still fail before any DPAPI/SecureString call (the plain-field
    // mismatch is checked first).
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    await fs.writeFile(secretsPath, JSON.stringify({ version: 1, receiverTokenProtected: 'AAAA', recipientKeyId: backup.recipientKeyId.slice(0, -1) + (backup.recipientKeyId.slice(-1) === 'a' ? 'b' : 'a'), backupPassphraseProtected: 'AAAA' }));
    const mismatched = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-ConfigPath', configPath, '-SecretsPath', secretsPath], { windowsHide: true, encoding: 'utf8' });
    assert.notEqual(mismatched.status, 0);
    assert.doesNotMatch(String(mismatched.stdout) + String(mismatched.stderr), /ProtectedData|Unprotect|SecureString/);

    // (c) an out-of-bounds timeout override must fail before any DPAPI call.
    await fs.writeFile(secretsPath, JSON.stringify({ version: 1, receiverTokenProtected: 'AAAA', recipientKeyId: backup.recipientKeyId, backupPassphraseProtected: 'AAAA' }));
    const badTimeout = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-ConfigPath', configPath, '-SecretsPath', secretsPath, '-RetainTimeoutMs', '0'], { windowsHide: true, encoding: 'utf8' });
    assert.notEqual(badTimeout.status, 0);
    assert.doesNotMatch(String(badTimeout.stdout) + String(badTimeout.stderr), /ProtectedData|Unprotect|SecureString/);

    // (d) the exact established secrets format (version=1, receiverTokenProtected,
    // backupPassphraseProtected, recipientKeyId) generated by the real
    // protect-receiver-secrets.ps1 pattern but with a merely malformed (non-SecureString)
    // backupPassphraseProtected value must still fail closed (SecureString restore failure),
    // never crash or emit a path/secret -- this is the real-format compatibility counterexample:
    // the established shape itself must be accepted by schema (reach exit 13, not 11) once it is
    // otherwise well-formed. A deliberately wrong-shaped value here still correctly fails (13)
    // because it is not a valid DPAPI-protected SecureString blob, not because the shape itself
    // is rejected.
    await fs.writeFile(secretsPath, JSON.stringify({ version: 1, receiverTokenProtected: 'not-a-real-protected-securestring', backupPassphraseProtected: 'not-a-real-protected-securestring', recipientKeyId: backup.recipientKeyId }));
    const malformedBlob = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath, '-ConfigPath', configPath, '-SecretsPath', secretsPath], { windowsHide: true, encoding: 'utf8' });
    assert.notEqual(malformedBlob.status, 0);
    assert.equal(malformedBlob.status, 13, 'a well-formed established-shape secrets file with an invalid SecureString blob must reach the SecureString-restore failure code (13), proving the established shape itself is accepted');
    assert.doesNotMatch(String(malformedBlob.stdout) + String(malformedBlob.stderr), /ProtectedData|Unprotect|SecureString|not-a-real-protected-securestring/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

// FINAL AUDIT REPAIR #1 regression: a prior version of the script invoked the node child
// directly inside Invoke-D2RetainedTrial (`& $NodePath @nodeArgs`), so the child's own stdout
// flowed into that function's success-output pipeline; PowerShell then folded the leaked output
// together with the real `return` value into an array, corrupting `$exitCode` into e.g.
// `@('some native output line', 0)` and breaking every downstream exit-code comparison. This
// extracts and runs ONLY the real script's `Invoke-D2RetainedNodeChild` helper, verbatim from
// its actual source, against fake "node" executables -- no config/secrets/DPAPI anywhere here.
test('D2 retained Windows PowerShell script: Invoke-D2RetainedNodeChild returns only a scalar exit code and never leaks the child stdout/stderr', { skip: !hasPowerShell() }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-ps-nodechild-'));
  try {
    const source = await fs.readFile(path.resolve('gateway/windows/run-d2-retained-trial.ps1'), 'utf8');
    const match = /function Invoke-D2RetainedNodeChild[\s\S]*?\n\}\r?\n/.exec(source);
    assert.ok(match, 'Invoke-D2RetainedNodeChild must exist, verbatim, in the real script source');
    const extracted = match[0];
    assert.doesNotMatch(extracted, /ProtectedData|Unprotect|DWO_RECIPIENT_BACKUP_PASSPHRASE/, 'the extracted helper must be the pure node-invocation function, with no DPAPI/secret handling in it');

    const harnessPath = path.join(base, 'harness.ps1');
    const harnessSource = [
      'param([string]$NodePath, [string[]]$NodeArgs = @())',
      extracted,
      '$code = Invoke-D2RetainedNodeChild -NodePath $NodePath -NodeArgs $NodeArgs',
      'Write-Output ("HARNESS_EXIT=" + $code)',
      'Write-Output ("HARNESS_TYPE=" + $code.GetType().Name)',
      'exit $code'
    ].join("\n");
    await fs.writeFile(harnessPath, harnessSource);

    const fakeNodeOk = path.join(base, 'fake-node-ok.cmd');
    await fs.writeFile(fakeNodeOk, '@echo off\r\necho FAKE_NODE_STDOUT_OK\r\necho FAKE_NODE_STDERR_OK>&2\r\nexit /b 0\r\n');
    const fakeNodeFail = path.join(base, 'fake-node-fail.cmd');
    await fs.writeFile(fakeNodeFail, '@echo off\r\necho FAKE_NODE_STDOUT_FAIL\r\necho FAKE_NODE_STDERR_FAIL>&2\r\nexit /b 7\r\n');

    const ok = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', harnessPath, '-NodePath', fakeNodeOk], { windowsHide: true, encoding: 'utf8' });
    assert.equal(ok.status, 0, 'a successful child must yield a scalar 0 exit code, never an array');
    assert.match(ok.stdout, /HARNESS_EXIT=0/);
    assert.match(ok.stdout, /HARNESS_TYPE=Int32/, 'the returned exit code must be a single scalar Int32, never an array folded together with leaked stdout');
    assert.doesNotMatch(ok.stdout, /FAKE_NODE_STDOUT_OK/, "the child's own stdout must never leak into the caller's captured output");
    assert.doesNotMatch(String(ok.stderr), /FAKE_NODE_STDERR_OK/, "the child's own stderr must never leak either");

    const failRun = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', harnessPath, '-NodePath', fakeNodeFail], { windowsHide: true, encoding: 'utf8' });
    assert.equal(failRun.status, 7, "a failing child's real exit code must still come through as a scalar, unmangled");
    assert.match(failRun.stdout, /HARNESS_EXIT=7/);
    assert.match(failRun.stdout, /HARNESS_TYPE=Int32/);
    assert.doesNotMatch(failRun.stdout, /FAKE_NODE_STDOUT_FAIL/);
    assert.doesNotMatch(String(failRun.stderr), /FAKE_NODE_STDERR_FAIL/);
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

// Issue #172 final compatibility repair: the launcher must never forward this host process's
// own DWO_D2_RECEIVER_BEARER / DWO_RECEIVER_TOKEN (if either is already set in the parent
// shell) to the single node child, and must restore them afterward on every outcome -- without
// ever logging or unprotecting them. This extracts both Invoke-D2RetainedNodeChild (unchanged)
// and the new Invoke-D2RetainedNodeChildScoped wrapper, verbatim from the real script source,
// and runs them in an isolated harness against sentinel (non-secret) values -- no DPAPI, config,
// or real secrets file anywhere in this test.
test('D2 retained Windows PowerShell script: Invoke-D2RetainedNodeChildScoped removes DWO_D2_RECEIVER_BEARER/DWO_RECEIVER_TOKEN before the child and restores them afterward, without ever logging them', { skip: !hasPowerShell() }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-ps-scoped-'));
  try {
    const source = await fs.readFile(path.resolve('gateway/windows/run-d2-retained-trial.ps1'), 'utf8');
    const childMatch = /function Invoke-D2RetainedNodeChild[\s\S]*?\n\}\r?\n/.exec(source);
    const scopedMatch = /function Invoke-D2RetainedNodeChildScoped[\s\S]*?\n\}\r?\n/.exec(source);
    assert.ok(childMatch, 'Invoke-D2RetainedNodeChild must exist, verbatim, in the real script source');
    assert.ok(scopedMatch, 'Invoke-D2RetainedNodeChildScoped must exist, verbatim, in the real script source');
    assert.doesNotMatch(scopedMatch[0], /ProtectedData|ConvertTo-SecureString|DWO_RECIPIENT_BACKUP_PASSPHRASE/, 'the scoped wrapper must only ever touch the receiver bearer/token env vars, never a secret');

    const harnessPath = path.join(base, 'harness.ps1');
    const harnessSource = [
      'param([string]$NodePath, [string[]]$NodeArgs = @())',
      childMatch[0],
      scopedMatch[0],
      '$code = Invoke-D2RetainedNodeChildScoped -NodePath $NodePath -NodeArgs $NodeArgs',
      'Write-Output ("HARNESS_EXIT=" + $code)',
      'Write-Output ("HARNESS_AFTER_BEARER=" + $env:DWO_D2_RECEIVER_BEARER)',
      'Write-Output ("HARNESS_AFTER_TOKEN=" + $env:DWO_RECEIVER_TOKEN)',
      'exit $code'
    ].join('\n');
    await fs.writeFile(harnessPath, harnessSource);

    const leakFile = path.join(base, 'leak.txt');
    const fakeNode = path.join(base, 'fake-node.cmd');
    await fs.writeFile(fakeNode, [
      '@echo off',
      'if defined DWO_D2_RECEIVER_BEARER (',
      '  (echo LEAKED_BEARER)> "' + leakFile + '"',
      ')',
      'if defined DWO_RECEIVER_TOKEN (',
      '  (echo LEAKED_TOKEN)>> "' + leakFile + '"',
      ')',
      'exit /b 0',
      ''
    ].join('\r\n'));

    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', harnessPath, '-NodePath', fakeNode], {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, DWO_D2_RECEIVER_BEARER: 'sentinel-bearer-value', DWO_RECEIVER_TOKEN: 'sentinel-token-value' }
    });
    assert.equal(run.status, 0, run.stderr);
    await assert.rejects(fs.stat(leakFile), { code: 'ENOENT' }, 'the child must never see either sentinel receiver bearer/token value');
    assert.match(run.stdout, /HARNESS_AFTER_BEARER=sentinel-bearer-value/, 'the parent process env must be restored exactly afterward');
    assert.match(run.stdout, /HARNESS_AFTER_TOKEN=sentinel-token-value/, 'the parent process env must be restored exactly afterward');
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});

// Issue #172 final compatibility repair: a focused, real executable regression. Uses only a
// newly generated synthetic CurrentUser-DPAPI SecureString (via the real `ConvertTo-SecureString`
// / `ConvertFrom-SecureString` cmdlets) and a temporary, entirely fictional backup/config/secrets
// fixture -- never any actual/production job, secret, Drive data, or network call. Confirms the
// real script delivers the correct passphrase to a harmless fake child without ever exposing it
// in its own stdout/stderr, returns a scalar 0 on success, surfaces a failing child as 15, and
// fails closed (11/12) on a wrong key or a malformed secrets file before the child ever runs.
test('D2 retained Windows PowerShell script: real executable regression with a freshly generated synthetic CurrentUser DPAPI SecureString delivers the correct passphrase to a harmless fake child, hides it from the script\'s own output, and rejects a failing child, wrong key, and malformed secrets', { skip: !hasPowerShell() }, async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-retain-ps-exec-'));
  try {
    const scriptPath = path.resolve('gateway/windows/run-d2-retained-trial.ps1');
    const passphrase = 'd2172SyntheticOnlyPassphrase'; // fictional, >=12 chars, alnum-only (safe for batch echo)

    async function protectWithDpapi(plainText) {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '$s = ConvertTo-SecureString -String $env:D2_TEST_PLAINTEXT -AsPlainText -Force; ConvertFrom-SecureString $s'
      ], { windowsHide: true, encoding: 'utf8', env: { ...process.env, D2_TEST_PLAINTEXT: plainText } });
      assert.equal(result.status, 0, 'synthetic CurrentUser DPAPI protect helper must succeed: ' + result.stderr);
      return result.stdout.trim();
    }

    const recipient = await C.generateRecipientIdentity(passphrase, { crypto: webcrypto });
    const backupPath = path.join(base, 'backup.json');
    await fs.writeFile(backupPath, JSON.stringify(recipient.backup));
    const configPath = path.join(base, 'retain-config.json');
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, expectedJobId: 'job_' + 'a'.repeat(64), syncRoot: 'sync', inboxRoot: 'inbox', recipientBackupPath: 'backup.json' }));
    const adapterPath = path.join(base, 'fake-adapter.mjs');
    await fs.writeFile(adapterPath, '// synthetic placeholder only -- the fake -NodePath below never actually executes this file.\n');

    const protectedToken = await protectWithDpapi('d2-172-synthetic-receiver-token-never-unprotected');
    const protectedPassphrase = await protectWithDpapi(passphrase);
    const secretsPath = path.join(base, 'secrets.json');
    await fs.writeFile(secretsPath, JSON.stringify({ version: 1, receiverTokenProtected: protectedToken, backupPassphraseProtected: protectedPassphrase, recipientKeyId: recipient.backup.recipientKeyId }));

    const fakeNodeOk = path.join(base, 'fake-node-ok.cmd');
    await fs.writeFile(fakeNodeOk, [
      '@echo off',
      'if defined DWO_RECIPIENT_BACKUP_PASSPHRASE (',
      '  (echo %DWO_RECIPIENT_BACKUP_PASSPHRASE%)> "%D2_TEST_PASSPHRASE_FILE%"',
      ')',
      'if defined DWO_D2_RECEIVER_BEARER (',
      '  (echo LEAKED_BEARER)> "%D2_TEST_BEARER_LEAK_FILE%"',
      ')',
      'if defined DWO_RECEIVER_TOKEN (',
      '  (echo LEAKED_TOKEN)> "%D2_TEST_TOKEN_LEAK_FILE%"',
      ')',
      'exit /b 0',
      ''
    ].join('\r\n'));
    const fakeNodeFail = path.join(base, 'fake-node-fail.cmd');
    await fs.writeFile(fakeNodeFail, [
      '@echo off',
      'if defined DWO_RECIPIENT_BACKUP_PASSPHRASE (',
      '  (echo %DWO_RECIPIENT_BACKUP_PASSPHRASE%)> "%D2_TEST_PASSPHRASE_FILE%"',
      ')',
      'exit /b 9',
      ''
    ].join('\r\n'));

    function runScript(nodePath, overrideSecretsPath) {
      const unique = Math.random().toString(36).slice(2);
      const passphraseFile = path.join(base, 'passphrase-out-' + unique + '.txt');
      const bearerLeakFile = path.join(base, 'bearer-leak-' + unique + '.txt');
      const tokenLeakFile = path.join(base, 'token-leak-' + unique + '.txt');
      const env = {
        ...process.env,
        // Simulates an operator shell that already happens to have a receiver bearer/token set
        // from unrelated work -- the script must still never forward either to this child.
        DWO_D2_RECEIVER_BEARER: 'sentinel-parent-bearer-never-inherited',
        DWO_RECEIVER_TOKEN: 'sentinel-parent-token-never-inherited',
        D2_TEST_PASSPHRASE_FILE: passphraseFile,
        D2_TEST_BEARER_LEAK_FILE: bearerLeakFile,
        D2_TEST_TOKEN_LEAK_FILE: tokenLeakFile
      };
      const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath,
        '-ConfigPath', configPath, '-SecretsPath', overrideSecretsPath || secretsPath,
        '-NodePath', nodePath, '-AdapterPath', adapterPath
      ], { windowsHide: true, encoding: 'utf8', env });
      return { run, passphraseFile, bearerLeakFile, tokenLeakFile };
    }

    // Success: the exact correct passphrase reaches the fake child; the receiver bearer/token
    // are never inherited; the script's own stdout/stderr never exposes the passphrase or
    // either sentinel secret value.
    {
      const { run, passphraseFile, bearerLeakFile, tokenLeakFile } = runScript(fakeNodeOk);
      assert.equal(run.status, 0, 'a successful fake child must yield the scalar exit code 0: ' + run.stderr);
      assert.match(String(run.stdout), /status=ok/);
      const delivered = (await fs.readFile(passphraseFile, 'utf8')).trim();
      assert.equal(delivered, passphrase, 'the fake child must receive the exact correct restored passphrase');
      await assert.rejects(fs.stat(bearerLeakFile), { code: 'ENOENT' }, 'the receiver bearer must never be inherited by the child');
      await assert.rejects(fs.stat(tokenLeakFile), { code: 'ENOENT' }, 'the receiver token must never be inherited by the child');
      const combinedOutput = String(run.stdout) + String(run.stderr);
      assert.doesNotMatch(combinedOutput, new RegExp(passphrase), "the script's own output must never expose the passphrase");
      assert.doesNotMatch(combinedOutput, /sentinel-parent-(bearer|token)-never-inherited/);
    }

    // Child failure: the fake child's own non-zero exit must surface only as the one sanitized
    // code 15, after still having correctly received the passphrase.
    {
      const { run, passphraseFile } = runScript(fakeNodeFail);
      assert.equal(run.status, 15, "a failing fake child's exit must surface as the single sanitized code 15");
      assert.equal((await fs.readFile(passphraseFile, 'utf8')).trim(), passphrase);
    }

    // Wrong key: a recipientKeyId mismatch must fail with code 12 before the child ever runs.
    {
      const wrongKeySecretsPath = path.join(base, 'secrets-wrong-key.json');
      await fs.writeFile(wrongKeySecretsPath, JSON.stringify({ version: 1, receiverTokenProtected: protectedToken, backupPassphraseProtected: protectedPassphrase, recipientKeyId: 'rk_' + 'z'.repeat(20) }));
      const { run, passphraseFile } = runScript(fakeNodeOk, wrongKeySecretsPath);
      assert.equal(run.status, 12, 'a recipientKeyId mismatch must fail with the dedicated code 12');
      await assert.rejects(fs.stat(passphraseFile), { code: 'ENOENT' }, 'the child must never be invoked on a key mismatch');
    }

    // Malformed secret: a missing required key (the established four-key shape is not satisfied)
    // must fail with code 11 before the child ever runs.
    {
      const malformedSecretsPath = path.join(base, 'secrets-malformed.json');
      await fs.writeFile(malformedSecretsPath, JSON.stringify({ version: 1, backupPassphraseProtected: protectedPassphrase, recipientKeyId: recipient.backup.recipientKeyId }));
      const { run, passphraseFile } = runScript(fakeNodeOk, malformedSecretsPath);
      assert.equal(run.status, 11, 'a missing receiverTokenProtected key must fail with the dedicated code 11');
      await assert.rejects(fs.stat(passphraseFile), { code: 'ENOENT' }, 'the child must never be invoked on a malformed secrets file');
    }
  } finally { await fs.rm(base, { recursive: true, force: true }); }
});
test('B5-drive-candidate crosses actual D2 mock wire, delayed sync, verified Windows save and interrupted ACK', async () => {
  const { PDFDocument } = require('../vendor/pdf/pdf-lib-1.17.1.min.js');
  const opts = { crypto: webcrypto, transferApi: T };
  const sender = await C.generateSenderIdentity(opts);
  const recipient = await C.generateRecipientIdentity('synthetic-B5-wire-passphrase', opts);
  const offer = await C.createPairingOffer(recipient, opts);
  const pairing = await C.createPairingResponse(offer, sender, opts);
  const registry = await C.verifyPairingResponse(offer, pairing, opts);
  const pdf = await PDFDocument.create();
  pdf.addPage([182 * 72 / 25.4, 257 * 72 / 25.4]);
  const bytes = Buffer.from(await pdf.save());
  const pkg = await T.buildPackage(REF, { workOrderRef: REF, patientName: 'SYNTHETIC_B5_WIRE' }, [],
    { ...opts, issuedB5Pdf: new Blob([bytes], { type: 'application/pdf' }) });
  const envelope = await C.encryptPackage(pkg, sender, recipient, opts);
  const wire = await R.buildDriveRelayBody(envelope, sender, recipient, { ...opts, bootstrapApi: B });
  assert.equal(wire.ackProofHash, h(h('dwo-receiver-ack-v1|' + wire.jobId + '|' + wire.descriptorSha256 + '|' + REF)));
  assert.equal(JSON.stringify(wire).includes(REF), false);
  assert.equal(JSON.stringify(wire).includes('SYNTHETIC_B5_WIRE'), false);
  const e = await fakeGateway();
  e.props.set('D2_RECIPIENT_PUBLIC_JSON', JSON.stringify({recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk}));
  e.g.d2Pair_({bearerSha256:e.sha(e.upload),clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,
    signingPublicJwk:sender.publicJwk,recipientKeyId:recipient.recipientKeyId});
  const request = {...wire,bearer:e.upload};
  assert.equal(e.g.d2Put_(request).status,'ready');
  assert.equal(e.g.d2Put_(request).status,'ready');
  const job=e.file(e.root,wire.jobId), unrelated=e.add(e.root,'keep.txt');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'dwo-b5-wire-'));
  try {
    const sync=path.join(root,wire.jobId), inbox=path.join(root,'inbox');
    await fs.mkdir(sync);
    const entries=[...e.rows.values()].filter(row=>row.parent===job.id && row.kind==='file');
    const missing=entries.find(row=>row.name==='obj_0001.bin');
    assert.ok(missing);
    for (const row of entries) if(row!==missing) await fs.writeFile(path.join(sync,row.name),row.bytes);
    let calls=0;
    const call=(action,body)=>{calls++;return e.g.d2Control_({receiverBearer:e.receiver,action,...body});};
    const receiveOpts={recipientKeyRingOrIdentity:recipient,senderRegistries:{senders:[registry]},inboxRoot:inbox,
      control:{issueAckCapability:async jobId=>call('issueAckCapability',{jobId}),
        ack:async value=>{assert.deepEqual(await fs.readFile(path.join(inbox,wire.jobId,'media','att-issued-b5-pdf.bin')),bytes);return call('ack',value);},
        resumeAck:async value=>call('resumeAck',value)}};
    await assert.rejects(()=>receiveD2Job(sync,receiveOpts),{code:'D2_SYNC_OBJECT_MISSING'});
    assert.equal(calls,0);
    await fs.writeFile(path.join(sync,missing.name),missing.bytes);
    e.setFailName('obj_0001.bin');
    await assert.rejects(()=>receiveD2Job(sync,receiveOpts),/D2_DELETE_FAILED/);
    assert.deepEqual(await fs.readFile(path.join(inbox,wire.jobId,'media','att-issued-b5-pdf.bin')),bytes);
    assert.ok(e.file(e.root,'control_'+wire.jobId+'.json'));
    const completed=await receiveD2Job(sync,receiveOpts);
    assert.equal(completed.status,'already-stored');
    assert.equal(completed.cloudStatus,'deleted');
    assert.equal(e.file(e.root,wire.jobId),undefined);
    assert.ok(e.rows.has(unrelated.id));
    assert.deepEqual(await fs.readFile(path.join(inbox,wire.jobId,'media','att-issued-b5-pdf.bin')),bytes);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});

test('B5-drive-candidate refuses wrong recipient and oversize instead of dropping data', async () => {
  const opts = {crypto:webcrypto,transferApi:T};
  const sender=await C.generateSenderIdentity(opts);
  const recipient=await C.generateRecipientIdentity('synthetic-drive-limit-passphrase',opts);
  const large = new Blob(['%PDF-',new Uint8Array(1024*1024)],{type:'application/pdf'});
  const pkg=await T.buildPackage(REF,{workOrderRef:REF},[],{...opts,issuedB5Pdf:large});
  const envelope=await C.encryptPackage(pkg,sender,recipient,opts);
  await assert.rejects(()=>R.buildDriveRelayBody(envelope,sender,{...recipient,recipientKeyId:'rk_other'},{...opts,bootstrapApi:B}),{code:'RELAY_DRIVE_BINDING_INVALID'});
  await assert.rejects(()=>R.buildDriveRelayBody(envelope,sender,recipient,{...opts,bootstrapApi:B}),{code:'RELAY_DRIVE_TRIAL_LIMIT'});
});

test('Drive-batch-candidate selects opaque directories and control-only retries once, excluding aliases and unrelated names', async () => {
  const {selectD2ReceiveCandidates,receiveD2BatchCandidate}=await import('../gateway/drive-relay-d2-adapter.mjs');
  const a='job_'+'a'.repeat(64), b='job_'+'b'.repeat(64), c='job_'+'c'.repeat(64);
  const entry=(name,kind)=>({name,isDirectory:()=>kind==='dir',isFile:()=>kind==='file',isSymbolicLink:()=>kind==='link'});
  const entries=[entry(b,'dir'),entry(a,'dir'),entry('control_'+a+'.json','file'),entry('control_'+c+'.json','file'),
    entry('control_'+b+'.json','dir'),entry('job_'+'d'.repeat(64),'link'),entry('job_'+'e'.repeat(64),'file'),
    entry('../'+a,'dir'),entry('pairing.json','file'),entry('control_'+c+'.json.bak','file')];
  assert.deepEqual(selectD2ReceiveCandidates(entries),[a,b,c]);
  const seen=[];
  const batch=await receiveD2BatchCandidate(entries,async id=>{
    seen.push(id);
    if(id===a)throw Object.assign(Error('synthetic sensitive detail'),{code:'D2_SYNC_OBJECT_MISSING'});
    if(id===b)return {jobId:b,status:'stored',cloudStatus:'deleted',workOrderRef:REF};
    return {jobId:a,status:'stored',cloudStatus:'deleted'};
  });
  assert.deepEqual(seen,[a,b,c]);
  assert.deepEqual(batch,{checked:3,results:[
    {jobId:a,status:'failed',errorCode:'D2_SYNC_OBJECT_MISSING'},
    {jobId:b,status:'stored',cloudStatus:'deleted'},
    {jobId:c,status:'failed',errorCode:'D2_BATCH_RESULT_UNCONFIRMED'}
  ]});
  assert.equal(JSON.stringify(batch).includes(REF),false);
});

test('Drive-batch-candidate receives two independent encrypted PDF jobs despite partial sync and resumes only verified saved job', async()=>{
  const {receiveD2BatchCandidate}=await import('../gateway/drive-relay-d2-adapter.mjs');
  const {PDFDocument}=require('../vendor/pdf/pdf-lib-1.17.1.min.js');
  const opts={crypto:webcrypto,transferApi:T};
  const sender=await C.generateSenderIdentity(opts);
  const recipient=await C.generateRecipientIdentity('synthetic-batch-receiver-passphrase',opts);
  const offer=await C.createPairingOffer(recipient,opts);
  const registry=await C.verifyPairingResponse(offer,await C.createPairingResponse(offer,sender,opts),opts);
  const e=await fakeGateway();
  e.props.set('D2_RECIPIENT_PUBLIC_JSON',JSON.stringify({recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk}));
  e.g.d2Pair_({bearerSha256:e.sha(e.upload),clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,signingPublicJwk:sender.publicJwk,recipientKeyId:recipient.recipientKeyId});
  const refs=[REF,'dwo:323e4567-e89b-42d3-a456-426614174002'];
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dwo-batch-candidate-'));
  try {
    const sync=path.join(root,'sync'),inbox=path.join(root,'inbox');
    await fs.mkdir(sync);
    const jobs=[];
    for(const ref of refs){
      const doc=await PDFDocument.create();doc.addPage([182*72/25.4,257*72/25.4]);
      const bytes=Buffer.from(await doc.save());
      const pkg=await T.buildPackage(ref,{workOrderRef:ref,patientName:'SYNTHETIC ONLY'},[],
        {...opts,issuedB5Pdf:new Blob([bytes],{type:'application/pdf'})});
      const env=await C.encryptPackage(pkg,sender,recipient,opts);
      const wire=await R.buildDriveRelayBody(env,sender,recipient,{...opts,bootstrapApi:B});
      e.g.d2Put_({...wire,bearer:e.upload});
      const job=e.file(e.root,wire.jobId),dir=path.join(sync,wire.jobId);
      await fs.mkdir(dir);
      const rows=[...e.rows.values()].filter(row=>row.parent===job.id&&row.kind==='file');
      for(const row of rows)await fs.writeFile(path.join(dir,row.name),row.bytes);
      jobs.push({wire,dir,bytes,rows});
    }
    jobs.sort((a,b)=>a.wire.jobId.localeCompare(b.wire.jobId));
    const [delayed,ready]=jobs;
    const missing=delayed.rows.find(row=>row.name==='obj_0001.bin');
    await fs.rm(path.join(delayed.dir,missing.name));
    const acked=[];
    const control=(action,body)=>e.g.d2Control_({receiverBearer:e.receiver,action,...body});
    const run=id=>receiveD2Job(path.join(sync,id),{
      recipientKeyRingOrIdentity:recipient,senderRegistries:{senders:[registry]},inboxRoot:inbox,
      control:{issueAckCapability:async jobId=>control('issueAckCapability',{jobId}),
        ack:async value=>{acked.push(value.jobId);return control('ack',value);},
        resumeAck:async value=>control('resumeAck',value)}
    });
    const first=await receiveD2BatchCandidate(await fs.readdir(sync,{withFileTypes:true}),run);
    assert.equal(first.checked,2);
    assert.equal(first.results[0].errorCode,'D2_SYNC_OBJECT_MISSING');
    assert.equal(first.results[1].status,'stored');
    assert.deepEqual(acked,[ready.wire.jobId]);
    await fs.writeFile(path.join(delayed.dir,missing.name),missing.bytes);
    e.setFailName('obj_0001.bin');
    const second=await receiveD2BatchCandidate(await fs.readdir(sync,{withFileTypes:true}),run);
    assert.equal(second.results[0].status,'failed');
    assert.equal(second.results[1].status,'already-stored');
    assert.ok(e.file(e.root,'control_'+delayed.wire.jobId+'.json'));
    // Cloud directory no longer needs to be locally present for ACK resume.
    await fs.rm(delayed.dir,{recursive:true,force:true});
    await fs.writeFile(path.join(sync,'control_'+delayed.wire.jobId+'.json'),'synthetic marker');
    const third=await receiveD2BatchCandidate(await fs.readdir(sync,{withFileTypes:true}),run);
    assert.equal(third.checked,2);
    assert.ok(third.results.every(x=>x.status==='already-stored'&&x.cloudStatus==='deleted'));
    assert.deepEqual(acked,[ready.wire.jobId,delayed.wire.jobId]);
    for(const j of jobs)assert.deepEqual(await fs.readFile(path.join(inbox,j.wire.jobId,'media','att-issued-b5-pdf.bin')),j.bytes);
    assert.equal((await fs.readdir(inbox)).filter(x=>x.startsWith('job_')).length,2);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('Drive-outbox-retry-wire connects real B5 ciphertext to D2 sender and gateway after a partial upload and lost reply', async () => {
  const opts = {crypto:webcrypto, transferApi:T};
  const sender = await C.generateSenderIdentity(opts);
  const recipient = await C.generateRecipientIdentity('synthetic-outbox-wire-passphrase',opts);
  const pkg = await T.buildPackage(REF,{workOrderRef:REF,trial:'SYNTHETIC_OUTBOX_WIRE'},[],
    {...opts,issuedB5Pdf:new Blob(['%PDF-1.7\nsynthetic'],{type:'application/pdf'})});
  const wire = await R.buildDriveRelayBody(await C.encryptPackage(pkg,sender,recipient,opts),sender,recipient,{...opts,bootstrapApi:B});
  const e = await fakeGateway();
  const bearer='A'.repeat(43);
  e.props.set('D2_RECIPIENT_PUBLIC_JSON',JSON.stringify({recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk}));
  e.g.d2Pair_({bearerSha256:e.sha(bearer),clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,
    signingPublicJwk:sender.publicJwk,recipientKeyId:recipient.recipientKeyId});
  const stored=R.canonicalJson(wire);
  const restored=await R.verifyDriveRelayBody(JSON.parse(stored),REF,recipient.recipientKeyId,opts);
  const status=b=>e.g.d2Status_({bearer,jobId:b.jobId,ackProofHash:b.ackProofHash,planSha256:b.planSha256});
  assert.equal(status(restored).status,'not-started');
  const interrupted={...restored,bearer,objects:restored.objects.map(o=>({...o}))};
  interrupted.objects[2].bytes=Buffer.from('synthetic-corrupt-part').toString('base64url');
  assert.throws(()=>e.g.d2Put_(interrupted),/D2_OBJECT_HASH_INVALID/);
  assert.equal(status(restored).status,'partial');
  // Connect the existing browser's actual status-first sender to the existing gateway VM.
  // All keys and jobs are fictional; no browser, external request or deployed endpoint.
  const db=makeFakeIndexedDB();
  db.seed(await makeSenderState({clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,
    signingPrivateKey:sender.privateKey,signingPublicJwk:sender.publicJwk,uploadBearer:bearer,
    recipientKeyId:recipient.recipientKeyId,recipientPublicJwk:recipient.publicJwk,
    pendingJob:{status:'pending',body:{...restored,bearer}}}));
  const ctx=buildSenderSandbox({indexedDB:db});
  const source=await fs.readFile(new URL('../app/drive-relay-d2-trial.js',import.meta.url),'utf8');
  vm.runInNewContext(testHookSource(source),ctx.sandbox);
  const actions=[];
  async function round(previous,expected,loseReply=false) {
    const src=await waitForSrcChange(ctx,previous),channel=readChannel(ctx.nodes);
    let observed;
    const peer={postMessage(message){observed=message;}};
    ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:peer,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
    assert.equal(observed.action,expected);
    actions.push(observed.action);
    if(expected==='putSyntheticJob'){
      const {bearer:sentBearer,...body}=observed.body;
      assert.equal(sentBearer,bearer);
      assert.equal(R.canonicalJson(body),stored);
    }
    const value=e.g.d2Bridge(channel,observed.action,observed.body);
    ctx.getOnMessage()({origin:SANDBOX_ORIGIN,source:peer,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:!loseReply,value:loseReply?undefined:value}});
    return src;
  }
  const retry=ctx.sandbox.D2TrialTestHooks.send();
  const first=await round('','getSyntheticJobStatus');
  const second=await round(first,'putSyntheticJob',true);
  await round(second,'getSyntheticJobStatus');
  await retry;
  assert.equal(db.peek('sender').pendingJob.status,'accepted');
  assert.equal(db.peek('sender').pendingJob.body.jobId,wire.jobId);
  assert.deepEqual(actions,['getSyntheticJobStatus','putSyntheticJob','getSyntheticJobStatus']);
  assert.equal(status(restored).status,'ready');
  const job=e.file(e.root,wire.jobId);
  assert.ok(job);
  assert.equal([...e.rows.values()].filter(x=>x.name===wire.jobId).length,1);
  assert.equal([...e.rows.values()].filter(x=>x.parent===job.id&&x.name==='ready.json').length,1);
  assert.equal(stored.includes(bearer),false);
  assert.equal(stored.includes('SYNTHETIC_OUTBOX_WIRE'),false);
});

test('normal credential store persists before pairing and authorizes a stable session only after exact confirmation', async () => {
  const source=await fs.readFile(new URL('../app/drive-relay-session-store.js',import.meta.url),'utf8');
  const db=makeFakeIndexedDB();
  const sandbox={indexedDB:db,crypto:webcrypto,MediaTransferCrypto:C,TextEncoder,Uint8Array,Array,Object,Error,Promise,globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
  const store=sandbox.DriveRelaySessionStore;
  const sender=await C.generateSenderIdentity({crypto:webcrypto});
  const recipient=await C.generateRecipientIdentity('synthetic-normal-store-passphrase',{crypto:webcrypto});
  const recipientPublicInfo={recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk};
  const pairingOffer=await C.createPairingOffer(recipientPublicInfo,{crypto:webcrypto,now:()=>1000,expiresInMs:10000,pairingId:'pr_normal_store'});
  const input={senderIdentity:sender,pairingOffer,uploadBearer:'S'.repeat(43)};
  const actions=[];
  const bridge=async(action,body)=>{actions.push(action);assert.equal(db.peek('current').status,'pairing','candidate must be durable before bridge call');
    if(action==='getConfig')return recipientPublicInfo;
    assert.equal(body.bearerSha256,createHash('sha256').update(input.uploadBearer).digest('hex'));
    assert.equal(body.clinicDeviceId,sender.clinicDeviceId);return {status:'paired'};};
  const completed=await store.beginPairingCredential(input,bridge,{now:()=>2000});
  assert.equal(completed.status,'paired');assert.equal(C.decodePairingPayload(completed.pairingPayload).type,'dwo-pairing-response');
  assert.deepEqual(actions,['getConfig','pair']);
  assert.equal(db.peek('current').status,'paired');
  assert.equal(db.peek('current').signingPrivateKey.extractable,false);
  assert.equal(db.peek('current').uploadBearer,input.uploadBearer);
  assert.equal(Object.hasOwn(db.peek('current'),'bridgeCall'),false);
  assert.equal(Object.hasOwn(db.peek('current'),'endpoint'),false);
  const restored=await store.restorePairedCredential();
  assert.equal(restored.signingKeyId,sender.signingKeyId);
  assert.equal(restored.recipientKeyId,recipient.recipientKeyId);
  const provider=store.createSessionProvider(bridge);
  const first=await provider(),second=await provider();
  assert.equal(first,second);assert.equal(Object.isFrozen(first),true);
  assert.equal(first.senderIdentity.privateKey,sender.privateKey);
  assert.equal(first.bridgeCall,bridge);
  await assert.rejects(()=>store.activateDeployment('https://script.google.com/macros/s/TEST/exec'),
    {code:'DRIVE_SESSION_BRIDGE_AUTHORITY_UNAVAILABLE'});
  await assert.rejects(()=>store.activateFinalIssueSession(bridge),{code:'DRIVE_SESSION_FINAL_ISSUE_UNAVAILABLE'});
  let installed=null,dispatchedRef=null,dispatchedSession=null;
  const finalIssue=Object.freeze({
    setIssuedDriveSessionProviderTrial(value){installed=value;},
    async dispatchIssuedDriveSessionTrial(ref){dispatchedRef=ref;dispatchedSession=await installed();return {decision:'KEEP_PENDING',jobId:'job_activation'};}
  });
  sandbox.DwoFinalIssue=finalIssue;
  const controller=await store.activateFinalIssueSession(bridge);
  assert.equal(Object.isFrozen(controller),true);assert.deepEqual(Object.keys(controller),['dispatch']);
  assert.deepEqual(await controller.dispatch('wo_activation'),{decision:'KEEP_PENDING',jobId:'job_activation'});
  assert.equal(dispatchedRef,'wo_activation');assert.equal(dispatchedSession,await installed());
  assert.equal(dispatchedSession.senderIdentity.privateKey,sender.privateKey);
  assert.equal(dispatchedSession.uploadBearer,input.uploadBearer);
  assert.equal(JSON.stringify(controller).includes(input.uploadBearer),false);
  const deploymentUrl='https://script.google.com/macros/s/DEPLOYMENT_TEST/exec';
  let createdUrl=null;
  sandbox.DriveRelayBridge=Object.freeze({create(url){createdUrl=url;return bridge;}});
  const deploymentController=await store.activateDeployment(deploymentUrl);
  assert.equal(createdUrl,deploymentUrl);
  assert.deepEqual(await deploymentController.dispatch('wo_deployment'),{decision:'KEEP_PENDING',jobId:'job_activation'});
  assert.equal(dispatchedRef,'wo_deployment');assert.equal(dispatchedSession.bridgeCall,bridge);
  sandbox.DwoFinalIssue=Object.freeze({...finalIssue});
  await assert.rejects(()=>controller.dispatch('wo_replaced'),{code:'DRIVE_SESSION_FINAL_ISSUE_CHANGED'});
  await assert.rejects(()=>store.beginPairingCredential({...input,uploadBearer:'T'.repeat(43)},bridge,{now:()=>2000}),{code:'DRIVE_SESSION_CREDENTIAL_CONFLICT'});
  assert.equal(db.peek('current').uploadBearer,input.uploadBearer,'conflict must not overwrite the paired credential');
  db.erase('current');
  await assert.rejects(()=>provider(),{code:'DRIVE_SESSION_CREDENTIAL_MISSING'});
  assert.equal(typeof store.clear,'undefined','credential deletion requires a separate authority');
});

test('normal credential store retains an incomplete candidate after a lost reply and resumes without rotating identity', async () => {
  const source=await fs.readFile(new URL('../app/drive-relay-session-store.js',import.meta.url),'utf8');
  const db=makeFakeIndexedDB();
  const sandbox={indexedDB:db,crypto:webcrypto,MediaTransferCrypto:C,TextEncoder,Uint8Array,Array,Object,Error,Promise,globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
  const store=sandbox.DriveRelaySessionStore;
  const sender=await C.generateSenderIdentity({crypto:webcrypto});
  const recipient=await C.generateRecipientIdentity('synthetic-normal-store-replacement',{crypto:webcrypto});
  const recipientPublicInfo={recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk};
  const pairingOffer=await C.createPairingOffer(recipientPublicInfo,{crypto:webcrypto,now:()=>1000,expiresInMs:10000,pairingId:'pr_normal_resume'});
  const input={senderIdentity:sender,pairingOffer,uploadBearer:'U'.repeat(43)};
  let pairCalls=0;
  const lost=async action=>{if(action==='getConfig')return recipientPublicInfo;pairCalls++;throw Error('synthetic lost reply');};
  await assert.rejects(()=>store.beginPairingCredential(input,lost,{now:()=>2000}));
  const pending=db.peek('current');assert.equal(pending.status,'pairing');assert.equal(pending.pairingResponse,null);
  await assert.rejects(()=>store.restorePairedCredential(),{code:'DRIVE_SESSION_PAIRING_INCOMPLETE'});
  let installed=0;
  sandbox.DwoFinalIssue=Object.freeze({
    setIssuedDriveSessionProviderTrial(){installed++;},
    async dispatchIssuedDriveSessionTrial(){throw Error('must not dispatch');}
  });
  await assert.rejects(()=>store.activateFinalIssueSession(lost),{code:'DRIVE_SESSION_PAIRING_INCOMPLETE'});
  assert.equal(installed,0,'an incomplete pairing must never register a send session');
  const resumed=await store.resumePairingCredential(async action=>{
    if(action==='getConfig')return recipientPublicInfo;pairCalls++;return {status:'paired'};
  },{now:()=>2500});
  assert.equal(resumed.status,'paired');assert.equal(pairCalls,2);
  assert.equal(db.peek('current').signingPrivateKey,sender.privateKey);
  assert.equal(db.peek('current').uploadBearer,input.uploadBearer);
  const already=await store.resumePairingCredential(async()=>{throw Error('bridge must not run after paired');},{now:()=>3000});
  assert.equal(already.pairingPayload,resumed.pairingPayload);
});

test('normal credential store rejects recipient/result mismatch and durable identity replacement without authorization', async () => {
  const source=await fs.readFile(new URL('../app/drive-relay-session-store.js',import.meta.url),'utf8');
  const db=makeFakeIndexedDB();
  const sandbox={indexedDB:db,crypto:webcrypto,MediaTransferCrypto:C,TextEncoder,Uint8Array,Array,Object,Error,Promise,globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
  const store=sandbox.DriveRelaySessionStore,sender=await C.generateSenderIdentity({crypto:webcrypto}),other=await C.generateSenderIdentity({crypto:webcrypto});
  const recipient=await C.generateRecipientIdentity('synthetic-normal-store-mismatch',{crypto:webcrypto});
  const recipientPublicInfo={recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk};
  const pairingOffer=await C.createPairingOffer(recipientPublicInfo,{crypto:webcrypto,now:()=>1000,expiresInMs:10000,pairingId:'pr_normal_mismatch'});
  const input={senderIdentity:sender,pairingOffer,uploadBearer:'V'.repeat(43)};
  await assert.rejects(()=>store.beginPairingCredential(input,async action=>action==='getConfig'
    ?{recipientKeyId:'rk_'+'A'.repeat(43),publicJwk:recipient.publicJwk}:{status:'paired'},{now:()=>2000}),
    {code:'DRIVE_SESSION_PAIRING_RECIPIENT_MISMATCH'});
  assert.equal(db.peek('current').status,'pairing');
  await assert.rejects(()=>store.resumePairingCredential(async action=>action==='getConfig'?recipientPublicInfo:{status:'paired',extra:true},{now:()=>2200}),
    {code:'DRIVE_SESSION_PAIRING_UNCONFIRMED'});
  assert.equal(db.peek('current').status,'pairing');
  db.seed({...db.peek('current'),signingKeyId:other.signingKeyId});
  await assert.rejects(()=>store.resumePairingCredential(async()=>({}),{now:()=>2300}),{code:'DRIVE_SESSION_CREDENTIAL_INVALID'});
  assert.equal(typeof store.clear,'undefined','credential deletion requires a separate authority');
  assert.match(await fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
    /media-transfer-crypto\.js"><\/script>\s*<script src="app\/drive-relay-session-store\.js"><\/script>\s*<script src="media-receiver-bootstrap\.js/);
});

test('normal bridge is inert until called and pins the exact sandbox origin and source', async () => {
  const source=await fs.readFile(new URL('../app/drive-relay-bridge.js',import.meta.url),'utf8');
  const listeners={message:new Set(),pagehide:new Set()},frames=[],timers=new Map();let timerId=0;
  const sandbox={crypto:webcrypto,Uint8Array,Promise,Object,Array,Error,Set,encodeURIComponent,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},
    addEventListener(type,fn){listeners[type].add(fn);},removeEventListener(type,fn){listeners[type].delete(fn);},
    document:{body:{appendChild(frame){frames.push(frame);}},createElement(tag){assert.equal(tag,'iframe');return{attrs:{},removed:false,setAttribute(k,v){this.attrs[k]=v;},remove(){this.removed=true;}};}},globalThis:null};
  sandbox.globalThis=sandbox;vm.runInNewContext(source,sandbox);
  assert.equal(frames.length,0,'module load and factory creation must not create a frame');
  assert.throws(()=>sandbox.DriveRelayBridge.create('https://example.test/exec'),{code:'DRIVE_BRIDGE_URL_INVALID'});
  const bridge=sandbox.DriveRelayBridge.create('https://script.google.com/macros/s/DEPLOYMENT_123/exec');
  assert.equal(frames.length,0,'an exact URL alone must remain inert');
  await assert.rejects(()=>bridge('delete',{}),{code:'DRIVE_BRIDGE_ACTION_INVALID'});
  await assert.rejects(()=>bridge('getConfig',null),{code:'DRIVE_BRIDGE_BODY_INVALID'});
  const pending=bridge('getConfig',{}),frame=frames[0],channel=new URL(frame.src).searchParams.get('channel');
  assert.match(channel,/^[A-Za-z0-9_-]{32}$/);assert.equal(frame.hidden,true);assert.equal(frame.referrerPolicy,'no-referrer');
  let posted=null;const peer={postMessage(message,origin){posted={message,origin};}},other={postMessage(){throw Error('wrong source');}};
  const emit=(type,event)=>{for(const fn of [...listeners[type]])fn(event);};
  emit('message',{origin:'https://script.googleusercontent.com',source:peer,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(posted,null);
  const origin='https://abc-123-script.googleusercontent.com';
  emit('message',{origin,source:peer,data:{version:'dwo-d2-bridge-v1',channel,type:'ready'}});
  assert.equal(posted.origin,origin);assert.equal(posted.message.action,'getConfig');assert.deepEqual(posted.message.body,{});
  emit('message',{origin,source:other,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{bad:true}}});
  emit('message',{origin,source:peer,data:{version:'dwo-d2-bridge-v1',channel,type:'result',ok:true,value:{recipientKeyId:'rk_test'}}});
  assert.deepEqual(await pending,{recipientKeyId:'rk_test'});assert.equal(frame.removed,true);
  assert.equal(listeners.message.size,0);assert.equal(listeners.pagehide.size,0);assert.equal(timers.size,0);
  const closing=bridge('getConfig',{}),closingFrame=frames[1];emit('pagehide',{});
  await assert.rejects(()=>closing,{code:'DRIVE_BRIDGE_PAGE_CLOSED'});assert.equal(closingFrame.removed,true);
  assert.match(await fs.readFile(new URL('../index.html',import.meta.url),'utf8'),
    /media-transfer-crypto\.js"><\/script>\s*<script src="app\/drive-relay-bridge\.js"><\/script>\s*<script src="app\/drive-relay-session-store\.js/);
});

// Test-only bridge between the actual signed outbox and existing Apps Script VM.
// Never imported by the app, never opens a real DB/endpoint, never accepts external
// pairing/bearer/wire or status. The synthetic operator intent is one-shot.
async function makeSignedD2ConnectorTrial(){
  const S=require('../media-storage.js'), opts={crypto:webcrypto,transferApi:T};
  const sender=await C.generateSenderIdentity(opts);
  const recipient=await C.generateRecipientIdentity('signed-d2-connector-synthetic',opts);
  const pairing={sender:{clinicDeviceId:sender.clinicDeviceId,signingKeyId:sender.signingKeyId,publicJwk:sender.publicJwk},
    recipient:{recipientKeyId:recipient.recipientKeyId,publicJwk:recipient.publicJwk}};
  let currentPairing=structuredClone(pairing);
  const bearer='A'.repeat(43);
  const storage=makeFakeIndexedDB();
  const indexedDB={open(name,version){
    assert.equal(name,S.DB_NAME);assert.equal(version,S.DB_VERSION);
    const req=storage.open(),db=req.result;
    // Adapt the existing isolated FIFO DB double to the real settings key path;
    // unwrap records on reads, keep the stored signed record itself unmodified.
    req.result={transaction(names,mode,options){
      assert.deepEqual(names,[S.STORE_SETTINGS]);
      const tx=db.transaction();
      tx.durability=options?.durability||'default';
      const store=tx.objectStore();
      tx.objectStore=name=>{
        assert.equal(name,S.STORE_SETTINGS);
        return {
          get(key){
            const inner=store.get(key);
            return {get result(){return structuredClone(inner.result?.value);},
              set onsuccess(fn){inner.onsuccess=fn;}};
          },
          add(record){
            assert.equal(mode,'readwrite');assert.equal(tx.durability,'strict');
            return store.add({id:record.key,value:structuredClone(record)});
          }
        };
      };
      return tx;
    }};
    return req;
  }};
  const env={indexedDB,crypto:webcrypto,MediaTransferCrypto:C,MediaRelayTransport:R};
  const pkg=await T.buildPackage(REF,{workOrderRef:REF,trial:'SYNTHETIC_SIGNED_D2_CONNECTOR'},[],
    {...opts,issuedB5Pdf:new Blob(['%PDF-1.7\nsynthetic connector'],{type:'application/pdf'})});
  const candidate=await R.buildDriveRelayBody(await C.encryptPackage(pkg,sender,recipient,opts),
    sender,recipient,{...opts,bootstrapApi:B});
  const proof=await S.createDriveOutboxTrial(env).claimSignedRecovery(REF,'b'.repeat(64),sender,recipient,candidate);
  const selection=Object.freeze({workOrderRef:REF,jobId:proof.jobId,wireSha256:proof.wireSha256});
  const key='dwo-drive-outbox-trial-v1:'+REF;
  const original=structuredClone(storage.peek(key).value);
  const gateway=await fakeGateway();
  gateway.props.set('D2_RECIPIENT_PUBLIC_JSON',JSON.stringify(pairing.recipient));
  gateway.g.d2Pair_({bearerSha256:gateway.sha(bearer),clinicDeviceId:sender.clinicDeviceId,
    signingKeyId:sender.signingKeyId,signingPublicJwk:sender.publicJwk,recipientKeyId:recipient.recipientKeyId});
  const calls=[];
  let nextIntent=null, afterStatus=null, loseReply=false;
  const reject=()=>Error('SIGNED_D2_CONNECTOR_REJECTED');
  const sameSelection=s=>s&&Object.keys(s).sort().join('|')==='jobId|wireSha256|workOrderRef'&&
    s.workOrderRef===REF&&s.jobId===selection.jobId&&s.wireSha256===selection.wireSha256;
  // Only an explicit synthetic operator action can mint this in-memory token.
  // It is never persisted, never available to application code, and is consumed once.
  function confirmSyntheticOperatorIntent(s){
    if(!sameSelection(s))throw reject();
    nextIntent=Object.freeze({});
    return nextIntent;
  }
  async function readCurrent(s){
    if(!sameSelection(s))throw reject();
    const trusted=structuredClone(currentPairing);
    // Use the production trial adapter's signature verifier with an independently
    // restored pairing, not data from the outbox or arguments of send().
    const verified=await S.createDriveOutboxTrial(env).inspectSignedRecovery(REF,trusted);
    const record=structuredClone(storage.peek(key)?.value);
    if(!record||verified.jobId!==s.jobId||verified.wireSha256!==s.wireSha256||
       h(record.wire)!==s.wireSha256||record.wireSha256!==s.wireSha256||
       R.canonicalJson(trusted)!==R.canonicalJson(currentPairing))throw reject();
    const body=await R.verifyDriveRelayBody(JSON.parse(record.wire),REF,trusted.recipient.recipientKeyId,opts);
    if(R.canonicalJson(body)!==record.wire||body.jobId!==s.jobId||
       R.canonicalJson(trusted)!==R.canonicalJson(currentPairing))throw reject();
    return {body,wire:record.wire,trust: R.canonicalJson(trusted)};
  }
  async function send(s,intent){
    if(!nextIntent||intent!==nextIntent)throw reject();
    nextIntent=null;
    const first=await readCurrent(s);
    const body=first.body;
    // This is the existing actual Apps Script status logic in its memory-only VM.
    calls.push('getSyntheticJobStatus');
    let reply;
    try{reply=gateway.g.d2Status_({bearer,jobId:body.jobId,ackProofHash:body.ackProofHash,planSha256:body.planSha256});}
    catch{return {status:'KEEP_PENDING',jobId:body.jobId};}
    if(!reply||Object.keys(reply).sort().join('|')!=='jobId|status'||reply.jobId!==body.jobId)
      return {status:'KEEP_PENDING',jobId:body.jobId};
    if(afterStatus){const fn=afterStatus;afterStatus=null;fn();}
    const current=await readCurrent(s);
    if(current.wire!==first.wire||current.trust!==first.trust)throw reject();
    if(reply.status==='ready'||reply.status==='deleted')return {status:'RELAY_REPORTED_ACCEPTED',jobId:body.jobId};
    if(reply.status!=='partial'&&reply.status!=='not-started')return {status:'KEEP_PENDING',jobId:body.jobId};
    calls.push('putSyntheticJob');
    try{
      const sent=gateway.g.d2Put_({...current.body,bearer});
      if(loseReply){loseReply=false;return {status:'KEEP_PENDING',jobId:body.jobId};}
      if(sent&&Object.keys(sent).sort().join('|')==='jobId|status'&&sent.status==='ready'&&sent.jobId===body.jobId)
        return {status:'RELAY_REPORTED_ACCEPTED',jobId:body.jobId};
    }catch{/* preserve the signed record; never auto-upload again */}
    return {status:'KEEP_PENDING',jobId:body.jobId};
  }
  return {selection,confirmSyntheticOperatorIntent,send,calls,
    assertOutboxUnchanged(){assert.deepEqual(storage.peek(key).value,original);},
    assertExactMockBytes(){
      const job=gateway.file(gateway.root,selection.jobId);assert.ok(job);
      for(const obj of candidate.objects){
        const name='obj_'+String(obj.ordinal).padStart(4,'0')+'.bin';
        const file=gateway.file(job,name);assert.ok(file);assert.equal(h(file.bytes),obj.ciphertextSha256);
      }
      assert.equal([...gateway.rows.values()].filter(x=>x.name===selection.jobId).length,1);
    },
    simulateLostReply(){loseReply=true;},
    changePairingAfterStatus(){afterStatus=()=>{currentPairing={...currentPairing,sender:{...currentPairing.sender,clinicDeviceId:'dev_revoked_synthetic'}};};},
    tamperAfterStatus(){afterStatus=()=>{storage.seed({id:key,value:{...original,wireSha256:'0'.repeat(64)}});};},
    interruptAfterStatus(){afterStatus=()=>{throw Error('SYNTHETIC_INTERRUPTED');};},
    assertTamperPreserved(){assert.equal(storage.peek(key).value.wireSha256,'0'.repeat(64));}
  };
}
test('Signed outbox D2 connector trial sends exact signed bytes only after explicit intent, lost reply and duplicate action are safe',async()=>{
  const f=await makeSignedD2ConnectorTrial(),s=f.selection;
  await assert.rejects(()=>f.send(s,{}),/SIGNED_D2_CONNECTOR_REJECTED/);
  assert.deepEqual(f.calls,[]);
  f.simulateLostReply();
  const intent=f.confirmSyntheticOperatorIntent(s);
  assert.deepEqual(await f.send(s,intent),{status:'KEEP_PENDING',jobId:s.jobId});
  f.assertOutboxUnchanged();f.assertExactMockBytes();
  await assert.rejects(()=>f.send(s,intent),/SIGNED_D2_CONNECTOR_REJECTED/);
  assert.deepEqual(await f.send(s,f.confirmSyntheticOperatorIntent(s)),{status:'RELAY_REPORTED_ACCEPTED',jobId:s.jobId});
  assert.deepEqual(f.calls,['getSyntheticJobStatus','putSyntheticJob','getSyntheticJobStatus']);
  f.assertOutboxUnchanged();f.assertExactMockBytes();
});
test('Signed outbox D2 connector trial rejects mismatched selection and revalidates pairing or tampered record after status',async()=>{
  const a=await makeSignedD2ConnectorTrial(),s=a.selection;
  await assert.rejects(()=>a.send({...s,wireSha256:'0'.repeat(64)},a.confirmSyntheticOperatorIntent(s)),/SIGNED_D2_CONNECTOR_REJECTED/);
  assert.deepEqual(a.calls,[]);
  a.changePairingAfterStatus();
  await assert.rejects(()=>a.send(s,a.confirmSyntheticOperatorIntent(s)));
  assert.deepEqual(a.calls,['getSyntheticJobStatus']);a.assertOutboxUnchanged();
  const b=await makeSignedD2ConnectorTrial();
  b.tamperAfterStatus();
  await assert.rejects(()=>b.send(b.selection,b.confirmSyntheticOperatorIntent(b.selection)));
  assert.deepEqual(b.calls,['getSyntheticJobStatus']);b.assertTamperPreserved();
  const c=await makeSignedD2ConnectorTrial();
  c.interruptAfterStatus();
  await assert.rejects(()=>c.send(c.selection,c.confirmSyntheticOperatorIntent(c.selection)),/SYNTHETIC_INTERRUPTED/);
  assert.deepEqual(c.calls,['getSyntheticJobStatus']);c.assertOutboxUnchanged();
});

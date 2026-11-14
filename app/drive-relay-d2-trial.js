(() => {
  'use strict';
  const DB='dwo_drive_relay_d2_trial_v2',STORE='state',ID='sender',status=document.getElementById('status'),bridgeFrame=document.getElementById('relay-bridge');
  const B64=/^[A-Za-z0-9_-]+$/, DEV=/^dev_[A-Za-z0-9_-]+$/, SK=/^sk_[A-Za-z0-9_-]+$/, RK=/^rk_[A-Za-z0-9_-]+$/;
  const b64url=b=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');};
  const random=n=>b64url(crypto.getRandomValues(new Uint8Array(n))),sha256=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const jwk=x=>x&&x.kty==='EC'&&x.crv==='P-256'&&/^[A-Za-z0-9_-]{40,50}$/.test(x.x||'')&&/^[A-Za-z0-9_-]{40,50}$/.test(x.y||'');
  const privateKey=k=>typeof CryptoKey==='function'&&k instanceof CryptoKey&&k.type==='private'&&k.extractable===false&&k.algorithm&&k.algorithm.name==='ECDSA'&&k.algorithm.namedCurve==='P-256'&&Array.isArray(k.usages)&&k.usages.length===1&&k.usages[0]==='sign';
  function pending(p,s){const b=p&&p.body,plan=b&&b.plan;if(!p)return true;return (p.status==='pending'||p.status==='accepted')&&b&&b.bearer===s.uploadBearer&&/^job_[0-9a-f]{64}$/.test(b.jobId||'')&&b.jobId==='job_'+b.descriptorSha256&&/^[0-9a-f]{64}$/.test(b.descriptorSha256||'')&&/^[0-9a-f]{64}$/.test(b.ackProofHash||'')&&/^[0-9a-f]{64}$/.test(b.planSha256||'')&&plan&&plan.version==='dwo-relay-plan-v1'&&Number.isSafeInteger(plan.totalBytes)&&plan.totalBytes>0&&Array.isArray(plan.entries)&&Array.isArray(b.objects)&&plan.entries.length===b.objects.length&&b.objects.length>=3&&b.objects.every((o,i)=>o&&o.ordinal===i&&Number.isSafeInteger(o.size)&&o.size>0&&/^[0-9a-f]{64}$/.test(o.ciphertextSha256||'')&&B64.test(o.bytes||''));}
  function validState(s){if(!s||s.id!==ID||s.version!==2||!DEV.test(s.clinicDeviceId||'')||!SK.test(s.signingKeyId||'')||!privateKey(s.signingPrivateKey)||!jwk(s.signingPublicJwk)||!/^[A-Za-z0-9_-]{43}$/.test(s.uploadBearer||''))return false;if(s.paired!==undefined&&typeof s.paired!=='boolean')return false;if(s.paired&&(!RK.test(s.recipientKeyId||'')||!jwk(s.recipientPublicJwk)))return false;if(!s.paired&&(s.recipientKeyId!==undefined||s.recipientPublicJwk!==undefined))return false;return pending(s.pendingJob,s);}
  function openDb(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
  async function getState(){const db=await openDb();try{return await new Promise((ok,no)=>{const r=db.transaction(STORE).objectStore(STORE).get(ID);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error);});}finally{db.close();}}
  async function putState(v){if(!validState(v))throw Error('PAIRING_STATE_INVALID');const db=await openDb();try{await new Promise((ok,no)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error||Error('PAIRING_STATE_TX_ABORTED'));});}finally{db.close();}}
  // Single readwrite get-then-put transaction so a decision made from the current durable
  // state (adopt it, reject it, or replace it) commits atomically against any other tab/page
  // racing the same store. mutate(current) returns the next state to persist, or null to make
  // no change and resolve with the current (already durable) state instead; it may throw to
  // reject without writing anything.
  function atomicState(mutate){return new Promise((resolve,reject)=>{openDb().then(db=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(ID);let settled=false;const fail=err=>{if(settled)return;settled=true;try{db.close();}catch(_){}reject(err);};const finish=value=>{if(settled)return;settled=true;db.close();resolve(value);};tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||Error('PAIRING_STATE_TX_ABORTED'));req.onsuccess=()=>{let next;try{next=mutate(req.result||null);}catch(err){fail(err);return;}if(next===null){tx.oncomplete=()=>finish(req.result||null);return;}if(!validState(next)){fail(Error('PAIRING_STATE_INVALID'));return;}store.put(next);tx.oncomplete=()=>finish(next);};req.onerror=()=>fail(req.error);},reject);});}
  const report=m=>{status.textContent=m;};
  async function initializeForPairing(){if(!isSecureContext||!crypto.subtle||!indexedDB)throw Error('BROWSER_CAPABILITY_MISSING');const i=await MediaTransferCrypto.generateSenderIdentity({crypto});return atomicState(current=>{if(current){if(!validState(current))throw Error('PAIRING_STATE_INVALID');return null;}return{id:ID,version:2,clinicDeviceId:i.clinicDeviceId,signingKeyId:i.signingKeyId,signingPrivateKey:i.privateKey,signingPublicJwk:i.publicJwk,uploadBearer:random(32)};});}
  const isSandboxOrigin=origin=>/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(origin||'');
  const HANDSHAKE_MS=15000,ACTION_MS=60000;
  function bridgeCall(action,body){const raw=new URL(location.href).searchParams.get('bridge');if(!raw||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(raw))throw Error('SYNTHETIC_BRIDGE_URL_REQUIRED');const channel=random(24);return new Promise((resolve,reject)=>{let sent=false,origin=null,source=null,handshakeTimer=null,actionTimer=null;const clearTimers=()=>{clearTimeout(handshakeTimer);clearTimeout(actionTimer);},done=(f,v)=>{clearTimers();window.removeEventListener('message',on);f(v);},on=e=>{const d=e.data;if(!d||d.version!=='dwo-d2-bridge-v1'||d.channel!==channel)return;if(d.type==='ready'&&!sent){if(!isSandboxOrigin(e.origin)||!e.source)return;sent=true;origin=e.origin;source=e.source;clearTimeout(handshakeTimer);actionTimer=setTimeout(()=>done(reject,Error('BRIDGE_ACTION_TIMEOUT')),ACTION_MS);source.postMessage({version:d.version,channel,action,body},origin);}else if(d.type==='result'&&sent&&e.source===source&&e.origin===origin){const ok=d.ok===true;done(ok?resolve:reject,ok?d.value:Error('BRIDGE_REJECTED'));}};window.addEventListener('message',on);handshakeTimer=setTimeout(()=>done(reject,Error('BRIDGE_TIMEOUT')),HANDSHAKE_MS);bridgeFrame.src=raw+'?bridge=1&channel='+encodeURIComponent(channel);});}
  let busy=false;
  async function withBusy(fn){if(busy)throw Error('D2_BUSY');busy=true;try{return await fn();}finally{busy=false;}}
  async function pair(){
    const s=await initializeForPairing(),c=await bridgeCall('getConfig',{});
    if(!c||!RK.test(c.recipientKeyId||'')||!jwk(c.publicJwk))throw Error('D2_RECIPIENT_CONFIG_INVALID');
    await bridgeCall('pair',{bearerSha256:await sha256(new TextEncoder().encode(s.uploadBearer)),clinicDeviceId:s.clinicDeviceId,signingKeyId:s.signingKeyId,signingPublicJwk:s.signingPublicJwk,recipientKeyId:c.recipientKeyId});
    // Finalize against the current durable state, not the pre-bridge snapshot `s`: another
    // tab may have created/advanced a pendingJob (or re-paired) while the bridge round-trips
    // happened above. Reject any identity drift instead of blind-overwriting; preserve any
    // existing pendingJob by spreading `current`.
    await atomicState(current=>{
      if(!current||!validState(current)||current.clinicDeviceId!==s.clinicDeviceId||current.signingKeyId!==s.signingKeyId||current.uploadBearer!==s.uploadBearer)throw Error('PAIRING_STATE_INVALID');
      if(current.paired){if(current.recipientKeyId!==c.recipientKeyId||JSON.stringify(current.recipientPublicJwk)!==JSON.stringify(c.publicJwk))throw Error('D2_PAIR_CONFLICT');return null;}
      return{...current,recipientKeyId:c.recipientKeyId,recipientPublicJwk:c.publicJwk,paired:true};
    });
    report('Synthetic pairing accepted. Credentials remain local.');
  }
  async function buildJobBody(s){const sender={privateKey:s.signingPrivateKey,publicJwk:s.signingPublicJwk,clinicDeviceId:s.clinicDeviceId,signingKeyId:s.signingKeyId},recipient={recipientKeyId:s.recipientKeyId,publicJwk:s.recipientPublicJwk},ref='dwo:123e4567-e89b-42d3-a456-426614174000',pkg=await MediaTransferPackage.buildPackage(ref,{workOrderRef:ref,trial:'D2-SYNTHETIC',createdFor:'test-only'},[{meta:{attachmentId:'att-'+random(12),kind:'file',mime:'application/octet-stream',size:4},blob:new Blob([new Uint8Array([68,50,0,1])])}],{crypto,now:()=>Date.now()}),env=await MediaTransferCrypto.encryptPackage(pkg,sender,recipient,{crypto,now:()=>Date.now()}),built=await MediaRelayTransport.buildCreateRequest(env,sender,{crypto,recipientPublicInfo:recipient,bootstrapApi:MediaReceiverBootstrap,now:()=>Date.now()}),objects=[];for(const part of built.parts){const bytes=new Uint8Array(await part.blob.arrayBuffer());objects.push({ordinal:objects.length,size:bytes.byteLength,ciphertextSha256:await sha256(bytes),bytes:b64url(bytes)});}const descriptorSha256=built.request.envelopeHeader.descriptorSha256,jobId='job_'+descriptorSha256,proof=await sha256(new TextEncoder().encode('dwo-receiver-ack-v1|'+jobId+'|'+descriptorSha256+'|'+ref));return{bearer:s.uploadBearer,jobId,descriptorSha256,ackProofHash:await sha256(new TextEncoder().encode(proof)),plan:built.request.plan,planSha256:await sha256(new TextEncoder().encode(MediaRelayTransport.canonicalJson(built.request.plan))),objects};}
  // Binds the claimed body to the *current* durable identity (not whatever snapshot the
  // caller held) so a stale/rotated bearer can never be claimed in; if another tab already
  // created a pendingJob first, that job is adopted (status-first, preserving exactly one
  // job) rather than blindly overwritten with this call's freshly generated body.
  // The resolved value is the resulting state itself (as before, so `.pendingJob.body` keeps
  // working for existing callers) tagged with explicit `created`/`adopted` booleans decided
  // from the very same atomic get-then-put transaction: `created` when this call's own body
  // was the one just stored, `adopted` when a racing tab's pendingJob (already pending or
  // already accepted) was found and returned instead. Callers must route an adopted job
  // through the existing status-first path rather than uploading it directly.
  function claimPendingJob(body){return new Promise((resolve,reject)=>{openDb().then(db=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(ID);let settled=false;const fail=err=>{if(settled)return;settled=true;try{db.close();}catch(_){}reject(err);};const finish=value=>{if(settled)return;settled=true;db.close();resolve(value);};tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||Error('PAIRING_STATE_TX_ABORTED'));req.onsuccess=()=>{const current=req.result;if(!current||!validState(current)||!current.paired||body.bearer!==current.uploadBearer){fail(Error('PAIRING_STATE_MISSING'));return;}if(current.pendingJob&&(current.pendingJob.status==='pending'||current.pendingJob.status==='accepted')){tx.oncomplete=()=>finish(Object.assign({},current,{created:false,adopted:true}));return;}const next={...current,pendingJob:{status:'pending',body}};if(!validState(next)){fail(Error('PAIRING_STATE_INVALID'));return;}store.put(next);tx.oncomplete=()=>finish(Object.assign({},next,{created:true,adopted:false}));};req.onerror=()=>fail(req.error);},reject);});}
  // Only ever reports accepted once a durable state exactly matching this identity/job has
  // actually been committed; a missing/mismatched/invalid current state is rejected rather
  // than silently resolved, so callers cannot mistake "nothing happened" for success.
  function markAccepted(jobId){return new Promise((resolve,reject)=>{openDb().then(db=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(ID);let settled=false;const fail=err=>{if(settled)return;settled=true;try{db.close();}catch(_){}reject(err);};const finish=value=>{if(settled)return;settled=true;db.close();resolve(value);};tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||Error('PAIRING_STATE_TX_ABORTED'));req.onsuccess=()=>{const current=req.result;if(!current||!validState(current)||!current.paired||!current.pendingJob||current.pendingJob.body.jobId!==jobId){fail(Error('PAIRING_STATE_INVALID'));return;}if(current.pendingJob.status==='accepted'){tx.oncomplete=()=>finish(current);return;}const next={...current,pendingJob:{status:'accepted',body:current.pendingJob.body}};if(!validState(next)){fail(Error('PAIRING_STATE_INVALID'));return;}store.put(next);tx.oncomplete=()=>finish(next);};req.onerror=()=>fail(req.error);},reject);});}
  function validReadyResult(r,jobId){return !!r&&typeof r==='object'&&Object.keys(r).length===2&&r.jobId===jobId&&r.status==='ready';}
  function validStatusResult(r,jobId){return !!r&&typeof r==='object'&&Object.keys(r).length===2&&r.jobId===jobId&&typeof r.status==='string'&&/^(ready|partial|deleting|deleted|not-started)$/.test(r.status);}
  async function queryStatus(body){let r;try{r=await bridgeCall('getSyntheticJobStatus',{bearer:body.bearer,jobId:body.jobId,ackProofHash:body.ackProofHash,planSha256:body.planSha256});}catch(e){throw Error('D2_STATUS_RESPONSE_INVALID');}if(!validStatusResult(r,body.jobId))throw Error('D2_STATUS_RESPONSE_INVALID');return r.status;}
  async function reconcileAfterFailure(body){let status;try{status=await queryStatus(body);}catch(e){return false;}return status==='ready'||status==='deleted';}
  async function attemptUpload(body){let result;try{result=await bridgeCall('putSyntheticJob',body);}catch(e){return await reconcileAfterFailure(body);}if(validReadyResult(result,body.jobId))return true;return await reconcileAfterFailure(body);}
  // Status-first handling for an already-pending job body, shared by both the normal
  // already-pending path and an adopted-via-claimPendingJob path: always query status before
  // ever uploading again. ready/deleted => markAccepted, no put. not-started/partial => exactly
  // one same-body retry via attemptUpload (which itself issues at most one put, reconciled by
  // its own status query). Any other outcome (deleting, or the status query itself failing) =>
  // retain the pending job unresolved, no put.
  async function resolvePendingJob(body){
    let status;
    try{status=await queryStatus(body);}catch(e){report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');return;}
    if(status==='ready'||status==='deleted'){await markAccepted(body.jobId);report('Synthetic ciphertext job already accepted by bridge.');return;}
    if(status==='not-started'||status==='partial'){
      const confirmed=await attemptUpload(body);
      if(confirmed){await markAccepted(body.jobId);report('Synthetic ciphertext job accepted by bridge. No credential or payload was displayed.');}
      else report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');
      return;
    }
    report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');
  }
  async function send(){
    const s=await getState();
    if(!validState(s)||!s.paired)throw Error('PAIRING_STATE_MISSING');
    if(s.pendingJob&&s.pendingJob.status==='accepted'){report('Synthetic ciphertext job already accepted.');return;}
    if(s.pendingJob&&s.pendingJob.status==='pending'){await resolvePendingJob(s.pendingJob.body);return;}
    const body=await buildJobBody(s);
    const claimed=await claimPendingJob(body);
    if(claimed.pendingJob.status==='accepted'){report('Synthetic ciphertext job already accepted.');return;}
    if(claimed.adopted){await resolvePendingJob(claimed.pendingJob.body);return;}
    const effectiveBody=claimed.pendingJob.body;
    const confirmed=await attemptUpload(effectiveBody);
    if(confirmed){await markAccepted(effectiveBody.jobId);report('Synthetic ciphertext job accepted by bridge. No credential or payload was displayed.');}
    else report('Synthetic ciphertext job status unconfirmed. Pending job retained for retry.');
  }
  document.getElementById('pair').onclick=()=>withBusy(pair).catch(e=>report('FAIL_CLOSED: '+e.message));document.getElementById('send').onclick=()=>withBusy(send).catch(e=>report('FAIL_CLOSED: '+e.message));
})();

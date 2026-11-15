(() => {
  'use strict';
  const DB='dwo_drive_relay_d2_trial_v2',STORE='state',ID='sender',ARCHIVE_ID='sender-first-accepted',FIRST_REF='dwo:123e4567-e89b-42d3-a456-426614174000',SECOND_REF='dwo:223e4567-e89b-42d3-a456-426614174001',status=document.getElementById('status'),bridgeFrame=document.getElementById('relay-bridge');
  const B64=/^[A-Za-z0-9_-]+$/, DEV=/^dev_[A-Za-z0-9_-]+$/, SK=/^sk_[A-Za-z0-9_-]+$/, RK=/^rk_[A-Za-z0-9_-]+$/;
  const b64url=b=>{let s='';for(const x of b)s+=String.fromCharCode(x);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');};
  const random=n=>b64url(crypto.getRandomValues(new Uint8Array(n))),sha256=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',v))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const jwk=x=>x&&x.kty==='EC'&&x.crv==='P-256'&&/^[A-Za-z0-9_-]{40,50}$/.test(x.x||'')&&/^[A-Za-z0-9_-]{40,50}$/.test(x.y||'');
  // Field-by-field EC public coordinate identity (never object identity or property order).
  const jwkEqual=(a,b)=>!!a&&!!b&&a.kty===b.kty&&a.crv===b.crv&&a.x===b.x&&a.y===b.y;
  const privateKey=k=>typeof CryptoKey==='function'&&k instanceof CryptoKey&&k.type==='private'&&k.extractable===false&&k.algorithm&&k.algorithm.name==='ECDSA'&&k.algorithm.namedCurve==='P-256'&&Array.isArray(k.usages)&&k.usages.length===1&&k.usages[0]==='sign';
  function pending(p,s){const b=p&&p.body,plan=b&&b.plan;if(!p)return true;return (p.status==='pending'||p.status==='accepted')&&b&&b.bearer===s.uploadBearer&&/^job_[0-9a-f]{64}$/.test(b.jobId||'')&&b.jobId==='job_'+b.descriptorSha256&&/^[0-9a-f]{64}$/.test(b.descriptorSha256||'')&&/^[0-9a-f]{64}$/.test(b.ackProofHash||'')&&/^[0-9a-f]{64}$/.test(b.planSha256||'')&&plan&&plan.version==='dwo-relay-plan-v1'&&Number.isSafeInteger(plan.totalBytes)&&plan.totalBytes>0&&Array.isArray(plan.entries)&&Array.isArray(b.objects)&&plan.entries.length===b.objects.length&&b.objects.length>=3&&b.objects.every((o,i)=>o&&o.ordinal===i&&Number.isSafeInteger(o.size)&&o.size>0&&/^[0-9a-f]{64}$/.test(o.ciphertextSha256||'')&&B64.test(o.bytes||''));}
  function validState(s){if(!s||s.id!==ID||s.version!==2||!DEV.test(s.clinicDeviceId||'')||!SK.test(s.signingKeyId||'')||!privateKey(s.signingPrivateKey)||!jwk(s.signingPublicJwk)||!/^[A-Za-z0-9_-]{43}$/.test(s.uploadBearer||''))return false;if(s.paired!==undefined&&typeof s.paired!=='boolean')return false;if(s.paired&&(!RK.test(s.recipientKeyId||'')||!jwk(s.recipientPublicJwk)))return false;if(!s.paired&&(s.recipientKeyId!==undefined||s.recipientPublicJwk!==undefined))return false;
  // Minimal explicit second-generation marker: absent means still first-generation (legacy,
  // exactly #169 behavior); present must be the exact prior accepted job id it rotated from.
  // No other shape is ever accepted, so a malformed/legacy marker fails closed rather than
  // being silently reset.
  if(s.secondGenerationOf!==undefined&&!/^job_[0-9a-f]{64}$/.test(s.secondGenerationOf))return false;
  return pending(s.pendingJob,s);}
  // The immutable archive record (separate key, same store) holding the first-generation
  // accepted pendingJob byte-for-byte. Only ever written once via `add`; existence alone (not
  // its content) is what blocks any further rotation, so a malformed/legacy archive still
  // fails closed instead of being reinterpreted or reset.
  function validArchive(a,expectedBearer){return !!a&&a.id===ARCHIVE_ID&&!!a.pendingJob&&a.pendingJob.status==='accepted'&&pending(a.pendingJob,{uploadBearer:expectedBearer});}
  function openDb(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}
  async function getState(){const db=await openDb();try{return await new Promise((ok,no)=>{const r=db.transaction(STORE).objectStore(STORE).get(ID);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error);});}finally{db.close();}}
  async function putState(v){if(!validState(v))throw Error('PAIRING_STATE_INVALID');const db=await openDb();try{await new Promise((ok,no)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(v);tx.oncomplete=ok;tx.onerror=()=>no(tx.error);tx.onabort=()=>no(tx.error||Error('PAIRING_STATE_TX_ABORTED'));});}finally{db.close();}}
  // Reads the immutable archive record directly (same store, separate key); callers validate
  // it themselves against the exact bearer/marker they already hold via validArchive.
  async function getArchiveRecord(){const db=await openDb();try{return await new Promise((ok,no)=>{const r=db.transaction(STORE).objectStore(STORE).get(ARCHIVE_ID);r.onsuccess=()=>ok(r.result||null);r.onerror=()=>no(r.error);});}finally{db.close();}}
  // Whenever the current durable state carries a second-generation marker, this must be
  // satisfied before any normal (non-rotation) action is taken against it: the marker must
  // point at an immutable archive that is itself a valid accepted job matching the exact
  // marker id and this identity's bearer, and the current pendingJob must be a genuinely
  // different (already-rotated) job in pending or accepted state -- never the archived job
  // itself, never missing, never malformed. Any violation fails closed with no further action
  // (no claim, no put, no bridge call) rather than reconstructing or resetting anything.
  async function checkSecondGenerationConsistency(s){
    const archive=await getArchiveRecord();
    if(!validArchive(archive,s.uploadBearer)||archive.pendingJob.body.jobId!==s.secondGenerationOf)throw Error('D2_SECOND_GENERATION_STATE_INVALID');
    if(!s.pendingJob||!(s.pendingJob.status==='pending'||s.pendingJob.status==='accepted')||s.pendingJob.body.jobId===s.secondGenerationOf)throw Error('D2_SECOND_GENERATION_STATE_INVALID');
  }
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
  async function buildJobBody(s,ref){const sender={privateKey:s.signingPrivateKey,publicJwk:s.signingPublicJwk,clinicDeviceId:s.clinicDeviceId,signingKeyId:s.signingKeyId},recipient={recipientKeyId:s.recipientKeyId,publicJwk:s.recipientPublicJwk};ref=ref||FIRST_REF;const pkg=await MediaTransferPackage.buildPackage(ref,{workOrderRef:ref,trial:'D2-SYNTHETIC',createdFor:'test-only'},[{meta:{attachmentId:'att-'+random(12),kind:'file',mime:'application/octet-stream',size:4},blob:new Blob([new Uint8Array([68,50,0,1])])}],{crypto,now:()=>Date.now()}),env=await MediaTransferCrypto.encryptPackage(pkg,sender,recipient,{crypto,now:()=>Date.now()}),built=await MediaRelayTransport.buildCreateRequest(env,sender,{crypto,recipientPublicInfo:recipient,bootstrapApi:MediaReceiverBootstrap,now:()=>Date.now()}),objects=[];for(const part of built.parts){const bytes=new Uint8Array(await part.blob.arrayBuffer());objects.push({ordinal:objects.length,size:bytes.byteLength,ciphertextSha256:await sha256(bytes),bytes:b64url(bytes)});}const descriptorSha256=built.request.envelopeHeader.descriptorSha256,jobId='job_'+descriptorSha256,proof=await sha256(new TextEncoder().encode('dwo-receiver-ack-v1|'+jobId+'|'+descriptorSha256+'|'+ref));return{bearer:s.uploadBearer,jobId,descriptorSha256,ackProofHash:await sha256(new TextEncoder().encode(proof)),plan:built.request.plan,planSha256:await sha256(new TextEncoder().encode(MediaRelayTransport.canonicalJson(built.request.plan))),objects};}
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
  function claimPendingJob(body){return new Promise((resolve,reject)=>{openDb().then(db=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(ID);let settled=false;const fail=err=>{if(settled)return;settled=true;try{db.close();}catch(_){}reject(err);};const finish=value=>{if(settled)return;settled=true;db.close();resolve(value);};tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||Error('PAIRING_STATE_TX_ABORTED'));req.onsuccess=()=>{const current=req.result;if(!current||!validState(current)||!current.paired||body.bearer!==current.uploadBearer){fail(Error('PAIRING_STATE_MISSING'));return;}if(current.pendingJob&&(current.pendingJob.status==='pending'||current.pendingJob.status==='accepted')){tx.oncomplete=()=>finish(Object.assign({},current,{created:false,adopted:true}));return;}if(current.secondGenerationOf!==undefined){fail(Error('D2_SECOND_GENERATION_STATE_INVALID'));return;}const next={...current,pendingJob:{status:'pending',body}};if(!validState(next)){fail(Error('PAIRING_STATE_INVALID'));return;}store.put(next);tx.oncomplete=()=>finish(Object.assign({},next,{created:true,adopted:false}));};req.onerror=()=>fail(req.error);},reject);});}
  // Only ever reports accepted once a durable state exactly matching this identity/job has
  // actually been committed; a missing/mismatched/invalid current state is rejected rather
  // than silently resolved, so callers cannot mistake "nothing happened" for success.
  function markAccepted(jobId){return new Promise((resolve,reject)=>{openDb().then(db=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),req=store.get(ID);let settled=false;const fail=err=>{if(settled)return;settled=true;try{db.close();}catch(_){}reject(err);};const finish=value=>{if(settled)return;settled=true;db.close();resolve(value);};tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error||Error('PAIRING_STATE_TX_ABORTED'));req.onsuccess=()=>{const current=req.result;if(!current||!validState(current)||!current.paired||!current.pendingJob||current.pendingJob.body.jobId!==jobId){fail(Error('PAIRING_STATE_INVALID'));return;}if(current.pendingJob.status==='accepted'){tx.oncomplete=()=>finish(current);return;}const next={...current,pendingJob:{status:'accepted',body:current.pendingJob.body}};if(!validState(next)){fail(Error('PAIRING_STATE_INVALID'));return;}store.put(next);tx.oncomplete=()=>finish(next);};req.onerror=()=>fail(req.error);},reject);});}
  // Rotates exactly once from a captured first-generation accepted job to a freshly pre-built
  // (outside this transaction) second-generation pending job, archiving the prior accepted
  // pendingJob byte-for-byte via a single-use `add` (never overwritten) in the very same
  // readwrite transaction that commits the replacement, so no partial state (archived-but-not-
  // replaced, or replaced-but-not-archived) can ever be observed. The transaction re-reads the
  // current durable record and compares it against `captured` (old accepted job id, plus the
  // full paired identity: clinicDeviceId, signingKeyId, bearer, and both the sender's and the
  // recipient's EC public coordinates compared field-by-field -- never a CryptoKey object,
  // never raw JSON/property-order/object-identity comparison) rather than trusting the
  // caller's earlier snapshot, so a racing tab (or a concurrent re-pair) can never undo,
  // duplicate, or misdirect this rotation. The freshly built replacement body is also rejected
  // outright if it would collide with the exact job/descriptor being archived -- a "second"
  // job must always be a genuinely distinct job. An already-rotated (second-generation marker
  // present) current state is only ever treated as this call having lost the race -- adopted,
  // never a third generation -- when that marker exactly matches this call's captured old job
  // id AND the current pendingJob is itself a genuinely different, structurally pending or
  // accepted job; any other shape (mismatched marker, missing/invalid pendingJob, or a
  // pendingJob that is still the archived job itself) fails closed instead of blindly adopting
  // a malformed or mismatched state. Any other unexpected/malformed current or archive state
  // (including an archive that already exists) fails closed with no write at all -- no reset.
  // No `await` is ever used inside the transaction; any synchronous validation, add, or put
  // failure explicitly aborts the transaction before rejecting, and a transaction construction
  // or other synchronous throw outside any request handler is still caught (via the trailing
  // `.catch`) rather than leaving the promise hanging. Only a true transaction-complete event
  // ever resolves this promise as a write; an error/abort terminal event never does.
  function rotateSecondJob(captured,newBody){return new Promise((resolve,reject)=>{
    let settled=false;
    openDb().then(db=>{
      const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);
      // `settled` is flipped to true before calling tx.abort(): the fake/real IndexedDB abort
      // can re-enter this exact handler synchronously via tx.onabort while still inside this
      // very call, and that re-entrant call must see the already-rejecting state and no-op so
      // the *original* error (not a generic abort error) is the one actually rejected with.
      const failTx=err=>{if(settled)return;settled=true;try{tx.abort();}catch(_){}try{db.close();}catch(_){}reject(err);};
      const finishTx=value=>{if(settled)return;settled=true;db.close();resolve(value);};
      tx.onerror=()=>failTx(tx.error);
      tx.onabort=()=>failTx(tx.error||Error('PAIRING_STATE_TX_ABORTED'));
      const req1=store.get(ID);
      req1.onerror=()=>failTx(req1.error);
      req1.onsuccess=()=>{
        const current=req1.result;
        if(!current||!validState(current)||!current.paired){failTx(Error('PAIRING_STATE_INVALID'));return;}
        const identityMatches=current.clinicDeviceId===captured.clinicDeviceId&&current.signingKeyId===captured.signingKeyId&&current.uploadBearer===captured.uploadBearer&&jwkEqual(current.signingPublicJwk,captured.signingPublicJwk)&&current.recipientKeyId===captured.recipientKeyId&&jwkEqual(current.recipientPublicJwk,captured.recipientPublicJwk);
        if(!identityMatches){failTx(Error('D2_SECOND_JOB_STATE_INVALID'));return;}
        if(current.secondGenerationOf!==undefined){
          const validLoss=current.secondGenerationOf===captured.oldJobId&&!!current.pendingJob&&(current.pendingJob.status==='pending'||current.pendingJob.status==='accepted')&&current.pendingJob.body.jobId!==captured.oldJobId;
          if(!validLoss){failTx(Error('D2_SECOND_JOB_STATE_INVALID'));return;}
          tx.oncomplete=()=>finishTx(Object.assign({},current,{created:false,adopted:true}));
          return;
        }
        if(!current.pendingJob||current.pendingJob.status!=='accepted'||current.pendingJob.body.jobId!==captured.oldJobId){failTx(Error('D2_SECOND_JOB_STATE_INVALID'));return;}
        if(newBody.jobId===captured.oldJobId||newBody.descriptorSha256===current.pendingJob.body.descriptorSha256){failTx(Error('D2_SECOND_JOB_STATE_INVALID'));return;}
        const req2=store.get(ARCHIVE_ID);
        req2.onerror=()=>failTx(req2.error);
        req2.onsuccess=()=>{
          if(req2.result!==undefined){failTx(Error('D2_SECOND_JOB_ARCHIVE_EXISTS'));return;}
          const archiveRecord={id:ARCHIVE_ID,pendingJob:current.pendingJob};
          if(!validArchive(archiveRecord,current.uploadBearer)){failTx(Error('PAIRING_STATE_INVALID'));return;}
          const next={...current,pendingJob:{status:'pending',body:newBody},secondGenerationOf:captured.oldJobId};
          if(!validState(next)){failTx(Error('PAIRING_STATE_INVALID'));return;}
          let req3;try{req3=store.add(archiveRecord);}catch(err){failTx(err);return;}
          req3.onerror=()=>failTx(req3.error||Error('D2_SECOND_JOB_ARCHIVE_WRITE_FAILED'));
          req3.onsuccess=()=>{
            let req4;try{req4=store.put(next);}catch(err){failTx(err);return;}
            req4.onerror=()=>failTx(req4.error||Error('D2_SECOND_JOB_STATE_WRITE_FAILED'));
            req4.onsuccess=()=>{tx.oncomplete=()=>finishTx(Object.assign({},next,{created:true,adopted:false}));};
          };
        };
      };
    }).catch(err=>{if(settled)return;settled=true;reject(err);});
  });}
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
      // A delayed ambiguous status answer for a body that is no longer the exact durable
      // current pending job (e.g. a stale in-flight check for a job a rotation has since
      // superseded) must never resurrect it with a fresh put; re-read the durable state
      // immediately before retrying and stop without any network call if it no longer matches.
      let current;
      try{current=await getState();}catch(e){report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');return;}
      const durable=current&&current.pendingJob&&current.pendingJob.body;
      const stillCurrent=validState(current)&&current.paired&&current.pendingJob&&current.pendingJob.status==='pending'&&durable&&durable.jobId===body.jobId&&durable.bearer===body.bearer&&durable.descriptorSha256===body.descriptorSha256&&durable.ackProofHash===body.ackProofHash&&durable.planSha256===body.planSha256;
      if(!stillCurrent){report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');return;}
      // Retry with the exact durable body just re-read above, never the caller's (possibly
      // stale) snapshot -- even though the checks above already matched it field-for-field.
      const confirmed=await attemptUpload(durable);
      if(confirmed){await markAccepted(durable.jobId);report('Synthetic ciphertext job accepted by bridge. No credential or payload was displayed.');}
      else report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');
      return;
    }
    report('Synthetic ciphertext job status unconfirmed. Existing pending job retained.');
  }
  async function send(){
    const s=await getState();
    if(!validState(s)||!s.paired)throw Error('PAIRING_STATE_MISSING');
    // A second-generation marker must never fall through to the create-a-new-job path below
    // (e.g. because the real rotated pendingJob or its archive is missing/malformed) -- that
    // would be a reconstructed/third-generation job. Fail closed first, with no network call.
    if(s.secondGenerationOf!==undefined)await checkSecondGenerationConsistency(s);
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
  async function buildSecondJobBody(s){return buildJobBody(s,SECOND_REF);}
  // Explicit, separate, bounded second synthetic job. Reuses the exact first-send pairing/
  // pending/accepted/status-first machinery; the only new behavior is the one-time rotation
  // itself (rotateSecondJob), and only when the current durable state is exactly a
  // first-generation accepted job. A pending, unknown (no job yet), or deleting first job can
  // never create a second job here -- those are routed to the existing status-first path (or
  // simply refused) instead. Once rotated (second-generation marker present), this button -
  // like the original send button, unchanged - simply resumes the now-current
  // second-generation pendingJob through the unchanged resolvePendingJob/markAccepted
  // contract; no third generation is ever possible from here.
  async function sendSecond(){
    const s=await getState();
    if(!validState(s)||!s.paired)throw Error('PAIRING_STATE_MISSING');
    if(s.secondGenerationOf!==undefined){
      // Verify the immutable archive still exists, is valid/accepted, matches this exact
      // marker, and the current pendingJob is genuinely the rotated job (never the archived
      // original) before taking any explicit second action here, including a no-op retry.
      await checkSecondGenerationConsistency(s);
      if(s.pendingJob.status==='accepted'){report('Second synthetic ciphertext job already accepted.');return;}
      await resolvePendingJob(s.pendingJob.body);
      return;
    }
    if(!s.pendingJob)throw Error('D2_SECOND_JOB_REQUIRES_FIRST_ACCEPTED');
    if(s.pendingJob.status==='pending'){await resolvePendingJob(s.pendingJob.body);return;}
    if(s.pendingJob.status!=='accepted')throw Error('D2_SECOND_JOB_REQUIRES_FIRST_ACCEPTED');
    const captured={oldJobId:s.pendingJob.body.jobId,clinicDeviceId:s.clinicDeviceId,signingKeyId:s.signingKeyId,uploadBearer:s.uploadBearer,signingPublicJwk:s.signingPublicJwk,recipientKeyId:s.recipientKeyId,recipientPublicJwk:s.recipientPublicJwk};
    const newBody=await buildSecondJobBody(s);
    const rotated=await rotateSecondJob(captured,newBody);
    if(rotated.pendingJob.status==='accepted'){report('Second synthetic ciphertext job already accepted.');return;}
    if(rotated.adopted){await resolvePendingJob(rotated.pendingJob.body);return;}
    const effectiveBody=rotated.pendingJob.body;
    const confirmed=await attemptUpload(effectiveBody);
    if(confirmed){await markAccepted(effectiveBody.jobId);report('Second synthetic ciphertext job accepted by bridge. No credential or payload was displayed.');}
    else report('Second synthetic ciphertext job status unconfirmed. Pending job retained for retry.');
  }
  document.getElementById('pair').onclick=()=>withBusy(pair).catch(e=>report('FAIL_CLOSED: '+e.message));document.getElementById('send').onclick=()=>withBusy(send).catch(e=>report('FAIL_CLOSED: '+e.message));document.getElementById('send2').onclick=()=>withBusy(sendSecond).catch(e=>report('FAIL_CLOSED: '+e.message));
})();

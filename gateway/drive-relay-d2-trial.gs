/* D2 synthetic-only; inert until configured. */
var D2_VERSION_='dwo-drive-relay-d2-v1',D2_STAGE_VERSION_='dwo-drive-relay-d2-staging-v1',D2_PARENT_='https://311experience-gisikoubou.github.io',D2_ROOT_NAME_='DWO_RELAY_D2_SYNTHETIC_ONLY',D2_FOLDER_MIME_='application/vnd.google-apps.folder',D2_MAX_BYTES_=1024*1024,D2_MAX_OBJECTS_=16;
function d2Props_(){var p=PropertiesService.getScriptProperties(),s=p.getProperty('D2_RECIPIENT_PUBLIC_JSON'),o=p.getProperty('D2_PARENT_ORIGIN'),id=p.getProperty('D2_SYNTHETIC_ROOT_ID');if(p.getProperty('D2_TRIAL_ENABLED')!=='true'||o!==D2_PARENT_||!id||!/^[0-9a-f]{64}$/.test(p.getProperty('D2_RECEIVER_BEARER_SHA256')||'')||!s)throw Error('D2_NOT_CONFIGURED');var r=JSON.parse(s);if(!r||!/^rk_[A-Za-z0-9_-]+$/.test(r.recipientKeyId||'')||!d2Jwk_(r.publicJwk))throw Error('D2_RECIPIENT_CONFIG_INVALID');var root=DriveApp.getFolderById(id);if(root.getName()!==D2_ROOT_NAME_)throw Error('D2_ROOT_INVALID');return{p:p,root:root,recipient:r,parentOrigin:o};}
function doGet(e){if(!e||!e.parameter||e.parameter.bridge!=='1'||!/^[A-Za-z0-9_-]{24,200}$/.test(e.parameter.channel||''))return HtmlService.createHtmlOutput('D2 synthetic bridge disabled');var c=e.parameter.channel,o=d2Props_().parentOrigin,h=HtmlService.createHtmlOutput('<script>const c='+JSON.stringify(c)+',o='+JSON.stringify(o)+';window.addEventListener("message",e=>{if(e.source!==top||e.origin!==o||!e.data||e.data.version!=="dwo-d2-bridge-v1"||e.data.channel!==c)return;google.script.run.withSuccessHandler(v=>top.postMessage({version:"dwo-d2-bridge-v1",channel:c,type:"result",ok:true,value:v},o)).withFailureHandler(()=>top.postMessage({version:"dwo-d2-bridge-v1",channel:c,type:"result",ok:false},o)).d2Bridge(c,e.data.action,e.data.body)});top.postMessage({version:"dwo-d2-bridge-v1",channel:c,type:"ready"},o)</script>');return h.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);}
function d2Bridge(c,a,b){return d2Bridge_(c,a,b);}function d2Bridge_(c,a,b){if(!/^[A-Za-z0-9_-]{24,200}$/.test(c||''))throw Error('D2_BRIDGE_INVALID');if(a==='getConfig'){var x=d2Props_();return{recipientKeyId:x.recipient.recipientKeyId,publicJwk:x.recipient.publicJwk};}if(a==='pair')return d2Pair_(b);if(a==='putSyntheticJob')return d2Put_(b);if(a==='getSyntheticJobStatus')return d2Status_(b);throw Error('D2_BRIDGE_ACTION_INVALID');}
function doPost(e){try{return d2Json_(d2Control_(JSON.parse(e&&e.postData&&e.postData.contents||'')));}catch(_){return d2Json_({ok:false,error:'D2_CONTROL_REJECTED'});}}function d2Json_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function d2Pair_(b){var l=LockService.getScriptLock();l.waitLock(10000);try{var c=d2Props_(),p=c.p;if(!b||!/^[0-9a-f]{64}$/.test(b.bearerSha256||'')||!/^dev_[A-Za-z0-9_-]+$/.test(b.clinicDeviceId||'')||!/^sk_[A-Za-z0-9_-]+$/.test(b.signingKeyId||'')||!d2Jwk_(b.signingPublicJwk)||b.recipientKeyId!==c.recipient.recipientKeyId)throw Error('D2_PAIR_INVALID');var rec={clinicDeviceId:b.clinicDeviceId,signingKeyId:b.signingKeyId,signingPublicJwk:b.signingPublicJwk,recipientKeyId:b.recipientKeyId},text=JSON.stringify(rec),old=d2File_(c.root,'pairing.json');if(old){if(old.getBlob().getDataAsString()!==text||!d2Eq_(p.getProperty('D2_UPLOAD_BEARER_SHA256')||'',b.bearerSha256))throw Error('D2_PAIR_CONFLICT');p.setProperty('D2_PAIRING_ENABLED','false');return{status:'paired'};}if(p.getProperty('D2_PAIRING_ENABLED')!=='true')throw Error('D2_PAIRING_DISABLED');p.setProperty('D2_UPLOAD_BEARER_SHA256',b.bearerSha256);d2Set_(c.root,'pairing.json',text);p.setProperty('D2_PAIRING_ENABLED','false');return{status:'paired'};}finally{l.releaseLock();}}
function d2Put_(b){var c=d2Props_(),l=LockService.getScriptLock();if(!b||!d2Eq_(d2Hash_(b.bearer),c.p.getProperty('D2_UPLOAD_BEARER_SHA256')||''))throw Error('D2_UPLOAD_AUTH_INVALID');var v=d2ValidatePut_(b);l.waitLock(10000);try{if(d2File_(c.root,'control_'+b.jobId+'.json')||c.p.getProperty('D2_DELETED_'+b.jobId))throw Error('D2_JOB_FINALIZED');var job=d2Folder_(c.root,b.jobId);if(!job)job=c.root.createFolder(b.jobId);var stage={version:D2_STAGE_VERSION_,jobId:b.jobId,descriptorSha256:b.descriptorSha256,ackProofHash:b.ackProofHash,planSha256:b.planSha256,totalBytes:v.totalBytes,objects:v.objects,bootstrap:v.bootstrap},stageText=d2Canonical_(stage),sf=d2File_(job,'staging.json');if(sf){if(sf.getBlob().getDataAsString()!==stageText)throw Error('D2_CONFLICT');}else d2Set_(job,'staging.json',stageText);for(var i=0;i<b.objects.length;i++){var o=b.objects[i],bytes=Utilities.base64DecodeWebSafe(o.bytes),name=v.objects[i].name,f=d2File_(job,name);if(bytes.length!==o.size||d2HashBytes_(bytes)!==o.ciphertextSha256)throw Error('D2_OBJECT_HASH_INVALID');if(f){if(f.getSize()!==o.size||d2HashBytes_(f.getBlob().getBytes())!==o.ciphertextSha256)throw Error('D2_CONFLICT');}else d2SetBytes_(job,name,bytes);}d2VerifyObjects_(job,v.objects);var stored=v.objects.map(function(o){var f=d2File_(job,o.name);return{ordinal:o.ordinal,name:o.name,fileId:f.getId(),size:o.size,ciphertextSha256:o.ciphertextSha256};}),meta={version:D2_VERSION_,jobId:b.jobId,state:'ready',descriptorSha256:b.descriptorSha256,ackProofHash:b.ackProofHash,planSha256:b.planSha256,totalBytes:v.totalBytes,objects:stored,bootstrap:v.bootstrap},metaText=d2Canonical_(meta),mf=d2File_(job,'meta.json');if(mf){if(d2Canonical_(JSON.parse(mf.getBlob().getDataAsString()))!==metaText)throw Error('D2_CONFLICT');}else d2Set_(job,'meta.json',metaText);var ready={version:D2_VERSION_,jobId:b.jobId,state:'ready',planSha256:b.planSha256,metaSha256:d2Hash_(metaText)},readyText=d2Canonical_(ready),rf=d2File_(job,'ready.json');if(rf){if(rf.getBlob().getDataAsString()!==readyText)throw Error('D2_CONFLICT');}else d2Set_(job,'ready.json',readyText);return{jobId:b.jobId,status:'ready'};}finally{l.releaseLock();}}
function d2ValidatePut_(b){if(!/^job_[0-9a-f]{64}$/.test(b.jobId||'')||b.jobId!=='job_'+b.descriptorSha256||!/^[0-9a-f]{64}$/.test(b.descriptorSha256||'')||!/^[0-9a-f]{64}$/.test(b.ackProofHash||'')||!/^[0-9a-f]{64}$/.test(b.planSha256||'')||!Array.isArray(b.objects)||!b.plan||b.plan.version!=='dwo-relay-plan-v1'||!Number.isSafeInteger(b.plan.totalBytes)||b.plan.totalBytes<1||b.plan.totalBytes>D2_MAX_BYTES_||!Array.isArray(b.plan.entries)||b.plan.entries.length!==b.objects.length||b.objects.length<3||b.objects.length>D2_MAX_OBJECTS_)throw Error('D2_JOB_INVALID');if(d2Hash_(d2Canonical_(b.plan))!==b.planSha256)throw Error('D2_PLAN_HASH_INVALID');var total=0,ivs={},attachmentNext={},objects=[];for(var i=0;i<b.objects.length;i++){var o=b.objects[i],e=b.plan.entries[i];if(!o||o.ordinal!==i||!Number.isSafeInteger(o.size)||o.size<1||!/^[0-9a-f]{64}$/.test(o.ciphertextSha256||'')||!/^[A-Za-z0-9_-]+$/.test(o.bytes||'')||!e||!Number.isSafeInteger(e.size)||e.size!==o.size||e.ciphertextSha256!==o.ciphertextSha256||!/^[0-9a-f]{64}$/.test(e.ciphertextSha256||'')||typeof e.iv!=='string'||!/^[A-Za-z0-9_-]+$/.test(e.iv)||ivs[e.iv])throw Error('D2_PLAN_INVALID');ivs[e.iv]=true;total+=o.size;objects.push({ordinal:i,name:'obj_'+('0000'+i).slice(-4)+'.bin',size:o.size,ciphertextSha256:o.ciphertextSha256});if(i===0){if(!d2Keys_(e,['slot','kind','iv','size','ciphertextSha256','bootstrapVersion','recipientKeyId','ephemeralPublicJwk','hkdfSalt'])||e.slot!=='receiver-bootstrap'||e.kind!=='receiver-bootstrap'||e.bootstrapVersion!=='dwo-receiver-bootstrap-v1'||!/^rk_[A-Za-z0-9_-]+$/.test(e.recipientKeyId||'')||!d2Jwk_(e.ephemeralPublicJwk)||!/^[A-Za-z0-9_-]+$/.test(e.hkdfSalt||''))throw Error('D2_BOOTSTRAP_INVALID');}else if(i===1||i===2){var expected=i===1?'manifest':'work-order';if(!d2Keys_(e,['slot','kind','iv','size','ciphertextSha256'])||e.slot!==expected||e.kind!==expected)throw Error('D2_PLAN_INVALID');}else{var m=/^attachment:([A-Za-z0-9_-]+):([0-9]+)$/.exec(e.slot||'');if(!d2Keys_(e,['slot','kind','iv','size','ciphertextSha256','attachmentId','index'])||e.kind!=='attachment'||!m||e.attachmentId!==m[1]||e.index!==Number(m[2])||e.index!==(attachmentNext[e.attachmentId]||0))throw Error('D2_PLAN_INVALID');attachmentNext[e.attachmentId]=e.index+1;}}if(total!==b.plan.totalBytes)throw Error('D2_PLAN_INVALID');var first=b.plan.entries[0],bootstrap={version:first.bootstrapVersion,recipientKeyId:first.recipientKeyId,ephemeralPublicJwk:first.ephemeralPublicJwk,hkdfSalt:first.hkdfSalt,iv:first.iv,ciphertextSize:objects[0].size,ciphertextSha256:objects[0].ciphertextSha256};return{totalBytes:total,objects:objects,bootstrap:bootstrap};}
// Read-only authenticated status lookup. Never creates, mutates, or deletes any record.
function d2Status_(b){
  var c=d2Props_();
  if(!d2Keys_(b,['bearer','jobId','ackProofHash','planSha256'])||typeof b.bearer!=='string'||!d2Eq_(d2Hash_(b.bearer),c.p.getProperty('D2_UPLOAD_BEARER_SHA256')||''))throw Error('D2_UPLOAD_AUTH_INVALID');
  if(!/^job_[0-9a-f]{64}$/.test(b.jobId||'')||!/^[0-9a-f]{64}$/.test(b.ackProofHash||'')||!/^[0-9a-f]{64}$/.test(b.planSha256||''))throw Error('D2_STATUS_INVALID');
  var l=LockService.getScriptLock();l.waitLock(10000);
  try{
    var id=b.jobId,tombRaw=c.p.getProperty('D2_DELETED_'+id),cf=d2File_(c.root,'control_'+id+'.json'),job=d2Folder_(c.root,id);
    if(tombRaw){
      var t=d2DeletedRecord_(JSON.parse(tombRaw));
      if(t.jobId!==id||!d2Eq_(t.ackProofHash,b.ackProofHash))throw Error('D2_STATUS_MISMATCH');
      if(cf||job||d2Lookup_(t.jobFolderId))throw Error('D2_STATUS_INCONSISTENT');
      return{jobId:id,status:'deleted'};
    }
    if(cf){
      var x=d2ControlRecord_(JSON.parse(cf.getBlob().getDataAsString()));
      if(x.jobId!==id||!d2Eq_(x.ackProofHash,b.ackProofHash))throw Error('D2_STATUS_MISMATCH');
      return{jobId:id,status:'deleting'};
    }
    if(!job)return{jobId:id,status:'not-started'};
    // Only a confirmed, fully-bound ready marker may report 'ready'; any malformed marker,
    // mismatched metadata, duplicate name, or lock/auth failure here is a real error, never
    // silently downgraded to 'partial'.
    if(d2File_(job,'ready.json')){
      var ready=d2Ready_(c,id),m=d2ValidMeta_(ready.meta);
      if(!d2Eq_(m.ackProofHash,b.ackProofHash)||!d2Eq_(m.planSha256,b.planSha256)||id!=='job_'+m.descriptorSha256)throw Error('D2_STATUS_MISMATCH');
      d2Staging_(ready.job,m);
      d2VerifyObjects_(ready.job,m.objects);
      return{jobId:id,status:'ready'};
    }
    return d2PartialStatus_(job,id,b);
  }finally{l.releaseLock();}
}
// Exact binding: staging must declare the same job/proof/plan/total and, after removing only
// the Drive fileId that staging never carries, its ordered object list and bootstrap must be
// byte-identical to the authoritative metadata.
function d2Staging_(job,m){
  var sf=d2File_(job,'staging.json');
  if(!sf)throw Error('D2_STATUS_INCONSISTENT');
  var st=JSON.parse(sf.getBlob().getDataAsString());
  if(!st||st.version!==D2_STAGE_VERSION_||st.jobId!==m.jobId||st.descriptorSha256!==m.descriptorSha256||st.ackProofHash!==m.ackProofHash||st.planSha256!==m.planSha256||st.totalBytes!==m.totalBytes||!Array.isArray(st.objects)||st.objects.length!==m.objects.length)throw Error('D2_STATUS_INCONSISTENT');
  var expected=m.objects.map(function(o){return{ordinal:o.ordinal,name:o.name,size:o.size,ciphertextSha256:o.ciphertextSha256};});
  if(d2Canonical_(st.objects)!==d2Canonical_(expected)||d2Canonical_(st.bootstrap)!==d2Canonical_(m.bootstrap))throw Error('D2_STATUS_INCONSISTENT');
  return st;
}
// Exact shape of the authoritative ready metadata: version/state/job binding, ordered objects
// with unique Drive fileIds, expected ordinal/name/positive size/hash, a correct aggregate
// total bounded by D2_MAX_OBJECTS_, and a bootstrap entry matching object 0.
function d2ValidMeta_(m){
  if(!m||typeof m!=='object'||Array.isArray(m)||m.version!==D2_VERSION_||m.state!=='ready'||!/^job_[0-9a-f]{64}$/.test(m.jobId||'')||m.jobId!=='job_'+m.descriptorSha256||!/^[0-9a-f]{64}$/.test(m.descriptorSha256||'')||!/^[0-9a-f]{64}$/.test(m.ackProofHash||'')||!/^[0-9a-f]{64}$/.test(m.planSha256||'')||!Number.isSafeInteger(m.totalBytes)||m.totalBytes<1||m.totalBytes>D2_MAX_BYTES_||!Array.isArray(m.objects)||m.objects.length<3||m.objects.length>D2_MAX_OBJECTS_||!m.bootstrap||typeof m.bootstrap!=='object')throw Error('D2_METADATA_INVALID');
  var sum=0,ids={};
  for(var i=0;i<m.objects.length;i++){
    var o=m.objects[i],expectedName='obj_'+('0000'+i).slice(-4)+'.bin';
    if(!o||typeof o!=='object'||o.ordinal!==i||o.name!==expectedName||typeof o.fileId!=='string'||!o.fileId||ids[o.fileId]||!Number.isSafeInteger(o.size)||o.size<1||!/^[0-9a-f]{64}$/.test(o.ciphertextSha256||''))throw Error('D2_METADATA_INVALID');
    ids[o.fileId]=true;sum+=o.size;
  }
  if(sum!==m.totalBytes)throw Error('D2_METADATA_INVALID');
  if(!d2ValidBootstrap_(m.bootstrap,m.objects[0]))throw Error('D2_METADATA_INVALID');
  return m;
}
function d2ValidBootstrap_(bs,first){return !!bs&&typeof bs==='object'&&bs.version==='dwo-receiver-bootstrap-v1'&&/^rk_[A-Za-z0-9_-]+$/.test(bs.recipientKeyId||'')&&d2Jwk_(bs.ephemeralPublicJwk)&&/^[A-Za-z0-9_-]+$/.test(bs.hkdfSalt||'')&&/^[A-Za-z0-9_-]+$/.test(bs.iv||'')&&bs.ciphertextSize===first.size&&bs.ciphertextSha256===first.ciphertextSha256;}
// A missing ready marker is only ever 'partial' when a durable, exactly-bound staging record
// exists; otherwise the status is unconfirmed and must be rejected rather than guessed.
// When metadata also exists (write interrupted between meta.json and ready.json) it must bind
// to the same job/proof/plan and its actual Drive object list must verify.
function d2PartialStatus_(job,id,b){
  var sf=d2File_(job,'staging.json');
  if(!sf)throw Error('D2_STATUS_UNCONFIRMED');
  var st=JSON.parse(sf.getBlob().getDataAsString());
  if(!st||st.version!==D2_STAGE_VERSION_||st.jobId!==id||id!=='job_'+(st.descriptorSha256||'')||!d2Eq_(st.ackProofHash||'',b.ackProofHash)||!d2Eq_(st.planSha256||'',b.planSha256)||!Number.isSafeInteger(st.totalBytes)||st.totalBytes<1||st.totalBytes>D2_MAX_BYTES_||!Array.isArray(st.objects)||st.objects.length<3||st.objects.length>D2_MAX_OBJECTS_)throw Error('D2_STATUS_UNCONFIRMED');
  var sum=0;
  for(var i=0;i<st.objects.length;i++){
    var o=st.objects[i],expectedName='obj_'+('0000'+i).slice(-4)+'.bin';
    if(!o||typeof o!=='object'||o.ordinal!==i||o.name!==expectedName||!Number.isSafeInteger(o.size)||o.size<1||!/^[0-9a-f]{64}$/.test(o.ciphertextSha256||''))throw Error('D2_STATUS_UNCONFIRMED');
    sum+=o.size;
  }
  if(sum!==st.totalBytes||!d2ValidBootstrap_(st.bootstrap,st.objects[0]))throw Error('D2_STATUS_UNCONFIRMED');
  var mf=d2File_(job,'meta.json');
  if(mf){
    var m=d2ValidMeta_(JSON.parse(mf.getBlob().getDataAsString()));
    if(m.jobId!==id||!d2Eq_(m.ackProofHash,b.ackProofHash)||!d2Eq_(m.planSha256,b.planSha256)||m.descriptorSha256!==st.descriptorSha256)throw Error('D2_STATUS_UNCONFIRMED');
    d2Staging_(job,m);
    d2VerifyObjects_(job,m.objects);
  }
  return{jobId:id,status:'partial'};
}
function d2Control_(b){var c=d2Props_();if(!b||!d2Eq_(d2Hash_(b.receiverBearer),c.p.getProperty('D2_RECEIVER_BEARER_SHA256')||''))throw Error('D2_RECEIVER_AUTH_INVALID');if(b.action==='issueAckCapability')return d2Issue_(c,b.jobId);if(b.action==='ack')return d2Ack_(c,b);if(b.action==='resumeAck')return d2ResumeAck_(c,b);throw Error('D2_CONTROL_ACTION_INVALID');}
function d2Ready_(c,id){var j=d2Job_(c,id),mf=d2File_(j,'meta.json'),rf=d2File_(j,'ready.json');if(!mf||!rf)throw Error('D2_JOB_NOT_READY');var mt=mf.getBlob().getDataAsString(),m=JSON.parse(mt),r=JSON.parse(rf.getBlob().getDataAsString());if(!m||m.version!==D2_VERSION_||m.state!=='ready'||m.jobId!==id||!/^[0-9a-f]{64}$/.test(m.planSha256||'')||!r||r.version!==D2_VERSION_||r.jobId!==id||r.state!=='ready'||r.planSha256!==m.planSha256||r.metaSha256!==d2Hash_(mt))throw Error('D2_READY_BINDING_INVALID');return{job:j,meta:m};}
function d2Issue_(c,id){if(!/^job_[0-9a-f]{64}$/.test(id||''))throw Error('D2_JOB_INVALID');var l=LockService.getScriptLock();l.waitLock(10000);try{if(d2File_(c.root,'control_'+id+'.json')||c.p.getProperty('D2_DELETED_'+id))throw Error('D2_JOB_NOT_READY');d2Ready_(c,id);var cap=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');c.p.setProperty('D2_ACK_CAP_'+id,d2Hash_(cap));return{jobId:id,ackCapability:cap};}finally{l.releaseLock();}}
function d2Ack_(c,b){if(!/^job_[0-9a-f]{64}$/.test(b&&b.jobId||'')||typeof b.ackCapability!=='string'||typeof b.ackProof!=='string')throw Error('D2_JOB_INVALID');var l=LockService.getScriptLock();l.waitLock(10000);try{var capKey='D2_ACK_CAP_'+b.jobId,tombKey='D2_DELETED_'+b.jobId,n='control_'+b.jobId+'.json',f=d2File_(c.root,n),t=c.p.getProperty(tombKey);if(!f&&t){var tomb=d2DeletedRecord_(JSON.parse(t));if(!d2Eq_(d2Hash_(b.ackCapability),tomb.ackCapabilityHash)||!d2Eq_(d2Hash_(b.ackProof),tomb.ackProofHash)||d2Lookup_(tomb.jobFolderId)||d2Folder_(c.root,b.jobId))throw Error('D2_ACK_INVALID');c.p.deleteProperty(capKey);return{jobId:b.jobId,status:'deleted'};}var cap=c.p.getProperty(capKey)||'';if(!d2Eq_(d2Hash_(b.ackCapability),cap))throw Error('D2_ACK_INVALID');var x;if(f){x=d2ControlRecord_(JSON.parse(f.getBlob().getDataAsString()));}else{var ready=d2Ready_(c,b.jobId),m=ready.meta;if(!d2Eq_(d2Hash_(b.ackProof),m.ackProofHash||''))throw Error('D2_ACK_INVALID');x={version:D2_VERSION_,state:'deleting',jobId:b.jobId,jobFolderId:ready.job.getId(),jobFolderName:b.jobId,ackProofHash:m.ackProofHash,objects:m.objects.map(function(o){var q=d2File_(ready.job,o.name);if(!q||q.getId()!==o.fileId)throw Error('D2_READY_BINDING_INVALID');return{fileId:o.fileId,name:o.name};}).concat([{fileId:d2File_(ready.job,'staging.json').getId(),name:'staging.json'},{fileId:d2File_(ready.job,'ready.json').getId(),name:'ready.json'},{fileId:d2File_(ready.job,'meta.json').getId(),name:'meta.json'}])};x=d2ControlRecord_(x);d2Set_(c.root,n,d2Canonical_(x));m.state='deleting';d2Replace_(ready.job,'meta.json',d2Canonical_(m));}if(!d2Eq_(d2Hash_(b.ackProof),x.ackProofHash))throw Error('D2_ACK_INVALID');d2Delete_(c,x,n,cap);c.p.deleteProperty(capKey);return{jobId:b.jobId,status:'deleted'};}finally{l.releaseLock();}}
// Resume only a previously capability-and-proof-authorized deletion. Never create it here.
function d2ResumeAck_(c,b){
  if(!/^job_[0-9a-f]{64}$/.test(b&&b.jobId||'')||!/^[0-9a-f]{64}$/.test(b.ackProof||''))throw Error('D2_JOB_INVALID');
  var l=LockService.getScriptLock();l.waitLock(10000);
  try{
    var id=b.jobId,n='control_'+id+'.json',capKey='D2_ACK_CAP_'+id,f=d2File_(c.root,n),t=c.p.getProperty('D2_DELETED_'+id),proofHash=d2Hash_(b.ackProof);
    if(f){
      var x=d2ControlRecord_(JSON.parse(f.getBlob().getDataAsString())),cap=c.p.getProperty(capKey)||'';
      if(x.jobId!==id||!/^[0-9a-f]{64}$/.test(cap)||!d2Eq_(proofHash,x.ackProofHash))throw Error('D2_ACK_INVALID');
      d2Delete_(c,x,n,cap);c.p.deleteProperty(capKey);return{jobId:id,status:'deleted'};
    }
    if(t){
      var tomb=d2DeletedRecord_(JSON.parse(t));
      if(tomb.jobId!==id||!d2Eq_(proofHash,tomb.ackProofHash)||d2Lookup_(tomb.jobFolderId)||d2Folder_(c.root,id))throw Error('D2_ACK_INVALID');
      c.p.deleteProperty(capKey);return{jobId:id,status:'deleted'};
    }
    return{jobId:id,status:'not-started'};
  }finally{l.releaseLock();}
}
function d2DeletedRecord_(x){if(!d2Keys_(x,['version','state','jobId','jobFolderId','ackCapabilityHash','ackProofHash'])||x.version!==D2_VERSION_||x.state!=='deleted'||!/^job_[0-9a-f]{64}$/.test(x.jobId||'')||!x.jobFolderId||!/^[0-9a-f]{64}$/.test(x.ackCapabilityHash||'')||!/^[0-9a-f]{64}$/.test(x.ackProofHash||''))throw Error('D2_TOMBSTONE_INVALID');return x;}
function d2ControlRecord_(x){if(!d2Keys_(x,['version','state','jobId','jobFolderId','jobFolderName','ackProofHash','objects'])||x.version!==D2_VERSION_||x.state!=='deleting'||!/^job_[0-9a-f]{64}$/.test(x.jobId||'')||x.jobFolderName!==x.jobId||!x.jobFolderId||!/^[0-9a-f]{64}$/.test(x.ackProofHash||'')||!Array.isArray(x.objects)||x.objects.length<6)throw Error('D2_CONTROL_INVALID');var names={},ids={},obj=[];x.objects.forEach(function(o){if(!d2Keys_(o,['fileId','name'])||!o.fileId||!o.name||names[o.name]||ids[o.fileId]||!(o.name==='staging.json'||o.name==='ready.json'||o.name==='meta.json'||/^obj_[0-9]{4}\.bin$/.test(o.name)))throw Error('D2_CONTROL_INVALID');names[o.name]=true;ids[o.fileId]=true;if(/^obj_/.test(o.name))obj.push(o.name);});if(!names['staging.json']||!names['ready.json']||!names['meta.json']||obj.length!==x.objects.length-3||obj.length<3)throw Error('D2_CONTROL_INVALID');obj.sort();obj.forEach(function(name,i){if(name!=='obj_'+('0000'+i).slice(-4)+'.bin')throw Error('D2_CONTROL_INVALID');});return x;}
function d2Delete_(c,x,n,capHash){x=d2ControlRecord_(x);var before=d2Lookup_(x.jobFolderId);if(before){if(before.name!==x.jobFolderName||before.mimeType!==D2_FOLDER_MIME_||!before.parents||before.parents.length!==1||before.parents[0]!==c.root.getId())throw Error('D2_DELETE_SCOPE_INVALID');x.objects.forEach(function(o){d2DeleteChild_(x.jobFolderId,o.fileId,o.name,'file');});}else if(x.objects.some(function(o){return !!d2Lookup_(o.fileId);}))throw Error('D2_DELETE_SCOPE_INVALID');var meta=d2Lookup_(x.jobFolderId);if(meta){if(meta.name!==x.jobFolderName||meta.mimeType!==D2_FOLDER_MIME_||!meta.parents||meta.parents.length!==1||meta.parents[0]!==c.root.getId())throw Error('D2_DELETE_SCOPE_INVALID');var job=DriveApp.getFolderById(x.jobFolderId);if(d2HasChildren_(job))throw Error('D2_FOLDER_NOT_EMPTY');d2DeleteChild_(c.root.getId(),x.jobFolderId,x.jobFolderName,'folder');}var tomb={version:D2_VERSION_,state:'deleted',jobId:x.jobId,jobFolderId:x.jobFolderId,ackCapabilityHash:capHash,ackProofHash:x.ackProofHash};c.p.setProperty('D2_DELETED_'+x.jobId,d2Canonical_(tomb));var cf=d2File_(c.root,n);if(cf)d2DeleteChild_(c.root.getId(),cf.getId(),n,'file');}
function d2Lookup_(id){var url='https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,parents,mimeType',r=UrlFetchApp.fetch(url,{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true}),code=r.getResponseCode();if(code===404)return null;if(code!==200)throw Error('D2_DRIVE_GET_FAILED');return JSON.parse(r.getContentText());}
function d2DeleteChild_(parent,id,name,kind){var v=d2Lookup_(id);if(!v)return;if(v.name!==name||!v.parents||v.parents.length!==1||v.parents[0]!==parent||(kind==='folder'&&v.mimeType!==D2_FOLDER_MIME_)||(kind==='file'&&v.mimeType===D2_FOLDER_MIME_))throw Error('D2_DELETE_SCOPE_INVALID');var r=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id),{method:'delete',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});if(r.getResponseCode()!==204&&r.getResponseCode()!==404)throw Error('D2_DELETE_FAILED');}
function d2File_(folder,name){var it=folder.getFilesByName(name),x=it.hasNext()?it.next():null;if(it.hasNext())throw Error('D2_DUPLICATE_NAME');return x;}function d2Folder_(folder,name){var it=folder.getFoldersByName(name),x=it.hasNext()?it.next():null;if(it.hasNext())throw Error('D2_DUPLICATE_NAME');return x;}function d2Job_(c,id){var j=d2Folder_(c.root,id);if(!j)throw Error('D2_JOB_NOT_FOUND');return j;}function d2Set_(f,n,t){if(d2File_(f,n))throw Error('D2_DUPLICATE_NAME');f.createFile(n,t,MimeType.PLAIN_TEXT);}function d2Replace_(f,n,t){var x=d2File_(f,n);if(!x)throw Error('D2_FILE_MISSING');x.setContent(t);}function d2SetBytes_(f,n,b){if(d2File_(f,n))throw Error('D2_DUPLICATE_NAME');f.createFile(Utilities.newBlob(b,'application/octet-stream',n));}
// At write-time (d2Put_) objects carry no fileId yet, so only bytes/size are verified; at
// status-time (ready/partial metadata) objects carry the recorded Drive fileId, which must
// match the actual file actually found by name -- a renamed/substituted fileId with matching
// bytes must never verify.
function d2VerifyObjects_(job,objects){objects.forEach(function(o){var f=d2File_(job,o.name);if(!f||f.getSize()!==o.size||d2HashBytes_(f.getBlob().getBytes())!==o.ciphertextSha256||(o.fileId!==undefined&&f.getId()!==o.fileId))throw Error('D2_OBJECT_VERIFY_FAILED');});}function d2HasChildren_(f){return f.getFiles().hasNext()||f.getFolders().hasNext();}
function d2Hash_(s){return d2HashBytes_(Utilities.newBlob(String(s)).getBytes());}function d2HashBytes_(b){var d=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,b),s='';for(var i=0;i<d.length;i++)s+=((d[i]+256)%256).toString(16).padStart(2,'0');return s;}function d2Eq_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var n=0;for(var i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function d2Jwk_(x){return x&&x.kty==='EC'&&x.crv==='P-256'&&/^[A-Za-z0-9_-]{40,50}$/.test(x.x||'')&&/^[A-Za-z0-9_-]{40,50}$/.test(x.y||'');}function d2Keys_(v,a){if(!v||typeof v!=='object'||Array.isArray(v))return false;var k=Object.keys(v).sort(),z=a.slice().sort();return k.length===z.length&&k.every(function(x,i){return x===z[i];});}
function d2Canonical_(v){if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);if(typeof v==='number'){if(!isFinite(v))throw Error('D2_NON_JSON');return JSON.stringify(v);}if(Array.isArray(v))return'['+v.map(d2Canonical_).join(',')+']';if(typeof v==='object'){var a=Object.keys(v).sort();return'{'+a.map(function(k){if(v[k]===undefined||typeof v[k]==='function'||typeof v[k]==='bigint'||typeof v[k]==='symbol')throw Error('D2_NON_JSON');return JSON.stringify(k)+':'+d2Canonical_(v[k]);}).join(',')+'}';}throw Error('D2_NON_JSON');}

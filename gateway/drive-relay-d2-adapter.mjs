import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { reconstructEnvelope, computeAckProof, resolveSenderRegistry } from './receiver-core.mjs';
import { persistVerifiedPackage } from './local-store.mjs';
import { loadVerifiedJob } from './viewer-core.mjs';
import { isDeepStrictEqual } from 'node:util';

const require=createRequire(import.meta.url),Crypto=require('../media-transfer-crypto.js'),Transfer=require('../media-transfer-package.js');
const META_VERSION='dwo-drive-relay-d2-v1',HEX64=/^[0-9a-f]{64}$/,OBJ=/^obj_([0-9]{4})\.bin$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function exact(value,keys){return plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function validJwk(value){return plain(value)&&value.kty==='EC'&&value.crv==='P-256'&&/^[A-Za-z0-9_-]{40,50}$/.test(value.x||'')&&/^[A-Za-z0-9_-]{40,50}$/.test(value.y||'');}
function validMeta(meta){
  if(!plain(meta)||meta.version!==META_VERSION||meta.state!=='ready'||!/^job_[0-9a-f]{64}$/.test(meta.jobId||'')||meta.jobId!=='job_'+meta.descriptorSha256||!HEX64.test(meta.descriptorSha256||'')||!HEX64.test(meta.ackProofHash||'')||!HEX64.test(meta.planSha256||'')||!Number.isSafeInteger(meta.totalBytes)||meta.totalBytes<1||!Array.isArray(meta.objects)||meta.objects.length<3||!plain(meta.bootstrap))return false;
  let sum=0;
  for(let i=0;i<meta.objects.length;i++){
    const object=meta.objects[i],match=OBJ.exec(object&&object.name||'');
    if(!plain(object)||object.ordinal!==i||!match||Number(match[1])!==i||typeof object.fileId!=='string'||!object.fileId||!Number.isSafeInteger(object.size)||object.size<1||!HEX64.test(object.ciphertextSha256||''))return false;
    sum+=object.size;
  }
  const first=meta.objects[0],b=meta.bootstrap;
  return sum===meta.totalBytes&&b.version==='dwo-receiver-bootstrap-v1'&&/^rk_[A-Za-z0-9_-]+$/.test(b.recipientKeyId||'')&&validJwk(b.ephemeralPublicJwk)&&/^[A-Za-z0-9_-]+$/.test(b.hkdfSalt||'')&&/^[A-Za-z0-9_-]+$/.test(b.iv||'')&&b.ciphertextSize===first.size&&b.ciphertextSha256===first.ciphertextSha256;
}
async function senderRegistryFromPairing(dir){
  const pairingPath=path.join(path.dirname(dir),'pairing.json');
  let pairingStat;try{pairingStat=await fs.lstat(pairingPath);}catch{throw fail('D2_PAIRING_REGISTRY_INVALID');}
  if(!pairingStat.isFile()||pairingStat.isSymbolicLink())throw fail('D2_PAIRING_REGISTRY_INVALID');
  let pairing;try{pairing=JSON.parse(await fs.readFile(pairingPath,'utf8'));}catch{throw fail('D2_PAIRING_REGISTRY_INVALID');}
  if(!exact(pairing,['clinicDeviceId','signingKeyId','signingPublicJwk','recipientKeyId'])||!/^dev_[A-Za-z0-9_-]+$/.test(pairing.clinicDeviceId)||!/^sk_[A-Za-z0-9_-]+$/.test(pairing.signingKeyId)||!/^rk_[A-Za-z0-9_-]+$/.test(pairing.recipientKeyId)||!validJwk(pairing.signingPublicJwk))throw fail('D2_PAIRING_REGISTRY_INVALID');
  return{version:'dwo-sender-registry-v1',clinicDeviceId:pairing.clinicDeviceId,status:'active',pairedRecipientKeyId:pairing.recipientKeyId,activeSigningKey:{signingKeyId:pairing.signingKeyId,publicJwk:pairing.signingPublicJwk,activatedAt:0},retiredSigningKeys:[],pairingId:'pr_d2_synthetic_trial',createdAt:0,updatedAt:0};
}
export async function readVerifiedSyncedJob(dir){
  let marker,meta,metaBytes;try{metaBytes=await fs.readFile(path.join(dir,'meta.json'));meta=JSON.parse(metaBytes.toString('utf8'));marker=JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8'));}catch{throw fail('D2_READY_MARKER_MISSING');}
  if(!validMeta(meta)||!plain(marker)||marker.version!==META_VERSION||marker.jobId!==meta.jobId||marker.state!=='ready'||marker.planSha256!==meta.planSha256||marker.metaSha256!==hash(metaBytes)||!HEX64.test(marker.metaSha256||''))throw fail('D2_METADATA_INVALID');
  const blobs=[];for(const object of meta.objects){let bytes;try{bytes=await fs.readFile(path.join(dir,object.name));}catch{throw fail('D2_SYNC_OBJECT_MISSING');}if(bytes.length!==object.size)throw fail('D2_SYNC_OBJECT_SIZE_MISMATCH');if(hash(bytes)!==object.ciphertextSha256)throw fail('D2_SYNC_OBJECT_HASH_MISMATCH');blobs.push(new Blob([bytes]));}
  return{meta,blobs};
}
// Reuse the existing inbox verifier; a receipt alone is not proof of durable content.
async function verifyD2LocalJob(root,jobId,expectedManifest){
  if(!path.isAbsolute(root||'')||!/^job_[0-9a-f]{64}$/.test(jobId))throw fail('D2_LOCAL_ID_INVALID');
  const job=await loadVerifiedJob(root,jobId);
  const receipt=JSON.parse(await fs.readFile(path.join(job.directory,'receipt.json'),'utf8'));
  if(receipt.descriptorSha256!==jobId.slice(4))throw fail('D2_LOCAL_DESCRIPTOR_MISMATCH');
  if(expectedManifest){
    const manifest=JSON.parse(await fs.readFile(path.join(job.directory,'manifest.json'),'utf8'));
    if(!isDeepStrictEqual(manifest,expectedManifest)||job.workOrderRef!==expectedManifest.workOrderRef)throw fail('D2_LOCAL_MANIFEST_MISMATCH');
  }
  return job;
}
function validateAckResponse(value,jobId,allowNotStarted=false){
  if(!plain(value)||value.jobId!==jobId||(value.status!=='deleted'&&!(allowNotStarted&&value.status==='not-started')))throw fail('D2_ACK_RESPONSE_INVALID');
  return value;
}
// Resume authorized deletion before reading Drive sync, which may be gone already.
export async function receiveD2Job(dir,options={}){
  const jobId=path.basename(path.resolve(dir));
  if(!/^job_[0-9a-f]{64}$/.test(jobId)||!path.isAbsolute(options.inboxRoot||''))throw fail('D2_LOCAL_ID_INVALID');
  let exists;
  try{await fs.lstat(path.join(options.inboxRoot,jobId));exists=true;}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
  if(exists){
    const local=await verifyD2LocalJob(options.inboxRoot,jobId);
    if(!options.control||typeof options.control.resumeAck!=='function')throw fail('D2_ACK_UNAVAILABLE');
    const proof=computeAckProof(jobId,jobId.slice(4),local.workOrderRef);
    const ack=validateAckResponse(await options.control.resumeAck({jobId,ackProof:proof}),jobId,true);
    if(ack.status==='deleted')return{jobId,status:'already-stored',cloudStatus:'deleted',workOrderRef:local.workOrderRef};
  }
  return processD2SyncedJob(dir,{...options,expectedJobId:jobId});
}
// Shared by processD2SyncedJob (ACK path) and the retained-only path: verifies the ready/meta
// binding and every ciphertext object, reconstructs the envelope, and decrypts it. Never
// persists and never touches ACK/control -- callers decide what happens with the result.
async function decryptD2Job(dir,options={}){
  const {meta,blobs}=await readVerifiedSyncedJob(dir),crypto=options.crypto||webcrypto;
  if(options.expectedJobId&&meta.jobId!==options.expectedJobId)throw fail('D2_LOCAL_ID_INVALID');
  const plan={version:'dwo-receiver-api-v1',jobId:meta.jobId,ackCapability:'A'.repeat(43),bootstrap:meta.bootstrap,objects:meta.objects.map(object=>({ordinal:object.ordinal,size:object.size,ciphertextSha256:object.ciphertextSha256,downloadUrl:'https://d2.invalid/'+object.name}))};
  const envelope=await reconstructEnvelope(plan,blobs,options.recipientKeyRingOrIdentity,{crypto});
  if(envelope.header.descriptorSha256!==meta.descriptorSha256)throw fail('D2_DESCRIPTOR_MISMATCH');
  const registry=options.senderRegistries||{senders:[await senderRegistryFromPairing(dir)]};
  const sender=resolveSenderRegistry(registry,envelope.descriptor.senderClinicDeviceId);
  const decrypted=await(options.cryptoApi||Crypto).decryptEnvelope(envelope,options.recipientKeyRingOrIdentity,sender,{crypto,transferApi:options.transferApi||Transfer});
  return{meta,envelope,decrypted};
}
export async function processD2SyncedJob(dir,options={}){
  const{meta,envelope,decrypted}=await decryptD2Job(dir,options);
  const stored=await(options.persist||persistVerifiedPackage)({jobId:meta.jobId,workOrderRef:decrypted.workOrderRef,pkg:decrypted.package,descriptorSha256:envelope.header.descriptorSha256},{root:options.inboxRoot,now:options.now});if(!stored||!['stored','already-stored'].includes(stored.status))throw fail('D2_PERSIST_FAILED');
  await verifyD2LocalJob(options.inboxRoot,meta.jobId,decrypted.package.manifest);
  if(!options.control||typeof options.control.issueAckCapability!=='function'||typeof options.control.ack!=='function')throw fail('D2_ACK_UNAVAILABLE');
  const issued=await options.control.issueAckCapability(meta.jobId);if(!issued||issued.jobId!==meta.jobId||!/^[A-Za-z0-9_-]{40,200}$/.test(issued.ackCapability||''))throw fail('D2_ACK_CAPABILITY_INVALID');
  const ack=validateAckResponse(await options.control.ack({jobId:meta.jobId,ackCapability:issued.ackCapability,ackProof:computeAckProof(meta.jobId,envelope.header.descriptorSha256,decrypted.workOrderRef)}),meta.jobId);
  return{jobId:meta.jobId,status:stored.status,cloudStatus:ack.status,workOrderRef:decrypted.workOrderRef};
}
export const constants=Object.freeze({META_VERSION,RETAIN_SYNTHETIC_WORK_ORDER_REF:'dwo:223e4567-e89b-42d3-a456-426614174001',RETAIN_SYNTHETIC_ATTACHMENT_BYTES:[68,50,0,1],RETAIN_DEFAULT_TIMEOUT_MS:180000});
export function createAppsScriptControl(endpoint,receiverBearer,fetchApi=globalThis.fetch){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint||'')||!/^[A-Za-z0-9_-]{43}$/.test(receiverBearer||'')||typeof fetchApi!=='function')throw fail('D2_CONTROL_CONFIG_INVALID');
  const call=async body=>{const response=await fetchApi(endpoint,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiverBearer,...body})});if(!response||!response.ok)throw fail('D2_CONTROL_FAILED');const value=await response.json();if(!value||value.ok===false)throw fail('D2_CONTROL_REJECTED');return value;};
  return{issueAckCapability:jobId=>call({action:'issueAckCapability',jobId}),ack:async value=>validateAckResponse(await call({action:'ack',...value}),value.jobId),resumeAck:async value=>validateAckResponse(await call({action:'resumeAck',...value}),value.jobId,true)};
}
function validateConfig(value){const keys=['schemaVersion','syncedJobDir','inboxRoot','recipientBackupPath','appsScriptEndpoint'];if(!exact(value,keys)||value.schemaVersion!==1||keys.slice(1,4).some(key=>typeof value[key]!=='string'||!value[key])||typeof value.appsScriptEndpoint!=='string')throw fail('D2_TRIAL_CONFIG_INVALID');return value;}
export async function runD2TrialOnce(configPath){
  let config;try{config=validateConfig(JSON.parse(await fs.readFile(configPath,'utf8')));}catch(error){if(error&&error.code)throw error;throw fail('D2_TRIAL_CONFIG_READ_FAILED');}
  const passphrase=process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE,receiverBearer=process.env.DWO_D2_RECEIVER_BEARER;if(typeof passphrase!=='string'||passphrase.length<12||!/^[A-Za-z0-9_-]{43}$/.test(receiverBearer||''))throw fail('D2_TRIAL_SECRET_MISSING');
  const base=path.dirname(path.resolve(configPath));let backup;try{backup=JSON.parse(await fs.readFile(path.resolve(base,config.recipientBackupPath),'utf8'));}catch{throw fail('D2_TRIAL_BACKUP_READ_FAILED');}
  const recipient=await Crypto.restoreRecipientIdentity(backup,passphrase,{crypto:webcrypto});const result=await receiveD2Job(path.resolve(base,config.syncedJobDir),{recipientKeyRingOrIdentity:recipient,inboxRoot:path.resolve(base,config.inboxRoot),control:createAppsScriptControl(config.appsScriptEndpoint,receiverBearer)});return{jobId:result.jobId,status:result.status,cloudStatus:result.cloudStatus};
}

// ============================================================
// Issue #172: bounded D2 "Windows logon receiver" -- retained-only path.
// This path never constructs a control object, never calls fetch, and never reads the
// receiver bearer: it only decrypts, validates against the one allowed second synthetic
// fixture, and persists locally (reusing the exact same verified decrypt/persist/local-verify
// building blocks as the ACK path above). It is invoked only by runD2RetainedTrialOnce /
// --retain-config=, never by --config=.
// ============================================================
const RETAIN_SYNTHETIC_WORK_ORDER_REF='dwo:223e4567-e89b-42d3-a456-426614174001';
const RETAIN_SYNTHETIC_ATTACHMENT_BYTES=Buffer.from([68,50,0,1]);
const RETAIN_OBJECT_COUNT=4;
const RETAIN_MAX_OBJECT_BYTES=16384;
const RETAIN_DEFAULT_TIMEOUT_MS=180000;
const RETAIN_DEFAULT_POLL_MS=200;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// True if `inner` is equal to or nested inside `outer` (lexical path containment, used only
// after both sides have already been resolved -- realpath when available, else normalized).
function pathOverlaps(outer,inner){const rel=path.relative(outer,inner);return rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel));}
async function realOrResolved(dir){try{return await fs.realpath(dir);}catch{return path.resolve(dir);}}

// Presence probe for the Drive-virtual-root itself: uses fs.stat (follows any reparse point)
// rather than lstat, so the mounted Drive folder's own reparse attributes are never treated as
// a rejectable "link" -- only its resolved type matters here. Missing -> null (retry); any
// other access failure or a non-directory target -> terminate (never retried).
async function statSyncRootOrMissing(dir){
  let stat;try{stat=await fs.stat(dir);}catch(error){if(error&&error.code==='ENOENT')return null;throw fail('D2_RETAIN_SYNC_ROOT_ACCESS_FAILED');}
  if(!stat.isDirectory())throw fail('D2_RETAIN_SYNC_ROOT_INVALID');
  return stat;
}
// Presence probe for everything *inside* the sync root (the job directory and its files) and
// for the local inbox job/media directories: uses lstat and explicitly rejects a symlink/
// junction at that exact entry. Missing -> null (retry); a link, wrong type, or any other
// access failure -> terminate (never retried).
async function statChildOrMissing(file,kind){
  let stat;try{stat=await fs.lstat(file);}catch(error){if(error&&error.code==='ENOENT')return null;throw fail('D2_RETAIN_FILE_ACCESS_FAILED');}
  if(stat.isSymbolicLink())throw fail('D2_RETAIN_LINK_REJECTED');
  if(kind==='dir'&&!stat.isDirectory())throw fail('D2_RETAIN_PATH_INVALID');
  if(kind==='file'&&!stat.isFile())throw fail('D2_RETAIN_PATH_INVALID');
  return stat;
}

// The single bounded-wait authority (Issue #172 / finding A6): polls, with a monotonic
// deadline, for the dedicated sync root, the exact job directory (a direct, non-linked child
// of it), and then ready.json/meta.json/every obj_NNNN.bin -- but only ever *waits* on an
// ENOENT ("missing"). Anything present-but-wrong (a link, wrong type, malformed JSON, a
// binding mismatch, a layout/size that cannot be this fixture, an unexpected size) terminates
// immediately instead of retrying. A deadline is only a bound on *this* wait loop, not a
// guarantee that no underlying filesystem call can ever block.
export async function waitForD2RetainedReady(syncRoot,expectedJobId,options={}){
  if(!path.isAbsolute(syncRoot||'')||!/^job_[0-9a-f]{64}$/.test(expectedJobId||''))throw fail('D2_RETAIN_CONFIG_INVALID');
  const timeoutMs=Number.isInteger(options.timeoutMs)&&options.timeoutMs>0&&options.timeoutMs<=RETAIN_DEFAULT_TIMEOUT_MS?options.timeoutMs:RETAIN_DEFAULT_TIMEOUT_MS;
  const pollMs=Number.isInteger(options.pollIntervalMs)&&options.pollIntervalMs>0?options.pollIntervalMs:RETAIN_DEFAULT_POLL_MS;
  const nowFn=options.monotonicNow||Date.now,sleepFn=options.sleep||delay;
  const resolvedRoot=path.normalize(path.resolve(syncRoot)),jobDir=path.join(resolvedRoot,expectedJobId);
  const deadline=nowFn()+timeoutMs;
  let meta=null,metaBytes=null,markerOk=false;
  for(;;){
    const rootStat=await statSyncRootOrMissing(resolvedRoot);
    if(rootStat){
      const jobStat=await statChildOrMissing(jobDir,'dir');
      if(jobStat){
        const[rootReal,jobReal]=await Promise.all([fs.realpath(resolvedRoot),fs.realpath(jobDir)]);
        if(path.dirname(jobReal)!==rootReal)throw fail('D2_RETAIN_PATH_ESCAPE');
        if(!meta){
          const metaStat=await statChildOrMissing(path.join(jobDir,'meta.json'),'file');
          if(metaStat){
            let parsed;try{metaBytes=await fs.readFile(path.join(jobDir,'meta.json'));parsed=JSON.parse(metaBytes.toString('utf8'));}catch{throw fail('D2_RETAIN_METADATA_INVALID');}
            if(!validMeta(parsed))throw fail('D2_RETAIN_METADATA_INVALID');
            if(parsed.jobId!==expectedJobId)throw fail('D2_RETAIN_JOB_ID_MISMATCH');
            if(parsed.objects.length!==RETAIN_OBJECT_COUNT||parsed.objects.some(object=>object.size>RETAIN_MAX_OBJECT_BYTES))throw fail('D2_RETAIN_LAYOUT_INVALID');
            meta=parsed;
          }
        }
        const readyStat=await statChildOrMissing(path.join(jobDir,'ready.json'),'file');
        if(readyStat){
          if(!meta)throw fail('D2_RETAIN_METADATA_INVALID'); // ready.json is written strictly after meta.json
          if(!markerOk){
            let marker;try{marker=JSON.parse(await fs.readFile(path.join(jobDir,'ready.json'),'utf8'));}catch{throw fail('D2_RETAIN_METADATA_INVALID');}
            if(!plain(marker)||marker.version!==META_VERSION||marker.jobId!==meta.jobId||marker.state!=='ready'||marker.planSha256!==meta.planSha256||marker.metaSha256!==hash(metaBytes)||!HEX64.test(marker.metaSha256||''))throw fail('D2_RETAIN_METADATA_INVALID');
            markerOk=true;
          }
        }
        if(meta&&markerOk){
          let allPresent=true;
          for(const object of meta.objects){
            const objectStat=await statChildOrMissing(path.join(jobDir,object.name),'file');
            if(!objectStat){allPresent=false;break;}
            if(objectStat.size!==object.size)throw fail('D2_RETAIN_OBJECT_SIZE_MISMATCH');
          }
          if(allPresent)return{meta,jobDir};
        }
      }
    }
    if(nowFn()>=deadline)throw fail('D2_RETAIN_WAIT_TIMEOUT');
    await sleepFn(pollMs);
  }
}

// Defense in depth beyond viewer-core's own per-file symlink checks (Issue #172 / finding A3):
// also rejects a linked inbox job directory itself and a linked media/ directory underneath
// it, so an ancestor link cannot smuggle a store/verify onto a path outside the inbox.
async function assertInboxJobLinkSafe(inboxRoot,jobId){
  const jobDir=path.join(path.resolve(inboxRoot),jobId);
  const jobStat=await statChildOrMissing(jobDir,'dir');
  if(!jobStat)return;
  const mediaStat=await statChildOrMissing(path.join(jobDir,'media'),'dir');
  void mediaStat; // missing media/ (not yet persisted) is fine; present-but-linked already threw above.
}

// The one allowed second synthetic fixture (Issue #172): a fixed work-order reference, an
// exact closed work-order JSON object, and exactly one application/octet-stream attachment of
// the exact 4 bytes below. Anything else is rejected before any local persistence, even if it
// decrypted and verified cryptographically without any other error.
async function assertExactRetainedSyntheticJob(decrypted){
  if(decrypted.workOrderRef!==RETAIN_SYNTHETIC_WORK_ORDER_REF)throw fail('D2_RETAIN_REF_REJECTED');
  const pkg=decrypted.package,manifest=pkg&&pkg.manifest;
  if(!manifest||manifest.workOrderRef!==RETAIN_SYNTHETIC_WORK_ORDER_REF)throw fail('D2_RETAIN_REF_REJECTED');
  let workOrder;
  try{workOrder=JSON.parse(Buffer.from(await pkg.workOrder.blob.arrayBuffer()).toString('utf8'));}catch{throw fail('D2_RETAIN_CONTENT_REJECTED');}
  if(!exact(workOrder,['workOrderRef','trial','createdFor'])||workOrder.workOrderRef!==RETAIN_SYNTHETIC_WORK_ORDER_REF||workOrder.trial!=='D2-SYNTHETIC'||workOrder.createdFor!=='test-only')throw fail('D2_RETAIN_CONTENT_REJECTED');
  if(!Array.isArray(manifest.attachments)||manifest.attachments.length!==1)throw fail('D2_RETAIN_CONTENT_REJECTED');
  const entry=manifest.attachments[0];
  if(entry.kind!=='file'||entry.mime!=='application/octet-stream'||entry.size!==4)throw fail('D2_RETAIN_CONTENT_REJECTED');
  const payload=pkg.attachments&&pkg.attachments[entry.attachmentId];
  if(!payload||!Array.isArray(payload.chunks)||payload.chunks.length===0)throw fail('D2_RETAIN_CONTENT_REJECTED');
  const buffers=[];for(const chunk of payload.chunks)buffers.push(Buffer.from(await chunk.arrayBuffer()));
  if(!Buffer.concat(buffers).equals(RETAIN_SYNTHETIC_ATTACHMENT_BYTES))throw fail('D2_RETAIN_CONTENT_REJECTED');
}

// The separate retained-only receive function (Issue #172). Never accepts/constructs a
// control object and never reads DWO_D2_RECEIVER_BEARER -- there is no ACK/deletion in this
// path. Reuses decryptD2Job (the exact same decrypt building block the ACK path uses),
// persistVerifiedPackage, and verifyD2LocalJob unchanged, so repeats are exactly as idempotent
// and fail-closed against conflicts/corruption as the ACK path already is.
export async function receiveD2RetainedJob(options={}){
  if(options.control!==undefined)throw fail('D2_RETAIN_CONTROL_FORBIDDEN');
  const{syncRoot,inboxRoot,expectedJobId,recipientKeyRingOrIdentity}=options;
  if(!path.isAbsolute(syncRoot||'')||!path.isAbsolute(inboxRoot||'')||!/^job_[0-9a-f]{64}$/.test(expectedJobId||''))throw fail('D2_RETAIN_CONFIG_INVALID');
  const resolvedSyncRoot=path.normalize(path.resolve(syncRoot)),resolvedInboxRoot=path.normalize(path.resolve(inboxRoot));
  const[realSync,realInbox]=await Promise.all([realOrResolved(resolvedSyncRoot),realOrResolved(resolvedInboxRoot)]);
  if(pathOverlaps(realSync,realInbox)||pathOverlaps(realInbox,realSync))throw fail('D2_RETAIN_ROOT_OVERLAP');

  await assertInboxJobLinkSafe(resolvedInboxRoot,expectedJobId);

  const{meta,jobDir}=await waitForD2RetainedReady(resolvedSyncRoot,expectedJobId,options);
  const{envelope,decrypted}=await decryptD2Job(jobDir,{...options,expectedJobId,recipientKeyRingOrIdentity});
  await assertExactRetainedSyntheticJob(decrypted);

  const stored=await(options.persist||persistVerifiedPackage)({jobId:meta.jobId,workOrderRef:decrypted.workOrderRef,pkg:decrypted.package,descriptorSha256:envelope.header.descriptorSha256},{root:resolvedInboxRoot,now:options.now});
  if(!stored||!['stored','already-stored'].includes(stored.status))throw fail('D2_RETAIN_PERSIST_FAILED');
  const verified=await verifyD2LocalJob(resolvedInboxRoot,meta.jobId,decrypted.package.manifest);
  await assertInboxJobLinkSafe(resolvedInboxRoot,meta.jobId);
  void verified;

  return{jobId:meta.jobId,status:stored.status,workOrderRef:decrypted.workOrderRef};
}

function validateRetainedConfig(value){
  const keys=['schemaVersion','expectedJobId','syncRoot','inboxRoot','recipientBackupPath'];
  if(!exact(value,keys)||value.schemaVersion!==1)throw fail('D2_RETAIN_CONFIG_INVALID');
  if(!/^job_[0-9a-f]{64}$/.test(value.expectedJobId||''))throw fail('D2_RETAIN_CONFIG_INVALID');
  if(keys.slice(2).some(key=>typeof value[key]!=='string'||!value[key]))throw fail('D2_RETAIN_CONFIG_INVALID');
  return value;
}
// CLI entry point for --retain-config=. Only the recipient-backup passphrase is read from the
// environment; no receiver bearer is ever read, and no control/Apps Script endpoint is ever
// constructed in this path.
export async function runD2RetainedTrialOnce(configPath,options={}){
  let config;try{config=validateRetainedConfig(JSON.parse(await fs.readFile(configPath,'utf8')));}catch(error){if(error&&error.code)throw error;throw fail('D2_RETAIN_CONFIG_READ_FAILED');}
  const passphrase=process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE;
  if(typeof passphrase!=='string'||passphrase.length<12)throw fail('D2_RETAIN_SECRET_MISSING');
  const base=path.dirname(path.resolve(configPath));
  const syncRoot=path.resolve(base,config.syncRoot),inboxRoot=path.resolve(base,config.inboxRoot);
  let backup;try{backup=JSON.parse(await fs.readFile(path.resolve(base,config.recipientBackupPath),'utf8'));}catch{throw fail('D2_RETAIN_BACKUP_READ_FAILED');}
  const recipient=await Crypto.restoreRecipientIdentity(backup,passphrase,{crypto:webcrypto});
  const result=await receiveD2RetainedJob({syncRoot,inboxRoot,expectedJobId:config.expectedJobId,recipientKeyRingOrIdentity:recipient,timeoutMs:options.timeoutMs,pollIntervalMs:options.pollIntervalMs});
  return{jobId:result.jobId,status:result.status};
}

// Pure argv parser for the CLI (exported so argument handling is testable without a
// subprocess). Exactly one of --config= / --retain-config= must be present; --retain-timeout-ms=
// is only ever accepted alongside --retain-config=.
const D2_CLI_CONFIG_PREFIX='--config=';
const D2_CLI_RETAIN_CONFIG_PREFIX='--retain-config=';
const D2_CLI_RETAIN_TIMEOUT_PREFIX='--retain-timeout-ms=';

export function parseD2CliArgs(args){
  const list=Array.isArray(args)?args:[];
  const configArgs=list.filter(value=>value.startsWith(D2_CLI_CONFIG_PREFIX));
  const retainArgs=list.filter(value=>value.startsWith(D2_CLI_RETAIN_CONFIG_PREFIX));
  const timeoutArgs=list.filter(value=>value.startsWith(D2_CLI_RETAIN_TIMEOUT_PREFIX));
  if(configArgs.length+retainArgs.length!==1)throw fail('D2_TRIAL_ARGS_INVALID');
  if(configArgs.length===1){
    if(list.length!==1||!configArgs[0].slice(D2_CLI_CONFIG_PREFIX.length))throw fail('D2_TRIAL_CONFIG_REQUIRED');
    return{mode:'config',configPath:configArgs[0].slice(D2_CLI_CONFIG_PREFIX.length)};
  }
  if(timeoutArgs.length>1||list.length!==1+timeoutArgs.length)throw fail('D2_RETAIN_ARGS_INVALID');
  const configPath=retainArgs[0].slice(D2_CLI_RETAIN_CONFIG_PREFIX.length);
  if(!configPath)throw fail('D2_RETAIN_CONFIG_REQUIRED');
  let timeoutMs;
  if(timeoutArgs.length===1){
    const n=Number(timeoutArgs[0].slice(D2_CLI_RETAIN_TIMEOUT_PREFIX.length));
    if(!Number.isInteger(n)||n<=0||n>RETAIN_DEFAULT_TIMEOUT_MS)throw fail('D2_RETAIN_TIMEOUT_INVALID');
    timeoutMs=n;
  }
  return{mode:'retain',configPath,timeoutMs};
}

const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain){
  let parsed=null;
  try{parsed=parseD2CliArgs(process.argv.slice(2));}
  catch(error){process.stderr.write('[d2-trial] fatal: '+(error&&error.code||'D2_TRIAL_ARGS_INVALID')+'\n');process.exitCode=1;}
  if(parsed){
    const resolvedPath=fileURLToPath(pathToFileURL(path.resolve(parsed.configPath)));
    const run=parsed.mode==='config'?runD2TrialOnce(resolvedPath):runD2RetainedTrialOnce(resolvedPath,{timeoutMs:parsed.timeoutMs});
    run.then(result=>process.stdout.write('[d2-trial] status='+result.status+'\n')).catch(error=>{process.stderr.write('[d2-trial] fatal: '+(error&&error.code||'D2_TRIAL_FAILED')+'\n');process.exitCode=1;});
  }
}

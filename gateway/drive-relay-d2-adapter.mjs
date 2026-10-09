import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { reconstructEnvelope, computeAckProof } from './receiver-core.mjs';
import { persistVerifiedPackage } from './local-store.mjs';

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
  let pairing;try{pairing=JSON.parse(await fs.readFile(path.join(path.dirname(dir),'pairing.json'),'utf8'));}catch{throw fail('D2_PAIRING_REGISTRY_INVALID');}
  if(!exact(pairing,['clinicDeviceId','signingKeyId','signingPublicJwk','recipientKeyId'])||!/^dev_[A-Za-z0-9_-]+$/.test(pairing.clinicDeviceId)||!/^sk_[A-Za-z0-9_-]+$/.test(pairing.signingKeyId)||!/^rk_[A-Za-z0-9_-]+$/.test(pairing.recipientKeyId)||!validJwk(pairing.signingPublicJwk))throw fail('D2_PAIRING_REGISTRY_INVALID');
  return{version:'dwo-sender-registry-v1',clinicDeviceId:pairing.clinicDeviceId,status:'active',pairedRecipientKeyId:pairing.recipientKeyId,activeSigningKey:{signingKeyId:pairing.signingKeyId,publicJwk:pairing.signingPublicJwk,activatedAt:0},retiredSigningKeys:[],pairingId:'pr_d2_synthetic_trial',createdAt:0,updatedAt:0};
}
export async function readVerifiedSyncedJob(dir){
  let marker,meta,metaBytes;try{metaBytes=await fs.readFile(path.join(dir,'meta.json'));meta=JSON.parse(metaBytes.toString('utf8'));marker=JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8'));}catch{throw fail('D2_READY_MARKER_MISSING');}
  if(!validMeta(meta)||!plain(marker)||marker.version!==META_VERSION||marker.jobId!==meta.jobId||marker.state!=='ready'||marker.planSha256!==meta.planSha256||marker.metaSha256!==hash(metaBytes)||!HEX64.test(marker.metaSha256||''))throw fail('D2_METADATA_INVALID');
  const blobs=[];for(const object of meta.objects){let bytes;try{bytes=await fs.readFile(path.join(dir,object.name));}catch{throw fail('D2_SYNC_OBJECT_MISSING');}if(bytes.length!==object.size)throw fail('D2_SYNC_OBJECT_SIZE_MISMATCH');if(hash(bytes)!==object.ciphertextSha256)throw fail('D2_SYNC_OBJECT_HASH_MISMATCH');blobs.push(new Blob([bytes]));}
  return{meta,blobs};
}
export async function processD2SyncedJob(dir,options={}){
  const {meta,blobs}=await readVerifiedSyncedJob(dir),crypto=options.crypto||webcrypto;
  const plan={version:'dwo-receiver-api-v1',jobId:meta.jobId,ackCapability:'A'.repeat(43),bootstrap:meta.bootstrap,objects:meta.objects.map(object=>({ordinal:object.ordinal,size:object.size,ciphertextSha256:object.ciphertextSha256,downloadUrl:'https://d2.invalid/'+object.name}))};
  const envelope=await reconstructEnvelope(plan,blobs,options.recipientKeyRingOrIdentity,{crypto});
  const registry=options.senderRegistries||{senders:[await senderRegistryFromPairing(dir)]};
  const sender=(registry.senders||registry).find(value=>value.clinicDeviceId===envelope.descriptor.senderClinicDeviceId);if(!sender)throw fail('D2_SENDER_REGISTRY_MISSING');
  const decrypted=await(options.cryptoApi||Crypto).decryptEnvelope(envelope,options.recipientKeyRingOrIdentity,sender,{crypto,transferApi:options.transferApi||Transfer});
  const stored=await(options.persist||persistVerifiedPackage)({jobId:meta.jobId,workOrderRef:decrypted.workOrderRef,pkg:decrypted.package,descriptorSha256:envelope.header.descriptorSha256},{root:options.inboxRoot,now:options.now});if(!stored||!['stored','already-stored'].includes(stored.status))throw fail('D2_PERSIST_FAILED');
  if(!options.control||typeof options.control.issueAckCapability!=='function'||typeof options.control.ack!=='function')throw fail('D2_ACK_UNAVAILABLE');
  const issued=await options.control.issueAckCapability(meta.jobId);if(!issued||issued.jobId!==meta.jobId||typeof issued.ackCapability!=='string')throw fail('D2_ACK_CAPABILITY_INVALID');
  await options.control.ack({jobId:meta.jobId,ackCapability:issued.ackCapability,ackProof:computeAckProof(meta.jobId,envelope.header.descriptorSha256,decrypted.workOrderRef)});
  return{jobId:meta.jobId,status:stored.status,workOrderRef:decrypted.workOrderRef};
}
export const constants=Object.freeze({META_VERSION});
export function createAppsScriptControl(endpoint,receiverBearer,fetchApi=globalThis.fetch){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint||'')||!/^[A-Za-z0-9_-]{43}$/.test(receiverBearer||'')||typeof fetchApi!=='function')throw fail('D2_CONTROL_CONFIG_INVALID');
  const call=async body=>{const response=await fetchApi(endpoint,{method:'POST',redirect:'follow',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiverBearer,...body})});if(!response||!response.ok)throw fail('D2_CONTROL_FAILED');const value=await response.json();if(!value||value.ok===false)throw fail('D2_CONTROL_REJECTED');return value;};
  return{issueAckCapability:jobId=>call({action:'issueAckCapability',jobId}),ack:value=>call({action:'ack',...value})};
}
function validateConfig(value){const keys=['schemaVersion','syncedJobDir','inboxRoot','recipientBackupPath','appsScriptEndpoint'];if(!exact(value,keys)||value.schemaVersion!==1||keys.slice(1,4).some(key=>typeof value[key]!=='string'||!value[key])||typeof value.appsScriptEndpoint!=='string')throw fail('D2_TRIAL_CONFIG_INVALID');return value;}
export async function runD2TrialOnce(configPath){
  let config;try{config=validateConfig(JSON.parse(await fs.readFile(configPath,'utf8')));}catch(error){if(error&&error.code)throw error;throw fail('D2_TRIAL_CONFIG_READ_FAILED');}
  const passphrase=process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE,receiverBearer=process.env.DWO_D2_RECEIVER_BEARER;if(typeof passphrase!=='string'||passphrase.length<12||!/^[A-Za-z0-9_-]{43}$/.test(receiverBearer||''))throw fail('D2_TRIAL_SECRET_MISSING');
  const base=path.dirname(path.resolve(configPath));let backup;try{backup=JSON.parse(await fs.readFile(path.resolve(base,config.recipientBackupPath),'utf8'));}catch{throw fail('D2_TRIAL_BACKUP_READ_FAILED');}
  const recipient=await Crypto.restoreRecipientIdentity(backup,passphrase,{crypto:webcrypto});const result=await processD2SyncedJob(path.resolve(base,config.syncedJobDir),{recipientKeyRingOrIdentity:recipient,inboxRoot:path.resolve(base,config.inboxRoot),control:createAppsScriptControl(config.appsScriptEndpoint,receiverBearer)});return{jobId:result.jobId,status:result.status};
}
const isMain=process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url;
if(isMain){const args=process.argv.slice(2),arg=args.find(value=>value.startsWith('--config='));if(args.length!==1||!arg||!arg.slice(9)){process.stderr.write('[d2-trial] fatal: D2_TRIAL_CONFIG_REQUIRED\n');process.exitCode=1;}else runD2TrialOnce(fileURLToPath(pathToFileURL(path.resolve(arg.slice(9))))).then(result=>process.stdout.write('[d2-trial] status='+result.status+'\n')).catch(error=>{process.stderr.write('[d2-trial] fatal: '+(error&&error.code||'D2_TRIAL_FAILED')+'\n');process.exitCode=1;});}

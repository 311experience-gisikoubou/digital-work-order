// DWO Issue #172 - new sender/receiver Base64URL attachment ID compatibility property.
// Source-only synthetic local save/read; no receiver, DPAPI, cloud, decryption, real job or ACK.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {persistVerifiedPackage} from '../gateway/local-store.mjs';
import {loadVerifiedJob,findAttachment,mediaFilePath,constants as viewerConstants} from '../gateway/viewer-core.mjs';

const require=createRequire(import.meta.url);
const Transfer=require('../media-transfer-package.js');

test('D2 sender Base64URL _ attachment ID survives local save and viewer verification while path characters remain forbidden', async()=>{
  // Exact shape reachable from app/drive-relay-d2-trial.js: 'att-' + base64url(random(12)).
  // Twelve bytes of 0xFF intentionally yield a Base64URL ID made entirely of '_'.
  const id='att-'+Buffer.alloc(12,0xff).toString('base64url');
  assert.equal(id.length,20);
  assert.ok(id.includes('_'),'exercise the previously unsupported Base64URL character');
  const ref='dwo:223e4567-e89b-42d3-a456-426614174001';
  const payload=Buffer.from([68,50,0,1]);
  const pkg=await Transfer.buildPackage(ref,
    {workOrderRef:ref,trial:'D2-SYNTHETIC',createdFor:'test-only'},
    [{meta:{attachmentId:id,kind:'file',mime:'application/octet-stream',size:payload.length},
      blob:new Blob([payload])}],
    {crypto:webcrypto,now:()=>4,chunkSize:4});
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'dwo-new-b64url-attachment-'));
  try{
    const jobId='job_'+'a'.repeat(64);
    const saved=await persistVerifiedPackage(
      {jobId,workOrderRef:ref,pkg,descriptorSha256:'a'.repeat(64)},
      {root,now:()=>99});
    assert.equal(saved.status,'stored');
    const verified=await loadVerifiedJob(root,jobId);
    assert.equal(verified.workOrderRef,ref);
    assert.equal(verified.attachments.length,1);
    assert.equal(verified.attachments[0].attachmentId,id);
    const found=findAttachment(verified,id);
    assert.ok(found);
    assert.deepEqual(await fs.readFile(mediaFilePath(verified,found)),payload);
    assert.equal(viewerConstants.ATTACHMENT_ID.test(id),true);

    // The newly accepted underscore must NOT permit traversal or arbitrary file names.
    for(const bad of [
      'att-../escape','att-/escape','att-\\escape',
      'att-%2e%2e','att-a.b','att-a b','att-a\nb',
      'att-','not-att-abc','att-'+'a'.repeat(121)
    ]){
      assert.equal(viewerConstants.ATTACHMENT_ID.test(bad),false);
      assert.equal(findAttachment(verified,bad),null);
    }
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

// Issue #172: NEW save/verify code visibility only.
// Does not repeat prior crypto, receive, PowerShell-child or full workflow tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const base=path.resolve('.');
test('exact source-defined GATEWAY / VIEWER / local verify / Windows filesystem codes pass the closed filter while injected text cannot',async()=>{
 const ps=await fs.readFile(path.join(base,'gateway/windows/run-d2-retained-trial.ps1'),'utf8');
 const store=await fs.readFile(path.join(base,'gateway/local-store.mjs'),'utf8');
 const viewer=await fs.readFile(path.join(base,'gateway/viewer-core.mjs'),'utf8');
 const adapter=await fs.readFile(path.join(base,'gateway/drive-relay-d2-adapter.mjs'),'utf8');
 const section=ps.match(/\$script:D2RetainAllowedChildFailureReasons = @\([\s\S]*?\r?\n\)/)?.[0];
 assert.ok(section,'bounded reason list exists');
 const parseCodes=(text,filter)=>[...new Set([...text.matchAll(/(?:storeError|viewerError|fail)\('([A-Z0-9_]+)'/g)].map(x=>x[1]).filter(x=>x.startsWith(filter)))];
 for(const code of [...parseCodes(store,'GATEWAY_'),...parseCodes(viewer,'VIEWER_'),...parseCodes(adapter,'D2_LOCAL_')])
   assert.ok(section.includes("'"+code+"'"),'active save/verify code must be source verified');
 for(const code of ['EACCES','EPERM','ENOENT','ENOSPC','EROFS','EIO','EBUSY','EEXIST','ENOTEMPTY'])assert.ok(section.includes("'"+code+"'"));
 // Previously qualified 20 reason literals must still exist; do not rerun their old test.
 for(const code of ['D2_TRIAL_FAILED','CRYPTO_DECRYPT_FAILED','D2_RETAIN_PERSIST_FAILED'])assert.ok(section.includes("'"+code+"'"));
 const st=ps.indexOf('function Get-D2RetainedChildFailureReason {');
 const en=ps.indexOf('# A second closed',st);
 assert.ok(st>0&&en>st,'reuse already-qualified function with no new classifier');
 const classifier=ps.slice(st,en);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'dwo-store-reason-'));
 try{
  const script=[
    'Set-StrictMode -Version Latest',
    "$ErrorActionPreference = 'Stop'",
    section,classifier,
    '$r=[ordered]@{}',
    "$r.Store=Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: GATEWAY_INVALID_ATTACHMENT_ID'",
    "$r.Viewer=Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: VIEWER_MALFORMED_MANIFEST'",
    "$r.Fs=Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: EACCES'",
    "$r.Injection=Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: GATEWAY_INVALID_ATTACHMENT_ID /SECRET_DO_NOT_PRINT'",
    "$r.Unknown=Get-D2RetainedChildFailureReason -CapturedOutput '[d2-trial] fatal: FAKE_REMOTE_SECRET_CODE'",
    '$r | ConvertTo-Json -Compress'
  ].join('\r\n');
  const file=path.join(dir,'reason-only.ps1');
  await fs.writeFile(file,script);
  const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{
    encoding:'utf8',windowsHide:true,timeout:15000
  });
  assert.equal(run.status,0,'isolated classifier only; no real receiver or child');
  assert.equal(run.stderr.trim(),'');
  assert.doesNotMatch(run.stdout,/SECRET_DO_NOT_PRINT|FAKE_REMOTE_SECRET_CODE/);
  const actual=JSON.parse(run.stdout.trim());
  assert.deepEqual(actual,{
    Store:'GATEWAY_INVALID_ATTACHMENT_ID',
    Viewer:'VIEWER_MALFORMED_MANIFEST',
    Fs:'EACCES',
    Injection:'UNKNOWN',
    Unknown:'UNKNOWN',
  });
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
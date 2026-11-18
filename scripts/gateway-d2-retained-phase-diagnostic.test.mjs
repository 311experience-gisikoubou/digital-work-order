// Issue #172: new property only, safe, fixed failure-stage attribution.
// No existing D2 receiver test, DPAPI, real ciphertext, or network actions are run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {receiveD2RetainedJob} from '../gateway/drive-relay-d2-adapter.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const psPath=path.join(root,'gateway/windows/run-d2-retained-trial.ps1');
const adapterPath=path.join(root,'gateway/drive-relay-d2-adapter.mjs');
const expectedPhases=['BACKUP_RESTORE','SYNC_VALIDATE','ENVELOPE_VERIFY','SIGNATURE_DECRYPT','SYNTHETIC_CHECK','SAVE_VERIFY'];

test('retained-only errors report a fixed phase and never emit arbitrary stage text', async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'dwo-d2-phase-only-'));
  try {
    const config=path.join(tmp,'fake-config.json');
    const backup=path.join(tmp,'fake-backup.json');
    const jobId='job_'+'a'.repeat(64);
    await fs.writeFile(backup,JSON.stringify({version:'invalid-fixture-only'}));
    await fs.writeFile(config,JSON.stringify({
      schemaVersion:1,expectedJobId:jobId,syncRoot:path.join(tmp,'sync'),
      inboxRoot:path.join(tmp,'inbox'),recipientBackupPath:backup,
    }));
    const env={...process.env,DWO_RECIPIENT_BACKUP_PASSPHRASE:'SyntheticOnlyPassphrase_NoRealKey'};
    delete env.DWO_D2_RECEIVER_BEARER;
    delete env.DWO_RECEIVER_TOKEN;
    const cli=spawnSync(process.execPath,[adapterPath,'--retain-config='+config],{
      cwd:root,env,encoding:'utf8',windowsHide:true,timeout:15000,
    });
    assert.equal(cli.status,1,'synthetic invalid backup must fail before decryption or any real receiver');
    assert.equal(cli.stdout.trim(),'');
    const lines=cli.stderr.trim().split(/\r?\n/).sort();
    assert.deepEqual(lines,[
      '[d2-trial] fatal: CRYPTO_MALFORMED_BACKUP',
      '[d2-trial] phase: BACKUP_RESTORE',
    ].sort(),'Node may print only its prior categorical fatal code and the new fixed stage');

    await assert.rejects(
      receiveD2RetainedJob({
        syncRoot:tmp,inboxRoot:tmp,expectedJobId:jobId,recipientKeyRingOrIdentity:{},
      }),
      e=>e.code==='D2_RETAIN_ROOT_OVERLAP'&&e.retainedPhase==='SYNC_VALIDATE',
      'existing root-overlap failure must be attributed to sync validation without decrypt or write'
    );
    // These are source identity assertions for the later stages; this test never runs
    // the already-proven decrypt/verify/store workflow again.
    const adapter=await fs.readFile(adapterPath,'utf8');
    for(const phase of expectedPhases)assert.match(adapter,new RegExp("'"+phase+"'"));
    assert.match(adapter,/onRetainedPhase:\s*phase\s*=>/);
    assert.match(adapter,/retainedPhase='SYNTHETIC_CHECK'/);
    assert.match(adapter,/retainedPhase='SAVE_VERIFY'/);

    const ps=await fs.readFile(psPath,'utf8');
    const status=ps.slice(ps.indexOf('function Write-Status('),ps.indexOf('# Issue #172',ps.indexOf('function Write-Status('))).trim();
    const enumBlock=ps.match(/\$script:D2RetainAllowedChildPhases = @\([\s\S]*?\r?\n\)/)?.[0];
    const phaseFun=ps.slice(ps.indexOf('function Get-D2RetainedChildFailurePhase {'),ps.indexOf('# Invokes exactly one native child process')).trim();
    assert.ok(status.startsWith('function Write-Status('));
    assert.ok(enumBlock?.includes("'BACKUP_RESTORE'"));
    assert.ok(phaseFun.startsWith('function Get-D2RetainedChildFailurePhase {'));
    const pscript=[
      "Set-StrictMode -Version Latest",
      "$ErrorActionPreference = 'Stop'",
      status,enumBlock,phaseFun,
      "$r=[ordered]@{}",
      "$r.Known=Get-D2RetainedChildFailurePhase -CapturedOutput '[d2-trial] phase: BACKUP_RESTORE'",
      "$r.Second=Get-D2RetainedChildFailurePhase -CapturedOutput '[d2-trial] phase: SAVE_VERIFY'",
      "$r.Injected=Get-D2RetainedChildFailurePhase -CapturedOutput '[d2-trial] phase: BACKUP_RESTORE token=NOT_FOR_OUTPUT /secrets/key'",
      "$r.Unknown=Get-D2RetainedChildFailurePhase -CapturedOutput '[d2-trial] phase: DUMP_PRIVATE_KEY'",
      "$r.Missing=Get-D2RetainedChildFailurePhase -CapturedOutput '[d2-trial] fatal: CRYPTO_BACKUP_AUTH_FAILED'",
      "$r.Status=Write-Status 'error-15' 'UNKNOWN' $r.Known",
      "$r | ConvertTo-Json -Compress",
    ].join('\r\n');
    const fixture=path.join(tmp,'classify-stage-only.ps1');
    await fs.writeFile(fixture,pscript,'utf8');
    const run=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fixture],{
      cwd:root,encoding:'utf8',windowsHide:true,timeout:15000,
    });
    assert.equal(run.status,0,'isolated PowerShell classifier must run');
    assert.equal(run.stderr.trim(),'');
    const actual=JSON.parse(run.stdout.trim());
    assert.deepEqual(actual,{
      Known:'BACKUP_RESTORE',Second:'SAVE_VERIFY',
      Injected:'UNKNOWN',Unknown:'UNKNOWN',Missing:'UNKNOWN',
      Status:'[d2-retain] status=error-15 reason=UNKNOWN phase=BACKUP_RESTORE',
    });
    assert.doesNotMatch(run.stdout,/NOT_FOR_OUTPUT|\/secrets\/key|DUMP_PRIVATE_KEY/);
  } finally {
    await fs.rm(tmp,{recursive:true,force:true});
  }
});
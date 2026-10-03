import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Phase7 cloud uses hash-only receiver auth and exact-object deletion without embedded secrets', () => {
  const cloud = read('cloud', 'index.mjs');
  const receiver = read('cloud', 'receiver-core.mjs');
  const relay = read('cloud', 'relay-core.mjs');
  const all = cloud + receiver + relay;

  assert.match(cloud, /DWO_RECEIVER_TOKEN_SHA256/);
  assert.match(cloud, /DWO_RECEIVER_KEY_ID/);
  assert.doesNotMatch(cloud, /process\.env\.DWO_RECEIVER_TOKEN(?!_SHA256)/);
  assert.doesNotMatch(all, /serviceAccount|private_key|client_email|-----BEGIN|refresh_token/i);

  assert.match(cloud, /:ack\$/);
  assert.match(cloud, /file\.delete\(\)/);
  assert.match(receiver, /deps\.storage\.deleteObject\(spec\.objectName\)/);
  assert.doesNotMatch(all, /deleteFiles|getFiles\(|bucket\.delete\(|\.deleteFiles\(|prefix\s*:/i);
});

test('Phase7 deletion start requires per-job capability plus decrypt-derived ACK proof', () => {
  const relay = read('cloud', 'relay-core.mjs');
  const cloud = read('cloud', 'index.mjs');
  const receiver = read('cloud', 'receiver-core.mjs');
  const gateway = read('gateway', 'receiver-core.mjs');

  assert.match(relay, /dwo-receiver-ack-v1\|/);
  assert.match(relay, /receiverAckProofHash/);
  assert.match(cloud, /ackCapabilityHashes/);
  assert.match(cloud, /data\.receiverAckProofHash !== ackProofHash/);
  assert.match(receiver, /hashToken\(ackCapability\)/);
  assert.match(receiver, /hashToken\(ackProof\)/);
  assert.match(gateway, /computeAckProof/);

  const persistIndex = gateway.indexOf('const stored = await');
  const proofIndex = gateway.indexOf('const ackProof = computeAckProof');
  const ackIndex = gateway.indexOf('const ack = await acknowledgeJob');
  assert.ok(persistIndex >= 0 && persistIndex < proofIndex && proofIndex < ackIndex);
});

test('Phase7 never persists ACK capability or ACK proof in the local receipt', () => {
  const store = read('gateway', 'local-store.mjs');
  const gateway = read('gateway', 'receiver-core.mjs');
  const cli = read('gateway', 'receiver.mjs');

  assert.doesNotMatch(store, /ackCapability|ackProof/);
  assert.doesNotMatch(cli, /ackCapability|ackProof|downloadUrl|workOrderRef|patientName|clinicName/);
  assert.match(cli, /checked=/);
  assert.match(cli, /delete-resumed=/);
  assert.match(cli, /error\.code/);
  assert.match(gateway, /ackCapability/);
  assert.match(gateway, /ackProof/);
});

test('examples contain no secrets and Windows setup remains random-token + DPAPI CurrentUser', () => {
  const config = read('gateway', 'gateway-config.example.json');
  const registry = read('gateway', 'sender-registry.example.json');
  const protect = read('gateway', 'windows', 'protect-receiver-secrets.ps1');
  const run = read('gateway', 'windows', 'run-receiver.ps1');

  assert.doesNotMatch(config + registry, /patientName|clinicName|doctorName|privateKey|receiverToken|backupPassphrase/i);
  assert.match(config, /REPLACE_WITH_RELAY_FUNCTION_URL/);
  assert.match(registry, /"senders"\s*:\s*\[\s*\]/);

  assert.match(protect, /New-Object byte\[\] 32/);
  assert.match(protect, /RandomNumberGenerator/);
  assert.match(protect, /ConvertFrom-SecureString/);
  assert.match(protect, /DWO_RECEIVER_TOKEN_SHA256=/);
  assert.doesNotMatch(protect, /Write-Host[^\n]*\$token\b/);
  assert.match(run, /ConvertTo-SecureString/);
  assert.match(run, /DWO_RECEIVER_TOKEN/);
  assert.match(run, /DWO_RECIPIENT_BACKUP_PASSPHRASE/);
  assert.match(run, /Remove-Item Env:DWO_RECEIVER_TOKEN/);
  assert.match(run, /Remove-Item Env:DWO_RECIPIENT_BACKUP_PASSPHRASE/);
});

test('Phase7 docs and config retain narrow IAM, deleting recovery and lifecycle fail-safe', () => {
  const cloudReadme = read('cloud', 'README.md');
  const gatewayReadme = read('gateway', 'README.md');
  const firebase = JSON.parse(read('cloud', 'firebase.json'));
  const indexes = JSON.parse(read('cloud', 'firestore.indexes.json'));
  const cloudSource = read('cloud', 'index.mjs');

  assert.match(cloudReadme, /storage\.objects\.get/);
  assert.match(cloudReadme, /storage\.objects\.delete/);
  assert.match(cloudReadme, /iam\.serviceAccounts\.signBlob/);
  assert.match(cloudReadme, /exact object names/i);
  assert.match(cloudReadme, /30-day lifecycle/i);
  assert.match(cloudReadme, /deleting jobs are resumed/i);
  assert.match(gatewayReadme, /decrypt-derived ACK proof/i);
  assert.match(gatewayReadme, /Normal Phase 7 operation deletes/i);

  assert.match(cloudSource, /\.where\('recipientKeyId', '==', recipientKeyId\)/);
  assert.match(cloudSource, /query\('ready'\)/);
  assert.match(cloudSource, /query\('deleting'\)/);
  assert.match(cloudSource, /\.orderBy\('readyAt', 'desc'\)/);
  assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
  assert.equal(indexes.indexes[0].collectionGroup, 'relayJobs');
  assert.deepEqual(indexes.indexes[0].fields.map(item => item.fieldPath), ['recipientKeyId', 'status', 'readyAt']);
  assert.equal(indexes.indexes[0].fields[2].order, 'DESCENDING');
});

test('Phase7 source keeps deletion idempotent and metadata-last', () => {
  const receiver = read('cloud', 'receiver-core.mjs');
  const cloud = read('cloud', 'index.mjs');

  const ackStart = receiver.indexOf('export async function acknowledgeReceiverJob');
  const ackBody = receiver.slice(ackStart);
  const deleteIndex = ackBody.indexOf('deps.storage.deleteObject(spec.objectName)');
  const statIndex = ackBody.indexOf('deps.storage.statObject(spec.objectName)', deleteIndex + 1);
  const finalIndex = ackBody.indexOf('deps.jobStore.finalizeDelete', statIndex + 1);
  assert.ok(ackStart >= 0 && deleteIndex >= 0 && deleteIndex < statIndex && statIndex < finalIndex);

  assert.match(cloud, /Number\(error\.code\) === 404/);
  assert.match(cloud, /transaction\.delete\(ref\)/);
  assert.match(cloud, /data\.status === 'deleting'/);
  assert.doesNotMatch(receiver, /listObjects|listFiles|getFiles|prefix/i);
});

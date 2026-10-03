import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('Phase6 cloud source has no plaintext receiver token, private key file, ack or delete endpoint', () => {
  const cloud = read('cloud', 'index.mjs');
  const receiver = read('cloud', 'receiver-core.mjs');
  assert.match(cloud, /DWO_RECEIVER_TOKEN_SHA256/);
  assert.match(cloud, /DWO_RECEIVER_KEY_ID/);
  assert.doesNotMatch(cloud, /process\.env\.DWO_RECEIVER_TOKEN(?!_SHA256)/);
  assert.doesNotMatch(cloud + receiver, /serviceAccount|private_key|client_email|-----BEGIN|refresh_token/i);
  assert.doesNotMatch(cloud, /receiver\/jobs\/[^\n]*:(?:ack|delete)/i);
  assert.doesNotMatch(receiver, /deleteObject|removeObject|\.delete\(/);
});

test('Phase6 examples contain no secrets or real identifiers', () => {
  const config = read('gateway', 'gateway-config.example.json');
  const registry = read('gateway', 'sender-registry.example.json');
  assert.doesNotMatch(config + registry, /patientName|clinicName|doctorName|privateKey|receiverToken|backupPassphrase/i);
  assert.match(config, /REPLACE_WITH_RELAY_FUNCTION_URL/);
  assert.match(registry, /"senders"\s*:\s*\[\s*\]/);
});

test('Windows secret setup uses random 32-byte token + DPAPI and does not print the plaintext token', () => {
  const protect = read('gateway', 'windows', 'protect-receiver-secrets.ps1');
  const run = read('gateway', 'windows', 'run-receiver.ps1');
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

test('Gateway logs only operational counts/error codes and no signed URLs or work-order identifiers', () => {
  const cli = read('gateway', 'receiver.mjs');
  assert.doesNotMatch(cli, /console\.log|downloadUrl|workOrderRef|patientName|clinicName/);
  assert.match(cli, /checked=/);
  assert.match(cli, /error\.code/);
});

test('Phase6 documentation keeps cloud delete in Phase7 and documents managed signed-url IAM/index', () => {
  const cloudReadme = read('cloud', 'README.md');
  const gatewayReadme = read('gateway', 'README.md');
  const firebase = JSON.parse(read('cloud', 'firebase.json'));
  const indexes = JSON.parse(read('cloud', 'firestore.indexes.json'));
  assert.match(cloudReadme, /iam\.serviceAccounts\.signBlob/);
  assert.match(cloudReadme, /storage\.objects\.get/);
  assert.match(cloudReadme, /DPAPI CurrentUser/);
  assert.match(cloudReadme, /firestore:indexes/);
  const cloudSource = read('cloud', 'index.mjs');
  assert.match(cloudSource, /\.where\('recipientKeyId', '==', recipientKeyId\)/);
  assert.match(cloudSource, /\.where\('status', '==', 'ready'\)/);
  assert.match(cloudSource, /\.orderBy\('readyAt', 'desc'\)/);
  assert.equal(firebase.firestore.indexes, 'firestore.indexes.json');
  assert.equal(indexes.indexes[0].collectionGroup, 'relayJobs');
  assert.deepEqual(indexes.indexes[0].fields.map(item => item.fieldPath), ['recipientKeyId', 'status', 'readyAt']);
  assert.equal(indexes.indexes[0].fields[2].order, 'DESCENDING');
  assert.match(gatewayReadme, /does not acknowledge or delete cloud objects/i);
  assert.match(gatewayReadme, /Phase 7/);
});

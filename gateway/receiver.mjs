import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { receiveOnce } from './receiver-core.mjs';
import { resolveInboxRoot } from './inbox-root.mjs';

const require = createRequire(import.meta.url);
const Crypto = require('../media-transfer-crypto.js');

function gatewayError(code, detail) {
  const error = new Error(detail ? code + ': ' + detail : code);
  error.code = code;
  return error;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw gatewayError('GATEWAY_CONFIG_READ_FAILED', path.basename(file));
  }
}

function validateConfig(config, configPath) {
  if (!config || config.schemaVersion !== 1 ||
      typeof config.relayEndpoint !== 'string' ||
      !Array.isArray(config.recipientBackupPaths) || config.recipientBackupPaths.length < 1 ||
      typeof config.senderRegistryPath !== 'string' ||
      (config.pollSeconds !== undefined && (!Number.isSafeInteger(config.pollSeconds) || config.pollSeconds < 30 || config.pollSeconds > 3600))) {
    throw gatewayError('GATEWAY_CONFIG_INVALID');
  }
  const baseDir = path.dirname(configPath);
  const resolvePath = value => path.isAbsolute(value) ? value : path.resolve(baseDir, value);
  return {
    relayEndpoint: config.relayEndpoint,
    recipientBackupPaths: config.recipientBackupPaths.map(resolvePath),
    activeRecipientKeyId: config.activeRecipientKeyId || null,
    senderRegistryPath: resolvePath(config.senderRegistryPath),
    inboxRoot: resolveInboxRoot(config.inboxRoot, configPath),
    pollSeconds: config.pollSeconds || 60
  };
}

async function restoreRecipientKeyRing(config, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw gatewayError('GATEWAY_BACKUP_PASSPHRASE_REQUIRED');
  }
  const identities = [];
  for (const backupPath of config.recipientBackupPaths) {
    const backup = await readJson(backupPath);
    identities.push(await Crypto.restoreRecipientIdentity(backup, passphrase, { crypto: webcrypto }));
  }
  const activeId = config.activeRecipientKeyId || identities[0].recipientKeyId;
  const active = identities.find(item => item.recipientKeyId === activeId);
  if (!active) throw gatewayError('GATEWAY_ACTIVE_RECIPIENT_KEY_MISSING');
  const decryptOnly = identities
    .filter(item => item.recipientKeyId !== activeId)
    .map(item => ({ recipientKeyId: item.recipientKeyId, publicJwk: item.publicJwk, privateKey: item.privateKey }));
  return {
    version: Crypto.SCHEMA_VERSIONS.keyRing,
    active: { recipientKeyId: active.recipientKeyId, publicJwk: active.publicJwk, privateKey: active.privateKey },
    decryptOnly
  };
}

function validateSenderRegistryFile(value) {
  if (!value || value.version !== 'dwo-gateway-sender-registry-v1' || !Array.isArray(value.senders)) {
    throw gatewayError('GATEWAY_SENDER_REGISTRY_INVALID');
  }
  return value;
}

async function buildRuntime(configPath) {
  const rawConfig = await readJson(configPath);
  const config = validateConfig(rawConfig, configPath);
  const token = process.env.DWO_RECEIVER_TOKEN;
  const passphrase = process.env.DWO_RECIPIENT_BACKUP_PASSPHRASE;
  if (typeof token !== 'string' || token.length < 40) throw gatewayError('GATEWAY_RECEIVER_TOKEN_REQUIRED');

  const recipientKeyRingOrIdentity = await restoreRecipientKeyRing(config, passphrase);
  const senderRegistries = validateSenderRegistryFile(await readJson(config.senderRegistryPath));
  return {
    config,
    token,
    recipientKeyRingOrIdentity,
    senderRegistries
  };
}

export async function runOnce(configPath, overrides = {}) {
  const runtime = await buildRuntime(configPath);
  return receiveOnce({
    endpoint: runtime.config.relayEndpoint,
    token: runtime.token,
    inboxRoot: runtime.config.inboxRoot,
    recipientKeyRingOrIdentity: runtime.recipientKeyRingOrIdentity,
    senderRegistries: runtime.senderRegistries,
    fetch: overrides.fetch,
    now: overrides.now
  });
}

function summarize(result) {
  const stored = result.results.filter(item => item.status === 'stored').length;
  const already = result.results.filter(item => item.status === 'already-stored').length;
  const resumed = result.results.filter(item => item.status === 'delete-resumed').length;
  const failed = result.results.filter(item => item.status === 'failed').length;
  return { checked: result.checked, stored, already, resumed, failed };
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  const configArg = args.find(arg => arg.startsWith('--config='));
  const configPath = path.resolve(configArg ? configArg.slice('--config='.length) : (process.env.DWO_GATEWAY_CONFIG || 'gateway-config.json'));
  const runtime = await buildRuntime(configPath);

  const execute = async () => {
    const result = await receiveOnce({
      endpoint: runtime.config.relayEndpoint,
      token: runtime.token,
      inboxRoot: runtime.config.inboxRoot,
      recipientKeyRingOrIdentity: runtime.recipientKeyRingOrIdentity,
      senderRegistries: runtime.senderRegistries
    });
    const summary = summarize(result);
    process.stdout.write('[gateway] checked=' + summary.checked + ' stored=' + summary.stored +
      ' already=' + summary.already + ' delete-resumed=' + summary.resumed +
      ' failed=' + summary.failed + '\n');
  };

  if (!watch) {
    await execute();
    return;
  }
  for (;;) {
    try {
      await execute();
    } catch (error) {
      process.stderr.write('[gateway] cycle failed: ' + (error && error.code ? error.code : 'GATEWAY_UNKNOWN_ERROR') + '\n');
    }
    await new Promise(resolve => setTimeout(resolve, runtime.config.pollSeconds * 1000));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write('[gateway] fatal: ' + (error && error.code ? error.code : 'GATEWAY_UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  });
}

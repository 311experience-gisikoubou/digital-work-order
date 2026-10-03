// Phase 8 viewer configuration loader.
//
// Unlike receiver.mjs's full validateConfig(), the viewer needs no receiver
// secrets, relay endpoint, recipient backup, or sender registry. It only
// reads the existing gateway-config.json to resolve the same inboxRoot the
// receiver already writes to, reusing resolveInboxRoot() from inbox-root.mjs
// so both tools agree on the same default directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveInboxRoot } from './inbox-root.mjs';

const MIN_PORT = 1024;
const MAX_PORT = 65535;
export const DEFAULT_PORT = 4850;

export async function loadInboxRootFromGatewayConfig(configPath) {
  let text;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return resolveInboxRoot(null, configPath);
    const wrapped = new Error('VIEWER_CONFIG_READ_FAILED');
    wrapped.code = 'VIEWER_CONFIG_READ_FAILED';
    throw wrapped;
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (_) {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      (Object.prototype.hasOwnProperty.call(raw, 'inboxRoot') &&
       raw.inboxRoot !== null && typeof raw.inboxRoot !== 'string')) {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }
  return resolveInboxRoot(raw.inboxRoot || null, configPath);
}

export function validateViewerPort(value) {
  if (value === undefined || value === null) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    const error = new Error('VIEWER_INVALID_PORT');
    error.code = 'VIEWER_INVALID_PORT';
    throw error;
  }
  return port;
}

export function resolveViewerConfigPath(configArgValue) {
  return path.resolve(configArgValue || process.env.DWO_GATEWAY_CONFIG || 'gateway-config.json');
}

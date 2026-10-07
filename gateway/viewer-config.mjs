// Phase 8 viewer configuration loader.
//
// The viewer needs no receiver secrets. It reads the existing gateway config
// only to resolve inboxRoot and the optional U13 manual PDF/video root.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveInboxRoot } from './inbox-root.mjs';

const MIN_PORT = 1024;
const MAX_PORT = 65535;
export const DEFAULT_PORT = 4850;

async function readViewerConfig(configPath) {
  let text;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }
  return raw;
}

export async function loadInboxRootFromGatewayConfig(configPath) {
  const raw = await readViewerConfig(configPath);
  if (Object.prototype.hasOwnProperty.call(raw, 'inboxRoot') &&
      raw.inboxRoot !== null &&
      typeof raw.inboxRoot !== 'string') {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }
  return resolveInboxRoot(raw.inboxRoot || null, configPath);
}

function defaultRelatedMediaStorePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.resolve(base, 'KoyoshiDWO', 'related-media-associations-v1.json');
}

// Optional U13 manual receive root. The related-media store defaults to a
// local app-state directory, deliberately outside the watched root and inbox.
export async function loadRelatedMediaConfig(configPath, manualRootOverride = null) {
  const raw = await readViewerConfig(configPath);
  if ((Object.prototype.hasOwnProperty.call(raw, 'manualRoot') &&
       raw.manualRoot !== null &&
       typeof raw.manualRoot !== 'string') ||
      (Object.prototype.hasOwnProperty.call(raw, 'relatedMediaStorePath') &&
       raw.relatedMediaStorePath !== null &&
       typeof raw.relatedMediaStorePath !== 'string')) {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }

  const base = path.dirname(path.resolve(configPath));
  const rawRoot = manualRootOverride === null ? raw.manualRoot : manualRootOverride;
  if (!rawRoot) return { manualRoot: null, associationStorePath: null };
  if (typeof rawRoot !== 'string' || rawRoot.trim() === '') {
    const error = new Error('VIEWER_CONFIG_INVALID');
    error.code = 'VIEWER_CONFIG_INVALID';
    throw error;
  }

  const resolveFromConfig = value => path.isAbsolute(value) ? value : path.resolve(base, value);
  return {
    manualRoot: resolveFromConfig(rawRoot),
    associationStorePath: raw.relatedMediaStorePath
      ? resolveFromConfig(raw.relatedMediaStorePath)
      : defaultRelatedMediaStorePath()
  };
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

export const constants = Object.freeze({ MIN_PORT, MAX_PORT });

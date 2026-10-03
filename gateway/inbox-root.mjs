// Shared default inboxRoot resolution for the Gateway (receiver + Phase 8 viewer).
// This is the single place that decides where the Windows lab PC stores verified
// received jobs when gateway-config.json does not set an explicit inboxRoot.
// Phase 6/7 receiver.mjs and the Phase 8 viewer must both resolve the same directory.
import os from 'node:os';
import path from 'node:path';

export function defaultInboxRoot() {
  return path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'),
    'DigitalWorkOrderGateway',
    'inbox'
  );
}

// configuredInboxRoot: the raw gateway-config.json "inboxRoot" value (string or falsy).
// configPath: absolute path to the gateway-config.json file, used to resolve relative paths.
export function resolveInboxRoot(configuredInboxRoot, configPath) {
  if (!configuredInboxRoot) return defaultInboxRoot();
  if (path.isAbsolute(configuredInboxRoot)) return configuredInboxRoot;
  const baseDir = path.dirname(configPath);
  return path.resolve(baseDir, configuredInboxRoot);
}

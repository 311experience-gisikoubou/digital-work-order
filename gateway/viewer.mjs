// Phase 8 localhost-only Gateway viewer CLI entry point.
//
// This process needs no receiver secrets. It reads the existing
// gateway-config.json only to resolve inboxRoot (the same directory
// Phase 6/7's receiver.mjs already writes verified jobs into), then serves
// a read-only viewer bound to 127.0.0.1 only.
//
// stdout prints only the localhost URL. It never prints job counts, work
// order fields, patient/clinic names, or any other received content.
import { pathToFileURL } from 'node:url';
import { loadInboxRootFromGatewayConfig, resolveViewerConfigPath, validateViewerPort, DEFAULT_PORT } from './viewer-config.mjs';
import { startViewer } from './viewer-server.mjs';

function parseArgs(argv) {
  const configArg = argv.find(arg => arg.startsWith('--config='));
  const portArg = argv.find(arg => arg.startsWith('--port='));
  return {
    configPath: resolveViewerConfigPath(configArg ? configArg.slice('--config='.length) : null),
    port: portArg ? portArg.slice('--port='.length) : DEFAULT_PORT
  };
}

async function main() {
  const { configPath, port } = parseArgs(process.argv.slice(2));
  const inboxRoot = await loadInboxRootFromGatewayConfig(configPath);
  const resolvedPort = validateViewerPort(port);
  const server = await startViewer({ inboxRoot, port: resolvedPort });
  const address = server.address();
  process.stdout.write('http://127.0.0.1:' + address.port + '/\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write('[viewer] fatal: ' + (error && error.code ? error.code : 'VIEWER_UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  });
}

export { parseArgs };

import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`Invalid arguments near: ${key ?? '<end>'}`);
    }
    out[key.slice(2)] = value;
  }
  return out;
}

function requireArg(args, name) {
  const value = args[name];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function getText(url) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  const text = await response.text();
  return { status: response.status, text };
}
function joinUrl(base, relativePath) {
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(relativePath.replace(/^\/+/, ''), baseWithSlash).toString();
}

export async function runGate(args) {
  const worktree = requireArg(args, 'worktree');
  const expectedSha = requireArg(args, 'sha').toLowerCase();
  const localBase = requireArg(args, 'local');
  const publicBase = requireArg(args, 'public');
  const markerPath = requireArg(args, 'marker-path');
  const marker = requireArg(args, 'marker');

  const actualSha = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim().toLowerCase();

  const localRoot = await getText(localBase);
  const publicRoot = await getText(publicBase);
  const localMarker = await getText(joinUrl(localBase, markerPath));
  const publicMarker = await getText(joinUrl(publicBase, markerPath));

  const checks = {
    headSha: actualSha === expectedSha,
    localHttp200: localRoot.status === 200,
    publicHttp200: publicRoot.status === 200,
    localMarker: localMarker.status === 200 && localMarker.text.includes(marker),
    publicMarker: publicMarker.status === 200 && publicMarker.text.includes(marker),
  };

  const pass = Object.values(checks).every(Boolean);
  return {
    pass,
    checks,
    expectedSha,
    actualSha,
    worktree,
    localBase,
    publicBase,
    markerPath,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runGate(args);
    if (!result.pass) {
      const { publicBase: _publicBase, ...safeResult } = result;
      console.log(JSON.stringify(safeResult, null, 2));
      console.error('REAL_DEVICE_PREVIEW_GATE=FAIL');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result, null, 2));
    console.log('REAL_DEVICE_PREVIEW_GATE=PASS');
    console.log(`USER_READY_URL=${result.publicBase}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('REAL_DEVICE_PREVIEW_GATE=FAIL');
    console.error(message.replace(/https?:\/\/\S+/g, '<redacted-url>'));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  await main();
}

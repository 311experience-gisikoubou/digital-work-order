const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const script = path.resolve(__dirname, '../tools/real-device-preview-gate.mjs');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwo-preview-gate-'));
  execFileSync('git', ['init', dir], { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>fixture</title>');
  fs.writeFileSync(path.join(dir, 'marker.js'), 'const UNIQUE_MARKER = true;');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', [
    '-C', dir, '-c', 'user.name=DWO Test', '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'fixture',
  ], { stdio: 'ignore' });
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  return { dir, sha };
}
function startServer() {
  const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(req.url === '/marker.js' ? 'const UNIQUE_MARKER = true;' : 'fixture');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
test('prints user-ready URL only when every check passes', async () => {
  const repo = makeRepo();
  const local = await startServer();
  const publicServer = await startServer();
  try {
    const result = await runCli([
      '--worktree', repo.dir,
      '--sha', repo.sha,
      '--local', local.url,
      '--public', publicServer.url,
      '--marker-path', 'marker.js',
      '--marker', 'UNIQUE_MARKER',
    ]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /REAL_DEVICE_PREVIEW_GATE=PASS/);
    assert.match(result.stdout, new RegExp(`USER_READY_URL=${publicServer.url}`));
  } finally {
    await local.close();
    await publicServer.close();
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
test('fails closed and hides public URL when any check fails', async () => {
  const repo = makeRepo();
  const local = await startServer();
  const publicServer = await startServer();
  try {
    const result = await runCli([
      '--worktree', repo.dir,
      '--sha', '0000000000000000000000000000000000000000',
      '--local', local.url,
      '--public', publicServer.url,
      '--marker-path', 'marker.js',
      '--marker', 'UNIQUE_MARKER',
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /REAL_DEVICE_PREVIEW_GATE=FAIL/);
    assert.doesNotMatch(result.stdout, /USER_READY_URL=/);
    assert.doesNotMatch(result.stdout, new RegExp(publicServer.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await local.close();
    await publicServer.close();
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

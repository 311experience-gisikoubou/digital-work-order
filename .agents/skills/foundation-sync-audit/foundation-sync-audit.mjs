#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
function argValue(name, fallback = '') {
  const i = args.lastIndexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const sourceRootRaw = argValue('--source-root');
const targetRootRaw = argValue('--target-root');
const jsonOnly = args.includes('--json');

const findings = [];
function add(status, code, detail = {}) { findings.push({ status, code, ...detail }); }

function normalizeRelative(path) {
  return path.split(sep).join('/');
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
async function isDirectory(path) {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function hashFile(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

async function collectFiles(root, startPath, prefix = '') {
  const files = new Map();
  if (!(await isDirectory(startPath))) return files;
  const entries = await readdir(startPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(startPath, entry.name);
    const rel = normalizeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(root, absolute, rel);
      for (const [k, v] of nested) files.set(k, v);
    } else if (entry.isFile()) {
      files.set(rel, await hashFile(absolute));
    }
  }
  return files;
}

async function collectSyncSet(root) {
  const set = new Map();
  const agents = resolve(root, 'AGENTS.md');
  if (await isFile(agents)) set.set('AGENTS.md', await hashFile(agents));

  const skillsRoot = resolve(root, '.agents', 'skills');
  const skills = await collectFiles(root, skillsRoot, '.agents/skills');
  for (const [k, v] of skills) set.set(k, v);
  return set;
}

if (!sourceRootRaw) add('STOP', 'FOUNDATION_SOURCE_ROOT_REQUIRED');
if (!targetRootRaw) add('STOP', 'FOUNDATION_TARGET_ROOT_REQUIRED');

let sourceVersion = null;
let sourceCount = 0;
let targetCount = 0;
let missingCount = 0;
let staleCount = 0;
let extraCount = 0;

if (!findings.some((f) => f.status === 'STOP')) {
  const sourceRoot = resolve(sourceRootRaw);
  const targetRoot = resolve(targetRootRaw);

  if (!(await isDirectory(sourceRoot))) add('STOP', 'FOUNDATION_SOURCE_ROOT_NOT_FOUND');
  if (!(await isDirectory(targetRoot))) add('STOP', 'FOUNDATION_TARGET_ROOT_NOT_FOUND');

  if (!findings.some((f) => f.status === 'STOP')) {
    const versionPath = resolve(sourceRoot, 'VERSION');
    if (!(await isFile(versionPath))) {
      add('STOP', 'FOUNDATION_SOURCE_VERSION_MISSING');
    } else {
      sourceVersion = (await readFile(versionPath, 'utf8')).trim();
      if (!sourceVersion) add('STOP', 'FOUNDATION_SOURCE_VERSION_EMPTY');
    }

    const source = await collectSyncSet(sourceRoot);
    const target = await collectSyncSet(targetRoot);
    sourceCount = source.size;
    targetCount = target.size;

    if (!source.has('AGENTS.md')) add('STOP', 'FOUNDATION_SOURCE_AGENTS_MISSING');
    if (![...source.keys()].some((p) => p.startsWith('.agents/skills/'))) {
      add('STOP', 'FOUNDATION_SOURCE_SKILLS_MISSING');
    }

    for (const [path, hash] of source) {
      if (!target.has(path)) missingCount += 1;
      else if (target.get(path) !== hash) staleCount += 1;
    }
    for (const path of target.keys()) {
      if (!source.has(path)) extraCount += 1;
    }

    if (missingCount > 0) add('STOP', 'FOUNDATION_SYNC_MISSING', { count: missingCount });
    if (staleCount > 0) add('STOP', 'FOUNDATION_SYNC_STALE', { count: staleCount });
    if (extraCount > 0) add('INFO', 'FOUNDATION_TARGET_EXTRA_PRESENT', { count: extraCount });
  }
}

if (!findings.some((f) => f.status === 'STOP')) {
  add('PASS', 'FOUNDATION_SYNC_MATCH', { sourceVersion, synchronizedFiles: sourceCount });
}

const result = findings.some((f) => f.status === 'STOP') ? 'STOP' : 'PASS';
const output = {
  result,
  sourceVersion,
  sourceCount,
  targetCount,
  missingCount,
  staleCount,
  extraCount,
  findings,
};
console.log(JSON.stringify(output, null, jsonOnly ? 0 : 2));
process.exit(result === 'PASS' ? 0 : 2);

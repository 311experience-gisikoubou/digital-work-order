#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

// This module only confirms that a given head-to-head range is a clean,
// linear, docs-only suffix. It never authorizes a merge: its result is
// explicitly named DOCS_ONLY_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION so no
// caller can mistake "docs suffix verified" for "merge approved". No Git
// write commands are ever issued here.
//
// verifyCanonicalWrapperMetadataSuffix() below is a separate, strictly
// narrower, opt-in proof for exactly one canonical native-skill wrapper
// template path. It never widens verifyDocsOnlySuffix()'s default
// behavior: that function keeps rejecting the wrapper template with
// OUT_OF_SCOPE_CHANGE unless the caller explicitly runs the wrapper
// function instead. Its success code is explicitly named
// CANONICAL_WRAPPER_METADATA_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION and
// never asserts an earlier qualified-commit receipt, a final direct-browser
// receipt, or overall merge readiness by itself.
const SHA_RE = /^[0-9a-f]{40}$/i;
const DOCS_EXT_RE = /\.(?:md|json|png)$/i;
const SPECIAL_ROOT_FILES = new Set(['CURRENT_STATUS.md', 'PROJECT_CONTEXT.json']);
const WRAPPER_TEMPLATE_PATH = 'templates/.claude/skills/local-ai-handoff/SKILL.md.template';
const CANONICAL_WRAPPER_SOURCE_PATH = '.agents/skills/local-ai-handoff/SKILL.md';
const DESCRIPTION_LINE_RE = /^description:\s/;

function repoRelativePath(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && !value.startsWith('/') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function stop(code) {
  return { result: 'STOP', code };
}

function runGit(repoRoot, args, timeoutMs = 10000) {
  return spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024,
  });
}

function parsePathsZ(stdout) {
  return String(stdout || '').split('\0').filter((entry) => entry.length > 0);
}

// A changed path qualifies only as CURRENT_STATUS.md, PROJECT_CONTEXT.json,
// or a .md/.json/.png file strictly under docs/. Nothing else, regardless of
// extension or location, is ever treated as docs-only.
function qualifiesAsDocsPath(changedPath) {
  if (SPECIAL_ROOT_FILES.has(changedPath)) return true;
  return changedPath.startsWith('docs/') && DOCS_EXT_RE.test(changedPath);
}

// Shared core (unchanged behavior/order): SHA + repoRoot validation.
function validateRepoRootAndHeads(repoRoot, fromHead, toHead) {
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) return stop('REPO_ROOT_INVALID');
  if (!SHA_RE.test(fromHead || '') || !SHA_RE.test(toHead || '')) return stop('HEAD_SHA_INVALID');
  return { normalizedFromHead: fromHead.toLowerCase(), normalizedToHead: toHead.toLowerCase() };
}

// Shared core (unchanged behavior/order): current HEAD matches toHead and
// the worktree is clean.
function verifyCleanCurrentHead(repoRoot, normalizedToHead) {
  const headResult = runGit(repoRoot, ['rev-parse', 'HEAD']);
  if (headResult.error || headResult.status !== 0) return stop('REPO_HEAD_UNVERIFIABLE');
  if (String(headResult.stdout || '').trim().toLowerCase() !== normalizedToHead) return stop('CURRENT_HEAD_MISMATCH');

  const statusResult = runGit(repoRoot, ['status', '--porcelain=v1']);
  if (statusResult.error || statusResult.status !== 0) return stop('WORKTREE_STATUS_UNVERIFIABLE');
  if (String(statusResult.stdout || '').trim().length > 0) return stop('WORKTREE_NOT_CLEAN');
  return null;
}

// Shared core (unchanged behavior/order): fromHead is an ancestor of toHead
// and no merge commits exist in the range.
function verifyAncestryNoMerges(repoRoot, normalizedFromHead, normalizedToHead) {
  const ancestorResult = runGit(repoRoot, ['merge-base', '--is-ancestor', normalizedFromHead, normalizedToHead]);
  if (ancestorResult.error) return stop('ANCESTRY_UNVERIFIABLE');
  if (ancestorResult.status !== 0) return stop('FROM_HEAD_NOT_ANCESTOR');

  const mergesResult = runGit(repoRoot, ['rev-list', '--min-parents=2', `${normalizedFromHead}..${normalizedToHead}`]);
  if (mergesResult.error || mergesResult.status !== 0) return stop('MERGE_HISTORY_UNVERIFIABLE');
  if (String(mergesResult.stdout || '').trim().length > 0) return stop('MERGED_COMMITS_PRESENT');
  return null;
}

// Shared core (unchanged behavior/order): the ordered commit list for the range.
function listSuffixCommits(repoRoot, normalizedFromHead, normalizedToHead) {
  const commitListResult = runGit(repoRoot, ['rev-list', '--reverse', `${normalizedFromHead}..${normalizedToHead}`]);
  if (commitListResult.error || commitListResult.status !== 0) return stop('COMMIT_LIST_UNVERIFIABLE');
  const commits = String(commitListResult.stdout || '').split('\n').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return { commits };
}

export function verifyDocsOnlySuffix({ repoRoot, fromHead, toHead, allowedPaths }) {
  const headsResult = validateRepoRootAndHeads(repoRoot, fromHead, toHead);
  if (headsResult.result === 'STOP') return headsResult;
  const { normalizedFromHead, normalizedToHead } = headsResult;

  if (!Array.isArray(allowedPaths) || !allowedPaths.every((entry) => repoRelativePath(entry))) {
    return stop('ALLOWED_PATHS_INVALID');
  }

  const cleanStop = verifyCleanCurrentHead(repoRoot, normalizedToHead);
  if (cleanStop) return cleanStop;

  const ancestryStop = verifyAncestryNoMerges(repoRoot, normalizedFromHead, normalizedToHead);
  if (ancestryStop) return ancestryStop;

  const commitsOutcome = listSuffixCommits(repoRoot, normalizedFromHead, normalizedToHead);
  if (commitsOutcome.result === 'STOP') return commitsOutcome;
  const { commits } = commitsOutcome;

  const changedPathsSet = new Set();

  for (const commit of commits) {
    if (!SHA_RE.test(commit)) return stop('COMMIT_SHA_INVALID');
    const normalizedCommit = commit.toLowerCase();

    const parentResult = runGit(repoRoot, ['rev-parse', `${normalizedCommit}^`]);
    if (parentResult.error || parentResult.status !== 0) return stop('COMMIT_PARENT_UNVERIFIABLE');
    const parent = String(parentResult.stdout || '').trim().toLowerCase();
    if (!SHA_RE.test(parent)) return stop('COMMIT_PARENT_INVALID');

    const commitDiffResult = runGit(repoRoot, ['diff', '--name-status', '--no-renames', '-z', parent, normalizedCommit]);
    if (commitDiffResult.error || commitDiffResult.status !== 0) return stop('DIFF_UNVERIFIABLE');
    const entries = parsePathsZ(commitDiffResult.stdout);

    for (let i = 0; i < entries.length; i += 2) {
      const status = entries[i];
      const changedPath = entries[i + 1];
      if (typeof status !== 'string' || typeof changedPath !== 'string') return stop('DIFF_UNVERIFIABLE');
      if (!repoRelativePath(changedPath)) return stop('CHANGED_PATH_INVALID');
      if (status.startsWith('D')) return stop('DOCS_DELETION_REFUSED');
      const explicitlyAllowed = allowedPaths.includes(changedPath);
      if (!explicitlyAllowed || !qualifiesAsDocsPath(changedPath)) return stop('OUT_OF_SCOPE_CHANGE');
      changedPathsSet.add(changedPath);
    }
  }

  const changedPaths = Array.from(changedPathsSet);

  return {
    result: 'DOCS_ONLY_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION',
    fromHead: normalizedFromHead,
    toHead: normalizedToHead,
    changedPaths,
  };
}

function gitShowBlobBytes(repoRoot, ref, timeoutMs = 10000) {
  const result = spawnSync('git', ['-C', repoRoot, 'show', ref], {
    windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) return null;
  return result.stdout;
}

// Fail closed on anything that could make byte-identity ambiguous: a lone
// CR byte (CRLF or bare-CR line endings) or a UTF-8 BOM.
function decodeStrictUtf8NoAmbiguity(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  if (buffer.includes(0x0d)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function frontmatterBounds(lines) {
  if (lines.length < 2 || lines[0] !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') return { start: 0, end: i };
  }
  return null;
}

function findDescriptionLineInFrontmatter(lines) {
  const bounds = frontmatterBounds(lines);
  if (!bounds) return null;
  const matches = [];
  for (let i = bounds.start + 1; i < bounds.end; i += 1) {
    if (DESCRIPTION_LINE_RE.test(lines[i])) matches.push(lines[i]);
  }
  return matches.length === 1 ? matches[0] : null;
}

// Strictly verifies ONLY a single-line `description:` replacement inside the
// YAML frontmatter of the one canonical native-skill wrapper template path,
// as the sole change of a single non-merge commit directly on top of
// fromHead. Caller-supplied path/description values are never accepted:
// the allowed path and the required description text (read from the
// canonical skill source at the same toHead) are both fixed here, so a
// caller cannot broaden scope by naming another path or approving an
// arbitrary string. On success this never implies an earlier qualified
// receipt, a final direct-browser receipt, or overall merge readiness.
export function verifyCanonicalWrapperMetadataSuffix({ repoRoot, fromHead, toHead }) {
  const headsResult = validateRepoRootAndHeads(repoRoot, fromHead, toHead);
  if (headsResult.result === 'STOP') return headsResult;
  const { normalizedFromHead, normalizedToHead } = headsResult;

  const cleanStop = verifyCleanCurrentHead(repoRoot, normalizedToHead);
  if (cleanStop) return cleanStop;

  const ancestryStop = verifyAncestryNoMerges(repoRoot, normalizedFromHead, normalizedToHead);
  if (ancestryStop) return ancestryStop;

  const commitsOutcome = listSuffixCommits(repoRoot, normalizedFromHead, normalizedToHead);
  if (commitsOutcome.result === 'STOP') return commitsOutcome;
  const { commits } = commitsOutcome;

  if (commits.length !== 1 || commits[0] !== normalizedToHead) {
    return stop('WRAPPER_SUFFIX_MUST_BE_SINGLE_COMMIT');
  }
  const commit = commits[0];

  const parentResult = runGit(repoRoot, ['rev-parse', `${commit}^`]);
  if (parentResult.error || parentResult.status !== 0) return stop('COMMIT_PARENT_UNVERIFIABLE');
  const parent = String(parentResult.stdout || '').trim().toLowerCase();
  if (!SHA_RE.test(parent)) return stop('COMMIT_PARENT_INVALID');
  if (parent !== normalizedFromHead) return stop('WRAPPER_SUFFIX_MUST_BE_SINGLE_COMMIT');

  const nameStatusResult = runGit(repoRoot, ['diff', '--name-status', '--no-renames', '-z', parent, commit]);
  if (nameStatusResult.error || nameStatusResult.status !== 0) return stop('DIFF_UNVERIFIABLE');
  const entries = parsePathsZ(nameStatusResult.stdout);
  if (entries.length !== 2) return stop('WRAPPER_MULTIPLE_PATHS_CHANGED');
  const [status, changedPath] = entries;
  if (typeof status !== 'string' || typeof changedPath !== 'string' || !repoRelativePath(changedPath)) {
    return stop('DIFF_UNVERIFIABLE');
  }
  if (changedPath !== WRAPPER_TEMPLATE_PATH) return stop('WRAPPER_UNEXPECTED_PATH');
  if (status !== 'M') return stop('WRAPPER_PATH_STATUS_INVALID');

  const numstatResult = runGit(repoRoot, ['diff', '--numstat', parent, commit, '--', WRAPPER_TEMPLATE_PATH]);
  if (numstatResult.error || numstatResult.status !== 0) return stop('DIFF_UNVERIFIABLE');
  const numstatParts = String(numstatResult.stdout || '').trim().split('\t');
  if (numstatParts.length < 2 || numstatParts[0] === '-' || numstatParts[1] === '-') {
    return stop('WRAPPER_BINARY_CHANGE_REFUSED');
  }

  const rawResult = runGit(repoRoot, ['diff', '--raw', '--no-renames', parent, commit, '--', WRAPPER_TEMPLATE_PATH]);
  if (rawResult.error || rawResult.status !== 0) return stop('DIFF_UNVERIFIABLE');
  const rawMatch = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\t/.exec(String(rawResult.stdout || '').trim());
  if (!rawMatch) return stop('WRAPPER_RAW_DIFF_UNPARSEABLE');
  const [, oldMode, newMode] = rawMatch;
  if (oldMode !== '100644' || newMode !== '100644') return stop('WRAPPER_MODE_CHANGE_REFUSED');

  const oldBlob = gitShowBlobBytes(repoRoot, `${parent}:${WRAPPER_TEMPLATE_PATH}`);
  const newBlob = gitShowBlobBytes(repoRoot, `${commit}:${WRAPPER_TEMPLATE_PATH}`);
  const canonicalBlob = gitShowBlobBytes(repoRoot, `${normalizedToHead}:${CANONICAL_WRAPPER_SOURCE_PATH}`);
  if (!oldBlob || !newBlob || !canonicalBlob) return stop('WRAPPER_BLOB_UNREADABLE');

  const oldText = decodeStrictUtf8NoAmbiguity(oldBlob);
  const newText = decodeStrictUtf8NoAmbiguity(newBlob);
  const canonicalText = decodeStrictUtf8NoAmbiguity(canonicalBlob);
  if (oldText === null || newText === null || canonicalText === null) return stop('WRAPPER_BLOB_ENCODING_INVALID');

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const canonicalLines = canonicalText.split('\n');

  const oldBounds = frontmatterBounds(oldLines);
  const newBounds = frontmatterBounds(newLines);
  if (!oldBounds || !newBounds || oldBounds.end !== newBounds.end || oldLines.length !== newLines.length) {
    return stop('WRAPPER_FRONTMATTER_STRUCTURE_CHANGED');
  }

  const diffIndices = [];
  for (let i = 0; i < oldLines.length; i += 1) {
    if (oldLines[i] !== newLines[i]) diffIndices.push(i);
  }
  if (diffIndices.length !== 1) return stop('WRAPPER_NOT_SINGLE_LINE_CHANGE');
  const diffIndex = diffIndices[0];
  if (diffIndex <= oldBounds.start || diffIndex >= oldBounds.end) return stop('WRAPPER_LINE_OUTSIDE_FRONTMATTER');

  const oldLine = oldLines[diffIndex];
  const newLine = newLines[diffIndex];
  if (!DESCRIPTION_LINE_RE.test(oldLine) || !DESCRIPTION_LINE_RE.test(newLine)) {
    return stop('WRAPPER_NOT_DESCRIPTION_LINE');
  }

  const canonicalDescriptionLine = findDescriptionLineInFrontmatter(canonicalLines);
  if (canonicalDescriptionLine === null) return stop('CANONICAL_DESCRIPTION_LINE_UNAVAILABLE');
  if (newLine !== canonicalDescriptionLine) return stop('WRAPPER_DESCRIPTION_MISMATCH_CANONICAL');

  return {
    result: 'CANONICAL_WRAPPER_METADATA_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION',
    fromHead: normalizedFromHead,
    toHead: normalizedToHead,
    changedPaths: [WRAPPER_TEMPLATE_PATH],
  };
}

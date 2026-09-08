#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const RECEIPT_HEADER = 'MERGE_AUTHORIZATION_V1';
const MAX_RECEIPT_AGE_MS = 30 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RECEIPT_SOURCES = new Set(['EXPLICIT_HUMAN', 'PERSISTED_AFTER_AUDIT']);

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
function parseRepo(value) {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(value);
  if (!match) throw new Error('Invalid --repo; expected owner/name');
  return { owner: match[1], repo: match[2] };
}

export function parseAuthorizationReceipt(body) {
  const lines = String(body ?? '').replace(/\r/g, '').trim().split('\n');
  if (lines.length !== 5 || lines[0] !== RECEIPT_HEADER) return null;
  const values = {};
  for (const line of lines.slice(1)) {
    const match = /^([A-Z_]+): ([^\n]+)$/.exec(line);
    if (!match || Object.hasOwn(values, match[1])) return null;
    values[match[1]] = match[2];
  }
  const keys = Object.keys(values).sort().join(',');
  if (keys !== 'AUTHORIZED,HEAD,PR,SOURCE') return null;
  if (!/^\d+$/.test(values.PR)) return null;
  if (!/^[0-9a-f]{40}$/i.test(values.HEAD)) return null;
  if (values.AUTHORIZED !== 'YES' || !RECEIPT_SOURCES.has(values.SOURCE)) return null;
  return {
    prNumber: Number(values.PR),
    headSha: values.HEAD.toLowerCase(),
    source: values.SOURCE,
  };
}
async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    redirect: 'follow',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'digital-work-order-merge-execution-gate',
    },
  });
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  return response.json();
}

async function fetchAllComments(apiBase, prNumber, fetchImpl) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await fetchJson(
      `${apiBase}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      fetchImpl,
    );
    if (!Array.isArray(batch)) throw new Error('Invalid GitHub comments response');
    all.push(...batch);
    if (batch.length < 100) break;
    if (page === 10) throw new Error('Too many PR comments to audit safely');
  }
  return all;
}
function classifyReceipt(comments, { author, prNumber, headSha, nowMs }) {
  const parsed = comments.map(comment => ({
    comment,
    receipt: parseAuthorizationReceipt(comment.body),
  })).filter(item => item.receipt);
  if (!parsed.length) return { code: 'AUTHORIZATION_RECEIPT_REQUIRED' };

  const byAuthor = parsed.filter(item => item.comment?.user?.login === author);
  if (!byAuthor.length) return { code: 'AUTHORIZATION_AUTHOR_MISMATCH' };
  const byPr = byAuthor.filter(item => item.receipt.prNumber === prNumber);
  if (!byPr.length) return { code: 'AUTHORIZATION_PR_MISMATCH' };
  const byHead = byPr.filter(item => item.receipt.headSha === headSha);
  if (!byHead.length) return { code: 'AUTHORIZATION_HEAD_MISMATCH' };

  const fresh = byHead.filter(item => {
    const createdMs = Date.parse(item.comment.created_at ?? '');
    if (!Number.isFinite(createdMs)) return false;
    const age = nowMs - createdMs;
    return age >= -MAX_FUTURE_SKEW_MS && age <= MAX_RECEIPT_AGE_MS;
  }).sort((a, b) => Date.parse(b.comment.created_at) - Date.parse(a.comment.created_at));
  if (!fresh.length) return { code: 'AUTHORIZATION_RECEIPT_EXPIRED' };
  return { code: 'AUTHORIZATION_RECEIPT_VALID', item: fresh[0] };
}

export async function runMergeExecutionGate({ repo, prNumber, baseBranch, author, nowMs = Date.now(), fetchImpl = fetch }) {
  const { owner, repo: repoName } = parseRepo(repo);
  if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error('Invalid PR number');
  if (!/^[A-Za-z0-9_.-]+$/.test(author)) throw new Error('Invalid author');
  if (!/^[A-Za-z0-9._/-]+$/.test(baseBranch)) throw new Error('Invalid base branch');
  const apiBase = `https://api.github.com/repos/${owner}/${repoName}`;
  const pr = await fetchJson(`${apiBase}/pulls/${prNumber}`, fetchImpl);
  const comments = await fetchAllComments(apiBase, prNumber, fetchImpl);
  const headSha = String(pr?.head?.sha ?? '').toLowerCase();
  const receipt = classifyReceipt(comments, { author, prNumber, headSha, nowMs });
  const checks = {
    prNumber: Number(pr?.number) === prNumber,
    prOpen: pr?.state === 'open' && !pr?.merged_at,
    notDraft: pr?.draft === false,
    baseBranch: pr?.base?.ref === baseBranch,
    headSha: /^[0-9a-f]{40}$/.test(headSha),
    authorizationReceipt: receipt.code === 'AUTHORIZATION_RECEIPT_VALID',
  };
  const pass = Object.values(checks).every(Boolean);
  return {
    pass,
    checks,
    finding: receipt.code,
    prNumber,
    baseBranch,
    actualHeadSha: headSha || '(missing)',
    expectedHeadSha: pass ? headSha : null,
    authorizationCommentId: pass ? receipt.item.comment.id : null,
    authorizationSource: pass ? receipt.item.receipt.source : null,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await runMergeExecutionGate({
      repo: requireArg(args, 'repo'),
      prNumber: Number(requireArg(args, 'pr')),
      baseBranch: requireArg(args, 'base'),
      author: requireArg(args, 'author'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) {
      console.error('MERGE_EXECUTION_GATE=FAIL');
      process.exitCode = 2;
      return;
    }
    console.log('MERGE_EXECUTION_GATE=PASS');
    console.log(`EXPECTED_HEAD_SHA=${result.expectedHeadSha}`);
    console.log(`AUTHORIZATION_COMMENT_ID=${result.authorizationCommentId}`);
    console.log(`AUTHORIZATION_SOURCE=${result.authorizationSource}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('MERGE_EXECUTION_GATE=FAIL');
    console.error(message.replace(/https?:\/\/\S+/g, '<redacted-url>'));
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) await main();

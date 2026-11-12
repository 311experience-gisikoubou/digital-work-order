#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyDocsOnlySuffix, verifyCanonicalWrapperMetadataSuffix } from './qualified-docs-suffix-audit.mjs';

let testCount = 0;
function check(condition, message) {
  testCount += 1;
  assert.ok(condition, `FAIL(${testCount}): ${message}`);
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualified-docs-suffix-audit-selftest-'));

function git(args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}
function commit(message) {
  git(['add', '-A']);
  git(['commit', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}
function write(relPath, content) {
  const full = path.join(repoRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

try {
  git(['init']);
  git(['config', 'user.name', 'Synthetic Selftest']);
  git(['config', 'user.email', 'synthetic-selftest@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);

  write('src/app.ts', "console.log('v1');\n");
  const baseHead = commit('base source commit');

  write('docs/notes.md', '# Notes v1\n');
  const head1 = commit('approved docs-only commit');
  const r1 = verifyDocsOnlySuffix({ repoRoot, fromHead: baseHead, toHead: head1, allowedPaths: ['docs/notes.md'] });
  check(r1.result === 'DOCS_ONLY_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION', 'approved docs-only suffix confirmed');

  write('src/app.ts', "console.log('v2');\n");
  commit('intermediate source edit');
  write('src/app.ts', "console.log('v1');\n");
  const head3 = commit('revert intermediate source edit');
  write('docs/more.md', '# More\n');
  const head4 = commit('another approved docs change');
  const allowed = ['docs/notes.md', 'docs/more.md'];

  const r2 = verifyDocsOnlySuffix({ repoRoot, fromHead: baseHead, toHead: head4, allowedPaths: allowed });
  check(r2.result === 'STOP' && r2.code === 'OUT_OF_SCOPE_CHANGE', 'intermediate src edit+revert still OUT_OF_SCOPE_CHANGE from base');

  const r3 = verifyDocsOnlySuffix({ repoRoot, fromHead: head3, toHead: head1, allowedPaths: allowed });
  check(r3.result === 'STOP' && r3.code === 'CURRENT_HEAD_MISMATCH', 'wrong final SHA yields CURRENT_HEAD_MISMATCH');

  const r4 = verifyDocsOnlySuffix({ repoRoot, fromHead: head3, toHead: head4, allowedPaths: [] });
  check(r4.result === 'STOP' && r4.code === 'OUT_OF_SCOPE_CHANGE', 'unapproved docs list yields OUT_OF_SCOPE_CHANGE');

  write('docs/notes.md', '# Notes v1 dirty uncommitted\n');
  const r5 = verifyDocsOnlySuffix({ repoRoot, fromHead: head3, toHead: head4, allowedPaths: allowed });
  check(r5.result === 'STOP' && r5.code === 'WORKTREE_NOT_CLEAN', 'dirty worktree yields WORKTREE_NOT_CLEAN');
  git(['checkout', '--', '.']);

  fs.rmSync(path.join(repoRoot, 'docs', 'more.md'));
  const head5 = commit('docs deletion');
  const r6 = verifyDocsOnlySuffix({ repoRoot, fromHead: head4, toHead: head5, allowedPaths: ['docs/more.md'] });
  check(r6.result === 'STOP' && r6.code === 'DOCS_DELETION_REFUSED', 'docs deletion yields DOCS_DELETION_REFUSED');

  // Synthetic coverage for verifyCanonicalWrapperMetadataSuffix() in a
  // dedicated second repository so it never interferes with the
  // verifyDocsOnlySuffix() scenarios above.
  const wrapperRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualified-docs-suffix-audit-wrapper-selftest-'));
  try {
    const CANONICAL_PATH = '.agents/skills/local-ai-handoff/SKILL.md';
    const WRAPPER_PATH = 'templates/.claude/skills/local-ai-handoff/SKILL.md.template';
    const oldDescription = 'description: Old wrapper description for synthetic selftest.';
    const newDescription = 'description: New canonical-matching wrapper description for synthetic selftest.';

    function wgit(args) {
      return execFileSync('git', ['-C', wrapperRepoRoot, ...args], { encoding: 'utf8' }).trim();
    }
    function wcommit(message) {
      wgit(['add', '-A']);
      wgit(['commit', '-m', message]);
      return wgit(['rev-parse', 'HEAD']);
    }
    function wwrite(relPath, content) {
      const full = path.join(wrapperRepoRoot, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    function fromBase(mutate, message) {
      wgit(['checkout', '--force', wBase]);
      mutate();
      return wcommit(message);
    }

    wgit(['init']);
    wgit(['config', 'user.name', 'Synthetic Selftest']);
    wgit(['config', 'user.email', 'synthetic-selftest@example.invalid']);
    wgit(['config', 'commit.gpgsign', 'false']);

    wwrite(CANONICAL_PATH, `---\nname: local-ai-handoff\n${newDescription}\n---\n\n# Canonical\n`);
    wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${oldDescription}\n---\n\n# Wrapper\n`);
    const wBase = wcommit('base with canonical + wrapper');

    // Positive: single-line description replacement matching canonical at toHead.
    wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${newDescription}\n---\n\n# Wrapper\n`);
    const wGood = wcommit('wrapper description synced to canonical');
    const w1 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: wGood });
    check(w1.result === 'CANONICAL_WRAPPER_METADATA_SUFFIX_CONFIRMED_NOT_MERGE_AUTHORIZATION', 'canonical wrapper description sync confirmed');
    check(Array.isArray(w1.changedPaths) && w1.changedPaths.length === 1 && w1.changedPaths[0] === WRAPPER_PATH, 'wrapper suffix changedPaths is exactly the wrapper path');

    // Arbitrary changed line outside the YAML frontmatter is refused.
    const headArbitrary = fromBase(() => {
      wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${oldDescription}\n---\n\n# Wrapper changed body\n`);
    }, 'wrapper body line changed, not description');
    const w2 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headArbitrary });
    check(w2.result === 'STOP' && w2.code === 'WRAPPER_LINE_OUTSIDE_FRONTMATTER', 'non-frontmatter line change refused');

    // A changed description line that does not match canonical is refused.
    const headMismatch = fromBase(() => {
      wwrite(WRAPPER_PATH, '---\nname: local-ai-handoff\ndescription: Totally different unmatched description text.\n---\n\n# Wrapper\n');
    }, 'wrapper description changed but does not match canonical');
    const w3 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headMismatch });
    check(w3.result === 'STOP' && w3.code === 'WRAPPER_DESCRIPTION_MISMATCH_CANONICAL', 'non-canonical description text refused');

    // Changing an unsafe/other metadata key (name) instead of description is refused.
    const headUnsafeKey = fromBase(() => {
      wwrite(WRAPPER_PATH, `---\nname: renamed-skill\n${oldDescription}\n---\n\n# Wrapper\n`);
    }, 'wrapper name key changed instead of description');
    const w4 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headUnsafeKey });
    check(w4.result === 'STOP' && w4.code === 'WRAPPER_NOT_DESCRIPTION_LINE', 'changed non-description metadata key refused');

    // An extra changed file alongside the wrapper is refused.
    const headExtraFile = fromBase(() => {
      wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${newDescription}\n---\n\n# Wrapper\n`);
      wwrite('templates/.claude/skills/local-ai-handoff/extra.txt', 'extra\n');
    }, 'wrapper description synced plus unapproved extra file');
    const w5 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headExtraFile });
    check(w5.result === 'STOP' && w5.code === 'WRAPPER_MULTIPLE_PATHS_CHANGED', 'extra changed file alongside wrapper refused');

    // An intermediate unrelated commit before the wrapper-only commit is refused.
    wgit(['checkout', '--force', wBase]);
    wwrite('src/unrelated.txt', 'v1\n');
    wcommit('intermediate unrelated commit');
    wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${newDescription}\n---\n\n# Wrapper\n`);
    const headIntermediate = wcommit('wrapper description synced after intermediate commit');
    const w6 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headIntermediate });
    check(w6.result === 'STOP' && w6.code === 'WRAPPER_SUFFIX_MUST_BE_SINGLE_COMMIT', 'intermediate non-wrapper commit refused');

    // Wrong current HEAD (toHead does not match actual repo HEAD) is refused.
    const w7 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: wGood });
    check(w7.result === 'STOP' && w7.code === 'CURRENT_HEAD_MISMATCH', 'wrong current HEAD refused');

    // Dirty worktree is refused.
    wwrite('src/unrelated.txt', 'dirty uncommitted\n');
    const w8 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headIntermediate });
    check(w8.result === 'STOP' && w8.code === 'WORKTREE_NOT_CLEAN', 'dirty worktree refused');
    wgit(['checkout', '--', '.']);

    // A mode change (e.g. executable/symlink bit) on the wrapper is refused
    // by the same oldMode/newMode check regardless of the exact target mode.
    wgit(['checkout', '--force', wBase]);
    wwrite(WRAPPER_PATH, `---\nname: local-ai-handoff\n${newDescription}\n---\n\n# Wrapper\n`);
    wgit(['add', WRAPPER_PATH]);
    wgit(['update-index', '--chmod=+x', WRAPPER_PATH]);
    wgit(['commit', '-m', 'wrapper description synced but mode changed']);
    const headModeChange = wgit(['rev-parse', 'HEAD']);
    const w9 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headModeChange });
    check(w9.result === 'STOP' && w9.code === 'WRAPPER_MODE_CHANGE_REFUSED', 'mode/symlink change on wrapper refused');

    // A changed path other than the one approved wrapper template is refused.
    const headWrongPath = fromBase(() => {
      wwrite('templates/.claude/skills/other-skill/SKILL.md.template', 'not the approved wrapper\n');
    }, 'unapproved template path changed instead of wrapper');
    const w10 = verifyCanonicalWrapperMetadataSuffix({ repoRoot: wrapperRepoRoot, fromHead: wBase, toHead: headWrongPath });
    check(w10.result === 'STOP' && w10.code === 'WRAPPER_UNEXPECTED_PATH', 'unapproved template path refused');
  } finally {
    fs.rmSync(wrapperRepoRoot, { recursive: true, force: true });
  }

  console.log(`QUALIFIED_DOCS_SUFFIX_AUDIT_SELFTEST=PASS tests=${testCount}`);
} finally {
  fs.rmSync(repoRoot, { recursive: true, force: true });
}

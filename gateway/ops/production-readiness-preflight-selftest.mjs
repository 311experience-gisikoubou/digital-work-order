#!/usr/bin/env node
// production-readiness-preflight-selftest.mjs
//
// Dependency-free selftest for gateway/ops/production-readiness-preflight.mjs.
// Uses only synthetic temporary fixtures created under the OS temp directory.
// No network, no cloud, no auth, no real repository paths are read or written.
// Every fixture directory created by this selftest is removed before exit,
// including on failure, so no artifact is left behind.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runPreflight, parseArgs } from './production-readiness-preflight.mjs';

const BASELINE_FIREBASE_JSON = {
  functions: {
    source: '.',
    codebase: 'relay',
    runtime: 'nodejs22',
    ignore: ['.git', 'node_modules'],
  },
  firestore: {
    rules: 'firestore.rules',
    indexes: 'firestore.indexes.json',
  },
  storage: {
    rules: 'storage.rules',
  },
};

const BASELINE_LIFECYCLE_JSON = {
  rule: [
    {
      action: { type: 'Delete' },
      condition: { age: 30 },
    },
  ],
};

const BASELINE_CORS_JSON = [
  {
    origin: ['https://311experience-gisikoubou.github.io'],
    method: ['PUT'],
    responseHeader: ['Content-Type', 'Range', 'X-Goog-Hash'],
    maxAgeSeconds: 600,
  },
];

const BASELINE_FIRESTORE_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;

const BASELINE_STORAGE_RULES = `rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{object=**} {
      allow read, write: if false;
    }
  }
}
`;

const BASELINE_GATEWAY_CONFIG_EXAMPLE = {
  schemaVersion: 1,
  relayEndpoint: 'https://REPLACE_WITH_RELAY_FUNCTION_URL',
  recipientBackupPaths: ['recipient-backup.json'],
  activeRecipientKeyId: null,
  senderRegistryPath: 'sender-registry.json',
  inboxRoot: null,
  pollSeconds: 60,
};

let passCount = 0;
let failCount = 0;
const failures = [];

function record(name, condition, detail) {
  if (condition) {
    passCount += 1;
  } else {
    failCount += 1;
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path, value) {
  writeFileSync(path, value, 'utf8');
}

function buildBaselineRepo(root) {
  mkdirSync(join(root, 'cloud'), { recursive: true });
  mkdirSync(join(root, 'gateway', 'windows'), { recursive: true });

  writeJson(join(root, 'cloud', 'firebase.json'), BASELINE_FIREBASE_JSON);
  writeJson(join(root, 'cloud', 'storage-lifecycle.json'), BASELINE_LIFECYCLE_JSON);
  writeJson(join(root, 'cloud', 'storage-cors.json'), BASELINE_CORS_JSON);
  writeText(join(root, 'cloud', 'firestore.rules'), BASELINE_FIRESTORE_RULES);
  writeText(join(root, 'cloud', 'storage.rules'), BASELINE_STORAGE_RULES);
  writeJson(join(root, 'gateway', 'gateway-config.example.json'), BASELINE_GATEWAY_CONFIG_EXAMPLE);
}

function withTempRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'dwo-preflight-selftest-'));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function findingFor(result, id) {
  return result.findings.find((finding) => finding.id === id);
}

// ---- Case 1: PASS baseline ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  const result = runPreflight(root);
  record('baseline overall status is PASS', result.status === 'PASS', JSON.stringify(result.findings));
  record(
    'baseline has no STOP findings',
    result.findings.every((finding) => finding.status === 'PASS'),
    JSON.stringify(result.findings.filter((f) => f.status === 'STOP'))
  );
  record('baseline includes nextHumanGates', Array.isArray(result.nextHumanGates) && result.nextHumanGates.length > 0);
});

// ---- Case 2: runtime drift (cloud/firebase.json) ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeJson(join(root, 'cloud', 'firebase.json'), {
    ...BASELINE_FIREBASE_JSON,
    functions: { ...BASELINE_FIREBASE_JSON.functions, runtime: 'nodejs18' },
  });
  const result = runPreflight(root);
  record('runtime drift overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'firebase-json');
  record('runtime drift produces firebase-json STOP finding', Boolean(finding) && finding.status === 'STOP');
});

// ---- Case 3: lifecycle drift (cloud/storage-lifecycle.json) ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeJson(join(root, 'cloud', 'storage-lifecycle.json'), {
    rule: [{ action: { type: 'Delete' }, condition: { age: 7 } }],
  });
  const result = runPreflight(root);
  record('lifecycle drift overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'storage-lifecycle');
  record('lifecycle drift produces storage-lifecycle STOP finding', Boolean(finding) && finding.status === 'STOP');
});

// ---- Case 4: CORS drift (cloud/storage-cors.json) ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeJson(join(root, 'cloud', 'storage-cors.json'), [
    {
      origin: ['https://311experience-gisikoubou.github.io', 'https://evil.example'],
      method: ['PUT', 'GET'],
      responseHeader: ['Content-Type', 'Range', 'X-Goog-Hash'],
      maxAgeSeconds: 600,
    },
  ]);
  const result = runPreflight(root);
  record('CORS drift overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'storage-cors');
  record('CORS drift produces storage-cors STOP finding', Boolean(finding) && finding.status === 'STOP');
});

// ---- Case 5: rules not deny-all (cloud/firestore.rules) ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeText(
    join(root, 'cloud', 'firestore.rules'),
    `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read: if true;
    }
  }
}
`
  );
  const result = runPreflight(root);
  record('non-deny-all rules overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'firestore-rules');
  record('non-deny-all rules produce firestore-rules STOP finding', Boolean(finding) && finding.status === 'STOP');
});

// ---- Case 6: tracked runtime config/secret path present ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeJson(join(root, 'gateway', 'gateway-config.json'), {
    schemaVersion: 1,
    relayEndpoint: 'https://example-relay.example/relay',
  });
  const result = runPreflight(root);
  record('tracked secret path overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'tracked-secret-path');
  record('tracked secret path produces tracked-secret-path STOP finding', Boolean(finding) && finding.status === 'STOP');
});

// ---- Case 6b: legitimate tracked source script with a secret-related
// filename (gateway/windows/protect-receiver-secrets.ps1) must NOT be
// flagged as a tracked secret-shaped path. ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeText(
    join(root, 'gateway', 'windows', 'protect-receiver-secrets.ps1'),
    '# reviewed source script, not a runtime secret artifact\n'
  );
  const result = runPreflight(root);
  record(
    'legitimate protect-receiver-secrets.ps1 source script does not cause STOP',
    result.status === 'PASS',
    JSON.stringify(result.findings.filter((f) => f.status === 'STOP'))
  );
  const finding = findingFor(result, 'tracked-secret-path');
  record(
    'legitimate protect-receiver-secrets.ps1 source script keeps tracked-secret-path PASS',
    Boolean(finding) && finding.status === 'PASS'
  );
});

// ---- Case 6c: an actual runtime receiver-secrets DPAPI JSON artifact must
// still fail closed. ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  writeJson(join(root, 'gateway', 'windows', 'receiver-secrets.dpapi.json'), {
    protectedBlob: 'not-a-real-secret-placeholder',
  });
  const result = runPreflight(root);
  record('actual receiver-secrets.dpapi.json runtime artifact overall status is STOP', result.status === 'STOP');
  const finding = findingFor(result, 'tracked-secret-path');
  record(
    'actual receiver-secrets.dpapi.json runtime artifact produces tracked-secret-path STOP finding',
    Boolean(finding) && finding.status === 'STOP'
  );
});

// ---- Case 7: missing required file fails closed ----

withTempRepo((root) => {
  buildBaselineRepo(root);
  rmSync(join(root, 'cloud', 'firebase.json'));
  const result = runPreflight(root);
  record('missing required file overall status is STOP', result.status === 'STOP');
});

// ---- Case 8: parseArgs fail-closed on malformed args ----

record('parseArgs accepts --pretty', (() => {
  try {
    const parsed = parseArgs(['--pretty']);
    return parsed.pretty === true;
  } catch {
    return false;
  }
})());

record('parseArgs accepts --repo-root value', (() => {
  try {
    const parsed = parseArgs(['--repo-root', 'C:\\some\\path']);
    return parsed.repoRoot === 'C:\\some\\path';
  } catch {
    return false;
  }
})());

record('parseArgs rejects --repo-root with no value', (() => {
  try {
    parseArgs(['--repo-root']);
    return false;
  } catch {
    return true;
  }
})());

record('parseArgs rejects unknown argument', (() => {
  try {
    parseArgs(['--not-a-real-flag']);
    return false;
  } catch {
    return true;
  }
})());

// ---- Case 9: non-existent repo root fails closed ----

record('runPreflight fails closed on non-existent repo root', (() => {
  const result = runPreflight(join(tmpdir(), 'dwo-preflight-selftest-does-not-exist-xyz'));
  return result.status === 'STOP';
})());

// ---- report ----

const total = passCount + failCount;
process.stdout.write(`production-readiness-preflight-selftest: ${passCount}/${total} checks passed\n`);
if (failCount > 0) {
  for (const failure of failures) {
    process.stdout.write(`FAIL: ${failure}\n`);
  }
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}

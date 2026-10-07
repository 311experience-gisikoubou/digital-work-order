// Synthetic-only permanent-delete Gate C probe.
// IMPORTANT:
// - doGet/doPost stay write-disabled.
// - runPermanentDeleteSelfTest() is executed manually from the Apps Script editor.
// - It creates only opaque synthetic files inside a dedicated temporary folder.
// - It permanently deletes only IDs created by the same test run after exact parent/list checks.

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    version: 'dwo-drive-relay-trial-v1-disabled',
    trialOnly: true,
    writeEnabled: false,
    serverTime: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: false,
    error: 'TRIAL_DISABLED',
    serverTime: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

function runPermanentDeleteSelfTest() {
  const checks = [];
  const check = function (label, ok) {
    checks.push({ label: label, ok: !!ok });
    console.log((ok ? 'PASS ' : 'FAIL ') + label);
    if (!ok) throw new Error('SELFTEST_FAILED:' + label);
  };

  const root = DriveApp.getRootFolder();
  const suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  const trialRoot = root.createFolder('DWO_RELAY_DELETE_TRIAL_' + suffix);
  const jobFolder = trialRoot.createFolder('job_' + suffix);
  const objectA = jobFolder.createFile(
    Utilities.newBlob('synthetic-ciphertext-a-' + suffix, 'application/octet-stream', 'obj_0000.bin')
  );
  const objectB = jobFolder.createFile(
    Utilities.newBlob('synthetic-ciphertext-b-' + suffix, 'application/octet-stream', 'obj_0001.bin')
  );
  const unrelated = jobFolder.createFile(
    Utilities.newBlob('synthetic-unrelated-' + suffix, 'application/octet-stream', 'control_unrelated.bin')
  );

  const receiverToken = 'receiver_' + Utilities.getUuid().replace(/-/g, '');
  const ackCapability = 'cap_' + Utilities.getUuid().replace(/-/g, '');
  const ackProof = sha256Hex_('proof:' + Utilities.getUuid());

  const job = {
    state: 'ready',
    trialRootId: trialRoot.getId(),
    jobFolderId: jobFolder.getId(),
    expectedFileIds: [objectA.getId(), objectB.getId()],
    receiverTokenHash: sha256Hex_(receiverToken),
    ackCapabilityHash: sha256Hex_(ackCapability),
    ackProofHash: sha256Hex_(ackProof)
  };

  try {
    check('public POST remains disabled in source', doPost().getContent().indexOf('TRIAL_DISABLED') >= 0);
    check('two expected synthetic objects exist', existsByApi_(objectA.getId()) && existsByApi_(objectB.getId()));
    check('unrelated control exists', existsByApi_(unrelated.getId()));

    const wrongReceiver = beginDelete_(job, 'wrong-receiver', ackCapability, ackProof);
    check('wrong receiver token rejected', wrongReceiver.ok === false && wrongReceiver.error === 'RECEIVER_AUTH_INVALID');
    check('wrong receiver cannot delete', existsByApi_(objectA.getId()) && existsByApi_(objectB.getId()));

    const wrongCapability = beginDelete_(job, receiverToken, 'wrong-capability', ackProof);
    check('wrong ACK capability rejected', wrongCapability.ok === false && wrongCapability.error === 'ACK_CAPABILITY_INVALID');
    check('wrong capability cannot delete', existsByApi_(objectA.getId()) && existsByApi_(objectB.getId()));

    const wrongProof = beginDelete_(job, receiverToken, ackCapability, '0'.repeat(64));
    check('wrong ACK proof rejected', wrongProof.ok === false && wrongProof.error === 'ACK_PROOF_INVALID');
    check('wrong proof cannot delete', existsByApi_(objectA.getId()) && existsByApi_(objectB.getId()));

    const authorized = beginDelete_(job, receiverToken, ackCapability, ackProof);
    check('valid ACK transitions ready to deleting', authorized.ok === true && job.state === 'deleting');

    const unrelatedAttempt = deleteExpectedObject_(job, unrelated.getId());
    check('unrelated file ID rejected before delete',
      unrelatedAttempt.ok === false && unrelatedAttempt.error === 'UNEXPECTED_FILE_ID');
    check('unrelated file remains after rejection', existsByApi_(unrelated.getId()));

    const firstDelete = deleteExpectedObject_(job, objectA.getId());
    check('first exact object permanently deleted', firstDelete.ok === true && !existsByApi_(objectA.getId()));
    check('simulated interruption preserves second object', existsByApi_(objectB.getId()) && job.state === 'deleting');

    const resumed = resumeDelete_(job);
    check('delete resume succeeds with first already absent', resumed.ok === true);
    check('second exact object permanently deleted on resume', !existsByApi_(objectB.getId()));
    check('unrelated file survives expected-object resume', existsByApi_(unrelated.getId()));

    // Test-only cleanup of the unrelated control file uses a separate one-item expected list.
    const cleanupJob = {
      state: 'deleting',
      jobFolderId: job.jobFolderId,
      expectedFileIds: [unrelated.getId()]
    };
    const controlCleanup = deleteExpectedObject_(cleanupJob, unrelated.getId());
    check('test-only control cleanup succeeds', controlCleanup.ok === true && !existsByApi_(unrelated.getId()));

    check('job folder is empty before folder delete', folderIsEmpty_(job.jobFolderId));
    const jobFolderDelete = deleteExactEmptyFolder_(
      job.jobFolderId,
      job.trialRootId,
      'job_' + suffix
    );
    check('empty job folder permanently deleted', jobFolderDelete.ok === true && !existsByApi_(job.jobFolderId));

    check('trial root is empty before root delete', folderIsEmpty_(job.trialRootId));
    const trialRootDelete = deleteExactEmptyFolder_(
      job.trialRootId,
      root.getId(),
      'DWO_RELAY_DELETE_TRIAL_' + suffix
    );
    check('empty trial root permanently deleted', trialRootDelete.ok === true && !existsByApi_(job.trialRootId));

    const allPassed = checks.every(function (entry) { return entry.ok; });
    console.log('DRIVE_RELAY_PERMANENT_DELETE_PROBE=' + (allPassed ? 'PASS' : 'FAIL'));
    console.log('CHECK_COUNT=' + checks.length);
    return { ok: allPassed, checkCount: checks.length };
  } catch (error) {
    console.error('DRIVE_RELAY_PERMANENT_DELETE_PROBE=FAIL');
    console.error(String(error && error.message ? error.message : error));
    // Fail closed. Do not recursively delete folders after an unexpected failure.
    // Synthetic leftovers, if any, remain visibly under DWO_RELAY_DELETE_TRIAL_* for manual inspection.
    throw error;
  }
}

function beginDelete_(job, receiverToken, ackCapability, ackProof) {
  if (!job || job.state !== 'ready') return { ok: false, error: 'JOB_NOT_READY' };
  if (!safeHexEqual_(sha256Hex_(receiverToken), job.receiverTokenHash)) {
    return { ok: false, error: 'RECEIVER_AUTH_INVALID' };
  }
  if (!safeHexEqual_(sha256Hex_(ackCapability), job.ackCapabilityHash)) {
    return { ok: false, error: 'ACK_CAPABILITY_INVALID' };
  }
  if (!safeHexEqual_(sha256Hex_(ackProof), job.ackProofHash)) {
    return { ok: false, error: 'ACK_PROOF_INVALID' };
  }
  job.state = 'deleting';
  return { ok: true };
}

function resumeDelete_(job) {
  if (!job || job.state !== 'deleting') return { ok: false, error: 'JOB_NOT_DELETING' };
  for (let i = 0; i < job.expectedFileIds.length; i += 1) {
    const result = deleteExpectedObject_(job, job.expectedFileIds[i]);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function deleteExpectedObject_(job, fileId) {
  if (!job || job.state !== 'deleting') return { ok: false, error: 'JOB_NOT_DELETING' };
  if (job.expectedFileIds.indexOf(fileId) < 0) return { ok: false, error: 'UNEXPECTED_FILE_ID' };

  const meta = driveGetMeta_(fileId);
  if (meta === null) return { ok: true, status: 'already-absent' };

  if (meta.mimeType === 'application/vnd.google-apps.folder') {
    return { ok: false, error: 'FILE_EXPECTED_NOT_FOLDER' };
  }
  if (!Array.isArray(meta.parents) || meta.parents.length !== 1 || meta.parents[0] !== job.jobFolderId) {
    return { ok: false, error: 'WRONG_PARENT' };
  }
  if (!/^obj_[0-9]{4}\.bin$/.test(meta.name) && meta.name !== 'control_unrelated.bin') {
    return { ok: false, error: 'UNEXPECTED_FILE_NAME' };
  }

  driveDeleteRaw_(fileId);
  return { ok: true, status: 'deleted' };
}

function deleteExactEmptyFolder_(folderId, expectedParentId, expectedName) {
  const meta = driveGetMeta_(folderId);
  if (meta === null) return { ok: true, status: 'already-absent' };
  if (meta.mimeType !== 'application/vnd.google-apps.folder') {
    return { ok: false, error: 'FOLDER_EXPECTED' };
  }
  if (meta.name !== expectedName) return { ok: false, error: 'FOLDER_NAME_MISMATCH' };
  if (!Array.isArray(meta.parents) || meta.parents.length !== 1 || meta.parents[0] !== expectedParentId) {
    return { ok: false, error: 'FOLDER_PARENT_MISMATCH' };
  }
  if (!folderIsEmpty_(folderId)) return { ok: false, error: 'FOLDER_NOT_EMPTY' };

  driveDeleteRaw_(folderId);
  return { ok: true, status: 'deleted' };
}

function folderIsEmpty_(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  return !folder.getFiles().hasNext() && !folder.getFolders().hasNext();
}

function existsByApi_(fileId) {
  return driveGetMeta_(fileId) !== null;
}

function driveGetMeta_(fileId) {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
      '?fields=id,name,mimeType,parents,trashed',
    {
      method: 'get',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    }
  );
  const code = response.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) throw new Error('DRIVE_GET_FAILED:' + code);
  return JSON.parse(response.getContentText());
}

function driveDeleteRaw_(fileId) {
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId),
    {
      method: 'delete',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    }
  );
  const code = response.getResponseCode();
  if (code !== 204 && code !== 200) throw new Error('DRIVE_DELETE_FAILED:' + code);
}

function sha256Hex_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  ).map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function safeHexEqual_(a, b) {
  if (!/^[0-9a-f]{64}$/.test(a || '') || !/^[0-9a-f]{64}$/.test(b || '')) return false;
  let diff = 0;
  for (let i = 0; i < 64; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

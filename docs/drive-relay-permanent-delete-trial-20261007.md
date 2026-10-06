# Drive relay permanent-delete trial — 2026-10-07

Status: **GATE C SYNTHETIC PASS**

This test used synthetic data only. It does not authorize production use or real patient/clinic data.

## Purpose

Prove that the Google Drive relay can permanently delete only exact expected objects after the
existing Phase 7-style ACK conditions are satisfied, while failing closed for wrong credentials,
unrelated files, and interrupted deletion.

## Official API path used

The trial deliberately did **not** enable the Advanced Drive service.

Apps Script called Drive API v3 directly with:

- `ScriptApp.getOAuthToken()`
- `UrlFetchApp.fetch()`
- `GET /drive/v3/files/{fileId}?fields=id,name,mimeType,parents,trashed`
- `DELETE /drive/v3/files/{fileId}`

Google documents that `files.delete` permanently deletes a user-owned file without moving it to
Trash.

References:

- https://developers.google.com/apps-script/reference/script/script-app
- https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/delete

## Safety boundary

The prototype is in:

`tools/drive-relay-permanent-delete-probe.gs`

The deployed public web app stayed write-disabled for the entire Gate C run:

- GET reported `writeEnabled:false`;
- POST returned `TRIAL_DISABLED`;
- the Gate C function was run manually from the Apps Script editor and was never deployed as a
  public delete endpoint.

The test created only an opaque temporary hierarchy:

`DWO_RELAY_DELETE_TRIAL_<opaque>/job_<opaque>/...`

The delete helper failed closed unless:

- job state was `deleting`;
- the exact file ID was in the job expected-file list;
- Drive metadata proved the file was a direct child of the exact job folder;
- the file was not a folder;
- its synthetic object name matched the allowed shape.

Folder deletion additionally required:

- exact folder ID;
- exact expected folder name;
- exact parent ID;
- an empty-folder check.

## Results

All 22 checks passed:

1. public POST remained disabled in source;
2. two expected synthetic objects existed;
3. unrelated control file existed;
4. wrong receiver token rejected;
5. wrong receiver token deleted nothing;
6. wrong ACK capability rejected;
7. wrong capability deleted nothing;
8. wrong ACK proof rejected;
9. wrong proof deleted nothing;
10. valid ACK transitioned `ready -> deleting`;
11. unrelated file ID rejected before delete;
12. unrelated file remained;
13. first exact object permanently deleted;
14. simulated interruption preserved the second object and `deleting` state;
15. resume succeeded when the first object was already absent;
16. second exact object permanently deleted on resume;
17. unrelated file survived expected-object resume;
18. test-only control cleanup succeeded;
19. job folder was empty before folder delete;
20. empty job folder permanently deleted;
21. trial root was empty before root delete;
22. empty trial root permanently deleted.

Execution log terminal result:

`DRIVE_RELAY_PERMANENT_DELETE_PROBE=PASS`

`CHECK_COUNT=22`

## Cleanup verification

After the test:

- no `DWO_RELAY_DELETE_TRIAL_*` folder remained in the lab-PC Google Drive view;
- the production/trial web-app deployment still returned `writeEnabled:false`;
- public POST still returned `TRIAL_DISABLED`;
- the Apps Script editor source was restored to the simple disabled trial source.

## Gate C decision

**PASS for the bounded synthetic permanent-delete prototype.**

This proves the exact-delete mechanism and failure semantics are viable. It does not yet prove the
full production receiver state store, actual receiver credential persistence, exact iPad flow, or
failure matrix under real network interruption.

The next external-device gate remains the real iPad Safari path with synthetic data only.

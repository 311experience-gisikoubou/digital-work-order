const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const M = require('../media.js');

// 架空サンプルのみ
const SAMPLES = {
  photo: { name: 'photo-sample.jpg', type: 'image/jpeg', size: 123456 },
  movie: { name: 'movie-sample.mov', type: 'video/quicktime', size: 2345678 },
  voice: { name: 'voice-sample.webm', type: 'audio/webm', size: 34567 },
  note: { name: 'note-sample.pdf', type: 'application/pdf', size: 45678 }
};

function fakeUrlApi() {
  let n = 0;
  const api = { created: [], revoked: [], fail: false };
  api.createObjectURL = () => {
    if (api.fail) throw new Error('quota');
    const url = 'blob:sample/' + (++n);
    api.created.push(url);
    return url;
  };
  api.revokeObjectURL = url => api.revoked.push(url);
  return api;
}

test('require succeeds without DOM and exposes helpers', () => {
  assert.equal(typeof document, 'undefined');
  assert.equal(typeof M.classifyKind, 'function');
  assert.equal(globalThis.ReferenceMediaManager, M);
});

test('classifyKind covers samples, unknown MIME and empty MIME', () => {
  assert.equal(M.classifyKind(SAMPLES.photo.type), 'image');
  assert.equal(M.classifyKind(SAMPLES.movie.type), 'video');
  assert.equal(M.classifyKind(SAMPLES.voice.type), 'audio');
  assert.equal(M.classifyKind(SAMPLES.note.type), 'file');
  assert.equal(M.classifyKind('application/x-unknown-sample'), 'file');
  assert.equal(M.classifyKind('', 'movie-sample.mov'), 'video');
  assert.equal(M.classifyKind('', 'mystery'), 'file');
  assert.equal(M.classifyKind(undefined), 'file');
});

test('formatFileSize', () => {
  assert.equal(M.formatFileSize(0), '0 B');
  assert.equal(M.formatFileSize(1023), '1023 B');
  assert.equal(M.formatFileSize(SAMPLES.photo.size), '120.6 KB');
  assert.equal(M.formatFileSize(SAMPLES.movie.size), '2.2 MB');
  assert.equal(M.formatFileSize(SAMPLES.voice.size), '33.8 KB');
  assert.equal(M.formatFileSize(SAMPLES.note.size), '44.6 KB');
  assert.equal(M.formatFileSize(-1), '-');
  assert.equal(M.formatFileSize(NaN), '-');
});

test('sanitizeDisplayName and recording names', () => {
  assert.equal(M.sanitizeDisplayName('photo-sample.jpg'), 'photo-sample.jpg');
  assert.equal(M.sanitizeDisplayName('a/b' + String.fromCharCode(92) + 'c.jpg'), 'a_b_c.jpg');
  assert.equal(M.sanitizeDisplayName('  \u0000\u0007 '), '無題ファイル');
  assert.equal(M.sanitizeDisplayName(null), '無題ファイル');
  assert.equal(M.sanitizeDisplayName('..'), '無題ファイル');
  const long = M.sanitizeDisplayName('x'.repeat(300) + '.pdf');
  assert.ok(Array.from(long).length <= 100 && long.endsWith('.pdf'));

  const d = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(M.buildRecordingName(d, 'audio/webm;codecs=opus'), '音声録音_20260102-030405.webm');
  assert.equal(M.buildRecordingName(d, 'audio/mp4'), '音声録音_20260102-030405.m4a');
  assert.equal(M.buildRecordingName(d, ''), '音声録音_20260102-030405');
});

test('generated IDs are unique and carry no patient/clinic info', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(M.generateAttachmentId());
  assert.equal(ids.size, 200);
  ids.forEach(id => assert.match(id, /^media-[a-z0-9]+-[a-z0-9]+-[0-9a-f]{8}$/));
});

test('store add keeps MIME/name as given and never renames from patient data', () => {
  const api = fakeUrlApi();
  const store = M.createAttachmentStore(api);
  const item = store.add(SAMPLES.movie, { source: 'camera-video' });
  assert.equal(item.kind, 'video');
  assert.equal(item.mime, 'video/quicktime');
  assert.equal(item.name, 'movie-sample.mov');
  assert.equal(item.size, 2345678);
  assert.equal(item.source, 'camera-video');
  assert.equal(item.objectUrl, 'blob:sample/1');
  const rec = store.add({ type: 'audio/webm', size: 34567 }, { source: 'recording', kind: 'audio', name: M.buildRecordingName(new Date(), 'audio/webm') });
  assert.equal(rec.kind, 'audio');
  assert.equal(rec.mime, 'audio/webm');
});

test('createObjectURL failure leaves no broken item', () => {
  const api = fakeUrlApi();
  const store = M.createAttachmentStore(api);
  api.fail = true;
  assert.equal(store.add(SAMPLES.photo), null);
  assert.equal(store.list().length, 0);
  assert.equal(store.add(null), null);
});

test('remove and clear revoke exactly the owned Object URLs', () => {
  const api = fakeUrlApi();
  const store = M.createAttachmentStore(api);
  const items = Object.values(SAMPLES).map(s => store.add(s));
  assert.equal(items.length, 4);
  assert.deepEqual(store.revocableUrls(), api.created);

  assert.equal(store.remove(items[1].id), true);
  assert.deepEqual(api.revoked, ['blob:sample/2']);
  assert.equal(store.remove(items[1].id), false);
  assert.equal(api.revoked.length, 1);
  assert.equal(store.list().length, 3);

  store.clear();
  assert.deepEqual(api.revoked.sort(), api.created.slice().sort());
  assert.equal(store.list().length, 0);
  assert.deepEqual(store.revocableUrls(), []);
  store.clear();
  assert.equal(api.revoked.length, 4);
});

test('send notice text is the Phase 0 wording and is hidden in HTML', () => {
  assert.equal(M.SEND_NOTICE_TEXT, '送信完了までこの画面を閉じないでください');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="media-send-notice"[^>]*hidden/);
});

test('index.html has 4 action buttons, 3 hidden inputs and one media.js script', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const count = re => (html.match(re) || []).length;
  ['写真を撮る', '動画を撮る', '音声を録音', 'ファイルから追加'].forEach(label =>
    assert.equal(count(new RegExp('>' + label + '<', 'g')), 1, label));
  assert.equal(count(/<input type="file" id="media-photo-input" accept="image\/\*" capture="environment" hidden>/g), 1);
  assert.equal(count(/<input type="file" id="media-video-input" accept="video\/\*" capture="environment" hidden>/g), 1);
  assert.equal(count(/<input type="file" id="media-file-input" multiple hidden>/g), 1);
  assert.equal(count(/<script src="media\.js"><\/script>/g), 1);
});

test('media.js does not use persistent storage or touch form data', () => {
  const src = fs.readFileSync(path.join(root, 'media.js'), 'utf8');
  assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|caches\.|collectFormData/);
});

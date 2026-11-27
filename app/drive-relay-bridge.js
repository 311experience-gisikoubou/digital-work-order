(() => {
  'use strict';

  // Normal-page Apps Script HtmlService bridge. This module is inert until a
  // caller supplies an exact deployment URL and explicitly invokes the returned
  // function. It never reads configuration, selects an endpoint, pairs, sends,
  // persists credentials, or changes UI by itself.
  const VERSION = 'dwo-d2-bridge-v1';
  const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  const SANDBOX_ORIGIN_RE = /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/;
  const ACTIONS = new Set(['getConfig', 'pair', 'getSyntheticJobStatus', 'putSyntheticJob']);
  const HANDSHAKE_MS = 15000;
  const ACTION_MS = 60000;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function exactKeys(value, expected) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  }

  function randomChannel() {
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function' ||
        typeof globalThis.btoa !== 'function') throw fail('DRIVE_BRIDGE_CAPABILITY_MISSING');
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
    let text = '';
    for (const value of bytes) text += String.fromCharCode(value);
    return globalThis.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function create(deploymentUrl) {
    if (typeof deploymentUrl !== 'string' || !URL_RE.test(deploymentUrl)) {
      throw fail('DRIVE_BRIDGE_URL_INVALID');
    }
    if (!globalThis.document || !globalThis.document.body ||
        typeof globalThis.document.createElement !== 'function' ||
        typeof globalThis.addEventListener !== 'function' ||
        typeof globalThis.removeEventListener !== 'function') {
      throw fail('DRIVE_BRIDGE_CAPABILITY_MISSING');
    }

    const bridgeCall = function bridgeCall(action, body) {
      if (!ACTIONS.has(action)) return Promise.reject(fail('DRIVE_BRIDGE_ACTION_INVALID'));
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Promise.reject(fail('DRIVE_BRIDGE_BODY_INVALID'));
      }
      let channel;
      try { channel = randomChannel(); } catch (error) { return Promise.reject(error); }

      return new Promise((resolve, reject) => {
        const frame = globalThis.document.createElement('iframe');
        frame.hidden = true;
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.referrerPolicy = 'no-referrer';
        let sent = false;
        let pinnedOrigin = null;
        let pinnedSource = null;
        let settled = false;
        let handshakeTimer = null;
        let actionTimer = null;

        const cleanup = () => {
          globalThis.clearTimeout(handshakeTimer);
          globalThis.clearTimeout(actionTimer);
          globalThis.removeEventListener('message', onMessage);
          globalThis.removeEventListener('pagehide', onPageHide);
          if (typeof frame.remove === 'function') frame.remove();
        };
        const done = (fn, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(value);
        };
        const onPageHide = () => done(reject, fail('DRIVE_BRIDGE_PAGE_CLOSED'));
        const onMessage = event => {
          const data = event && event.data;
          if (!data || data.version !== VERSION || data.channel !== channel) return;
          if (data.type === 'ready' && !sent) {
            if (!exactKeys(data, ['version', 'channel', 'type']) ||
                !SANDBOX_ORIGIN_RE.test(event.origin || '') || !event.source) return;
            sent = true;
            pinnedOrigin = event.origin;
            pinnedSource = event.source;
            globalThis.clearTimeout(handshakeTimer);
            actionTimer = globalThis.setTimeout(
              () => done(reject, fail('DRIVE_BRIDGE_ACTION_TIMEOUT')), ACTION_MS);
            pinnedSource.postMessage({ version: VERSION, channel, action, body }, pinnedOrigin);
            return;
          }
          if (data.type !== 'result' || !sent || event.origin !== pinnedOrigin ||
              event.source !== pinnedSource) return;
          if (data.ok === true && exactKeys(data, ['version', 'channel', 'type', 'ok', 'value'])) {
            done(resolve, data.value);
          } else if (data.ok === false && exactKeys(data, ['version', 'channel', 'type', 'ok'])) {
            done(reject, fail('DRIVE_BRIDGE_REJECTED'));
          } else {
            done(reject, fail('DRIVE_BRIDGE_RESULT_INVALID'));
          }
        };

        globalThis.addEventListener('message', onMessage);
        globalThis.addEventListener('pagehide', onPageHide);
        handshakeTimer = globalThis.setTimeout(
          () => done(reject, fail('DRIVE_BRIDGE_HANDSHAKE_TIMEOUT')), HANDSHAKE_MS);
        frame.src = deploymentUrl + '?bridge=1&channel=' + encodeURIComponent(channel);
        globalThis.document.body.appendChild(frame);
      });
    };
    return Object.freeze(bridgeCall);
  }

  globalThis.DriveRelayBridge = Object.freeze({ create });
})();

(function (global) {
  'use strict';

  const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function formatUuidV4(bytes) {
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  function createUuidV4(cryptoApi) {
    if (!cryptoApi) throw new Error('SECURE_WORK_ORDER_REF_UNAVAILABLE');

    if (typeof cryptoApi.randomUUID === 'function') {
      const uuid = cryptoApi.randomUUID();
      if (!UUID_V4_PATTERN.test(uuid)) throw new Error('SECURE_WORK_ORDER_REF_INVALID');
      return uuid.toLowerCase();
    }

    if (typeof cryptoApi.getRandomValues !== 'function') {
      throw new Error('SECURE_WORK_ORDER_REF_UNAVAILABLE');
    }

    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return formatUuidV4(bytes);
  }

  function generateWorkOrderRef(cryptoApi = global.crypto) {
    return `dwo:${createUuidV4(cryptoApi)}`;
  }

  global.generateWorkOrderRef = generateWorkOrderRef;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateWorkOrderRef };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);

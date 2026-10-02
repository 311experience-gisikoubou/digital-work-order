// ============================================================
// Phase 2 Stage 3: per-order visualSnapshot freeze
// ============================================================
(function initVisualSnapshot() {
  const VISUAL_SNAPSHOT_SCHEMA_VERSION = 'dwo-visual-snapshot-v1';
  const TOOTH_BASE_STATES = ['normal', 'missing', 'abutment'];
  // Canonical FDI numbering shared with app/tooth-state.js and tooth-chart.js.
  // This enumerates valid tooth IDs only; it does not redefine tooth geometry.
  const CANONICAL_FDI_IDS = [
    18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
    48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38
  ];
  const CANONICAL_FDI_KEYS = CANONICAL_FDI_IDS.map(String);
  const VISUAL_SNAPSHOT_TOP_KEYS = ['claspState', 'coordinates', 'drawing', 'schemaVersion', 'selectedTeeth', 'teeth'];

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function sameKeySet(actualKeys, expectedKeys) {
    const a = [...actualKeys].sort();
    const b = [...expectedKeys].sort();
    return a.length === b.length && a.every((key, index) => key === b[index]);
  }

  // Generic JSON-safe check: rejects functions, undefined, symbols, bigint,
  // non-finite numbers, and circular references. Used for structures whose
  // internal business shape (clasp/stroke) is owned by other protected files.
  function isJsonSafeValue(value, seen) {
    if (value === null) return true;
    const type = typeof value;
    if (type === 'string' || type === 'boolean') return true;
    if (type === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) {
      if (seen.has(value)) return false;
      seen.add(value);
      return value.every(item => isJsonSafeValue(item, seen));
    }
    if (isPlainObject(value)) {
      if (seen.has(value)) return false;
      seen.add(value);
      return Object.keys(value).every(key => isJsonSafeValue(value[key], seen));
    }
    return false;
  }

  function isJsonSafePlainObject(value) {
    return isPlainObject(value) && isJsonSafeValue(value, new WeakSet());
  }

  function isJsonSafeArray(value) {
    return Array.isArray(value) && isJsonSafeValue(value, new WeakSet());
  }

  // JSON-safe deep clone. Throws on any non-JSON-safe input instead of
  // silently coercing it, so a corrupted global state fails the freeze.
  function jsonSafeDeepClone(value) {
    function walk(input, seen) {
      if (input === null) return null;
      const type = typeof input;
      if (type === 'number') {
        if (!Number.isFinite(input)) throw new Error('VISUAL_SNAPSHOT_NON_FINITE');
        return input;
      }
      if (type === 'string' || type === 'boolean') return input;
      if (Array.isArray(input)) {
        if (seen.has(input)) throw new Error('VISUAL_SNAPSHOT_CIRCULAR');
        seen.add(input);
        return input.map(item => walk(item, seen));
      }
      if (isPlainObject(input)) {
        if (seen.has(input)) throw new Error('VISUAL_SNAPSHOT_CIRCULAR');
        seen.add(input);
        const out = {};
        Object.keys(input).forEach(key => { out[key] = walk(input[key], seen); });
        return out;
      }
      throw new Error('VISUAL_SNAPSHOT_NOT_JSON_SAFE');
    }
    return walk(value, new WeakSet());
  }

  function isValidTeethSnapshot(teeth) {
    if (!isPlainObject(teeth)) return false;
    const keys = Object.keys(teeth);
    if (!sameKeySet(keys, CANONICAL_FDI_KEYS)) return false;
    return keys.every(key => {
      const entry = teeth[key];
      if (!isPlainObject(entry)) return false;
      const entryKeys = Object.keys(entry).sort();
      if (entryKeys.length !== 2 || entryKeys[0] !== 'baseState' || entryKeys[1] !== 'caution') return false;
      return TOOTH_BASE_STATES.includes(entry.baseState) && typeof entry.caution === 'boolean';
    });
  }

  function deriveSelectedTeethFromTeeth(teeth) {
    return Object.keys(teeth)
      .filter(key => teeth[key].baseState === 'missing')
      .map(Number)
      .sort((a, b) => a - b);
  }

  function isValidSelectedTeeth(selectedTeeth, teeth) {
    if (!Array.isArray(selectedTeeth)) return false;
    if (!selectedTeeth.every(value => Number.isInteger(value))) return false;
    if (new Set(selectedTeeth).size !== selectedTeeth.length) return false;
    const sorted = [...selectedTeeth].sort((a, b) => a - b);
    if (!sorted.every((value, index) => value === selectedTeeth[index])) return false;

    const expected = deriveSelectedTeethFromTeeth(teeth);
    return expected.length === selectedTeeth.length &&
      expected.every((value, index) => value === selectedTeeth[index]);
  }

  function isValidDrawing(drawing) {
    if (!isPlainObject(drawing)) return false;
    if (!sameKeySet(Object.keys(drawing), ['memoStrokes', 'strokes'])) return false;
    return isJsonSafeArray(drawing.strokes) && isJsonSafeArray(drawing.memoStrokes);
  }

  function isValidCoordinates(coordinates) {
    if (!isPlainObject(coordinates)) return false;
    const keys = Object.keys(coordinates);
    if (!sameKeySet(keys, CANONICAL_FDI_KEYS)) return false;
    return keys.every(key => {
      const entry = coordinates[key];
      if (!isPlainObject(entry)) return false;
      if (!sameKeySet(Object.keys(entry), ['cx', 'cy', 'rx', 'ry'])) return false;
      return ['cx', 'cy', 'rx', 'ry'].every(field => isFiniteNumber(entry[field]));
    });
  }

  function isValidVisualSnapshot(snapshot) {
    if (!isPlainObject(snapshot)) return false;
    if (!sameKeySet(Object.keys(snapshot), VISUAL_SNAPSHOT_TOP_KEYS)) return false;
    if (snapshot.schemaVersion !== VISUAL_SNAPSHOT_SCHEMA_VERSION) return false;
    if (!isValidTeethSnapshot(snapshot.teeth)) return false;
    if (!isValidSelectedTeeth(snapshot.selectedTeeth, snapshot.teeth)) return false;
    if (!isJsonSafePlainObject(snapshot.claspState)) return false;
    if (!isValidDrawing(snapshot.drawing)) return false;
    if (!isValidCoordinates(snapshot.coordinates)) return false;
    return true;
  }

  function buildCoordinatesSnapshot(sourceCoords) {
    if (!isPlainObject(sourceCoords)) throw new Error('VISUAL_SNAPSHOT_COORDS_UNAVAILABLE');
    const sourceKeys = Object.keys(sourceCoords);
    if (!sameKeySet(sourceKeys, CANONICAL_FDI_KEYS)) throw new Error('VISUAL_SNAPSHOT_COORDS_KEY_MISMATCH');

    const coordinates = {};
    CANONICAL_FDI_KEYS.forEach(key => {
      const entry = sourceCoords[key];
      if (!isPlainObject(entry)) throw new Error('VISUAL_SNAPSHOT_COORD_MISSING');
      const { cx, cy, rx, ry } = entry;
      if (![cx, cy, rx, ry].every(isFiniteNumber)) throw new Error('VISUAL_SNAPSHOT_COORD_INVALID');
      coordinates[key] = { cx, cy, rx, ry };
    });
    return coordinates;
  }

  function freezeVisualSnapshot() {
    try {
      if (typeof getToothStateSnapshot !== 'function') throw new Error('VISUAL_SNAPSHOT_TOOTH_FN_MISSING');
      const rawTeeth = getToothStateSnapshot();
      const teeth = jsonSafeDeepClone(rawTeeth);
      if (!isValidTeethSnapshot(teeth)) throw new Error('VISUAL_SNAPSHOT_TEETH_INVALID');

      const selectedTeeth = deriveSelectedTeethFromTeeth(teeth);

      if (typeof claspState === 'undefined' || !isPlainObject(claspState)) {
        throw new Error('VISUAL_SNAPSHOT_CLASP_STATE_UNAVAILABLE');
      }
      const claspStateCopy = jsonSafeDeepClone(claspState);
      if (!isJsonSafePlainObject(claspStateCopy)) throw new Error('VISUAL_SNAPSHOT_CLASP_STATE_INVALID');

      if (typeof drawStrokes === 'undefined' || !Array.isArray(drawStrokes)) {
        throw new Error('VISUAL_SNAPSHOT_DRAW_STROKES_UNAVAILABLE');
      }
      if (typeof memoStrokes === 'undefined' || !Array.isArray(memoStrokes)) {
        throw new Error('VISUAL_SNAPSHOT_MEMO_STROKES_UNAVAILABLE');
      }
      const strokesCopy = jsonSafeDeepClone(drawStrokes);
      const memoStrokesCopy = jsonSafeDeepClone(memoStrokes);
      if (!isJsonSafeArray(strokesCopy) || !isJsonSafeArray(memoStrokesCopy)) {
        throw new Error('VISUAL_SNAPSHOT_DRAWING_INVALID');
      }

      if (typeof coords === 'undefined') throw new Error('VISUAL_SNAPSHOT_COORDS_UNAVAILABLE');
      const coordsCopy = jsonSafeDeepClone(coords);
      const coordinates = buildCoordinatesSnapshot(coordsCopy);

      const snapshot = {
        schemaVersion: VISUAL_SNAPSHOT_SCHEMA_VERSION,
        teeth,
        selectedTeeth,
        claspState: claspStateCopy,
        drawing: { strokes: strokesCopy, memoStrokes: memoStrokesCopy },
        coordinates
      };

      if (!isValidVisualSnapshot(snapshot)) throw new Error('VISUAL_SNAPSHOT_SELF_CHECK_FAILED');
      return snapshot;
    } catch (_) {
      return null;
    }
  }

  window.freezeVisualSnapshot = freezeVisualSnapshot;
  window.isValidVisualSnapshot = isValidVisualSnapshot;
})();

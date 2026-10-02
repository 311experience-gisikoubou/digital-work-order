// ============================================================
// Phase 2 Stage 2: canonical tooth state
// ============================================================
(function initCanonicalToothState() {
  const TOOTH_BASE_STATES = ['normal', 'missing', 'abutment'];
  const UPPER_DENTURE_TEETH = [17,16,15,14,13,12,11,21,22,23,24,25,26,27];
  const LOWER_DENTURE_TEETH = [47,46,45,44,43,42,41,31,32,33,34,35,36,37];

  function getAllToothIds() {
    return upperTeeth.concat(lowerTeeth).map(tooth => tooth.num);
  }

  function defaultToothState() {
    return { baseState: 'normal', caution: false };
  }

  function normalizeLegacyToothState(value) {
    if (value === 'missing') return { baseState: 'missing', caution: false };
    if (value === 'caution') return { baseState: 'normal', caution: true };
    if (value && typeof value === 'object' && !Array.isArray(value)
        && TOOTH_BASE_STATES.includes(value.baseState)
        && typeof value.caution === 'boolean') {
      return { baseState: value.baseState, caution: value.caution };
    }
    return defaultToothState();
  }

  function applyModeToTooth(num, mode) {
    const current = toothState[num];
    if (!current || typeof current !== 'object') return false;

    if (mode === 'missing') {
      current.baseState = current.baseState === 'missing' ? 'normal' : 'missing';
    } else if (mode === 'abutment') {
      current.baseState = current.baseState === 'abutment' ? 'normal' : 'abutment';
    } else if (mode === 'caution') {
      current.caution = !current.caution;
    } else if (mode === 'clear') {
      current.baseState = 'normal';
      current.caution = false;
    } else {
      return false;
    }
    return true;
  }

  function ensureCautionMarker(num) {
    if (document.getElementById('caution-' + num)) return;
    const group = document.getElementById('g-' + num);
    const coord = coords[num];
    if (!group || !coord) return;

    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    mark.setAttribute('x', coord.cx + coord.rx * 0.6);
    mark.setAttribute('y', coord.cy - coord.ry * 0.6);
    mark.setAttribute('class', 'tooth-caution-mark');
    mark.id = 'caution-' + num;
    mark.textContent = '!';
    group.appendChild(mark);
  }

  function renderToothVisual(num) {
    const current = toothState[num];
    if (!current) return;

    const tooth = document.getElementById('tooth-' + num);
    const stamp = document.getElementById('stamp-' + num);
    const caution = document.getElementById('caution-' + num);
    const isEdit = currentMode === 'edit';

    if (tooth) {
      let className = 'tooth-el';
      if (isEdit) className += ' edit-mode';
      if (current.baseState === 'missing') className += ' missing';
      if (current.baseState === 'abutment') className += ' abutment';
      if (current.caution) className += ' caution';
      tooth.setAttribute('class', className);
    }

    if (stamp) {
      if (current.baseState === 'missing') {
        stamp.setAttribute('class', 'tooth-stamp show missing');
        stamp.textContent = '✕';
      } else if (current.baseState === 'abutment') {
        stamp.setAttribute('class', 'tooth-stamp show abutment');
        stamp.textContent = '支';
      } else {
        stamp.setAttribute('class', 'tooth-stamp');
        stamp.textContent = '';
      }
    }

    if (caution) {
      caution.setAttribute(
        'class',
        current.caution ? 'tooth-caution-mark show' : 'tooth-caution-mark'
      );
    }

    const numeric = document.querySelector('.tooth[data-num="' + num + '"]');
    if (numeric && numeric.classList) {
      numeric.classList.toggle('selected', current.baseState === 'missing');
      numeric.classList.toggle('abutment', current.baseState === 'abutment');
      numeric.classList.toggle('caution', current.caution);
    }
  }

  function renderAllToothVisuals() {
    getAllToothIds().forEach(renderToothVisual);
  }

  function syncSelectedTeethFromState() {
    state.selectedTeeth.clear();
    getAllToothIds().forEach(num => {
      if (toothState[num].baseState === 'missing') state.selectedTeeth.add(num);
    });
    updateTeethDisplay();
  }

  function updateCanonicalResults() {
    const groups = { missing: [], abutment: [], caution: [] };
    getAllToothIds().forEach(num => {
      const current = toothState[num];
      if (current.baseState === 'missing') groups.missing.push(num);
      if (current.baseState === 'abutment') groups.abutment.push(num);
      if (current.caution) groups.caution.push(num);
    });

    function format(values) {
      values.sort((a, b) => a - b);
      return values.length ? values.join('、') : '<span class="re">—</span>';
    }

    const missing = document.getElementById('r-missing');
    const abutment = document.getElementById('r-abutment');
    const caution = document.getElementById('r-caution');
    if (missing) missing.innerHTML = format(groups.missing);
    if (abutment) abutment.innerHTML = format(groups.abutment);
    if (caution) caution.innerHTML = format(groups.caution);
  }

  function refreshCanonicalToothState() {
    renderAllToothVisuals();
    syncSelectedTeethFromState();
    updateCanonicalResults();
  }

  function handleCanonicalNumericToothClick(num) {
    if (currentMode === 'edit') return;
    if (!applyModeToTooth(num, currentMode)) return;
    refreshCanonicalToothState();
  }

  function handleCanonicalSvgToothClick(num) {
    if (drawMode || currentMode === 'edit' || drag.moved) return;
    if (claspMode) {
      applyClaspToTooth(num);
      return;
    }
    if (activeClaspUid) {
      activeClaspUid = null;
      renderAllClasps();
    }
    if (!applyModeToTooth(num, currentMode)) return;
    refreshCanonicalToothState();
  }

  function setTeethMissing(teeth) {
    teeth.forEach(num => {
      if (toothState[num]) toothState[num].baseState = 'missing';
    });
    refreshCanonicalToothState();
  }

  function getToothStateSnapshot() {
    const snapshot = {};
    getAllToothIds().forEach(num => {
      const current = toothState[num] || defaultToothState();
      snapshot[String(num)] = {
        baseState: current.baseState,
        caution: Boolean(current.caution)
      };
    });
    return snapshot;
  }

  function isValidToothStateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
    const ids = getAllToothIds().map(String);
    const keys = Object.keys(snapshot);
    if (keys.length !== ids.length) return false;
    if (ids.some(id => !Object.prototype.hasOwnProperty.call(snapshot, id))) return false;

    return keys.every(key => {
      if (!ids.includes(key)) return false;
      const entry = snapshot[key];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      const entryKeys = Object.keys(entry).sort();
      if (entryKeys.length !== 2 || entryKeys[0] !== 'baseState' || entryKeys[1] !== 'caution') {
        return false;
      }
      return TOOTH_BASE_STATES.includes(entry.baseState) && typeof entry.caution === 'boolean';
    });
  }

  function restoreToothStateSnapshot(snapshot) {
    if (!isValidToothStateSnapshot(snapshot)) return false;

    getAllToothIds().forEach(num => {
      const entry = snapshot[String(num)];
      toothState[num] = { baseState: entry.baseState, caution: entry.caution };
    });
    refreshCanonicalToothState();
    return true;
  }

  function resetCanonicalToothState() {
    getAllToothIds().forEach(num => {
      toothState[num] = defaultToothState();
    });
    refreshCanonicalToothState();
  }

  function updateCautionMarkerPosition() {
    if (!drag || !drag.active || !drag.num) return;
    const num = drag.num;
    const coord = coords[num];
    const caution = document.getElementById('caution-' + num);
    if (!coord || !caution) return;
    caution.setAttribute('x', coord.cx + coord.rx * 0.6);
    caution.setAttribute('y', coord.cy - coord.ry * 0.6);
  }

  function initializeCanonicalState() {
    getAllToothIds().forEach(num => {
      toothState[num] = normalizeLegacyToothState(toothState[num]);
      ensureCautionMarker(num);
    });
    refreshCanonicalToothState();
  }

  // Replace only runtime tooth-state behavior; approved SVG geometry remains in tooth-chart.js.
  toggleTooth = handleCanonicalNumericToothClick;
  clickTooth = handleCanonicalSvgToothClick;
  updateResults = updateCanonicalResults;
  resetAll = resetCanonicalToothState;
  selectUpperDenture = function selectUpperDentureCanonical() {
    setTeethMissing(UPPER_DENTURE_TEETH);
  };
  selectLowerDenture = function selectLowerDentureCanonical() {
    setTeethMissing(LOWER_DENTURE_TEETH);
  };

  syncToothChart = function syncToothChartCanonical(num, isSelected) {
    if (!toothState[num]) return;
    if (isSelected) toothState[num].baseState = 'missing';
    else if (toothState[num].baseState === 'missing') toothState[num].baseState = 'normal';
    refreshCanonicalToothState();
  };

  syncToShijiChart = function syncToShijiChartCanonical(num, isSelected) {
    syncToothChart(num, isSelected);
  };

  window.getToothStateSnapshot = getToothStateSnapshot;
  window.restoreToothStateSnapshot = restoreToothStateSnapshot;

  // Existing mode handlers run first; this final listener redraws from the canonical state.
  document.querySelectorAll('.mode-btn[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      renderAllToothVisuals();
      updateCanonicalResults();
    });
  });

  // Existing 7-7 helpers also carry .mode-btn. Preserve the prior editing mode after their old handler runs.
  document.querySelectorAll('.mode-btn:not([data-mode])').forEach(button => {
    let previousMode = 'missing';
    button.addEventListener('click', () => {
      previousMode = currentMode || 'missing';
    }, true);
    button.addEventListener('click', () => {
      currentMode = previousMode;
      button.classList.remove('active');
      document.querySelectorAll('.mode-btn[data-mode]').forEach(modeButton => {
        modeButton.classList.toggle('active', modeButton.dataset.mode === currentMode);
      });
      renderAllToothVisuals();
    });
  });

  const svg = document.getElementById('toothSvg');
  if (svg) {
    svg.addEventListener('mousemove', updateCautionMarkerPosition);
    svg.addEventListener('touchmove', updateCautionMarkerPosition, { passive: true });
  }

  initializeCanonicalState();
})();

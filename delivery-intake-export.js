// ============================================================
//  納品アプリ連携 JSON（Stage 2-B）
// ============================================================
(function(global) {
  'use strict';

  const SCHEMA_VERSION = 'digital-work-order-intake-v1';
  const SOURCE_SYSTEM = 'digital-work-order';
  const MAX_PAYLOAD_BYTES = 256 * 1024;
  const MAX_DISPLAY_NAME_CHARS = 200;
  const MAX_INSTRUCTION_VALUES = 32;
  const MAX_INSTRUCTION_VALUE_CHARS = 2000;
  const STABLE_REF_RE = /^dwo:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

  function fail(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function charCount(value) {
    return Array.from(value).length;
  }
  function isValidDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parts = value.split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0]
      && date.getUTCMonth() === parts[1] - 1
      && date.getUTCDate() === parts[2];
  }

  function isValidRfc3339(value) {
    return typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      && !Number.isNaN(Date.parse(value));
  }

  function validateDisplayName(value, optional) {
    if (optional && (value == null || String(value).trim() === '')) return null;
    if (typeof value !== 'string') fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');
    if (value.trim() !== value || value === '' || charCount(value) > MAX_DISPLAY_NAME_CHARS) {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');
    }
    if (Array.from(value).some(ch => /[\u0000-\u001f\u007f]/.test(ch))) {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');
    }
    return value;
  }

  function normalizeInstructionValues(values) {
    const normalized = [];
    (Array.isArray(values) ? values : [values]).forEach(value => {
      if (value == null || value === false) return;
      const text = String(value).trim();
      if (!text) return;
      if (charCount(text) > MAX_INSTRUCTION_VALUE_CHARS) {
        fail('DELIVERY_INTAKE_EXPORT_INVALID_INSTRUCTIONS');
      }
      if (Array.from(text).some(ch => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(ch))) {
        fail('DELIVERY_INTAKE_EXPORT_INVALID_INSTRUCTIONS');
      }
      normalized.push(text);
    });
    if (normalized.length > MAX_INSTRUCTION_VALUES) {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_INSTRUCTIONS');
    }
    return normalized;
  }

  function addInstruction(fields, code, values) {
    const normalized = normalizeInstructionValues(values);
    if (normalized.length > 0) fields.push({ code, values: normalized });
  }

  function buildSourceInstructions(order) {
    const fields = [];
    addInstruction(fields, 'order_type', order.orderTypes);
    addInstruction(fields, 'repair_detail', order.repairDetail);
    addInstruction(fields, 'bed_type', order.bedType);
    addInstruction(fields, 'device', order.devices);
    addInstruction(fields, 'clasp_type', order.claspType);
    addInstruction(fields, 'bar_type', order.barType);

    const castBarValues = [];
    const castBarCounts = order.castBarCounts || {};
    if (Number(castBarCounts.upper) > 0) castBarValues.push(`upper=${Number(castBarCounts.upper)}`);
    if (Number(castBarCounts.lower) > 0) castBarValues.push(`lower=${Number(castBarCounts.lower)}`);
    addInstruction(fields, 'cast_bar_count', castBarValues);

    if (Number(order.reinforcementWireCount) > 0) {
      addInstruction(fields, 'reinforcement_wire_count', String(Number(order.reinforcementWireCount)));
    }

    const rimountValues = [];
    if (order.rimountJaws?.upper) rimountValues.push('upper');
    if (order.rimountJaws?.lower) rimountValues.push('lower');
    if (Number(order.rimountCount) > 0) rimountValues.push(`count=${Number(order.rimountCount)}`);
    if (order.hasRimount && rimountValues.length === 0) rimountValues.push('enabled');
    addInstruction(fields, 'rimount', rimountValues);

    if (order.hasMetalup) addInstruction(fields, 'metalup', order.metalupDetail || 'enabled');
    if (order.hasKyoko) addInstruction(fields, 'reinforced_base', order.kyokoDetail || 'enabled');

    const artificialToothValues = [];
    if (order.toothAnterior) artificialToothValues.push(`anterior=${order.toothAnterior}`);
    if (order.toothPosterior) artificialToothValues.push(`posterior=${order.toothPosterior}`);
    addInstruction(fields, 'artificial_tooth', artificialToothValues);

    const shadeValues = [];
    if (order.shadeGuide) shadeValues.push(`guide=${order.shadeGuide}`);
    if (order.shadeNumber) shadeValues.push(`number=${order.shadeNumber}`);
    addInstruction(fields, 'shade', shadeValues);

    if (order.taigoha) addInstruction(fields, 'opposing_tooth', 'enabled');
    if (order.bite) addInstruction(fields, 'bite', 'enabled');
    if (order.goaFlag) addInstruction(fields, 'goa', 'enabled');

    if (order.hasArticulator) {
      const articulatorValues = [];
      if (order.articulatorType) articulatorValues.push(order.articulatorType);
      if (order.articulatorDetail) articulatorValues.push(order.articulatorDetail);
      addInstruction(fields, 'articulator', articulatorValues.length ? articulatorValues : 'enabled');
    }
    addInstruction(fields, 'remarks', order.remarks);
    return fields;
  }

  function buildDigitalWorkOrderIntake(order) {
    if (!order || typeof order !== 'object') fail('DELIVERY_INTAKE_EXPORT_INVALID_ORDER');
    const refMatch = typeof order.workOrderRef === 'string' ? order.workOrderRef.match(STABLE_REF_RE) : null;
    if (!refMatch) fail('DELIVERY_INTAKE_EXPORT_INVALID_REF');
    if (!isValidDate(order.issueDate) || !isValidRfc3339(order.createdAt)) {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');
    }
    if (order.insuranceType !== 'insurance' && order.insuranceType !== 'jishi') {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');
    }

    const teeth = Array.isArray(order.selectedTeeth) ? order.selectedTeeth.map(value => String(value)) : [];
    if (teeth.length > 64 || new Set(teeth).size !== teeth.length) {
      fail('DELIVERY_INTAKE_EXPORT_INVALID_TEETH');
    }
    teeth.forEach(tooth => {
      if (!tooth || tooth.trim() !== tooth || tooth.length > 8 || !/^[A-Za-z0-9_-]+$/.test(tooth)) {
        fail('DELIVERY_INTAKE_EXPORT_INVALID_TEETH');
      }
    });

    const doctor = typeof order.doctorName === 'string' ? order.doctorName.trim() : '';
    const dueDate = order.deliveryDate ? order.deliveryDate : null;
    if (dueDate !== null && !isValidDate(dueDate)) fail('DELIVERY_INTAKE_EXPORT_INVALID_METADATA');

    return {
      schemaVersion: SCHEMA_VERSION,
      sourceSystem: SOURCE_SYSTEM,
      workOrderRef: order.workOrderRef,
      sourceIssueDate: order.issueDate,
      sourceCreatedAt: order.createdAt,
      clinicDisplayName: validateDisplayName(order.clinicName, false),
      doctorDisplayName: validateDisplayName(doctor, true),
      patientDisplayName: validateDisplayName(order.patientName, false),
      dueDate,
      sourceClassification: order.insuranceType,
      sourceTeeth: teeth,
      sourceInstructions: buildSourceInstructions(order)
    };
  }

  function buildDeliveryIntakeFilename(workOrderRef) {
    const match = typeof workOrderRef === 'string' ? workOrderRef.match(STABLE_REF_RE) : null;
    if (!match) fail('DELIVERY_INTAKE_EXPORT_INVALID_REF');
    return `dwo_${match[1].toLowerCase()}.json`;
  }

  function downloadDeliveryIntakeJson(order, env = global) {
    const payload = buildDigitalWorkOrderIntake(order);
    const filename = buildDeliveryIntakeFilename(payload.workOrderRef);
    if (!env.Blob || !env.URL?.createObjectURL || !env.document?.createElement || !env.document?.body) {
      fail('DELIVERY_INTAKE_EXPORT_UNAVAILABLE');
    }

    const json = JSON.stringify(payload, null, 2);
    const blob = new env.Blob([json], { type: 'application/json;charset=utf-8' });
    if (blob.size > MAX_PAYLOAD_BYTES) fail('DELIVERY_INTAKE_EXPORT_TOO_LARGE');

    const url = env.URL.createObjectURL(blob);
    const anchor = env.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    env.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    const delay = typeof env.setTimeout === 'function' ? env.setTimeout.bind(env) : setTimeout;
    delay(() => env.URL.revokeObjectURL(url), 1000);
    return { payload, filename };
  }

  global.buildDigitalWorkOrderIntake = buildDigitalWorkOrderIntake;
  global.buildDeliveryIntakeFilename = buildDeliveryIntakeFilename;
  global.downloadDeliveryIntakeJson = downloadDeliveryIntakeJson;
})(globalThis);

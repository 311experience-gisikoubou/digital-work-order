// Thin ESM bridge that reuses the existing, unmodified delivery-intake-export.js
// contract (digital-work-order-intake-v1) inside the Node.js Gateway viewer.
// delivery-intake-export.js is a browser-style UMD script that attaches its API
// to `globalThis`; requiring it once here makes the same validated builder and
// filename convention available to the viewer, so Phase 8 does not invent a
// second schema for handoff to dental-delivery-billing.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../delivery-intake-export.js');

export const buildDigitalWorkOrderIntake = globalThis.buildDigitalWorkOrderIntake;
export const buildDeliveryIntakeFilename = globalThis.buildDeliveryIntakeFilename;

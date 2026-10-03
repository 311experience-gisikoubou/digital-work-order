import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { Storage } from '@google-cloud/storage';
import { completeRelayJob, createRelayJob, relayError } from './relay-core.mjs';

if (getApps().length === 0) initializeApp();

const REGION = 'asia-northeast1';
const DEFAULT_ALLOWED_ORIGIN = 'https://311experience-gisikoubou.github.io';
const REGISTRY_COLLECTION = 'relaySenderRegistry';
const JOB_COLLECTION = 'relayJobs';

function runtimeError(code, detail) {
  return relayError(code, detail);
}

function allowedOrigin() {
  const value = process.env.DWO_RELAY_ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
  if (!/^https:\/\/[^\s/]+(?:\.[^\s/]+)+$/.test(value)) throw runtimeError('RELAY_RUNTIME_CONFIG_INVALID', 'origin');
  return value;
}

function bucketName() {
  const value = process.env.DWO_RELAY_BUCKET;
  if (!value || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value)) {
    throw runtimeError('RELAY_RUNTIME_CONFIG_MISSING', 'DWO_RELAY_BUCKET');
  }
  return value;
}

function applyCors(req, res) {
  const origin = req.get('origin');
  const allowed = allowedOrigin();
  if (origin && origin !== allowed) return false;
  if (origin === allowed) {
    res.set('Access-Control-Allow-Origin', allowed);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  return true;
}

function sendError(res, error) {
  const code = error && typeof error.code === 'string' ? error.code : 'RELAY_INTERNAL_ERROR';
  const clientCodes = new Set([
    'RELAY_INVALID_REQUEST', 'RELAY_INVALID_PLAN', 'RELAY_PLAN_DESCRIPTOR_MISMATCH',
    'RELAY_SIZE_LIMIT', 'RELAY_INVALID_AUTHORIZATION', 'RELAY_AUTHORIZATION_MISMATCH',
    'RELAY_AUTHORIZATION_EXPIRED', 'RELAY_DESCRIPTOR_HASH_MISMATCH',
    'RELAY_INVALID_ENVELOPE_SIGNATURE', 'RELAY_INVALID_AUTHORIZATION_SIGNATURE',
    'RELAY_SENDER_UNKNOWN', 'RELAY_SENDER_REVOKED', 'RELAY_SENDER_MISMATCH',
    'RELAY_INVALID_REGISTRY', 'RELAY_IDEMPOTENCY_CONFLICT',
    'RELAY_INVALID_COMPLETE_REQUEST', 'RELAY_JOB_NOT_FOUND', 'RELAY_JOB_STATE_INVALID',
    'RELAY_CAPABILITY_INVALID', 'RELAY_OBJECT_INCOMPLETE', 'RELAY_OBJECT_METADATA_MISMATCH'
  ]);
  const status = clientCodes.has(code) ? 400 : 500;
  res.status(status).json({ error: code });
}

function firestoreAdapters(db) {
  return {
    registryStore: {
      async getSender(clinicDeviceId) {
        if (typeof clinicDeviceId !== 'string') return null;
        const snapshot = await db.collection(REGISTRY_COLLECTION).doc(clinicDeviceId).get();
        return snapshot.exists ? snapshot.data() : null;
      }
    },
    jobStore: {
      async reserve(jobId, baseRecord) {
        const ref = db.collection(JOB_COLLECTION).doc(jobId);
        return db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref);
          if (snapshot.exists) return { created: false, record: snapshot.data() };
          transaction.create(ref, baseRecord);
          return { created: true, record: baseRecord };
        });
      },
      async get(jobId) {
        const snapshot = await db.collection(JOB_COLLECTION).doc(jobId).get();
        return snapshot.exists ? snapshot.data() : null;
      },
      async setUploads(jobId, uploads, capabilityHash) {
        const ref = db.collection(JOB_COLLECTION).doc(jobId);
        return db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) throw runtimeError('RELAY_JOB_NOT_FOUND');
          const data = snapshot.data();
          const storedUploads = Array.isArray(data.uploads) && data.uploads.length > 0 ? data.uploads : uploads;
          const hashes = Array.isArray(data.capabilityHashes) ? data.capabilityHashes.slice() : [];
          if (!hashes.includes(capabilityHash)) hashes.push(capabilityHash);
          const boundedHashes = hashes.slice(-4);
          transaction.update(ref, {
            uploads: storedUploads,
            capabilityHashes: boundedHashes,
            updatedAt: Date.now()
          });
          return { uploads: storedUploads };
        });
      },
      async markReady(jobId, detail) {
        const update = {
          status: 'ready',
          readyAt: detail.readyAt,
          updatedAt: detail.readyAt
        };
        if (detail.clearUploads) update.uploads = FieldValue.delete();
        if (detail.clearCapabilities) update.capabilityHashes = FieldValue.delete();
        await db.collection(JOB_COLLECTION).doc(jobId).update(update);
      }
    }
  };
}

function storageAdapter(storage, name, origin) {
  const bucket = storage.bucket(name);
  return {
    async createResumableUpload(spec) {
      const file = bucket.file(spec.objectName);
      const [uri] = await file.createResumableUpload({
        origin,
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/octet-stream',
          cacheControl: 'no-store',
          metadata: spec.metadata
        }
      });
      return uri;
    },
    async statObject(objectName) {
      const file = bucket.file(objectName);
      try {
        const [metadata] = await file.getMetadata();
        return {
          exists: true,
          size: Number(metadata.size),
          metadata: metadata.metadata || {}
        };
      } catch (error) {
        if (error && Number(error.code) === 404) return { exists: false, size: 0, metadata: {} };
        throw error;
      }
    }
  };
}

function buildDeps() {
  const db = getFirestore();
  const storage = new Storage();
  return Object.assign(firestoreAdapters(db), {
    storage: storageAdapter(storage, bucketName(), allowedOrigin())
  });
}

function parseCompletePath(pathname) {
  const match = /^\/v1\/jobs\/(job_[A-Za-z0-9_-]+)\/complete$/.exec(pathname);
  return match ? match[1] : null;
}

async function handleRequest(req, res) {
  if (!applyCors(req, res)) {
    res.status(403).json({ error: 'RELAY_ORIGIN_FORBIDDEN' });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'RELAY_METHOD_NOT_ALLOWED' });
    return;
  }

  const deps = buildDeps();
  try {
    if (req.path === '/v1/jobs') {
      const result = await createRelayJob(req.body, deps);
      res.status(200).json(result);
      return;
    }
    const jobId = parseCompletePath(req.path);
    if (jobId) {
      const body = req.body;
      if (!body || body.version !== 'dwo-relay-v1' || typeof body.uploadCapability !== 'string') {
        throw runtimeError('RELAY_INVALID_COMPLETE_REQUEST');
      }
      const result = await completeRelayJob(jobId, body.uploadCapability, deps);
      res.status(200).json(result);
      return;
    }
    res.status(404).json({ error: 'RELAY_ROUTE_NOT_FOUND' });
  } catch (error) {
    sendError(res, error);
  }
}

export const relay = onRequest({
  region: REGION,
  cors: false,
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 3
}, handleRequest);

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMongoActive } from './storageService.js';
import { CctvCatalogOverride } from './models/CctvCatalogOverride.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/atomicJson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OVERRIDES_PATH = path.resolve(__dirname, '../data/cctv_catalog_overrides.json');

let loadedPath = null;
let overridesVersion = 1;
const overrideMap = new Map();

export function getCatalogOverridesPath() {
  return process.env.JAKSAFE_CCTV_OVERRIDES_PATH
    ? path.resolve(process.env.JAKSAFE_CCTV_OVERRIDES_PATH)
    : DEFAULT_OVERRIDES_PATH;
}

export function getCatalogOverridesVersion() {
  const currentPath = getCatalogOverridesPath();
  if (loadedPath !== currentPath) {
    loadOverridesFromDiskSync();
  }
  return overridesVersion;
}

function normalizeRecord(raw) {
  if (!raw || typeof raw.cameraId !== 'string' || !raw.cameraId.trim()) return null;
  return {
    cameraId: raw.cameraId.trim(),
    isCustom: Boolean(raw.isCustom),
    enabled: raw.enabled !== false,
    deleted: Boolean(raw.deleted),
    patch: raw.patch && typeof raw.patch === 'object' ? { ...raw.patch } : {},
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : null,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
  };
}

function loadOverridesFromDiskSync() {
  const file = getCatalogOverridesPath();
  overrideMap.clear();
  const raw = readJsonFile(file, () => ({ overrides: [] }), { createIfMissing: false });
  const list = Array.isArray(raw?.overrides) ? raw.overrides : [];
  for (const item of list) {
    const norm = normalizeRecord(item);
    if (norm) overrideMap.set(norm.cameraId, norm);
  }
  loadedPath = file;
  overridesVersion += 1;
  return overrideMap;
}

function persistOverridesToDiskSync() {
  const file = getCatalogOverridesPath();
  writeJsonFileAtomic(file, {
    updatedAt: new Date().toISOString(),
    overrides: Array.from(overrideMap.values()),
  });
}

export function resetCatalogOverridesCache() {
  loadedPath = null;
  overrideMap.clear();
  overridesVersion += 1;
}

export function getCatalogOverridesMapSync() {
  const currentPath = getCatalogOverridesPath();
  if (loadedPath !== currentPath) {
    loadOverridesFromDiskSync();
  }
  return overrideMap;
}

/**
 * Sinkronkan seluruh override katalog CCTV dari MongoDB ke cache RAM saat server menyala.
 */
export async function hydrateCatalogOverridesFromMongo() {
  if (!isMongoActive()) {
    getCatalogOverridesMapSync();
    return { hydrated: overrideMap.size, source: 'local' };
  }

  try {
    const docs = await CctvCatalogOverride.find({}).lean();
    overrideMap.clear();
    for (const doc of docs) {
      const norm = normalizeRecord(doc);
      if (norm) overrideMap.set(norm.cameraId, norm);
    }
    loadedPath = getCatalogOverridesPath();
    overridesVersion += 1;
    return { hydrated: overrideMap.size, source: 'mongodb' };
  } catch (err) {
    console.warn('[cctvStore] Gagal memuat override katalog dari MongoDB:', err?.message || err);
    getCatalogOverridesMapSync();
    return { hydrated: overrideMap.size, source: 'local' };
  }
}

export async function upsertCatalogOverride(cameraId, record) {
  const norm = normalizeRecord({ ...record, cameraId });
  if (!norm) {
    throw new Error('ID kamera override tidak valid');
  }

  getCatalogOverridesMapSync();
  overrideMap.set(norm.cameraId, norm);
  overridesVersion += 1;

  if (isMongoActive()) {
    await CctvCatalogOverride.findOneAndUpdate(
      { cameraId: norm.cameraId },
      { $set: norm },
      { upsert: true, new: true, runValidators: true }
    );
  } else {
    persistOverridesToDiskSync();
  }

  return norm;
}

export async function removeCatalogOverride(cameraId) {
  const id = String(cameraId || '').trim();
  if (!id) return false;

  getCatalogOverridesMapSync();
  const existed = overrideMap.delete(id);
  overridesVersion += 1;

  if (isMongoActive()) {
    const res = await CctvCatalogOverride.deleteOne({ cameraId: id });
    return Boolean(res?.deletedCount > 0 || existed);
  }

  if (existed) {
    persistOverridesToDiskSync();
  }
  return existed;
}

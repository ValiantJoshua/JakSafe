import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from './models/User.js';
import { SavedRoute } from './models/SavedRoute.js';
import { TripHistory } from './models/TripHistory.js';
import { readJsonFile, writeJsonFileAtomic } from '../utils/atomicJson.js';

const DEFAULT_LOCAL_STORAGE_PATH = path.resolve(process.cwd(), 'src', 'data', 'jaksafe_local_storage.json');
const MAX_LOCAL_HISTORY_PER_USER = 60;

function getLocalStoragePath() {
  return process.env.JAKSAFE_LOCAL_STORAGE_PATH
    ? path.resolve(process.env.JAKSAFE_LOCAL_STORAGE_PATH)
    : DEFAULT_LOCAL_STORAGE_PATH;
}

/**
 * Cek apakah koneksi MongoDB aktif dan siap menerima operasi database.
 * readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
 */
export function isMongoActive() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

// -------------------------------------------------------------
// MANAJEMEN PENYIMPANAN LOKAL (FALLBACK JIKA MONGODB TIDAK JALAN)
// -------------------------------------------------------------
function readLocalStore() {
  const parsed = readJsonFile(
    getLocalStoragePath(),
    () => ({ users: [], savedRoutes: [], tripHistory: [] })
  );
  return {
    users: Array.isArray(parsed?.users) ? parsed.users : [],
    savedRoutes: Array.isArray(parsed?.savedRoutes) ? parsed.savedRoutes : [],
    tripHistory: Array.isArray(parsed?.tripHistory) ? parsed.tripHistory : [],
  };
}

function writeLocalStore(data) {
  writeJsonFileAtomic(getLocalStoragePath(), data);
}

function sanitizeUser(user) {
  if (!user) return null;
  const doc = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete doc.password;
  doc.role = doc.role === 'admin' ? 'admin' : 'user';
  if (doc._id) {
    doc.id = String(doc._id);
  }
  return doc;
}

// -------------------------------------------------------------
// OPERASI USER
// -------------------------------------------------------------
export async function findUserByEmail(email, { includePassword = false } = {}) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail) return null;

  if (isMongoActive()) {
    const query = User.findOne({ email: normEmail });
    if (!includePassword) query.select('-password');
    const found = await query.exec();
    return found ? (includePassword ? found.toObject() : sanitizeUser(found)) : null;
  }

  const store = readLocalStore();
  const found = store.users.find((u) => u.email === normEmail);
  if (!found) return null;
  return includePassword ? { ...found } : sanitizeUser(found);
}

export async function findUserById(id) {
  if (!id) return null;

  if (isMongoActive()) {
    try {
      const user = await User.findById(id).select('-password').exec();
      return sanitizeUser(user);
    } catch {
      return null;
    }
  }

  const store = readLocalStore();
  const found = store.users.find((u) => u.id === id || u._id === id);
  return sanitizeUser(found);
}

export async function createUser({ name, email, password, role = 'user', healthProfile = {}, alertPreferences = {} }) {
  const normEmail = String(email || '').trim().toLowerCase();
  const safeName = String(name || '').trim();
  const safeRole = role === 'admin' ? 'admin' : 'user';

  const profile = {
    isSensitive: Boolean(healthProfile?.isSensitive),
    conditions: Array.isArray(healthProfile?.conditions) ? healthProfile.conditions : [],
  };
  const alertsPref = {
    enabled: alertPreferences?.enabled !== undefined ? Boolean(alertPreferences.enabled) : true,
    regions: Array.isArray(alertPreferences?.regions) ? alertPreferences.regions : [],
    minSeverity: ['pantau', 'waspada', 'siaga'].includes(alertPreferences?.minSeverity)
      ? alertPreferences.minSeverity
      : 'waspada',
  };

  if (isMongoActive()) {
    const doc = await User.create({
      name: safeName,
      email: normEmail,
      password,
      role: safeRole,
      healthProfile: profile,
      alertPreferences: alertsPref,
    });
    return sanitizeUser(doc);
  }

  const store = readLocalStore();
  const existing = store.users.find((u) => u.email === normEmail);
  if (existing) {
    const err = new Error('Email sudah terdaftar');
    err.code = 11000;
    throw err;
  }

  const generatedId = crypto.randomUUID();
  const newUser = {
    id: generatedId,
    _id: generatedId,
    name: safeName,
    email: normEmail,
    password,
    role: safeRole,
    healthProfile: profile,
    alertPreferences: alertsPref,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.users.push(newUser);
  writeLocalStore(store);
  return sanitizeUser(newUser);
}

/**
 * Perbarui peran pengguna secara eksplisit (hanya untuk admin seeding / konfigurasi server).
 * @param {string} id
 * @param {'user'|'admin'} role
 */
export async function updateUserRole(id, role) {
  if (!id) return null;
  const safeRole = role === 'admin' ? 'admin' : 'user';

  if (isMongoActive()) {
    const updated = await User.findByIdAndUpdate(
      id,
      { $set: { role: safeRole } },
      { new: true, runValidators: true }
    ).select('-password');
    return sanitizeUser(updated);
  }

  const store = readLocalStore();
  const idx = store.users.findIndex((u) => u.id === id || u._id === id);
  if (idx === -1) return null;

  store.users[idx].role = safeRole;
  store.users[idx].updatedAt = new Date().toISOString();
  writeLocalStore(store);
  return sanitizeUser(store.users[idx]);
}

export async function updateUserProfile(id, { name, healthProfile, alertPreferences }) {
  if (!id) return null;

  const normHealth = healthProfile !== undefined
    ? {
      isSensitive: Boolean(healthProfile.isSensitive),
      conditions: Array.isArray(healthProfile.conditions) ? healthProfile.conditions : [],
    }
    : undefined;

  const normAlerts = alertPreferences !== undefined
    ? {
      enabled: alertPreferences.enabled !== undefined ? Boolean(alertPreferences.enabled) : true,
      regions: Array.isArray(alertPreferences.regions) ? alertPreferences.regions : [],
      minSeverity: ['pantau', 'waspada', 'siaga'].includes(alertPreferences.minSeverity)
        ? alertPreferences.minSeverity
        : 'waspada',
    }
    : undefined;

  if (isMongoActive()) {
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (normHealth !== undefined) update.healthProfile = normHealth;
    if (normAlerts !== undefined) update.alertPreferences = normAlerts;
    const updated = await User.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).select('-password');
    return sanitizeUser(updated);
  }

  const store = readLocalStore();
  const idx = store.users.findIndex((u) => u.id === id || u._id === id);
  if (idx === -1) return null;

  if (name !== undefined) store.users[idx].name = String(name).trim();
  if (normHealth !== undefined) store.users[idx].healthProfile = normHealth;
  if (normAlerts !== undefined) store.users[idx].alertPreferences = normAlerts;
  store.users[idx].updatedAt = new Date().toISOString();
  writeLocalStore(store);
  return sanitizeUser(store.users[idx]);
}

// -------------------------------------------------------------
// OPERASI RUTE TERSIMPAN (SAVED ROUTES) & RIWAYAT PERJALANAN
// -------------------------------------------------------------
function normalizeRouteEndpointPayload({
  userId,
  origin,
  destination,
  score,
  distanceM = 0,
  durationS = 0,
  profile = 'car',
}) {
  return {
    userId,
    origin: {
      id: origin?.id || null,
      name: origin?.name || 'Titik Awal',
      area: origin?.area || '',
      lat: Number(origin?.lat) || 0,
      lon: Number(origin?.lon) || 0,
    },
    destination: {
      id: destination?.id || null,
      name: destination?.name || 'Tujuan',
      area: destination?.area || '',
      lat: Number(destination?.lat) || 0,
      lon: Number(destination?.lon) || 0,
    },
    score: {
      totalScore: Number(score?.totalScore ?? score ?? 0),
      label: String(score?.label || 'AMAN'),
      color: String(score?.color || '#16a34a'),
    },
    distanceM: Number(distanceM) || 0,
    durationS: Number(durationS) || 0,
    profile: String(profile || 'car'),
  };
}

export async function getSavedRoutesByUser(userId) {
  if (!userId) return [];

  if (isMongoActive()) {
    const list = await SavedRoute.find({ userId }).sort({ createdAt: -1 }).lean().exec();
    return list.map((r) => ({
      ...r,
      id: String(r._id),
    }));
  }

  const store = readLocalStore();
  return store.savedRoutes
    .filter((r) => String(r.userId) === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function createSavedRoute({
  userId,
  title,
  origin,
  destination,
  score,
  distanceM = 0,
  durationS = 0,
  profile = 'car',
}) {
  if (!userId) throw new Error('userId is required');

  const routeItem = {
    title: title || `${origin?.name || 'Titik Awal'} -> ${destination?.name || 'Tujuan'}`,
    ...normalizeRouteEndpointPayload({ userId, origin, destination, score, distanceM, durationS, profile }),
  };

  if (isMongoActive()) {
    const doc = await SavedRoute.create(routeItem);
    const obj = doc.toObject();
    obj.id = String(obj._id);
    return obj;
  }

  const store = readLocalStore();
  const id = crypto.randomUUID();
  const newRoute = {
    ...routeItem,
    id,
    _id: id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.savedRoutes.unshift(newRoute);
  writeLocalStore(store);
  return newRoute;
}

export async function deleteSavedRoute(routeId, userId) {
  if (!routeId || !userId) return false;

  if (isMongoActive()) {
    const res = await SavedRoute.findOneAndDelete({ _id: routeId, userId });
    return Boolean(res);
  }

  const store = readLocalStore();
  const initLen = store.savedRoutes.length;
  store.savedRoutes = store.savedRoutes.filter(
    (r) => !(String(r.id || r._id) === String(routeId) && String(r.userId) === String(userId))
  );

  const changed = store.savedRoutes.length !== initLen;
  if (changed) {
    writeLocalStore(store);
  }
  return changed;
}

export async function getTripHistoryByUser(userId, { limit = 30 } = {}) {
  if (!userId) return [];
  const cap = Math.max(1, Math.min(Number(limit) || 30, 100));

  if (isMongoActive()) {
    const list = await TripHistory.find({ userId }).sort({ createdAt: -1 }).limit(cap).lean().exec();
    return list.map((entry) => ({
      ...entry,
      id: String(entry._id),
    }));
  }

  const store = readLocalStore();
  return store.tripHistory
    .filter((entry) => String(entry.userId) === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, cap);
}

export async function createTripHistory({
  userId,
  origin,
  destination,
  score,
  distanceM = 0,
  durationS = 0,
  profile = 'car',
  summary = '',
  source = 'preview',
}) {
  if (!userId) throw new Error('userId is required');

  const historyItem = {
    ...normalizeRouteEndpointPayload({ userId, origin, destination, score, distanceM, durationS, profile }),
    summary: String(summary || ''),
    source: String(source || 'preview'),
  };

  if (isMongoActive()) {
    const doc = await TripHistory.create(historyItem);
    const obj = doc.toObject();
    obj.id = String(obj._id);
    return obj;
  }

  const store = readLocalStore();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const entry = {
    ...historyItem,
    id,
    _id: id,
    createdAt: now,
    updatedAt: now,
  };

  store.tripHistory.unshift(entry);
  // Batasi entri riwayat lokal per pengguna agar berkas tetap ringan
  let userCount = 0;
  store.tripHistory = store.tripHistory.filter((item) => {
    if (String(item.userId) !== String(userId)) return true;
    userCount += 1;
    return userCount <= MAX_LOCAL_HISTORY_PER_USER;
  });
  writeLocalStore(store);
  return entry;
}

export async function deleteTripHistory(historyId, userId) {
  if (!historyId || !userId) return false;

  if (isMongoActive()) {
    const res = await TripHistory.findOneAndDelete({ _id: historyId, userId });
    return Boolean(res);
  }

  const store = readLocalStore();
  const initLen = store.tripHistory.length;
  store.tripHistory = store.tripHistory.filter(
    (entry) => !(String(entry.id || entry._id) === String(historyId) && String(entry.userId) === String(userId))
  );

  const changed = store.tripHistory.length !== initLen;
  if (changed) {
    writeLocalStore(store);
  }
  return changed;
}

export async function clearTripHistoryByUser(userId) {
  if (!userId) return 0;

  if (isMongoActive()) {
    const res = await TripHistory.deleteMany({ userId });
    return Number(res?.deletedCount || 0);
  }

  const store = readLocalStore();
  const initLen = store.tripHistory.length;
  store.tripHistory = store.tripHistory.filter((entry) => String(entry.userId) !== String(userId));
  const deletedCount = initLen - store.tripHistory.length;
  if (deletedCount > 0) {
    writeLocalStore(store);
  }
  return deletedCount;
}


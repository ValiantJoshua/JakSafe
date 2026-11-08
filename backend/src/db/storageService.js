import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from './models/User.js';
import { SavedRoute } from './models/SavedRoute.js';

const LOCAL_STORAGE_PATH = path.resolve(process.cwd(), 'src', 'data', 'jaksafe_local_storage.json');

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
  try {
    if (!fs.existsSync(LOCAL_STORAGE_PATH)) {
      const initial = { users: [], savedRoutes: [] };
      fs.writeFileSync(LOCAL_STORAGE_PATH, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    const raw = fs.readFileSync(LOCAL_STORAGE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed?.users) ? parsed.users : [],
      savedRoutes: Array.isArray(parsed?.savedRoutes) ? parsed.savedRoutes : [],
    };
  } catch (err) {
    console.warn('[Storage] Gagal membaca storage lokal fallback, menginisialisasi baru:', err.message);
    return { users: [], savedRoutes: [] };
  }
}

function writeLocalStore(data) {
  try {
    const dir = path.dirname(LOCAL_STORAGE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Tulis atomik lewat file sementara
    const tmpPath = `${LOCAL_STORAGE_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, LOCAL_STORAGE_PATH);
  } catch (err) {
    console.error('[Storage] Gagal menyimpan ke storage lokal fallback:', err.message);
  }
}

function sanitizeUser(user) {
  if (!user) return null;
  const doc = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete doc.password;
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

export async function createUser({ name, email, password, healthProfile = {} }) {
  const normEmail = String(email || '').trim().toLowerCase();
  const safeName = String(name || '').trim();

  const profile = {
    isSensitive: Boolean(healthProfile?.isSensitive),
    conditions: Array.isArray(healthProfile?.conditions) ? healthProfile.conditions : [],
  };

  if (isMongoActive()) {
    const doc = await User.create({
      name: safeName,
      email: normEmail,
      password,
      healthProfile: profile,
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

  const newUser = {
    id: crypto.randomUUID(),
    _id: crypto.randomUUID(),
    name: safeName,
    email: normEmail,
    password,
    healthProfile: profile,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.users.push(newUser);
  writeLocalStore(store);
  return sanitizeUser(newUser);
}

export async function updateUserProfile(id, { name, healthProfile }) {
  if (!id) return null;

  if (isMongoActive()) {
    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (healthProfile !== undefined) {
      update.healthProfile = {
        isSensitive: Boolean(healthProfile.isSensitive),
        conditions: Array.isArray(healthProfile.conditions) ? healthProfile.conditions : [],
      };
    }
    const updated = await User.findByIdAndUpdate(id, { $set: update }, { new: true, runValidators: true }).select('-password');
    return sanitizeUser(updated);
  }

  const store = readLocalStore();
  const idx = store.users.findIndex((u) => u.id === id || u._id === id);
  if (idx === -1) return null;

  if (name !== undefined) store.users[idx].name = String(name).trim();
  if (healthProfile !== undefined) {
    store.users[idx].healthProfile = {
      isSensitive: Boolean(healthProfile.isSensitive),
      conditions: Array.isArray(healthProfile.conditions) ? healthProfile.conditions : [],
    };
  }
  store.users[idx].updatedAt = new Date().toISOString();
  writeLocalStore(store);
  return sanitizeUser(store.users[idx]);
}

// -------------------------------------------------------------
// OPERASI RUTE TERSIMPAN (SAVED ROUTES)
// -------------------------------------------------------------
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
    userId,
    title: title || `${origin?.name || 'Titik Awal'} -> ${destination?.name || 'Tujuan'}`,
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


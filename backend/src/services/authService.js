import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserProfile,
} from '../db/storageService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'jaksafe-dev-secret-key-2026';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[authService] PERINGATAN: JWT_SECRET tidak diatur pada environment production; menggunakan fallback dev.');
}
const JWT_EXPIRES_IN = '7d';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

/**
 * Generate JWT token untuk pengguna.
 */
export function generateToken(user) {
  const payload = {
    id: user.id || user._id,
    email: user.email,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifikasi token JWT.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new AuthError('Token otentikasi tidak valid atau telah kedaluwarsa', 401);
  }
}

/**
 * Registrasi pengguna baru.
 */
export async function register({ email, password, name, isHealthSensitive = false, conditions = [] }) {
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new AuthError('Format email tidak valid', 400);
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new AuthError('Kata sandi minimal 6 karakter', 400);
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AuthError('Email ini sudah terdaftar. Silakan langsung masuk.', 409);
  }

  const displayName = String(name || email.split('@')[0] || 'Pengguna JakSafe').trim();
  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = await createUser({
    name: displayName,
    email,
    password: hashedPassword,
    healthProfile: {
      isSensitive: Boolean(isHealthSensitive),
      conditions: Array.isArray(conditions) ? conditions : [],
    },
  });

  const token = generateToken(newUser);
  return { user: newUser, token };
}

/**
 * Masuk (Login) pengguna.
 * Jika pengguna belum terdaftar dan memasukkan kredensial valid, kita bisa mendukung seamless auto-provisioning
 * atau mengembalikan pesan yang jelas.
 */
export async function login({ email, password }) {
  if (!email || !password) {
    throw new AuthError('Email dan kata sandi wajib diisi', 400);
  }

  const user = await findUserByEmail(email, { includePassword: true });
  if (!user) {
    throw new AuthError('Akun dengan email ini belum terdaftar', 404);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AuthError('Kata sandi salah. Silakan coba lagi.', 401);
  }

  const safeUser = { ...user };
  delete safeUser.password;
  if (safeUser._id) safeUser.id = String(safeUser._id);

  const token = generateToken(safeUser);
  return { user: safeUser, token };
}

/**
 * Mengambil data profil pengguna berdasarkan user ID dari token JWT.
 */
export async function getCurrentUser(userId) {
  const user = await findUserById(userId);
  if (!user) {
    throw new AuthError('Pengguna tidak ditemukan', 404);
  }
  return user;
}

const VALID_SEVERITIES = ['pantau', 'waspada', 'siaga'];

/**
 * Normalisasi dan validasi preferensi peringatan area rawan milik pengguna.
 */
export function normalizeAlertPreferences(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const minSev = VALID_SEVERITIES.includes(raw.minSeverity)
    ? raw.minSeverity
    : (VALID_SEVERITIES.includes(fallback.minSeverity) ? fallback.minSeverity : 'waspada');
  const regions = Array.isArray(raw.regions)
    ? [...new Set(raw.regions.map((r) => String(r || '').trim()).filter(Boolean))].slice(0, 10)
    : (Array.isArray(fallback.regions) ? fallback.regions : []);
  return {
    enabled: raw.enabled !== undefined ? Boolean(raw.enabled) : (fallback.enabled ?? true),
    regions,
    minSeverity: minSev,
  };
}

/**
 * Memperbarui profil pengguna (nama, profil kesehatan, atau preferensi peringatan area rawan).
 */
export async function updateProfile(userId, { name, isHealthSensitive, conditions, alertPreferences }) {
  const updatePayload = {};
  if (name !== undefined) updatePayload.name = name;
  if (isHealthSensitive !== undefined || conditions !== undefined) {
    updatePayload.healthProfile = {
      isSensitive: Boolean(isHealthSensitive),
      conditions: Array.isArray(conditions) ? conditions : [],
    };
  }
  if (alertPreferences !== undefined) {
    const existing = await findUserById(userId);
    const normalized = normalizeAlertPreferences(alertPreferences, existing?.alertPreferences || {});
    if (normalized) updatePayload.alertPreferences = normalized;
  }

  const updated = await updateUserProfile(userId, updatePayload);
  if (!updated) {
    throw new AuthError('Gagal memperbarui profil pengguna', 404);
  }
  return updated;
}


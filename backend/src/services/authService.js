import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserProfile,
  updateUserRole,
  incrementUserTokenVersion,
} from '../db/storageService.js';

const EPHEMERAL_DEV_SECRET = crypto.randomBytes(32).toString('hex');
const DUMMY_BCRYPT_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8p4R2X9z3s8m5K1v7L9q2W4e6R8t0y';

function getJwtSecret() {
  const envSecret = typeof process.env.JWT_SECRET === 'string' ? process.env.JWT_SECRET.trim() : '';
  if (process.env.NODE_ENV === 'production') {
    if (envSecret.length < 32) {
      throw new Error('[authService] FATAL: JWT_SECRET wajib diatur minimal 32 karakter pada environment production.');
    }
    return envSecret;
  }
  return envSecret || EPHEMERAL_DEV_SECRET;
}

if (process.env.NODE_ENV === 'production') {
  getJwtSecret();
}

const JWT_EXPIRES_IN = '24h';
const MAX_PASSWORD_BYTES = 72;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

let cachedGoogleJwks = { keys: [], expiresAt: 0 };

export function getGoogleClientId() {
  return String(process.env.GOOGLE_CLIENT_ID || '').trim();
}

export function resetGoogleJwksCacheForTest() {
  cachedGoogleJwks = { keys: [], expiresAt: 0 };
}

async function fetchGoogleJwks({ force = false, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (!force && cachedGoogleJwks.keys.length > 0 && now < cachedGoogleJwks.expiresAt) {
    return cachedGoogleJwks.keys;
  }

  const res = await fetchImpl(GOOGLE_JWKS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new AuthError('Gagal mengambil kunci verifikasi Google. Silakan coba lagi.', 502);
  }

  const data = await res.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (keys.length === 0) {
    throw new AuthError('Kunci verifikasi Google tidak tersedia.', 502);
  }

  const cc = String(res.headers?.get?.('cache-control') || '');
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlSec = maxAgeMatch ? Math.max(300, Math.min(86400, Number(maxAgeMatch[1]))) : 3600;
  cachedGoogleJwks = { keys, expiresAt: now + ttlSec * 1000 };
  return keys;
}

/**
 * Verifikasi Google ID Token (JWT RS256 dari Google Identity Services)
 * secara kriptografis menggunakan JWKS resmi Google.
 */
export async function verifyGoogleIdToken(idToken, { clientId = getGoogleClientId(), fetchImpl = fetch } = {}) {
  if (!clientId) {
    throw new AuthError('Google Sign-In belum dikonfigurasi di server.', 503);
  }
  if (!idToken || typeof idToken !== 'string') {
    throw new AuthError('Token Google wajib disertakan.', 400);
  }

  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header?.kid;
  const alg = decoded?.header?.alg;
  if (!kid || alg !== 'RS256') {
    throw new AuthError('Format token Google tidak valid.', 401);
  }

  let keys = await fetchGoogleJwks({ force: false, fetchImpl });
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    // Kemungkinan Google baru saja merotasi kunci publik
    keys = await fetchGoogleJwks({ force: true, fetchImpl });
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) {
    throw new AuthError('Kunci penandatangan token Google tidak dikenali.', 401);
  }

  let payload;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    payload = jwt.verify(idToken, publicKey, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
    });
  } catch {
    throw new AuthError('Token Google tidak valid atau telah kedaluwarsa.', 401);
  }

  const email = String(payload?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email) || !payload?.sub) {
    throw new AuthError('Informasi akun Google tidak lengkap.', 401);
  }
  if (payload.email_verified !== true) {
    throw new AuthError('Email pada akun Google Anda belum terverifikasi.', 403);
  }

  return {
    sub: String(payload.sub),
    email,
    name: String(payload.name || email.split('@')[0] || 'JakSafe User').trim(),
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

/**
 * Verifikasi Google OAuth2 Access Token (dari Google OAuth2 Popup)
 * melalui tokeninfo (validasi audience/Client ID) dan userinfo resmi Google.
 */
export async function verifyGoogleAccessToken(accessToken, { clientId = getGoogleClientId(), fetchImpl = fetch } = {}) {
  if (!clientId) {
    throw new AuthError('Google Sign-In belum dikonfigurasi di server.', 503);
  }
  if (!accessToken || typeof accessToken !== 'string') {
    throw new AuthError('Token akses Google wajib disertakan.', 400);
  }

  const infoUrl = `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`;
  const infoRes = await fetchImpl(infoUrl, {
    headers: { Accept: 'application/json' },
  });
  if (!infoRes.ok) {
    throw new AuthError('Token Google tidak valid atau telah kedaluwarsa.', 401);
  }

  const info = await infoRes.json();
  if (info?.aud !== clientId && info?.azp !== clientId) {
    throw new AuthError('Token Google tidak diterbitkan untuk aplikasi ini.', 401);
  }

  const userRes = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!userRes.ok) {
    throw new AuthError('Gagal mengambil profil akun Google.', 502);
  }

  const profile = await userRes.json();
  const email = String(profile?.email || info?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_REGEX.test(email) || !profile?.sub) {
    throw new AuthError('Informasi akun Google tidak lengkap.', 401);
  }
  if (profile.email_verified !== true && profile.email_verified !== 'true') {
    throw new AuthError('Email pada akun Google Anda belum terverifikasi.', 403);
  }

  return {
    sub: String(profile.sub),
    email,
    name: String(profile.name || email.split('@')[0] || 'JakSafe User').trim(),
    picture: typeof profile.picture === 'string' ? profile.picture : null,
  };
}

/**
 * Masuk atau daftar otomatis menggunakan Google ID Token maupun OAuth2 Access Token.
 */
export async function loginWithGoogle({ credential, accessToken, isHealthSensitive = false }, opts = {}) {
  const googleProfile = accessToken
    ? await verifyGoogleAccessToken(accessToken, opts)
    : await verifyGoogleIdToken(credential, opts);
  const existing = await findUserByEmail(googleProfile.email);

  if (existing) {
    const safeUser = {
      ...existing,
      id: String(existing.id || existing._id),
      role: existing.role === 'admin' ? 'admin' : 'user',
      tokenVersion: Number(existing.tokenVersion) || 0,
    };
    const token = generateToken(safeUser);
    return { user: safeUser, token, isNewUser: false };
  }

  // Buat password acak kriptografis agar skema User tetap aman & akun Google tidak bisa dibobol lewat password biasa
  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
  const newUser = await createUser({
    name: googleProfile.name,
    email: googleProfile.email,
    password: randomPasswordHash,
    role: 'user',
    googleId: googleProfile.sub,
    avatarUrl: googleProfile.picture,
    healthProfile: {
      isSensitive: Boolean(isHealthSensitive),
      conditions: [],
    },
  });

  const token = generateToken(newUser);
  return { user: newUser, token, isNewUser: true };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getConfiguredAdminEmails() {
  const raw = [process.env.ADMIN_EMAIL, process.env.ADMIN_EMAILS]
    .filter(Boolean)
    .join(',');
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isConfiguredAdminEmail(email) {
  const norm = String(email || '').trim().toLowerCase();
  return Boolean(norm) && getConfiguredAdminEmails().has(norm);
}

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
    role: user.role === 'admin' ? 'admin' : 'user',
    tokenVersion: Number(user.tokenVersion) || 0,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifikasi token JWT.
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    throw new AuthError('Token otentikasi tidak valid atau telah kedaluwarsa', 401);
  }
}

/**
 * Registrasi pengguna baru.
 * Secara default seluruh registrasi publik mendapatkan role 'user'.
 */
export async function register({ email, password, name, isHealthSensitive = false, conditions = [] }) {
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    throw new AuthError('Format email tidak valid', 400);
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new AuthError('Kata sandi minimal 6 karakter', 400);
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AuthError('Kata sandi maksimal 72 karakter', 400);
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AuthError('Email ini sudah terdaftar. Silakan langsung masuk.', 409);
  }

  const displayName = String(name || email.split('@')[0] || 'Pengguna JakSafe').trim();
  const hashedPassword = await bcrypt.hash(password, 10);
  const role = 'user';

  const newUser = await createUser({
    name: displayName,
    email,
    password: hashedPassword,
    role,
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
 */
export async function login({ email, password }) {
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    throw new AuthError('Email dan kata sandi wajib diisi', 400);
  }

  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AuthError('Kata sandi salah. Silakan coba lagi.', 401);
  }

  const user = await findUserByEmail(email, { includePassword: true });
  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH).catch(() => {});
    throw new AuthError('Akun dengan email ini belum terdaftar', 404);
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    throw new AuthError('Kata sandi salah. Silakan coba lagi.', 401);
  }

  const safeUser = { ...user };
  delete safeUser.password;
  if (safeUser._id) safeUser.id = String(safeUser._id);
  safeUser.role = safeUser.role === 'admin' ? 'admin' : 'user';
  safeUser.tokenVersion = Number(safeUser.tokenVersion) || 0;

  const token = generateToken(safeUser);
  return { user: safeUser, token };
}

/**
 * Cabut seluruh token aktif pengguna dengan menaikkan tokenVersion di penyimpanan.
 */
export async function logout(userId) {
  if (!userId) throw new AuthError('Pengguna tidak ditemukan', 404);
  await incrementUserTokenVersion(userId);
  return { ok: true };
}

/**
 * Pastikan akun admin dari environment (`ADMIN_EMAIL` + `ADMIN_PASSWORD`) siap saat eksplisit dipanggil.
 */
export async function bootstrapAdminFromEnv() {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.ADMIN_PASSWORD || '');
  const adminName = String(process.env.ADMIN_NAME || 'Administrator JakSafe').trim();

  if (adminEmail && EMAIL_REGEX.test(adminEmail) && adminPassword.length >= 6) {
    const existing = await findUserByEmail(adminEmail);
    if (!existing) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await createUser({
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
      });
      console.log(`[auth] Akun admin awal dibuat untuk ${adminEmail}.`);
    } else if (existing.role !== 'admin') {
      await updateUserRole(existing.id, 'admin');
      console.log(`[auth] Hak akses admin diaktifkan untuk ${adminEmail}.`);
    }
  }
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


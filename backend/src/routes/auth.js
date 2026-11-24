import { Router } from 'express';
import {
  register,
  login,
  loginWithGoogle,
  getGoogleClientId,
  logout,
  updateProfile,
  AuthError,
} from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, name, isHealthSensitive, conditions } = req.body || {};
  try {
    const result = await register({ email, password, name, isHealthSensitive, conditions });
    res.status(201).json({
      ok: true,
      message: 'Registrasi berhasil',
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Gagal melakukan registrasi pengguna',
    });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const result = await login({ email, password });
    res.json({
      ok: true,
      message: 'Berhasil masuk',
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Gagal masuk',
    });
  }
});

// GET /api/auth/google/config -> memberi tahu frontend apakah Google Sign-In aktif beserta Client ID publiknya
router.get('/google/config', (_req, res) => {
  const clientId = getGoogleClientId();
  res.json({
    ok: true,
    enabled: Boolean(clientId),
    clientId: clientId || null,
  });
});

// POST /api/auth/google -> verifikasi Google ID Token / Access Token & terbitkan JWT JakSafe
router.post('/google', async (req, res) => {
  const { credential, accessToken, isHealthSensitive } = req.body || {};
  try {
    const result = await loginWithGoogle({ credential, accessToken, isHealthSensitive });
    res.status(result.isNewUser ? 201 : 200).json({
      ok: true,
      message: result.isNewUser ? 'Akun Google berhasil dibuat' : 'Berhasil masuk dengan Google',
      isNewUser: result.isNewUser,
      token: result.token,
      user: result.user,
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Gagal masuk dengan Google',
    });
  }
});

// GET /api/auth/me -> info pengguna saat ini dari token
router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.user,
  });
});

// POST /api/auth/logout -> cabut seluruh token aktif pengguna (tokenVersion++)
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await logout(req.user.id);
    res.json({
      ok: true,
      message: 'Berhasil keluar dan sesi telah dicabut',
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Gagal mencabut sesi',
    });
  }
});

// PUT /api/auth/profile -> perbarui profil pengguna, status sensitif kesehatan, & preferensi peringatan
router.put('/profile', requireAuth, async (req, res) => {
  const { name, isHealthSensitive, conditions, alertPreferences } = req.body || {};
  try {
    const updated = await updateProfile(req.user.id, {
      name,
      isHealthSensitive,
      conditions,
      alertPreferences,
    });
    res.json({
      ok: true,
      message: 'Profil pengguna berhasil diperbarui',
      user: updated,
    });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({
      ok: false,
      error: err.message || 'Gagal memperbarui profil pengguna',
    });
  }
});

export default router;


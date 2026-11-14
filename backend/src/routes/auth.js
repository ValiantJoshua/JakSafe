import { Router } from 'express';
import {
  register,
  login,
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

// GET /api/auth/me -> info pengguna saat ini dari token
router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: req.user,
  });
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


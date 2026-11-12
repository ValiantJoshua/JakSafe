import { verifyToken, getCurrentUser, AuthError } from '../services/authService.js';

/**
 * Middleware untuk rute yang mewajibkan pengguna terotentikasi.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Akses ditolak. Token otentikasi (Bearer token) diperlukan.',
    });
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return res.status(401).json({
      ok: false,
      error: 'Token otentikasi kosong.',
    });
  }

  try {
    const decoded = verifyToken(token);
    const user = await getCurrentUser(decoded.id);
    req.user = user;
    next();
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    return res.status(status).json({
      ok: false,
      error: err.message || 'Sesi otentikasi tidak valid atau telah berakhir',
    });
  }
}


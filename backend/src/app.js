import dns from 'node:dns';
import express from 'express';
import cors from 'cors';
import routeRouter from './routes/route.js';
import aqiRouter from './routes/aqi.js';
import cctvRouter from './routes/cctv.js';
import tomtomRouter from './routes/tomtom.js';
import navigateRouter from './routes/navigate.js';
import geocodeRouter from './routes/geocode.js';
import authRouter from './routes/auth.js';
import savedRoutesRouter from './routes/savedRoutes.js';
import historyRouter from './routes/history.js';
import alertsRouter from './routes/alerts.js';
import { createAdminRouter } from './routes/admin.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { getAllCacheStats, getCacheAggregateSummary } from './services/cacheService.js';

// Utamakan IPv4 untuk mencegah galat "fetch failed" / ETIMEDOUT pada jaringan ISP Indonesia
dns.setDefaultResultOrder('ipv4first');

/**
 * Express application factory for JakSafe backend.
 * Decouples Express app creation from server network listening,
 * enabling seamless integration and system testing (ANSI/IEEE 829-1983).
 */
export function createApp(options = {}) {
  const app = express();
  app.set('trust proxy', 1);

  const rlOpts = options.rateLimit || {};
  const apiWindowMs = Number(rlOpts.apiWindowMs || process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const apiMax = Number(rlOpts.apiMax || process.env.RATE_LIMIT_API_MAX || 240);
  const authWindowMs = Number(rlOpts.authWindowMs || process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60_000);
  const authMax = Number(rlOpts.authMax || process.env.RATE_LIMIT_AUTH_MAX || 25);
  const heavyMax = Number(rlOpts.heavyMax || process.env.RATE_LIMIT_HEAVY_MAX || 35);
  const tileMax = Number(rlOpts.tileMax || process.env.RATE_LIMIT_TILE_MAX || 600);
  const adminMax = Number(rlOpts.adminMax || process.env.RATE_LIMIT_ADMIN_MAX || 120);

  const apiLimiter = createRateLimiter({
    name: 'api_general',
    windowMs: apiWindowMs,
    max: apiMax,
    skip: (req) => (
      req.path === '/health'
      || req.path.startsWith('/tomtom/flow')
      || req.path === '/auth/login'
      || req.path === '/auth/register'
    ),
  });

  const authLimiter = createRateLimiter({
    name: 'auth_sensitive',
    windowMs: authWindowMs,
    max: authMax,
    message: 'Terlalu banyak percobaan autentikasi. Silakan tunggu beberapa menit sebelum mencoba lagi.',
  });

  const heavyLimiter = createRateLimiter({
    name: 'compute_ai',
    windowMs: apiWindowMs,
    max: heavyMax,
    message: 'Batas permintaan analisis rute & AI tercapai sementara. Coba lagi sebentar lagi.',
  });

  const tileLimiter = createRateLimiter({
    name: 'traffic_tiles',
    windowMs: apiWindowMs,
    max: tileMax,
  });

  const adminLimiter = createRateLimiter({
    name: 'admin_api',
    windowMs: apiWindowMs,
    max: adminMax,
  });

  const allLimiters = [apiLimiter, authLimiter, heavyLimiter, tileLimiter, adminLimiter];
  const getRateLimitStats = () => allLimiters.map((lim) => lim.getStats());

  app.use(cors());
  app.use(express.json());
  app.use('/api', apiLimiter);

  // Diagnostic / Serviceability Health Check Endpoint (publik ringan tanpa bocor detail internal)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'jaksafe-backend',
      time: new Date().toISOString(),
    });
  });

  // Dedicated Cache Inspection Endpoint (dilindungi otentikasi admin)
  app.get('/api/cache/stats', adminLimiter, requireAuth, requireAdmin, (_req, res) => {
    res.json({
      ok: true,
      service: 'jaksafe-backend',
      time: new Date().toISOString(),
      cache: getAllCacheStats(),
      summary: getCacheAggregateSummary(),
    });
  });

  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/navigate', heavyLimiter);
  app.use('/api/cctv/analyze', heavyLimiter);
  app.use('/api/tomtom/flow', tileLimiter);

  app.use('/api/route', routeRouter);
  app.use('/api/aqi', aqiRouter);
  app.use('/api/cctv', cctvRouter);
  app.use('/api/tomtom', tomtomRouter);
  app.use('/api/navigate', navigateRouter);
  app.use('/api/geocode', geocodeRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/routes/saved', savedRoutesRouter);
  app.use('/api/routes/history', historyRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/admin', adminLimiter, createAdminRouter({ getRateLimitStats }));

  return app;
}

const app = createApp();
export default app;

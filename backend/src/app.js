import express from 'express';
import cors from 'cors';
import routeRouter from './routes/route.js';
import aqiRouter from './routes/aqi.js';
import cctvRouter from './routes/cctv.js';
import tomtomRouter from './routes/tomtom.js';
import navigateRouter from './routes/navigate.js';
import geocodeRouter from './routes/geocode.js';

/**
 * Express application factory for JakSafe backend.
 * Decouples Express app creation from server network listening,
 * enabling seamless integration and system testing (ANSI/IEEE 829-1983).
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Diagnostic / Serviceability Health Check Endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'jaksafe-backend',
      time: new Date().toISOString(),
    });
  });

  app.use('/api/route', routeRouter);
  app.use('/api/aqi', aqiRouter);
  app.use('/api/cctv', cctvRouter);
  app.use('/api/tomtom', tomtomRouter);
  app.use('/api/navigate', navigateRouter);
  app.use('/api/geocode', geocodeRouter);

  return app;
}

const app = createApp();
export default app;

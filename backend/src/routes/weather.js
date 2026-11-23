import { Router } from 'express';
import { getHybridWeather, WeatherError } from '../services/weatherService.js';

const router = Router();

// GET /api/weather?lat=-6.192&lon=106.823
router.get('/', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ ok: false, error: 'query lat dan lon wajib berupa angka valid' });
  }
  try {
    const weather = await getHybridWeather({ lat, lon });
    return res.json({ ok: true, weather });
  } catch (err) {
    const status = err instanceof WeatherError ? err.status : 502;
    return res.status(status).json({ ok: false, error: err?.message || 'weather service error' });
  }
});

export default router;

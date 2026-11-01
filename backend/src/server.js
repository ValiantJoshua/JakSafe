import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routeRouter from './routes/route.js';
import aqiRouter from './routes/aqi.js';
import cctvRouter from './routes/cctv.js';
import tomtomRouter from './routes/tomtom.js';
import navigateRouter from './routes/navigate.js';
import { connectDb } from './db/mongoClient.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Connect to MongoDB asynchronously
connectDb().catch((e) => console.warn('[mongo] init warning:', e.message));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'jaksafe-backend', time: new Date().toISOString() });
});

app.use('/api/route', routeRouter);
app.use('/api/aqi', aqiRouter);
app.use('/api/cctv', cctvRouter);
app.use('/api/tomtom', tomtomRouter);
app.use('/api/navigate', navigateRouter);

app.listen(PORT, () => {
  console.log(`jakSafe backend running on http://localhost:${PORT}`);
});

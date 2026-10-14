import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'jaksafe-backend', time: new Date().toISOString() });
});

// TODO: GET /api/route, GET /api/cctv/*, POST /api/navigate

app.listen(PORT, () => {
  console.log(`jakSafe backend running on http://localhost:${PORT}`);
});

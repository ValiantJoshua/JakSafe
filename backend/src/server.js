import dns from 'node:dns';
import 'dotenv/config';

// Utamakan IPv4 untuk mencegah galat "fetch failed" / ETIMEDOUT pada jaringan ISP Indonesia
dns.setDefaultResultOrder('ipv4first');

import app from './app.js';
import { connectDb } from './db/mongoClient.js';
import { startCctvHealthScheduler } from './services/cctvHealthService.js';

const PORT = process.env.PORT || 3001;

// Connect to MongoDB asynchronously, then hydrate & start zero-token CCTV health checker
connectDb()
  .catch((e) => console.warn('[mongo] init warning:', e.message))
  .finally(() => {
    startCctvHealthScheduler().catch((e) =>
      console.warn('[cctvHealth] scheduler warning:', e.message)
    );
  });

app.listen(PORT, () => {
  console.log(`jakSafe backend running on http://localhost:${PORT}`);
});

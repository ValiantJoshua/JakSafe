import dns from 'node:dns';
import 'dotenv/config';

// Utamakan IPv4 untuk mencegah galat "fetch failed" / ETIMEDOUT pada jaringan ISP Indonesia
dns.setDefaultResultOrder('ipv4first');

import app from './app.js';
import { connectDb } from './db/mongoClient.js';
import { bootstrapAdminFromEnv } from './services/authService.js';
import { hydrateCatalogOverridesFromMongo } from './db/cctvCatalogStore.js';
import { startCctvHealthScheduler } from './services/cctvHealthService.js';

const PORT = process.env.PORT || 3001;

// Connect to MongoDB asynchronously, sync admin role & catalog overrides, then start CCTV health checker
connectDb()
  .catch((e) => console.warn('[mongo] init warning:', e.message))
  .finally(async () => {
    try {
      await bootstrapAdminFromEnv();
    } catch (e) {
      console.warn('[auth] admin bootstrap warning:', e.message);
    }
    try {
      await hydrateCatalogOverridesFromMongo();
    } catch (e) {
      console.warn('[cctvStore] hydrate warning:', e.message);
    }
    startCctvHealthScheduler().catch((e) =>
      console.warn('[cctvHealth] scheduler warning:', e.message)
    );
  });

app.listen(PORT, () => {
  console.log(`jakSafe backend running on http://localhost:${PORT}`);
});

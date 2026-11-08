import 'dotenv/config';
import app from './app.js';
import { connectDb } from './db/mongoClient.js';

const PORT = process.env.PORT || 3001;

// Connect to MongoDB asynchronously
connectDb().catch((e) => console.warn('[mongo] init warning:', e.message));

app.listen(PORT, () => {
  console.log(`jakSafe backend running on http://localhost:${PORT}`);
});

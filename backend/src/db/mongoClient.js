import dns from 'node:dns';
import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://localhost:27017/jaksafe';
const PUBLIC_SRV_DNS = ['1.1.1.1', '8.8.8.8'];
const SERVER_SELECTION_TIMEOUT_MS = 8000;
let isConnected = false;

function isLoopbackOnlyDns(servers) {
  return Array.isArray(servers)
    && servers.length > 0
    && servers.every((s) => s === '127.0.0.1' || s === '::1');
}

const ExecutionLogSchema = new mongoose.Schema(
  {
    requestId: { type: String, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
    origin: {
      lat: Number,
      lon: Number,
    },
    destination: {
      lat: Number,
      lon: Number,
    },
    profile: { type: String, default: 'car' },
    preferences: {
      healthSensitive: { type: Boolean, default: false },
    },
    reasoning: [
      {
        step: Number,
        thought: String,
        action: String,
        observation: mongoose.Schema.Types.Mixed,
        durationMs: Number,
      },
    ],
    route: {
      distanceM: Number,
      durationS: Number,
      geometry: [[Number]],
    },
    score: {
      totalScore: Number,
      label: String,
      color: String,
      breakdown: mongoose.Schema.Types.Mixed,
    },
    air: mongoose.Schema.Types.Mixed,
    visual: mongoose.Schema.Types.Mixed,
    traffic: mongoose.Schema.Types.Mixed,
    alternatives: [mongoose.Schema.Types.Mixed],
    totalDurationMs: Number,
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    error: String,
  },
  {
    timestamps: true,
  }
);

export const ExecutionLog = mongoose.models.ExecutionLog || mongoose.model('ExecutionLog', ExecutionLogSchema);

/**
 * Initialize MongoDB connection gracefully.
 * Does not throw error if MongoDB is temporarily down so the server can still run.
 */
export async function connectDb() {
  const uri = process.env.MONGODB_URI || DEFAULT_URI;
  const isSrv = uri.startsWith('mongodb+srv://');

  if (isSrv && isLoopbackOnlyDns(dns.getServers())) {
    dns.setServers(PUBLIC_SRV_DNS);
  }

  const attemptConnect = () => {
    mongoose.set('strictQuery', false);
    return mongoose.connect(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
    });
  };

  try {
    try {
      await attemptConnect();
    } catch (firstErr) {
      if (isSrv && /querySrv/i.test(firstErr?.message || '')) {
        dns.setServers(PUBLIC_SRV_DNS);
        await attemptConnect();
      } else {
        throw firstErr;
      }
    }
    isConnected = true;
    console.log(`[db] Connected to MongoDB (${mongoose.connection.name}) at ${uri.replace(/\/\/.*@/, '//<auth>@')}`);
  } catch (err) {
    isConnected = false;
    console.warn(`[db] MongoDB connection failed (${err.message}). Logging to MongoDB is suspended.`);
  }
}

/**
 * Save an execution audit log. Fails gracefully if DB is disconnected.
 */
export async function saveExecutionLog(payload) {
  if (!isConnected) {
    return null;
  }
  try {
    const log = new ExecutionLog(payload);
    return await log.save();
  } catch (err) {
    console.error('[db] Failed to save execution log:', err.message);
    return null;
  }
}


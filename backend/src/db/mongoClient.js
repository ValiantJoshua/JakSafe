import dns from 'node:dns';
import mongoose from 'mongoose';
import {
  appendLocalExecutionLog,
  readLocalExecutionLogs,
  filterAndFormatExecutionLogs,
  summarizeExecutionLogs,
} from './executionLogStore.js';
import { TripHistory } from './models/TripHistory.js';
import { SavedRoute } from './models/SavedRoute.js';

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
      label: String,
    },
    destination: {
      lat: Number,
      lon: Number,
      label: String,
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
      summary: String,
      geometry: [[Number]],
    },
    score: {
      totalScore: Number,
      label: String,
      color: String,
      breakdown: mongoose.Schema.Types.Mixed,
    },
    modelTelemetry: {
      preferredModel: String,
      modelUsed: String,
      fallbackOccurred: Boolean,
      fallbackCount: Number,
      modelsTried: [String],
      aiMode: String,
      usedSummaryFallback: Boolean,
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

export function isMongoConnected() {
  return Boolean(isConnected && mongoose.connection && mongoose.connection.readyState === 1);
}

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
 * Save an execution audit log to MongoDB when connected, or local fallback JSON store otherwise.
 */
export async function saveExecutionLog(payload) {
  if (!isMongoConnected()) {
    return appendLocalExecutionLog(payload);
  }
  try {
    const log = new ExecutionLog(payload);
    return await log.save();
  } catch (err) {
    console.error('[db] Failed to save execution log, writing local fallback:', err.message);
    return appendLocalExecutionLog(payload);
  }
}

/**
 * Ambil daftar ExecutionLog terfilter untuk Dashboard Admin.
 */
export async function getExecutionLogsForAdmin({
  limit = 30,
  status = 'all',
  scoreLabel = 'all',
  fallbackOnly = false,
} = {}) {
  if (isMongoConnected()) {
    try {
      const query = {};
      if (status && status !== 'all') query.status = status;
      if (scoreLabel && scoreLabel !== 'all') query['score.label'] = scoreLabel;
      if (fallbackOnly) query['modelTelemetry.fallbackOccurred'] = true;

      const maxItems = Math.min(Math.max(1, Number(limit) || 30), 200);
      const docs = await ExecutionLog.find(query)
        .sort({ timestamp: -1 })
        .limit(maxItems)
        .select('-route.geometry -alternatives -reasoning.observation')
        .lean();

      const needsEnrich = docs.some(
        (d) =>
          (d?.origin && !d.origin.label) ||
          (d?.destination && !d.destination.label)
      );
      if (needsEnrich) {
        try {
          const [trips, saved] = await Promise.all([
            TripHistory.find().select('origin destination').limit(200).lean(),
            SavedRoute.find().select('origin destination').limit(200).lean(),
          ]);
          const coordMap = new Map();
          const addPt = (pt) => {
            const lat = Number(pt?.lat);
            const lon = Number(pt?.lon);
            const name = String(pt?.name || pt?.label || '').trim();
            if (Number.isFinite(lat) && Number.isFinite(lon) && name) {
              coordMap.set(`${lat.toFixed(3)},${lon.toFixed(3)}`, name);
            }
          };
          for (const item of [...trips, ...saved]) {
            addPt(item?.origin);
            addPt(item?.destination);
          }
          for (const doc of docs) {
            if (doc?.origin && !doc.origin.label) {
              const key = `${Number(doc.origin.lat).toFixed(3)},${Number(doc.origin.lon).toFixed(3)}`;
              if (coordMap.has(key)) doc.origin.label = coordMap.get(key);
            }
            if (doc?.destination && !doc.destination.label) {
              const key = `${Number(doc.destination.lat).toFixed(3)},${Number(doc.destination.lon).toFixed(3)}`;
              if (coordMap.has(key)) doc.destination.label = coordMap.get(key);
            }
          }
        } catch {
          // Abaikan error saat memperkaya label historis
        }
      }

      return {
        storage: 'mongodb',
        logs: filterAndFormatExecutionLogs(docs, { limit: maxItems, status, scoreLabel, fallbackOnly }),
      };
    } catch (err) {
      console.warn('[db] Gagal membaca ExecutionLog dari MongoDB:', err.message);
    }
  }

  return {
    storage: 'local-fallback',
    logs: filterAndFormatExecutionLogs(readLocalExecutionLogs(), {
      limit,
      status,
      scoreLabel,
      fallbackOnly,
    }),
  };
}

/**
 * Ambil statistik agregat performa agen dari ExecutionLog (latensi, fallback Gemini, distribusi skor).
 */
export async function getExecutionStatsForAdmin() {
  if (isMongoConnected()) {
    try {
      const docs = await ExecutionLog.find({})
        .sort({ timestamp: -1 })
        .limit(500)
        .select('timestamp profile score.label score.totalScore totalDurationMs status modelTelemetry')
        .lean();
      return summarizeExecutionLogs(docs, 'mongodb');
    } catch (err) {
      console.warn('[db] Gagal mengagregasi ExecutionLog dari MongoDB:', err.message);
    }
  }

  return summarizeExecutionLogs(readLocalExecutionLogs(), 'local-fallback');
}


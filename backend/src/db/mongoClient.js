import mongoose from 'mongoose';

const DEFAULT_URI = 'mongodb://localhost:27017/jaksafe';
let isConnected = false;

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
  try {
    mongoose.set('strictQuery', false);
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    isConnected = true;
    console.log(`[db] Connected to MongoDB at ${uri.replace(/\/\/.*@/, '//<auth>@')}`);
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

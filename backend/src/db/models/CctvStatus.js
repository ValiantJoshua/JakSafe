import mongoose from 'mongoose';

const cctvStatusSchema = new mongoose.Schema(
  {
    cameraId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'unknown'],
      required: true,
      default: 'unknown',
    },
    reason: {
      type: String,
      default: null,
    },
    latencyMs: {
      type: Number,
      default: null,
    },
    checkedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    versionKey: false,
    collection: 'cctv_statuses',
  }
);

// MongoDB TTL index: MongoDB background cleaner drops expired status docs automatically
cctvStatusSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const CctvStatus =
  mongoose.models.CctvStatus || mongoose.model('CctvStatus', cctvStatusSchema);


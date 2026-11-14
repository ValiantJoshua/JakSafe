import mongoose from 'mongoose';

const TripHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed, // ObjectId bila di MongoDB, string id bila fallback lokal
      required: true,
      index: true,
    },
    origin: {
      id: { type: String, default: null },
      name: { type: String, required: true },
      area: { type: String, default: '' },
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
    destination: {
      id: { type: String, default: null },
      name: { type: String, required: true },
      area: { type: String, default: '' },
      lat: { type: Number, required: true },
      lon: { type: Number, required: true },
    },
    score: {
      totalScore: { type: Number, default: 0 },
      label: { type: String, default: 'AMAN' },
      color: { type: String, default: '#16a34a' },
    },
    distanceM: { type: Number, default: 0 },
    durationS: { type: Number, default: 0 },
    profile: { type: String, default: 'car' },
    summary: { type: String, default: '' },
    source: { type: String, default: 'preview' },
  },
  {
    timestamps: true,
  }
);

export const TripHistory = mongoose.models.TripHistory || mongoose.model('TripHistory', TripHistorySchema);


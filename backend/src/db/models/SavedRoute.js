import mongoose from 'mongoose';

const SavedRouteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed, // ObjectId bila di MongoDB, string id bila fallback
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
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
      totalScore: { type: Number, required: true },
      label: { type: String, required: true },
      color: { type: String, default: '#16a34a' },
    },
    distanceM: { type: Number, default: 0 },
    durationS: { type: Number, default: 0 },
    profile: { type: String, default: 'car' },
  },
  {
    timestamps: true,
  }
);

export const SavedRoute = mongoose.models.SavedRoute || mongoose.model('SavedRoute', SavedRouteSchema);


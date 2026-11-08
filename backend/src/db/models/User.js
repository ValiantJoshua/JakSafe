import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
    },
    healthProfile: {
      isSensitive: {
        type: Boolean,
        default: false,
      },
      conditions: {
        type: [String],
        default: [],
      },
    },
  },
  {
    timestamps: true,
  }
);

// Hilangkan password saat di-serialize ke JSON
UserSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export const User = mongoose.models.User || mongoose.model('User', UserSchema);


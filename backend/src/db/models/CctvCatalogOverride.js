import mongoose from 'mongoose';

const cctvCatalogOverrideSchema = new mongoose.Schema(
  {
    cameraId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    isCustom: {
      type: Boolean,
      default: false,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    patch: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    updatedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'cctv_catalog_overrides',
  }
);

export const CctvCatalogOverride =
  mongoose.models.CctvCatalogOverride
  || mongoose.model('CctvCatalogOverride', cctvCatalogOverrideSchema);

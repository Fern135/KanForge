'use strict';

const { Schema, model } = require('mongoose');

// Instance-wide settings, kept in one document with _id "instance".
const settingsSchema = new Schema(
  {
    _id: { type: String },
    // Per-app on/off overrides. Apps missing here use their default.
    apps: { type: Map, of: Boolean, default: undefined },
  },
  { timestamps: true, collection: 'settings' },
);

settingsSchema.statics.INSTANCE = 'instance';

module.exports = model('Settings', settingsSchema);

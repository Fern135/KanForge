'use strict';

const { Schema, model } = require('mongoose');

// Instance-wide Files settings, set by a platform admin on a self-hosted install.
// One document with _id "instance". Missing values mean the defaults below.
const settingsSchema = new Schema(
  {
    _id: { type: String },
    // Whether items can be shared with a public link. Turning it off stops every
    // existing link from working too (they come back if it's turned on again).
    linkSharing: { type: Boolean },
    // Storage per person when they have no limit of their own. null: unlimited.
    defaultQuotaBytes: { type: Number, min: 0, default: null },
    // The largest single file. null: no limit beyond the technical one (limits.js).
    maxFileBytes: { type: Number, min: 1, default: null },
  },
  { timestamps: true, collection: 'files_settings' },
);

settingsSchema.statics.INSTANCE = 'instance';

module.exports = model('FilesSettings', settingsSchema);

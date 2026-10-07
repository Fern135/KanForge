'use strict';

const { Schema, model } = require('mongoose');

// A platform admin's storage limit for one person, overriding the default
// (self-hosted installs). Keyed by user id. bytes null means unlimited.
const quotaSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, ref: 'User' },
    bytes: { type: Number, min: 0, default: null },
  },
  { timestamps: true, collection: 'file_quotas' },
);

module.exports = model('FileQuota', quotaSchema);

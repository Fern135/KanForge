'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

// Same shape as every app's folders (core/services/folderTree.js).
const folderSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    nameKey: { type: String, required: true },
    parent: { type: Schema.Types.ObjectId, ref: 'OfficeFolder', default: null },
    path: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: 'office_folders' },
);

folderSchema.plugin(tenantPlugin);

module.exports = model('OfficeFolder', folderSchema);

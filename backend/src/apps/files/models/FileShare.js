'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

// Access to a file or folder for someone other than its owner. Sharing a folder
// shares everything inside it, at any depth.
//   grantee set:   a member of the same workspace, who can view or edit
//   grantee null:  the item's public link (at most one per item, view only).
//                  The link's token is derived from this document's id (links.js),
//                  so deleting the document revokes the link.
const shareSchema = new Schema(
  {
    node: { type: Schema.Types.ObjectId, ref: 'FileNode', required: true },
    // The item's owner, so "everything Ana shared" is one query.
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    grantee: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, enum: ['view', 'edit'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, collection: 'file_shares' },
);

shareSchema.plugin(tenantPlugin);

module.exports = model('FileShare', shareSchema);

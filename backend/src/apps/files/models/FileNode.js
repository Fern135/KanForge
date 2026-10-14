'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

// One entry in someone's drive: a folder or a file. Folders and files share a
// collection so a folder's contents, a search or the trash is one query.
//
// Nesting has no depth limit. `path` lists every ancestor's id from the top
// down, so "everything inside folder X" is a single indexed match on path = X.
//
// Everything in a tree belongs to the drive's owner (`owner`), even when someone
// the folder is shared with uploads into it (`uploadedBy`): the owner's storage
// pays for it, and only the owner can share it or delete it for good.
const nodeSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['folder', 'file'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 255 },
    // Lowercased name, for sorting and case-insensitive search.
    nameKey: { type: String, required: true },
    // The folder it sits in; null at the top of the owner's drive.
    parent: { type: Schema.Types.ObjectId, ref: 'FileNode', default: null },
    // Ancestor ids, top down (empty at the top level).
    path: { type: [Schema.Types.ObjectId], default: [] },

    // Files only. size is the full size, reserved against the quota from the
    // moment an upload starts.
    size: { type: Number, min: 0 },
    // The type the browser reported. Only used to choose how a download is served,
    // and anything not on the safe list is served as a plain download.
    mime: { type: String, maxlength: 255 },
    // Where the contents live in the object store.
    storageKey: { type: String },
    // 'uploading' until every part has arrived; hidden from listings until 'ready'.
    status: { type: String, enum: ['uploading', 'ready'] },
    // The object store's multipart upload id and the part size, while uploading.
    uploadId: { type: String },
    partSize: { type: Number },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    // A small preview image for the grid view (images, PDFs, Word, PowerPoint,
    // text), made in the browser and stored next to the file (see thumbnails.js).
    // 'ready' once stored, 'none' when the file can't have one; unset until tried.
    thumb: { type: String, enum: ['ready', 'none'] },
    // The preview's image type (image/webp, image/jpeg or image/png).
    thumbMime: { type: String },

    // Set when moved to the trash. Trashing a folder trashes everything inside it
    // too, and trashRoot names the node that was trashed, so restoring it brings
    // back exactly what went with it. Purged for good 30 days later (sweeper.js).
    trashedAt: { type: Date, default: null },
    trashRoot: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, collection: 'file_nodes' },
);

nodeSchema.plugin(tenantPlugin);

module.exports = model('FileNode', nodeSchema);

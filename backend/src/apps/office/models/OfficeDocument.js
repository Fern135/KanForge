'use strict';

const { Schema, model } = require('mongoose');

const marginsSchema = new Schema(
  { top: Number, right: Number, bottom: Number, left: Number },
  { _id: false },
);

const documentSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // doc (Docs) for now; sheet and slides come with their editors.
    kind: { type: String, enum: ['doc', 'sheet', 'slides'], required: true },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    // The editor's JSON document, rebuilt by the kind's sanitizer before every save.
    content: { type: Schema.Types.Mixed, required: true },
    // Plain-text copy of the content, for search.
    text: { type: String, default: '' },
    // Page setup (Docs).
    settings: {
      pageSize: { type: String, default: 'letter' },
      orientation: { type: String, default: 'portrait' },
      margins: { type: marginsSchema, default: undefined },
    },
    // Images the content uses, so images no document uses can be cleaned up.
    imageIds: { type: [Schema.Types.ObjectId], default: [] },
    folder: { type: Schema.Types.ObjectId, ref: 'OfficeFolder', default: null },
    // Set when moved to the trash. A TTL index deletes the document 30 days later.
    trashedAt: { type: Date, default: null },
    // Bumped on every title, content or settings change, so two tabs can't silently overwrite each other.
    version: { type: Number, default: 1 },
    // Size of the stored content in bytes, shown in the document list.
    size: { type: Number, default: 0 },
  },
  { timestamps: true, minimize: false, collection: 'office_documents' },
);

module.exports = model('OfficeDocument', documentSchema);

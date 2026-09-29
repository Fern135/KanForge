'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

const noteSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    // The editor's JSON document, rebuilt by content.js before every save.
    content: { type: Schema.Types.Mixed, required: true },
    // Plain-text copy of the content, for search and list previews.
    text: { type: String, default: '' },
    tags: { type: [String], validate: (v) => v.length <= 20 },
    // null means the note isn't in any folder.
    folder: { type: Schema.Types.ObjectId, ref: 'NoteFolder', default: null },
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    // Set when moved to the trash. A TTL index deletes the note 30 days later.
    trashedAt: { type: Date, default: null },
    // Bumped on every title or content change, so two tabs can't silently overwrite each other.
    version: { type: Number, default: 1 },
  },
  { timestamps: true, minimize: false },
);

noteSchema.plugin(tenantPlugin);

module.exports = model('Note', noteSchema);

'use strict';

const { Schema, model } = require('mongoose');

const folderSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Lowercased name. Folders in the same parent can't share one.
    nameKey: { type: String, required: true },
    parent: { type: Schema.Types.ObjectId, ref: 'NoteFolder', default: null },
    // Ancestor ids from the top down (parent last), so a whole subtree is one query.
    path: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: 'note_folders' },
);

module.exports = model('NoteFolder', folderSchema);

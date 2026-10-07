'use strict';

const { Schema, model } = require('mongoose');

// Object-store contents waiting to be deleted. Deleting a file removes its
// database entry at once and queues its contents here; the sweeper (sweeper.js)
// deletes them from the store. Queuing first means a crash or a store outage
// can never leave contents behind that nothing points to anymore.
// Not tied to a workspace: the sweeper works across all of them.
const garbageSchema = new Schema(
  {
    key: { type: String, required: true },
    // Set for an upload that never finished: it's aborted rather than deleted.
    uploadId: { type: String },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'file_garbage' },
);

module.exports = model('FileGarbage', garbageSchema);

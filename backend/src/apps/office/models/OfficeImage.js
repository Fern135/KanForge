'use strict';

const { Schema, model } = require('mongoose');

// Images placed in documents. Kept out of the document itself so autosave
// doesn't resend them, and only ever served to their owner.
const imageSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    mime: { type: String, enum: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], required: true },
    data: { type: Buffer, required: true },
    size: { type: Number, required: true },
  },
  { timestamps: true, collection: 'office_images' },
);

module.exports = model('OfficeImage', imageSchema);

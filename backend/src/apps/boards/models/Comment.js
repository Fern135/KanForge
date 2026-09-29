'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

const commentSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    card: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

commentSchema.plugin(tenantPlugin);

module.exports = model('Comment', commentSchema);

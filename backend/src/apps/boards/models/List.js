'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

const listSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    position: { type: Number, required: true },
  },
  { timestamps: true },
);

listSchema.plugin(tenantPlugin);

module.exports = model('List', listSchema);

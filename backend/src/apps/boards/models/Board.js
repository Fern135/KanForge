'use strict';

const { Schema, model } = require('mongoose');
const { tenantPlugin } = require('../../../core/tenancy');

const LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'navy', 'gray'];
const BOARD_BACKGROUNDS = ['navy', 'green', 'gray', 'teal', 'slate', 'forest'];

const labelSchema = new Schema({
  name: { type: String, trim: true, maxlength: 40, default: '' },
  color: { type: String, enum: LABEL_COLORS, required: true },
});

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'member'], required: true },
  },
  { _id: false },
);

const boardSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    background: { type: String, enum: BOARD_BACKGROUNDS, default: 'navy' },
    members: { type: [memberSchema], validate: (v) => v.length <= 100 },
    labels: { type: [labelSchema], validate: (v) => v.length <= 30 },
  },
  { timestamps: true },
);

boardSchema.plugin(tenantPlugin);

module.exports = model('Board', boardSchema);
module.exports.LABEL_COLORS = LABEL_COLORS;
module.exports.BOARD_BACKGROUNDS = BOARD_BACKGROUNDS;

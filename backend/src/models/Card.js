'use strict';

const { Schema, model } = require('mongoose');

const checklistItemSchema = new Schema({
  text: { type: String, required: true, trim: true, maxlength: 200 },
  done: { type: Boolean, default: false },
});

const cardSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
    list: { type: Schema.Types.ObjectId, ref: 'List', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    position: { type: Number, required: true },
    labels: { type: [Schema.Types.ObjectId], validate: (v) => v.length <= 30 },
    dueDate: { type: Date, default: null },
    dueComplete: { type: Boolean, default: false },
    checklist: { type: [checklistItemSchema], validate: (v) => v.length <= 100 },
    commentCount: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

module.exports = model('Card', cardSchema);

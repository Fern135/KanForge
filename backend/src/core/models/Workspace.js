'use strict';

const { Schema, model } = require('mongoose');
const { PLAN_IDS } = require('../plans');

// A workspace (tenant). Everything people create lives in exactly one workspace.
const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Used in URLs (/app/w/<slug>/...). Never changes, so links keep working.
    slug: { type: String, required: true, unique: true, lowercase: true, maxlength: 40 },
    plan: { type: String, enum: PLAN_IDS, required: true },
    // Per-app on/off overrides set by workspace admins. Apps missing here use their default.
    apps: { type: Map, of: Boolean, default: undefined },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

module.exports = model('Workspace', workspaceSchema);

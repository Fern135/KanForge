'use strict';

const { Schema, model } = require('mongoose');

// A link that lets people join a workspace. Only a SHA-256 hash of the link's
// token is stored. Expired links are deleted by a TTL index on expiresAt.
// Looked up by token from outside any workspace, so it doesn't use tenantPlugin.
const inviteSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    tokenHash: { type: String, required: true, unique: true },
    role: { type: String, enum: ['admin', 'member'], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    expiresAt: { type: Date, required: true },
    // null: no limit.
    maxUses: { type: Number, default: null },
    uses: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = model('Invite', inviteSchema);

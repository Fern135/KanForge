'use strict';

const { Schema, model } = require('mongoose');

// A person's place in a workspace. Workspace admins manage members, apps and the
// workspace name. This is separate from User.role, which marks platform admins.
const membershipSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], required: true },
  },
  { timestamps: true },
);

membershipSchema.statics.ROLES = ['admin', 'member'];

module.exports = model('Membership', membershipSchema);

'use strict';

const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // The first account on a new install becomes admin. Admins manage apps and roles.
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    passwordHash: { type: String, required: true, select: false },
    // Optional sign-in PIN. Off (unset) for every new account.
    pinHash: { type: String, select: false },
    // Devices allowed to sign in with the PIN alone. Only token hashes are stored.
    pinDevices: {
      type: [{ _id: false, tokenHash: String, createdAt: Date }],
      default: undefined,
      select: false,
    },
    // Bumped on password change / "log out everywhere" to invalidate outstanding access tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    return { id: String(ret._id), email: ret.email, name: ret.name, role: ret.role || 'user' };
  },
});

module.exports = model('User', userSchema);

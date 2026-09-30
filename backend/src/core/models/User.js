'use strict';

const { Schema, model } = require('mongoose');
const { ACCESS_LEVELS } = require('../access');

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    // Platform admins run the whole server. Never granted by signing up: the first one
    // is made with `make admin email=...` (scripts/make-admin.js), later ones in the app.
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
    // What this person can do in each app, when a platform admin has limited it
    // (see access.js). Unset means full use of every app.
    access: { type: Map, of: { type: String, enum: ACCESS_LEVELS }, default: undefined },
    // Set when a platform admin made the account or reset its password: the
    // temporary password must be replaced before anything else.
    mustChangePassword: { type: Boolean },
    // When the account last used the app (updated at most once an hour), for the
    // platform stats.
    lastActiveAt: { type: Date },
    // Bumped on password change / "log out everywhere" to invalidate outstanding access tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    return {
      id: String(ret._id),
      email: ret.email,
      name: ret.name,
      role: ret.role || 'user',
      ...(ret.mustChangePassword ? { mustChangePassword: true } : {}),
    };
  },
});

module.exports = model('User', userSchema);

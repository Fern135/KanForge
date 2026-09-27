'use strict';

const { Schema, model } = require('mongoose');

// One document per issued refresh token. Only a SHA-256 hash of the token is
// stored. Tokens rotate on every use; replaying a rotated token revokes the
// whole family (refresh token reuse detection).
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 256 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);

module.exports = model('Session', sessionSchema);

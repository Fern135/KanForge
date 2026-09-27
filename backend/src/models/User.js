'use strict';

const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    passwordHash: { type: String, required: true, select: false },
    // Bumped on password change / "log out everywhere" to invalidate outstanding access tokens.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    return { id: String(ret._id), email: ret.email, name: ret.name };
  },
});

module.exports = model('User', userSchema);

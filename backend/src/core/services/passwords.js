'use strict';

const crypto = require('node:crypto');
const argon2 = require('argon2');

// OWASP-recommended Argon2id parameters (19 MiB, t=2, p=1). This is strong and
// still fast enough to keep login snappy.
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// No look-alike characters (0/O, 1/l/I), so it reads out and types in easily.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ23456789';

// A one-time password a platform admin hands to someone, e.g. "k7Qm-9xRt-Ph3w-cV8n"
// (about 90 bits). The account must replace it at first sign-in.
function temporaryPassword() {
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''));
  return groups.join('-');
}

const hashPassword = (password) => argon2.hash(password, ARGON_OPTS);

module.exports = { ARGON_OPTS, temporaryPassword, hashPassword };

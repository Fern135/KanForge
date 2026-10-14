'use strict';

const crypto = require('node:crypto');
const config = require('../../core/config');

// Two kinds of URL that work without the Authorization header:
//
//   Public links ("anyone with the link can view"): the token is the share's id
//   plus a signature of it. Nothing secret is stored, and deleting the share
//   document revokes the link for good.
//
//   Preview links: the same, for a file's preview image in the grid view. They
//   come with every listing, so they're made to stay the same for an hour at a
//   time and the browser can cache the image.
//
//   Download links: a browser can't add an Authorization header to <img src>,
//   <video src> or a plain download, so a signed-in person first asks for a
//   short-lived signed URL naming one file, then the browser fetches that.
//
// Both are signed with a key derived from JWT_ACCESS_SECRET, so rotating that
// secret (make rotate-jwt) also invalidates every public and download link.

const keyFor = (purpose) => crypto.createHmac('sha256', config.jwt.secret).update(`kanforge-files:${purpose}`).digest();
const SHARE_KEY = keyFor('share-link');
const DOWNLOAD_KEY = keyFor('download');
const THUMB_KEY = keyFor('thumbnail');

const mac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Public links ----------

// 24 hex characters of share id, then 22 of signature (128 bits).
const SHARE_TOKEN = /^([a-f0-9]{24})([A-Za-z0-9_-]{22})$/;

const shareToken = (shareId) => `${shareId}${mac(SHARE_KEY, String(shareId)).slice(0, 22)}`;

// The share id a token names, or null if it's malformed or the signature is wrong.
function parseShareToken(token) {
  const m = SHARE_TOKEN.exec(String(token || ''));
  if (!m) return null;
  return safeEqual(m[2], mac(SHARE_KEY, m[1]).slice(0, 22)) ? m[1] : null;
}

// ---------- Download links ----------

// Long enough for a video to keep seeking (each seek is a new request), short
// enough that a copied link soon stops working.
const DOWNLOAD_TTL_SECONDS = 60 * 60;

// payload: { w: workspace id, n: node id, i: 1 to show in the browser instead of saving }
function downloadToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) + DOWNLOAD_TTL_SECONDS })).toString('base64url');
  return `${body}.${mac(DOWNLOAD_KEY, body)}`;
}

// The payload, or null if the token is malformed, tampered with or expired.
function parseDownloadToken(token) {
  const [body, sig, extra] = String(token || '').split('.');
  if (!body || !sig || extra !== undefined || body.length > 300) return null;
  if (!safeEqual(sig, mac(DOWNLOAD_KEY, body))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.e !== 'number' || payload.e < Date.now() / 1000) return null;
  if (!/^[a-f0-9]{24}$/.test(payload.w) || !/^[a-f0-9]{24}$/.test(payload.n)) return null;
  return payload;
}

// ---------- Preview links ----------

const HOUR = 3600;

// A token for one file's preview image: { w: workspace id, n: node id }. It
// expires at the end of the next whole hour, so every listing in the same hour
// gets the same URL (cacheable) and it always lives between one and two hours.
function thumbToken(payload) {
  const e = (Math.floor(Date.now() / 1000 / HOUR) + 2) * HOUR;
  const body = `${payload.w}.${payload.n}.${e}`;
  return `${body}.${mac(THUMB_KEY, body).slice(0, 22)}`;
}

// { w, n }, or null if the token is malformed, tampered with or expired.
function parseThumbToken(token) {
  const m = /^([a-f0-9]{24})\.([a-f0-9]{24})\.(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(String(token || ''));
  if (!m) return null;
  if (!safeEqual(m[4], mac(THUMB_KEY, `${m[1]}.${m[2]}.${m[3]}`).slice(0, 22))) return null;
  if (Number(m[3]) < Date.now() / 1000) return null;
  return { w: m[1], n: m[2] };
}

module.exports = {
  shareToken, parseShareToken, downloadToken, parseDownloadToken, thumbToken, parseThumbToken, DOWNLOAD_TTL_SECONDS,
};

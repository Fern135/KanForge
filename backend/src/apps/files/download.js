'use strict';

const { pipeline } = require('node:stream/promises');
const storage = require('./storage');
const logger = require('../../core/utils/logger');
const AppError = require('../../core/utils/AppError');

// Sends a file's contents to the browser, streamed from the object store.
//
// Only types a browser shows safely are ever sent with their own type, and only
// when the caller asked to view rather than save (`inline`). Everything else,
// HTML and SVG included, goes out as application/octet-stream with "attachment",
// so a file can never run script on this site. The API's own CSP
// (default-src 'none') and nosniff header back that up.
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/x-wav',
  'application/pdf',
  'text/plain',
]);

const canShowInline = (mime) => INLINE_TYPES.has(mime);

// Content-Disposition with the file's real name (RFC 6266): a plain ASCII
// fallback for old clients, and the exact UTF-8 name for everyone else.
function disposition(kind, name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// A single "bytes=start-end" range (what browsers send when seeking in a video
// or resuming a download). Returns { start, end } (inclusive), null for the
// whole file, or 'invalid' when it can't be satisfied. Multi-range requests
// are answered with the whole file, which the standard allows.
function parseRange(header, size) {
  if (!header || size === 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || start >= size || end < start) return 'invalid';
  return { start, end };
}

// node: a finished file. inline: show it in the browser if its type is safe to.
async function sendFile(req, res, node, { inline = false } = {}) {
  storage.assertConfigured();
  const showInline = inline && canShowInline(node.mime);
  const range = parseRange(req.get('range'), node.size);
  if (range === 'invalid') {
    res.set('Content-Range', `bytes */${node.size}`);
    throw new AppError(416, 'Requested range not satisfiable', 'BAD_RANGE');
  }

  // Stop reading from the store as soon as the browser goes away.
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  let object;
  try {
    object = await storage.read(node.storageKey, range, abort.signal);
  } catch (err) {
    if (storage.isGone(err)) throw AppError.notFound('This file\'s contents are missing');
    throw err;
  }

  res.status(range ? 206 : 200).set({
    'Content-Type': showInline ? `${node.mime}${node.mime === 'text/plain' ? '; charset=utf-8' : ''}` : 'application/octet-stream',
    'Content-Length': String(range ? range.end - range.start + 1 : node.size),
    'Content-Disposition': disposition(showInline ? 'inline' : 'attachment', node.name),
    'Accept-Ranges': 'bytes',
    // The URL is signed and short-lived, and the contents behind it never change.
    'Cache-Control': 'private, max-age=3600',
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${node.size}` } : {}),
  });
  if (req.method === 'HEAD') {
    object.Body.destroy?.();
    return res.end();
  }
  try {
    await pipeline(object.Body, res);
  } catch (err) {
    // The browser cancelled (closed the tab, seeked elsewhere): nothing to report.
    if (abort.signal.aborted || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return undefined;
    logger.warn({ err: err.message, node: String(node._id) }, 'file download interrupted');
    res.destroy();
  }
  return undefined;
}

module.exports = { sendFile, canShowInline, parseRange, disposition, INLINE_TYPES };

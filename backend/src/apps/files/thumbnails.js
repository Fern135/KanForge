'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const FileNode = require('./models/FileNode');
const storage = require('./storage');
const { item } = require('./serialize');
const { requireRole } = require('./tree');
const { ids } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

// Preview images for the grid view, like Google Drive's thumbnails.
//
// The browser makes them, not the server: it already has the file in hand when
// uploading it, and it can draw images, PDFs (pdf.js), Word and PowerPoint files
// and text onto a canvas. That keeps heavy converters (LibreOffice, Poppler) off
// the server. Files uploaded before previews existed get one the first time
// someone who can edit them looks at the grid view.
//
//   PUT  /nodes/:id/thumbnail      the preview image (raw bytes: WebP, JPEG or PNG)
//   POST /nodes/:id/no-thumbnail   this file can't have one, don't try again
//
// Previews are served by the public router (GET /thumb/:token, see public.js),
// through a signed link that comes with each listed item. They don't count
// towards anyone's storage: they're small, and there's one per file at most.

// A preview is a few dozen KB; this leaves plenty of room without letting the
// preview store become free storage.
const MAX_THUMB_BYTES = 400 * 1024;

// The image type, read from the first bytes rather than trusted from the
// browser, so nothing but a real image is ever stored or served as one.
function sniffImage(buf) {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  return null;
}

// Reads the request body into memory, refusing anything over `max` bytes.
async function readBody(req, max) {
  const declared = Number(req.get('content-length'));
  if (!Number.isFinite(declared) || declared <= 0) throw AppError.badRequest('Send the preview image', 'BAD_THUMBNAIL');
  if (declared > max) throw new AppError(413, 'That preview image is too large', 'THUMBNAIL_TOO_LARGE');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new AppError(413, 'That preview image is too large', 'THUMBNAIL_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// A finished file (not a folder, not in the trash) the caller can edit.
async function editableFile(req) {
  const { node } = await requireRole(req, req.params.nodeId, 'edit');
  if (node.kind !== 'file' || node.trashedAt || node.status !== 'ready') {
    throw AppError.badRequest('Only files have previews', 'NOT_A_FILE');
  }
  return node;
}

function thumbnailsRouter() {
  const router = express.Router();

  router.put('/nodes/:nodeId/thumbnail', ids('nodeId'), async (req, res) => {
    storage.assertConfigured();
    if (!req.is('application/octet-stream')) throw AppError.badRequest('Send the preview as application/octet-stream', 'BAD_THUMBNAIL');
    const node = await editableFile(req);
    const body = await readBody(req, MAX_THUMB_BYTES);
    const mime = sniffImage(body);
    if (!mime) throw AppError.badRequest('Previews must be WebP, JPEG or PNG images', 'BAD_THUMBNAIL');
    await storage.put(storage.thumbKeyFor(node.storageKey), body, mime);
    const updated = await FileNode.findOneAndUpdate(
      { _id: node._id },
      { $set: { thumb: 'ready', thumbMime: mime } },
      { returnDocument: 'after' },
    ).lean();
    res.json({ item: item(updated) });
  });

  // Only marks files that have no preview yet: a stored one is never thrown away.
  router.post('/nodes/:nodeId/no-thumbnail', ids('nodeId'), async (req, res) => {
    const node = await editableFile(req);
    await FileNode.updateOne({ _id: node._id, thumb: trusted({ $exists: false }) }, { $set: { thumb: 'none' } });
    res.status(204).end();
  });

  return router;
}

module.exports = { thumbnailsRouter, sniffImage, MAX_THUMB_BYTES };

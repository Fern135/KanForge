'use strict';

const express = require('express');
const { trusted, Types } = require('mongoose');
const OfficeImage = require('./models/OfficeImage');
const OfficeDocument = require('./models/OfficeDocument');
const { body, ids, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// Per person, across every workspace they're in.
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
// A just-uploaded image may not be saved into its document yet, so cleanup leaves new ones alone.
const GRACE_MS = 24 * 60 * 60 * 1000;

const uploadSchema = z.strictObject({
  data: z
    .string()
    .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4, 'Images can be up to 5 MB')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid image data'),
});

// The type comes from the file's own bytes, never from what the client says.
// SVG is deliberately not accepted: it can carry script.
function detectMime(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const everywhere = { allWorkspaces: true };

// Deletes the owner's images that none of their documents (in any workspace,
// including the trash) uses.
async function collectGarbage(ownerId) {
  const used = await OfficeDocument.distinct('imageIds', { owner: ownerId }).setOptions(everywhere);
  await OfficeImage.deleteMany({
    owner: ownerId,
    _id: trusted({ $nin: used }),
    createdAt: trusted({ $lt: new Date(Date.now() - GRACE_MS) }),
  }).setOptions(everywhere);
}

async function usedBytes(ownerId) {
  const [row] = await OfficeImage.aggregate([
    { $match: { owner: new Types.ObjectId(ownerId) } },
    { $group: { _id: null, total: { $sum: '$size' } } },
  ], everywhere);
  return row?.total || 0;
}

// Mounted at /api/office/images.
function imagesRouter(limiters) {
  const router = express.Router();

  router.post('/', limiters.bulk, body(uploadSchema), async (req, res) => {
    const data = Buffer.from(req.body.data, 'base64');
    if (!data.length || data.length > MAX_IMAGE_BYTES) throw AppError.badRequest('Images can be up to 5 MB', 'TOO_LARGE');
    const mime = detectMime(data);
    if (!mime) throw AppError.badRequest('Only PNG, JPEG, GIF and WebP images are supported', 'UNSUPPORTED_IMAGE');

    if ((await usedBytes(req.user.id)) + data.length > MAX_TOTAL_BYTES) {
      await collectGarbage(req.user.id);
      if ((await usedBytes(req.user.id)) + data.length > MAX_TOTAL_BYTES) {
        throw AppError.badRequest('Your documents have reached the 200 MB image limit across all your workspaces', 'LIMIT');
      }
    }
    const image = await OfficeImage.create({ owner: req.user.id, mime, data, size: data.length });
    // Uploads running at the same moment can all pass the check above. If together
    // they went over, this one is undone.
    if ((await usedBytes(req.user.id)) > MAX_TOTAL_BYTES) {
      await OfficeImage.deleteOne({ _id: image._id });
      throw AppError.badRequest('Your documents have reached the 200 MB image limit across all your workspaces', 'LIMIT');
    }
    res.status(201).json({ image: { id: String(image._id), mime, size: data.length } });
  });

  router.get('/:imageId', ids('imageId'), async (req, res) => {
    const image = await OfficeImage.findOne({ owner: req.user.id, _id: req.params.imageId }).lean();
    if (!image) throw AppError.notFound('Image not found');
    // An image never changes once uploaded, so the browser may keep it (privately).
    res.set({
      'Content-Type': image.mime,
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=86400, immutable',
    });
    // lean() returns BSON Binary, whose .buffer holds exactly the image's bytes.
    res.send(Buffer.isBuffer(image.data) ? image.data : Buffer.from(image.data.buffer));
  });

  return router;
}

module.exports = { imagesRouter, collectGarbage };

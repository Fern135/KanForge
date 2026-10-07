'use strict';

const express = require('express');
const User = require('../../core/models/User');
const FileNode = require('./models/FileNode');
const storage = require('./storage');
const limits = require('./limits');
const sweeper = require('./sweeper');
const { item } = require('./serialize');
const {
  childPath, discard, assertItemRoom, targetFolder, nameSchema: name,
} = require('./tree');
const { body, ids, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

// Uploading a file, in three steps, so files of any size get through:
//
//   1. POST   /uploads                      says what's coming (name, size, type, folder).
//      Checks the size limits, reserves the space and starts a multipart upload
//      in the object store. Answers with the part size and how many parts to send.
//   2. PUT    /uploads/:id/parts/:n         sends part n (raw bytes, application/
//      octet-stream). Parts can go in any order, several at a time, and a failed
//      part can simply be sent again.
//   3. POST   /uploads/:id/complete         once every part is in: the store joins
//      them, and the file appears in its folder.
//
//   DELETE /uploads/:id cancels, throwing away whatever arrived.
//
// Each part streams from the request straight into the object store, so the API
// never holds more than a little of a file in memory, however large it is.
// Uploads abandoned midway are cleaned up by the sweeper after a day.

const MB = 1024 * 1024;
// S3 needs every part but the last to be at least 5 MB, and allows 10,000 parts.
// Parts stay small enough to arrive well within the server's 30 second limit
// for one request on an ordinary connection.
const MIN_PART_BYTES = 5 * MB;
const MAX_PARTS = 10_000;

const partSizeFor = (size) => Math.max(MIN_PART_BYTES, Math.ceil(size / MAX_PARTS / MB) * MB);
const partCountOf = (node) => Math.max(1, Math.ceil(node.size / node.partSize));
// Every part is partSize bytes except the last, which gets whatever is left.
const partLength = (node, n) => (n < partCountOf(node) ? node.partSize : node.size - node.partSize * (partCountOf(node) - 1));

// The browser's reported type, kept only to pick how a download is served (see
// download.js). Anything odd is stored as a generic binary file.
const mime = z
  .string()
  .trim()
  .toLowerCase()
  .max(255)
  .transform((m) => (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) ? m : 'application/octet-stream'));

const startSchema = z.strictObject({
  name,
  size: z.number().int().min(0).max(limits.TECHNICAL_MAX_FILE_BYTES),
  mime: mime.default('application/octet-stream'),
  parentId: z.string().regex(/^[a-f0-9]{24}$/).nullable().default(null),
});

// The caller's own upload that is still in progress.
async function findUpload(req) {
  const node = await FileNode.findOne({ _id: req.params.uploadId, status: 'uploading', uploadedBy: req.user.id }).lean();
  if (!node) throw AppError.notFound('Upload not found. It may have been cancelled or finished already.', 'UPLOAD_NOT_FOUND');
  return node;
}

function uploadsRouter() {
  const router = express.Router();

  router.post('/', body(startSchema), async (req, res) => {
    storage.assertConfigured();
    const parent = await targetFolder(req, req.body.parentId);
    // Files in a shared folder belong to the folder's owner and use their storage.
    const ownerId = parent ? String(parent.owner) : req.user.id;
    const ownerName = ownerId === req.user.id ? null : (await User.findById(ownerId).select('name').lean())?.name;
    await assertItemRoom(ownerId);
    const lim = await limits.assertFits({ ownerId, ownerName, workspace: req.workspace, size: req.body.size });

    const node = new FileNode({
      owner: ownerId,
      kind: 'file',
      name: req.body.name,
      nameKey: req.body.name.toLowerCase(),
      parent: parent ? parent._id : null,
      path: childPath(parent),
      size: req.body.size,
      mime: req.body.mime,
      status: 'uploading',
      uploadedBy: req.user.id,
      partSize: partSizeFor(req.body.size),
    });
    node.storageKey = storage.keyFor(node._id);

    // An empty file has nothing to send: store it and finish right away.
    if (req.body.size === 0) {
      await storage.putEmpty(node.storageKey, node.mime);
      node.status = 'ready';
      node.partSize = undefined;
      await node.save();
      return res.status(201).json({ done: true, item: item(node.toObject()) });
    }

    // Saved first, so its size is reserved before anything is sent. Uploads
    // starting at the same moment can all pass the check above: if together
    // they went over, this one is undone.
    await node.save();
    if (!(await limits.stillFits(ownerId, lim))) {
      await FileNode.deleteOne({ _id: node._id });
      throw limits.storageFull(lim, ownerName);
    }
    try {
      const uploadId = await storage.createUpload(node.storageKey, node.mime);
      await FileNode.updateOne({ _id: node._id }, { $set: { uploadId } });
    } catch (err) {
      await FileNode.deleteOne({ _id: node._id });
      throw err;
    }
    return res.status(201).json({
      done: false,
      upload: { id: String(node._id), partSize: node.partSize, partCount: partCountOf(node) },
    });
  });

  router.put('/:uploadId/parts/:partNumber', ids('uploadId'), async (req, res) => {
    storage.assertConfigured();
    if (!req.is('application/octet-stream')) throw AppError.badRequest('Send the part as application/octet-stream', 'BAD_PART');
    const node = await findUpload(req);
    const n = Number(req.params.partNumber);
    if (!Number.isInteger(n) || n < 1 || n > partCountOf(node)) throw AppError.badRequest('No such part', 'BAD_PART');

    // The size must be declared up front and match exactly: the store is told
    // how many bytes to expect before they arrive.
    const expected = partLength(node, n);
    if (Number(req.get('content-length')) !== expected) {
      throw AppError.badRequest(`Part ${n} must be exactly ${expected} bytes`, 'BAD_PART');
    }

    // If the browser goes away mid-part, stop waiting for the rest of it.
    const abort = new AbortController();
    req.on('close', () => !req.complete && abort.abort());
    try {
      await storage.uploadPart({ key: node.storageKey, uploadId: node.uploadId, partNumber: n, body: req, length: expected, signal: abort.signal });
    } catch (err) {
      if (abort.signal.aborted) return undefined;
      if (storage.isGone(err)) throw AppError.notFound('Upload not found. It may have been cancelled.', 'UPLOAD_NOT_FOUND');
      throw err;
    }
    // Activity keeps the sweeper from treating the upload as abandoned.
    await FileNode.updateOne({ _id: node._id }, { $set: { updatedAt: new Date() } });
    return res.status(204).end();
  });

  router.post('/:uploadId/complete', ids('uploadId'), async (req, res) => {
    storage.assertConfigured();
    const node = await findUpload(req);
    const count = partCountOf(node);
    // The store's own list of what arrived decides, not anything the browser says.
    const received = new Map((await storage.listParts(node.storageKey, node.uploadId)).map((p) => [p.PartNumber, p]));
    const missing = [];
    for (let n = 1; n <= count; n += 1) {
      if (received.get(n)?.Size !== partLength(node, n)) missing.push(n);
    }
    if (missing.length) {
      return res.status(400).json({ error: { code: 'PARTS_MISSING', message: 'Some parts haven\'t arrived yet', missing: missing.slice(0, 100) } });
    }
    await storage.completeUpload(node.storageKey, node.uploadId, [...received.values()].sort((a, b) => a.PartNumber - b.PartNumber));
    const done = await FileNode.findOneAndUpdate(
      { _id: node._id, status: 'uploading' },
      { $set: { status: 'ready' }, $unset: { uploadId: '', partSize: '' } },
      { returnDocument: 'after' },
    ).lean();
    if (!done) throw AppError.notFound('Upload not found. It may have been cancelled.', 'UPLOAD_NOT_FOUND');
    return res.json({ item: item(done) });
  });

  router.delete('/:uploadId', ids('uploadId'), async (req, res) => {
    const node = await findUpload(req);
    await discard([node]);
    sweeper.kick();
    res.status(204).end();
  });

  return router;
}

module.exports = { uploadsRouter, partSizeFor, MIN_PART_BYTES };

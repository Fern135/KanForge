'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const OfficeDocument = require('./models/OfficeDocument');
const OfficeFolder = require('./models/OfficeFolder');
const folders = require('./folders');
const { collectGarbage } = require('./images');
const { sanitizeDocContent, EMPTY_DOC, PAGE_SIZES, DEFAULT_SETTINGS } = require('./docContent');
const { body, ids, objectId, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

const MAX_DOCUMENTS_PER_USER = 1000;
const MAX_LISTED = 1000;

// Each kind's content check. Sheets and Slides join when their editors do.
const KINDS = {
  doc: { sanitize: sanitizeDocContent, empty: () => EMPTY_DOC, name: 'Untitled document' },
};
const kind = z.enum(Object.keys(KINDS));

const title = z.string().trim().max(200);
const margin = z.number().min(0).max(100);
const settingsSchema = z.strictObject({
  pageSize: z.enum(PAGE_SIZES),
  orientation: z.enum(['portrait', 'landscape']),
  margins: z.strictObject({ top: margin, right: margin, bottom: margin, left: margin }),
});
const folderId = objectId.nullable().optional();

const createSchema = z.strictObject({
  kind,
  title: title.optional(),
  content: z.unknown().optional(),
  settings: settingsSchema.optional(),
  folderId,
});
const updateSchema = z
  .strictObject({
    title: title.optional(),
    content: z.unknown().optional(),
    settings: settingsSchema.optional(),
    folderId,
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update')
  .refine((v) => (v.title === undefined && v.content === undefined && v.settings === undefined) || v.version !== undefined, {
    message: 'version is required when changing the title, content or page setup',
    path: ['version'],
  });
const listQuery = z.object({
  view: z.enum(['active', 'trash']).default('active'),
  q: z.string().trim().max(100).optional(),
  kind: kind.optional(),
  folder: z.union([objectId, z.literal('unfiled')]).optional(),
  deep: z.enum(['0', '1']).optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (d) => (d ? new Date(d).toISOString() : null);

const summary = (d) => ({
  id: String(d._id),
  kind: d.kind,
  title: d.title,
  folderId: d.folder ? String(d.folder) : null,
  size: d.size || 0,
  trashedAt: iso(d.trashedAt),
  createdAt: iso(d.createdAt),
  updatedAt: iso(d.updatedAt),
  version: d.version,
});
const full = (d) => ({
  ...summary(d),
  content: d.content,
  settings: {
    pageSize: d.settings?.pageSize || DEFAULT_SETTINGS.pageSize,
    orientation: d.settings?.orientation || DEFAULT_SETTINGS.orientation,
    margins: d.settings?.margins || DEFAULT_SETTINGS.margins,
  },
});

const mine = (req, extra = {}) => ({ owner: req.user.id, ...extra });

async function findMine(req) {
  const doc = await OfficeDocument.findOne(mine(req, { _id: req.params.docId })).lean();
  if (!doc) throw AppError.notFound('Document not found');
  return doc;
}

async function resolveFolder(req, id) {
  if (!id) return null;
  return (await folders.findFolder(req.user.id, id))._id;
}

async function assertRoom(req) {
  if ((await OfficeDocument.countDocuments(mine(req))) >= MAX_DOCUMENTS_PER_USER) {
    throw AppError.badRequest(`You can have up to ${MAX_DOCUMENTS_PER_USER} documents, including the trash`, 'LIMIT');
  }
}

// Clean content plus the fields derived from it.
function contentFields(docKind, content) {
  const { doc, text, imageIds } = KINDS[docKind].sanitize(content);
  return { content: doc, text, imageIds, size: JSON.stringify(doc).length };
}

// Mounted at /api/office/documents.
module.exports = function documentsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const { view, q, kind: byKind, folder, deep } = listQuery.parse(req.query);
    const filter = mine(req, { trashedAt: view === 'trash' ? trusted({ $ne: null }) : null });
    if (byKind) filter.kind = byKind;
    if (folder && view !== 'trash') {
      if (folder === 'unfiled') filter.folder = null;
      else filter.folder = deep === '1' ? trusted({ $in: await folders.subtreeIds(req.user.id, folder) }) : folder;
    }
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: re }, { text: re }];
    }
    const sort = view === 'trash' ? { trashedAt: -1 } : { updatedAt: -1 };
    const docs = await OfficeDocument.find(filter).sort(sort).limit(MAX_LISTED).select('-content -text -imageIds').lean();
    res.json({ documents: docs.map(summary) });
  });

  router.post('/', body(createSchema), async (req, res) => {
    await assertRoom(req);
    const fields = contentFields(req.body.kind, req.body.content ?? KINDS[req.body.kind].empty());
    const doc = await OfficeDocument.create({
      owner: req.user.id,
      kind: req.body.kind,
      title: req.body.title ?? '',
      settings: req.body.settings ?? DEFAULT_SETTINGS,
      folder: await resolveFolder(req, req.body.folderId),
      ...fields,
    });
    res.status(201).json({ document: full(doc.toObject()) });
  });

  router.delete('/trash', async (req, res) => {
    const r = await OfficeDocument.deleteMany(mine(req, { trashedAt: trusted({ $ne: null }) }));
    await collectGarbage(req.user.id);
    res.json({ deleted: r.deletedCount });
  });

  router.get('/:docId', ids('docId'), async (req, res) => {
    res.json({ document: full(await findMine(req)) });
  });

  router.patch('/:docId', ids('docId'), body(updateSchema), async (req, res) => {
    const current = await findMine(req);
    if (current.trashedAt) throw AppError.badRequest('Restore the document from the trash to edit it', 'IN_TRASH');

    const { version, content, folderId: moveTo, ...fields } = req.body;
    const set = { ...fields };
    if (content !== undefined) Object.assign(set, contentFields(current.kind, content));
    if (moveTo !== undefined) set.folder = await resolveFolder(req, moveTo);

    // Title, content and page-setup changes only apply to the version the client last saw.
    const edits = req.body.title !== undefined || content !== undefined || req.body.settings !== undefined;
    const filter = mine(req, { _id: req.params.docId, trashedAt: null });
    if (edits) filter.version = version;
    const update = edits ? { $set: set, $inc: { version: 1 } } : { $set: set };

    const doc = await OfficeDocument.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!doc) throw AppError.conflict('This document was changed somewhere else', 'VERSION_CONFLICT');
    res.json({ document: full(doc) });
  });

  // "Make a copy", placed next to the original.
  router.post('/:docId/copy', ids('docId'), async (req, res) => {
    const source = await findMine(req);
    await assertRoom(req);
    const doc = await OfficeDocument.create({
      owner: req.user.id,
      kind: source.kind,
      title: `Copy of ${source.title || KINDS[source.kind]?.name || 'document'}`.slice(0, 200),
      content: source.content,
      text: source.text,
      imageIds: source.imageIds,
      size: source.size,
      settings: source.settings,
      folder: source.folder,
    });
    res.status(201).json({ document: summary(doc.toObject()) });
  });

  router.post('/:docId/trash', ids('docId'), async (req, res) => {
    const doc = await OfficeDocument.findOneAndUpdate(
      mine(req, { _id: req.params.docId, trashedAt: null }),
      { $set: { trashedAt: new Date() } },
      { new: true },
    ).lean();
    if (!doc) throw AppError.notFound('Document not found');
    res.json({ document: summary(doc) });
  });

  // A document whose folder was deleted meanwhile comes back unfiled.
  router.post('/:docId/restore', ids('docId'), async (req, res) => {
    const current = await findMine(req);
    const folderGone = current.folder && !(await OfficeFolder.exists({ owner: req.user.id, _id: current.folder }));
    const doc = await OfficeDocument.findOneAndUpdate(
      mine(req, { _id: req.params.docId, trashedAt: trusted({ $ne: null }) }),
      { $set: folderGone ? { trashedAt: null, folder: null } : { trashedAt: null } },
      { new: true },
    ).lean();
    if (!doc) throw AppError.notFound('Document not found');
    res.json({ document: summary(doc) });
  });

  // Permanent. Only documents already in the trash can be deleted.
  router.delete('/:docId', ids('docId'), async (req, res) => {
    const r = await OfficeDocument.deleteOne(mine(req, { _id: req.params.docId, trashedAt: trusted({ $ne: null }) }));
    if (!r.deletedCount) {
      await findMine(req);
      throw AppError.badRequest('Move the document to the trash first', 'NOT_IN_TRASH');
    }
    await collectGarbage(req.user.id);
    res.status(204).end();
  });

  return router;
};

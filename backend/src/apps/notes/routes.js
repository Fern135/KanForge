'use strict';

const express = require('express');
const { trusted, Types } = require('mongoose');
const Note = require('./models/Note');
const NoteFolder = require('./models/NoteFolder');
const { sanitizeDoc, EMPTY_DOC } = require('./content');
const folders = require('./folders');
const { namePaths, folderName, MAX_DEPTH } = require('../../core/services/folderTree');

const { findFolder, subtreeIds, listFolders, ensurePath } = folders;
const { body, ids, objectId, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

const MAX_NOTES_PER_USER = 2000;
const MAX_LISTED = 1000;
const MAX_IMPORT = 100;
const PREVIEW_LENGTH = 160;

const title = z.string().trim().max(200);
const tag = z.string().trim().toLowerCase().min(1).max(30).regex(/^[^<>#,]+$/, 'Tags cannot contain < > # or ,');
const tags = z.array(tag).max(20).transform((list) => [...new Set(list)]);

const folderId = objectId.nullable().optional();
const createSchema = z.strictObject({
  title: title.optional(),
  content: z.unknown().optional(),
  tags: tags.optional(),
  folderId,
});
const updateSchema = z
  .strictObject({
    title: title.optional(),
    content: z.unknown().optional(),
    tags: tags.optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    folderId,
    version: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), 'Nothing to update')
  .refine((v) => (v.title === undefined && v.content === undefined) || v.version !== undefined, {
    message: 'version is required when changing the title or content',
    path: ['version'],
  });
const importSchema = z.strictObject({
  notes: z
    .array(z.strictObject({ title, content: z.unknown(), tags: tags.optional(), folderPath: z.array(folderName).max(MAX_DEPTH).optional() }))
    .min(1)
    .max(MAX_IMPORT),
});
const listQuery = z.object({
  view: z.enum(['active', 'archived', 'trash']).default('active'),
  q: z.string().trim().max(100).optional(),
  tag: tag.optional(),
  // A folder id, or "unfiled" for notes outside every folder.
  folder: z.union([objectId, z.literal('unfiled')]).optional(),
  // "1" includes notes in the folder's subfolders.
  deep: z.enum(['0', '1']).optional(),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (d) => (d ? new Date(d).toISOString() : null);

const summary = (n) => ({
  id: String(n._id),
  title: n.title,
  preview: (n.text || '').replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH),
  tags: n.tags || [],
  folderId: n.folder ? String(n.folder) : null,
  pinned: Boolean(n.pinned),
  archived: Boolean(n.archived),
  trashedAt: iso(n.trashedAt),
  updatedAt: iso(n.updatedAt),
  version: n.version,
});
const full = (n) => ({ ...summary(n), content: n.content });

// Every query is scoped to the caller, so other people's notes read as missing.
const mine = (req, extra = {}) => ({ owner: req.user.id, ...extra });

async function findMine(req) {
  const note = await Note.findOne(mine(req, { _id: req.params.noteId })).lean();
  if (!note) throw AppError.notFound('Note not found');
  return note;
}

async function assertRoom(req, adding) {
  const count = await Note.countDocuments(mine(req));
  if (count + adding > MAX_NOTES_PER_USER) {
    throw AppError.badRequest(`You can have up to ${MAX_NOTES_PER_USER} notes, including the trash`, 'LIMIT');
  }
}

// null for "no folder"; otherwise the folder, which must belong to the caller.
async function resolveFolder(req, id) {
  if (!id) return null;
  return (await findFolder(req.user.id, id))._id;
}

module.exports = function notesRouter(limiters) {
  const router = express.Router();

  router.use('/folders', folders.router());

  router.get('/', async (req, res) => {
    const { view, q, tag: byTag, folder, deep } = listQuery.parse(req.query);
    const filter = mine(req);
    if (view === 'trash') {
      filter.trashedAt = trusted({ $ne: null });
    } else {
      filter.trashedAt = null;
      filter.archived = view === 'archived';
    }
    if (byTag) filter.tags = byTag;
    // The trash lists everything, whatever folder it came from.
    if (folder && view !== 'trash') {
      if (folder === 'unfiled') filter.folder = null;
      else filter.folder = deep === '1' ? trusted({ $in: await subtreeIds(req.user.id, folder) }) : folder;
    }
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: re }, { text: re }];
    }
    const sort = view === 'trash' ? { trashedAt: -1 } : { pinned: -1, updatedAt: -1 };
    const notes = await Note.find(filter).sort(sort).limit(MAX_LISTED).select('-content').lean();
    res.json({ notes: notes.map(summary) });
  });

  // Tags on notes that aren't in the trash, with how many notes use each.
  router.get('/tags', async (req, res) => {
    const rows = await Note.aggregate([
      { $match: { owner: new Types.ObjectId(req.user.id), trashedAt: null } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    res.json({ tags: rows.map((r) => ({ name: r._id, count: r.count })) });
  });

  // Every note outside the trash, with content. Streamed so a large account
  // doesn't build the whole response in memory.
  // Each note carries its folder path (names from the top down) so the export can rebuild the tree.
  router.get('/export', limiters.bulk, async (req, res) => {
    const paths = namePaths(await listFolders(req.user.id));
    res.type('application/json');
    res.write('{"notes":[');
    let first = true;
    const cursor = Note.find(mine(req, { trashedAt: null })).sort({ updatedAt: -1 }).lean().cursor();
    for await (const note of cursor) {
      const folderPath = note.folder ? paths.get(String(note.folder)) ?? [] : [];
      res.write((first ? '' : ',') + JSON.stringify({ ...full(note), folderPath }));
      first = false;
    }
    res.end(']}');
  });

  router.post('/', body(createSchema), async (req, res) => {
    await assertRoom(req, 1);
    const { doc, text } = req.body.content === undefined ? { doc: EMPTY_DOC, text: '' } : sanitizeDoc(req.body.content);
    const folder = await resolveFolder(req, req.body.folderId);
    const note = await Note.create({
      owner: req.user.id,
      folder,
      title: req.body.title ?? '',
      content: doc,
      text,
      tags: req.body.tags ?? [],
    });
    res.status(201).json({ note: full(note.toObject()) });
  });

  // Every note is checked before anything is saved. Folders named in
  // folderPath are found or created, so an imported folder tree is rebuilt.
  router.post('/import', limiters.bulk, body(importSchema), async (req, res) => {
    await assertRoom(req, req.body.notes.length);
    const docs = req.body.notes.map((n) => {
      const { doc, text } = sanitizeDoc(n.content);
      return { owner: req.user.id, title: n.title, content: doc, text, tags: n.tags ?? [], folderPath: n.folderPath ?? [] };
    });
    const cache = new Map();
    for (const d of docs) {
      d.folder = d.folderPath.length ? await ensurePath(req.user.id, d.folderPath, cache) : null;
      delete d.folderPath;
    }
    const created = await Note.insertMany(docs);
    res.status(201).json({ imported: created.length });
  });

  router.delete('/trash', async (req, res) => {
    const r = await Note.deleteMany(mine(req, { trashedAt: trusted({ $ne: null }) }));
    res.json({ deleted: r.deletedCount });
  });

  router.get('/:noteId', ids('noteId'), async (req, res) => {
    res.json({ note: full(await findMine(req)) });
  });

  router.patch('/:noteId', ids('noteId'), body(updateSchema), async (req, res) => {
    const current = await findMine(req);
    if (current.trashedAt) throw AppError.badRequest('Restore the note from the trash to edit it', 'IN_TRASH');

    const { version, content, folderId: moveTo, ...fields } = req.body;
    const set = { ...fields };
    if (moveTo !== undefined) set.folder = await resolveFolder(req, moveTo);
    if (content !== undefined) Object.assign(set, (({ doc, text }) => ({ content: doc, text }))(sanitizeDoc(content)));

    // Title and content changes only apply to the version the client last saw.
    const editsText = req.body.title !== undefined || content !== undefined;
    const filter = mine(req, { _id: req.params.noteId, trashedAt: null });
    if (editsText) filter.version = version;
    const update = editsText ? { $set: set, $inc: { version: 1 } } : { $set: set };

    const note = await Note.findOneAndUpdate(filter, update, { new: true }).lean();
    if (!note) throw AppError.conflict('This note was changed somewhere else', 'VERSION_CONFLICT');
    res.json({ note: full(note) });
  });

  router.post('/:noteId/trash', ids('noteId'), async (req, res) => {
    const note = await Note.findOneAndUpdate(
      mine(req, { _id: req.params.noteId, trashedAt: null }),
      { $set: { trashedAt: new Date(), pinned: false } },
      { new: true },
    ).lean();
    if (!note) throw AppError.notFound('Note not found');
    res.json({ note: summary(note) });
  });

  // A note whose folder was deleted meanwhile comes back unfiled.
  router.post('/:noteId/restore', ids('noteId'), async (req, res) => {
    const current = await findMine(req);
    const folderGone = current.folder && !(await NoteFolder.exists({ owner: req.user.id, _id: current.folder }));
    const note = await Note.findOneAndUpdate(
      mine(req, { _id: req.params.noteId, trashedAt: trusted({ $ne: null }) }),
      { $set: folderGone ? { trashedAt: null, folder: null } : { trashedAt: null } },
      { new: true },
    ).lean();
    if (!note) throw AppError.notFound('Note not found');
    res.json({ note: summary(note) });
  });

  // Permanent. Only notes already in the trash can be deleted.
  router.delete('/:noteId', ids('noteId'), async (req, res) => {
    const r = await Note.deleteOne(mine(req, { _id: req.params.noteId, trashedAt: trusted({ $ne: null }) }));
    if (!r.deletedCount) {
      await findMine(req);
      throw AppError.badRequest('Move the note to the trash first', 'NOT_IN_TRASH');
    }
    res.status(204).end();
  });

  return router;
};

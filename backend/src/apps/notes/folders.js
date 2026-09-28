'use strict';

const express = require('express');
const { trusted, Types } = require('mongoose');
const Note = require('./models/Note');
const NoteFolder = require('./models/NoteFolder');
const { body, ids, objectId, z } = require('../../core/middleware/validate');
const AppError = require('../../core/utils/AppError');

const MAX_DEPTH = 10;
const MAX_FOLDERS_PER_USER = 500;

const folderName = z
  .string()
  .trim()
  .min(1, 'Folder name is required')
  .max(100)
  .regex(/^[^/\\<>\u0000-\u001f]+$/, 'Folder names cannot contain / \\ < or >');

const createSchema = z.strictObject({ name: folderName, parentId: objectId.nullable().optional() });
const updateSchema = z
  .strictObject({ name: folderName.optional(), parentId: objectId.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const nameTaken = () => AppError.conflict('A folder with that name is already there', 'FOLDER_EXISTS');
const tooDeep = () => AppError.badRequest(`Folders can be nested up to ${MAX_DEPTH} levels deep`, 'TOO_DEEP');

// ---------- Helpers shared with the note routes ----------

const listFolders = (ownerId) => NoteFolder.find({ owner: ownerId }).select('name parent path').lean();

async function findFolder(ownerId, folderId) {
  const folder = await NoteFolder.findOne({ owner: ownerId, _id: folderId }).lean();
  if (!folder) throw AppError.notFound('Folder not found');
  return folder;
}

// The folder and everything inside it, at any depth.
async function subtreeIds(ownerId, folderId) {
  const inside = await NoteFolder.find({ owner: ownerId, path: folderId }).select('_id').lean();
  return [new Types.ObjectId(String(folderId)), ...inside.map((f) => f._id)];
}

// Each folder's names from the top down, e.g. ["Work", "Clients"].
function namePaths(folders) {
  const byId = new Map(folders.map((f) => [String(f._id), f]));
  return new Map(folders.map((f) => [String(f._id), [...f.path.map((id) => byId.get(String(id))?.name ?? ''), f.name]]));
}

async function assertRoom(ownerId, adding = 1) {
  if ((await NoteFolder.countDocuments({ owner: ownerId })) + adding > MAX_FOLDERS_PER_USER) {
    throw AppError.badRequest(`You can have up to ${MAX_FOLDERS_PER_USER} folders`, 'LIMIT');
  }
}

async function createFolder(ownerId, name, parent) {
  if (parent && parent.path.length + 1 >= MAX_DEPTH) throw tooDeep();
  try {
    const folder = await NoteFolder.create({
      owner: ownerId,
      name,
      nameKey: name.toLowerCase(),
      parent: parent?._id ?? null,
      path: parent ? [...parent.path, parent._id] : [],
    });
    return folder.toObject();
  } catch (err) {
    if (err?.code === 11000) throw nameTaken();
    throw err;
  }
}

// Finds or creates each folder along a path of names (for imports). `cache`
// is shared across one import so repeated paths cost one lookup.
async function ensurePath(ownerId, names, cache) {
  let parent = null;
  for (let i = 0; i < names.length; i += 1) {
    const key = names.slice(0, i + 1).map((n) => n.toLowerCase()).join('/');
    if (!cache.has(key)) {
      let folder = await NoteFolder.findOne({ owner: ownerId, parent: parent?._id ?? null, nameKey: names[i].toLowerCase() }).lean();
      if (!folder) {
        await assertRoom(ownerId);
        try {
          folder = await createFolder(ownerId, names[i], parent);
        } catch (err) {
          // Created by a concurrent request in the meantime.
          if (err.code !== 'FOLDER_EXISTS') throw err;
          folder = await NoteFolder.findOne({ owner: ownerId, parent: parent?._id ?? null, nameKey: names[i].toLowerCase() }).lean();
        }
      }
      cache.set(key, folder);
    }
    parent = cache.get(key);
  }
  return parent?._id ?? null;
}

// Folders with how many notes (outside the trash) sit directly in each.
async function foldersPayload(ownerId) {
  const [folders, counts] = await Promise.all([
    listFolders(ownerId),
    Note.aggregate([
      { $match: { owner: new Types.ObjectId(ownerId), trashedAt: null, folder: { $ne: null } } },
      { $group: { _id: '$folder', count: { $sum: 1 } } },
    ]),
  ]);
  const byFolder = new Map(counts.map((c) => [String(c._id), c.count]));
  return folders
    .map((f) => ({
      id: String(f._id),
      name: f.name,
      parentId: f.parent ? String(f.parent) : null,
      noteCount: byFolder.get(String(f._id)) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

// ---------- Routes, mounted at /api/notes/folders ----------

function foldersRouter() {
  const router = express.Router();

  // Also counts notes outside the trash in total and outside every folder, for "All notes" and "Unfiled".
  router.get('/', async (req, res) => {
    const owner = req.user.id;
    const [folders, totalCount, unfiledCount] = await Promise.all([
      foldersPayload(owner),
      Note.countDocuments({ owner, trashedAt: null }),
      Note.countDocuments({ owner, trashedAt: null, folder: null }),
    ]);
    res.json({ folders, totalCount, unfiledCount });
  });

  router.post('/', body(createSchema), async (req, res) => {
    await assertRoom(req.user.id);
    const parent = req.body.parentId ? await findFolder(req.user.id, req.body.parentId) : null;
    const folder = await createFolder(req.user.id, req.body.name, parent);
    res.status(201).json({
      folder: { id: String(folder._id), name: folder.name, parentId: folder.parent ? String(folder.parent) : null, noteCount: 0 },
    });
  });

  // Renames and/or moves a folder. Moving takes its whole subtree along.
  router.patch('/:folderId', ids('folderId'), body(updateSchema), async (req, res) => {
    const owner = req.user.id;
    const folder = await findFolder(owner, req.params.folderId);
    const set = {};
    if (req.body.name !== undefined) Object.assign(set, { name: req.body.name, nameKey: req.body.name.toLowerCase() });

    const moving = req.body.parentId !== undefined && String(req.body.parentId) !== String(folder.parent ?? null);
    let inside = [];
    let newPath = folder.path;
    if (moving) {
      const target = req.body.parentId ? await findFolder(owner, req.body.parentId) : null;
      if (target && (String(target._id) === String(folder._id) || target.path.some((id) => String(id) === String(folder._id)))) {
        throw AppError.badRequest("A folder can't go inside itself", 'FOLDER_CYCLE');
      }
      newPath = target ? [...target.path, target._id] : [];
      inside = await NoteFolder.find({ owner, path: folder._id }).select('path').lean();
      const deepest = Math.max(0, ...inside.map((f) => f.path.length - folder.path.length));
      if (newPath.length + 1 + deepest > MAX_DEPTH) throw tooDeep();
      Object.assign(set, { parent: target?._id ?? null, path: newPath });
    }

    try {
      await NoteFolder.updateOne({ owner, _id: folder._id }, { $set: set });
    } catch (err) {
      if (err?.code === 11000) throw nameTaken();
      throw err;
    }
    if (inside.length) {
      // Rewrite every descendant's ancestor list: the new path, this folder, then whatever sat below it.
      await NoteFolder.bulkWrite(inside.map((f) => ({
        updateOne: {
          filter: { owner, _id: f._id },
          update: { $set: { path: [...newPath, folder._id, ...f.path.slice(folder.path.length + 1)] } },
        },
      })));
    }
    res.json({ folders: await foldersPayload(owner) });
  });

  // Deletes the folder and its subfolders. Their notes go to the trash (and
  // come back unfiled if restored).
  router.delete('/:folderId', ids('folderId'), async (req, res) => {
    const owner = req.user.id;
    await findFolder(owner, req.params.folderId);
    const all = await subtreeIds(owner, req.params.folderId);
    const inFolders = { owner, folder: trusted({ $in: all }) };
    const trashed = await Note.updateMany({ ...inFolders, trashedAt: null }, { $set: { trashedAt: new Date(), pinned: false } });
    await Note.updateMany(inFolders, { $set: { folder: null } });
    const removed = await NoteFolder.deleteMany({ owner, _id: trusted({ $in: all }) });
    res.json({ deletedFolders: removed.deletedCount, trashedNotes: trashed.modifiedCount, folders: await foldersPayload(owner) });
  });

  return router;
}

module.exports = {
  foldersRouter,
  findFolder,
  subtreeIds,
  namePaths,
  listFolders,
  ensurePath,
  folderName,
  MAX_DEPTH,
};

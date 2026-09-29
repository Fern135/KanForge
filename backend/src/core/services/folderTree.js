'use strict';

const express = require('express');
const { trusted, Types } = require('mongoose');
const { body, ids, objectId, z } = require('../middleware/validate');
const AppError = require('../utils/AppError');

// Nested folders for any app whose items (notes, documents, ...) live in them.
// createFolderTree() takes the app's folder model and item model and returns
// the folder routes plus helpers for the app's own item routes.
//
// Folder model fields: owner, name, nameKey (lowercased name), parent, path
// (ancestor ids, top down). Items need: owner, folder, trashedAt.
// Names are unique among siblings (a unique index on owner + parent + nameKey).

const MAX_DEPTH = 10;

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

// Each folder's names from the top down, e.g. ["Work", "Clients"].
function namePaths(folders) {
  const byId = new Map(folders.map((f) => [String(f._id), f]));
  return new Map(folders.map((f) => [String(f._id), [...f.path.map((id) => byId.get(String(id))?.name ?? ''), f.name]]));
}

// trashSet: extra fields set on items when their folder is deleted (e.g. { pinned: false }).
function createFolderTree({ Folder, Item, maxFolders = 500, trashSet = {} }) {
  const listFolders = (ownerId) => Folder.find({ owner: ownerId }).select('name parent path').lean();

  async function findFolder(ownerId, folderId) {
    const folder = await Folder.findOne({ owner: ownerId, _id: folderId }).lean();
    if (!folder) throw AppError.notFound('Folder not found');
    return folder;
  }

  // The folder and everything inside it, at any depth.
  async function subtreeIds(ownerId, folderId) {
    const inside = await Folder.find({ owner: ownerId, path: folderId }).select('_id').lean();
    return [new Types.ObjectId(String(folderId)), ...inside.map((f) => f._id)];
  }

  async function assertRoom(ownerId, adding = 1) {
    if ((await Folder.countDocuments({ owner: ownerId })) + adding > maxFolders) {
      throw AppError.badRequest(`You can have up to ${maxFolders} folders`, 'LIMIT');
    }
  }

  async function createFolder(ownerId, name, parent) {
    if (parent && parent.path.length + 1 >= MAX_DEPTH) throw tooDeep();
    try {
      const folder = await Folder.create({
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

  const findChild = (ownerId, parent, name) =>
    Folder.findOne({ owner: ownerId, parent: parent?._id ?? null, nameKey: name.toLowerCase() }).lean();

  // Finds or creates each folder along a path of names (for imports). `cache`
  // is shared across one import so repeated paths cost one lookup.
  async function ensurePath(ownerId, names, cache) {
    let parent = null;
    for (let i = 0; i < names.length; i += 1) {
      const key = names.slice(0, i + 1).map((n) => n.toLowerCase()).join('/');
      if (!cache.has(key)) {
        let folder = await findChild(ownerId, parent, names[i]);
        if (!folder) {
          await assertRoom(ownerId);
          try {
            folder = await createFolder(ownerId, names[i], parent);
          } catch (err) {
            // Created by a concurrent request in the meantime.
            if (err.code !== 'FOLDER_EXISTS') throw err;
            folder = await findChild(ownerId, parent, names[i]);
          }
        }
        cache.set(key, folder);
      }
      parent = cache.get(key);
    }
    return parent?._id ?? null;
  }

  // Folders with how many items (outside the trash) sit directly in each.
  async function foldersPayload(ownerId) {
    const [folders, counts] = await Promise.all([
      listFolders(ownerId),
      Item.aggregate([
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
        itemCount: byFolder.get(String(f._id)) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  // Mounted at /api/<app>/folders.
  function router() {
    const r = express.Router();

    // Also counts items outside the trash in total and outside every folder, for "All" and "Unfiled".
    r.get('/', async (req, res) => {
      const owner = req.user.id;
      const [folders, totalCount, unfiledCount] = await Promise.all([
        foldersPayload(owner),
        Item.countDocuments({ owner, trashedAt: null }),
        Item.countDocuments({ owner, trashedAt: null, folder: null }),
      ]);
      res.json({ folders, totalCount, unfiledCount });
    });

    r.post('/', body(createSchema), async (req, res) => {
      await assertRoom(req.user.id);
      const parent = req.body.parentId ? await findFolder(req.user.id, req.body.parentId) : null;
      const folder = await createFolder(req.user.id, req.body.name, parent);
      res.status(201).json({
        folder: { id: String(folder._id), name: folder.name, parentId: folder.parent ? String(folder.parent) : null, itemCount: 0 },
      });
    });

    // Renames and/or moves a folder. Moving takes its whole subtree along.
    r.patch('/:folderId', ids('folderId'), body(updateSchema), async (req, res) => {
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
        inside = await Folder.find({ owner, path: folder._id }).select('path').lean();
        const deepest = Math.max(0, ...inside.map((f) => f.path.length - folder.path.length));
        if (newPath.length + 1 + deepest > MAX_DEPTH) throw tooDeep();
        Object.assign(set, { parent: target?._id ?? null, path: newPath });
      }

      try {
        await Folder.updateOne({ owner, _id: folder._id }, { $set: set });
      } catch (err) {
        if (err?.code === 11000) throw nameTaken();
        throw err;
      }
      if (inside.length) {
        // Rewrite every descendant's ancestor list: the new path, this folder, then whatever sat below it.
        await Folder.bulkWrite(inside.map((f) => ({
          updateOne: {
            filter: { owner, _id: f._id },
            update: { $set: { path: [...newPath, folder._id, ...f.path.slice(folder.path.length + 1)] } },
          },
        })));
      }
      res.json({ folders: await foldersPayload(owner) });
    });

    // Deletes the folder and its subfolders. Their items go to the trash (and
    // come back unfiled if restored).
    r.delete('/:folderId', ids('folderId'), async (req, res) => {
      const owner = req.user.id;
      await findFolder(owner, req.params.folderId);
      const all = await subtreeIds(owner, req.params.folderId);
      const inFolders = { owner, folder: trusted({ $in: all }) };
      const trashed = await Item.updateMany({ ...inFolders, trashedAt: null }, { $set: { trashedAt: new Date(), ...trashSet } });
      await Item.updateMany(inFolders, { $set: { folder: null } });
      const removed = await Folder.deleteMany({ owner, _id: trusted({ $in: all }) });
      res.json({ deletedFolders: removed.deletedCount, trashedItems: trashed.modifiedCount, folders: await foldersPayload(owner) });
    });

    return r;
  }

  return { router, findFolder, subtreeIds, listFolders, ensurePath };
}

module.exports = { createFolderTree, namePaths, folderName, MAX_DEPTH };

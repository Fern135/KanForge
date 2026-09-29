'use strict';

const Note = require('./models/Note');
const NoteFolder = require('./models/NoteFolder');
const { createFolderTree } = require('../../core/services/folderTree');

module.exports = createFolderTree({ Folder: NoteFolder, Item: Note, trashSet: { pinned: false } });

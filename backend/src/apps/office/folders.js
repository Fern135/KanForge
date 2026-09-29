'use strict';

const OfficeDocument = require('./models/OfficeDocument');
const OfficeFolder = require('./models/OfficeFolder');
const { createFolderTree } = require('../../core/services/folderTree');

module.exports = createFolderTree({ Folder: OfficeFolder, Item: OfficeDocument });

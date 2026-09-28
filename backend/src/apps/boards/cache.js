'use strict';

const config = require('../../core/config');
const { getJSON, setJSON, del } = require('../../core/services/cache');

const boardKey = (id) => `board:${id}`;

module.exports = {
  getBoard: (id) => getJSON(boardKey(id)),
  setBoard: (id, payload) => setJSON(boardKey(id), payload, config.boardCacheTtl),
  invalidateBoard: (id) => del(boardKey(id)),
};

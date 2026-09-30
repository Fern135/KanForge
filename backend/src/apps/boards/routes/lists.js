'use strict';

const express = require('express');
const { trusted } = require('mongoose');
const List = require('../models/List');
const Card = require('../models/Card');
const Comment = require('../models/Comment');
const cache = require('../cache');
const { positionAt } = require('../services/position');
const { body, ids, z } = require('../../../core/middleware/validate');
const AppError = require('../../../core/utils/AppError');
const s = require('../serialize');

const MAX_LISTS_PER_BOARD = 100;

const title = z.string().trim().min(1).max(100);
const index = z.number().int().min(0).max(10_000);
const createSchema = z.strictObject({ title });
const updateSchema = z.strictObject({ title });
const moveSchema = z.strictObject({ index });

module.exports = function listsRouter() {
  const router = express.Router({ mergeParams: true });

  // Loads the list only if it belongs to the already-authorized board.
  async function loadList(req, _res, next) {
    const list = await List.findOne({ _id: req.params.listId, board: req.board._id }).lean();
    if (!list) throw AppError.notFound('List not found');
    req.list = list;
    next();
  }

  router.post('/', body(createSchema), async (req, res) => {
    const boardId = req.board._id;
    if ((await List.countDocuments({ board: boardId })) >= MAX_LISTS_PER_BOARD) {
      throw AppError.badRequest('List limit reached', 'LIMIT');
    }
    const position = await positionAt(List, { board: boardId }, Number.MAX_SAFE_INTEGER);
    const list = await List.create({ board: boardId, title: req.body.title, position });
    // Counted again: requests running at the same moment can all pass the check above.
    if ((await List.countDocuments({ board: boardId })) > MAX_LISTS_PER_BOARD) {
      await List.deleteOne({ _id: list._id });
      throw AppError.badRequest('List limit reached', 'LIMIT');
    }
    await cache.invalidateBoard(boardId);
    res.status(201).json({ list: s.list(list) });
  });

  router.use('/:listId', ids('listId'), loadList);

  router.patch('/:listId', body(updateSchema), async (req, res) => {
    const list = await List.findByIdAndUpdate(req.list._id, { $set: { title: req.body.title } }, { new: true }).lean();
    await cache.invalidateBoard(req.board._id);
    res.json({ list: s.list(list) });
  });

  router.put('/:listId/move', body(moveSchema), async (req, res) => {
    const position = await positionAt(List, { board: req.board._id }, req.body.index, req.list._id);
    const list = await List.findByIdAndUpdate(req.list._id, { $set: { position } }, { new: true }).lean();
    await cache.invalidateBoard(req.board._id);
    res.json({ list: s.list(list) });
  });

  router.delete('/:listId', async (req, res) => {
    const cardIds = await Card.find({ list: req.list._id, board: req.board._id }).distinct('_id');
    await Comment.deleteMany({ board: req.board._id, card: trusted({ $in: cardIds }) });
    await Card.deleteMany({ list: req.list._id, board: req.board._id });
    await List.deleteOne({ _id: req.list._id });
    await cache.invalidateBoard(req.board._id);
    res.status(204).end();
  });

  return router;
};

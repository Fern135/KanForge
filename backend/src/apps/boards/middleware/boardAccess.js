'use strict';

const Board = require('../models/Board');
const AppError = require('../../../core/utils/AppError');

// Loads the board from :boardId and checks the caller is a member. It returns
// 404 (not 403) for non-members so board IDs can't be probed. Every nested
// resource query must filter by req.board._id, which prevents cross-board
// access (IDOR).
async function requireBoardMember(req, _res, next) {
  const board = await Board.findById(req.params.boardId).lean();
  const membership = board?.members.find((m) => String(m.user) === req.user.id);
  if (!membership) throw AppError.notFound('Board not found');
  req.board = board;
  req.boardRole = membership.role;
  next();
}

function requireBoardOwner(req, _res, next) {
  if (req.boardRole !== 'owner') throw AppError.forbidden('Only the board owner can do that');
  next();
}

module.exports = { requireBoardMember, requireBoardOwner };

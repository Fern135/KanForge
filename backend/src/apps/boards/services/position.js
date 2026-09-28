'use strict';

const { trusted } = require('mongoose');

const GAP = 1024;
const MIN_GAP = 1e-6;

/**
 * Computes a sort key that places an item at `index` among its siblings
 * (excluding `excludeId`, the item being moved). Uses fractional positions so
 * a move normally writes a single document. When the gap between neighbours
 * gets too small, it renumbers the siblings in one bulkWrite.
 */
async function positionAt(Model, filter, index, excludeId = null) {
  const query = excludeId ? { ...filter, _id: trusted({ $ne: excludeId }) } : filter;
  const siblings = await Model.find(query).sort({ position: 1 }).select('_id position').lean();

  const i = Math.max(0, Math.min(Number.isInteger(index) ? index : siblings.length, siblings.length));
  const prev = siblings[i - 1]?.position;
  const next = siblings[i]?.position;

  if (prev === undefined && next === undefined) return GAP;
  if (prev === undefined) {
    if (next > MIN_GAP * 2) return next / 2;
  } else if (next === undefined) {
    return prev + GAP;
  } else if (next - prev > MIN_GAP) {
    return (prev + next) / 2;
  }

  // Neighbours too close: renumber the siblings, leaving a slot at index i.
  const ops = [];
  siblings.forEach((s, idx) => {
    const pos = (idx < i ? idx + 1 : idx + 2) * GAP;
    ops.push({ updateOne: { filter: { _id: s._id }, update: { $set: { position: pos } } } });
  });
  await Model.bulkWrite(ops, { ordered: false });
  return (i + 1) * GAP;
}

module.exports = { positionAt, GAP };

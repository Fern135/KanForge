'use strict';

const { trusted } = require('mongoose');
const config = require('../../core/config');
const logger = require('../../core/utils/logger');
const { redis } = require('../../core/db/redis');
const FileGarbage = require('./models/FileGarbage');
const storage = require('./storage');
const { discardWhere } = require('./tree');

// Background clean-up for the Files app, run every few minutes by each API
// process (a Redis lock makes sure only one of them sweeps at a time):
//   1. Items in the trash for 30 days are deleted for good.
//   2. Uploads nobody has touched for a day are abandoned.
//   3. Contents queued for deletion (FileGarbage) are deleted from the object
//      store. An entry stays queued until the store confirms, so nothing is lost
//      if the store is down: it's simply tried again next time.

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_DAYS = 30;
const STALE_UPLOAD_MS = DAY_MS;
const INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
const LOCK_KEY = 'files:sweeper';
// After this many failures an entry is left alone (and logged): something is
// wrong that retrying won't fix, like a missing bucket.
const MAX_ATTEMPTS = 20;
const everywhere = { allWorkspaces: true };

// Deletes queued contents from the object store, up to `max` entries.
// Returns how many were cleared.
async function drainGarbage(max = 1000) {
  if (!storage.configured()) return 0;
  let cleared = 0;
  while (cleared < max) {
    const batch = await FileGarbage.find({ attempts: trusted({ $lt: MAX_ATTEMPTS }) }).sort({ createdAt: 1 }).limit(50).lean();
    if (!batch.length) break;
    let progress = 0;
    for (const g of batch) {
      try {
        if (g.uploadId) await storage.abortUpload(g.key, g.uploadId);
        else await storage.remove(g.key);
      } catch (err) {
        if (!storage.isGone(err)) {
          await FileGarbage.updateOne({ _id: g._id }, { $inc: { attempts: 1 } });
          if (g.attempts + 1 >= MAX_ATTEMPTS) logger.error({ err: err.message, key: g.key }, 'files: giving up deleting stored contents');
          continue;
        }
      }
      await FileGarbage.deleteOne({ _id: g._id });
      cleared += 1;
      progress += 1;
    }
    // The whole batch failed: the store is likely down. Try again next round.
    if (!progress) break;
  }
  return cleared;
}

// One full sweep. Exported so tests (and an admin script, if ever needed) can run it.
async function sweep(now = Date.now()) {
  const trash = await discardWhere({ trashedAt: trusted({ $lt: new Date(now - TRASH_DAYS * DAY_MS) }) }, everywhere);
  const stale = await discardWhere({ status: 'uploading', updatedAt: trusted({ $lt: new Date(now - STALE_UPLOAD_MS) }) }, everywhere);
  const cleared = await drainGarbage();
  if (trash || stale || cleared) logger.info({ trash, stale, cleared }, 'files: swept');
  return { trash, stale, cleared };
}

// Sweeps unless another process is already doing it.
async function sweepWithLock() {
  const locked = await redis.set(LOCK_KEY, String(process.pid), 'PX', INTERVAL_MS - 1000, 'NX');
  if (!locked) return;
  try {
    await sweep();
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }
}

let timers = [];
let draining = null;

// Deletes queued contents soon after something is deleted, instead of waiting
// for the next sweep. Fire and forget: failures are retried by the sweeper.
// Off in tests, which run drainGarbage themselves when they need it.
function kick() {
  if (config.isTest || !storage.configured() || draining) return;
  draining = drainGarbage(200)
    .catch((err) => logger.warn({ err: err.message }, 'files: could not delete stored contents yet'))
    .finally(() => { draining = null; });
}

// Called by server.js once the databases are connected.
function start() {
  if (!storage.configured()) {
    logger.warn('files: no object storage configured (S3_* settings), so the Files app can\'t store files');
    return;
  }
  const run = () => sweepWithLock().catch((err) => logger.error({ err }, 'files: sweep failed'));
  timers = [setTimeout(run, FIRST_RUN_MS).unref(), setInterval(run, INTERVAL_MS).unref()];
}

function stop() {
  timers.forEach(clearTimeout);
  timers = [];
}

module.exports = { sweep, drainGarbage, kick, start, stop, TRASH_DAYS };

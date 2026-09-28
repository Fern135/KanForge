'use strict';

const Settings = require('../models/Settings');

// Keeps each app's on/off state for one API process. Reads are cached briefly,
// so with several API replicas a change takes up to CACHE_MS to reach them all.
const CACHE_MS = 5_000;

function createAppState(manifests) {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  let cached = null;
  let cachedAt = 0;

  async function overrides() {
    if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
    const doc = await Settings.findById(Settings.INSTANCE).select('apps').lean();
    cached = doc?.apps ? { ...doc.apps } : {};
    cachedAt = Date.now();
    return cached;
  }

  async function list() {
    const o = await overrides();
    return manifests.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      enabled: typeof o[m.id] === 'boolean' ? o[m.id] : m.defaultEnabled,
    }));
  }

  async function isEnabled(id) {
    return (await list()).find((a) => a.id === id)?.enabled ?? false;
  }

  async function setEnabled(id, enabled) {
    if (!byId.has(id)) return false;
    await Settings.updateOne({ _id: Settings.INSTANCE }, { $set: { [`apps.${id}`]: enabled } }, { upsert: true });
    cached = null;
    return true;
  }

  return { list, isEnabled, setEnabled, has: (id) => byId.has(id) };
}

module.exports = { createAppState };

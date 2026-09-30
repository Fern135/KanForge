'use strict';

// What one person can do in each app, set by a platform admin on a self-hosted
// install: 'none' hides the app, 'view' opens it read-only and 'edit' is full use.
// Only restrictions are stored, so an app that isn't listed means 'edit'.
// Platform admins always have full use.
const ACCESS_LEVELS = ['none', 'view', 'edit'];

function accessTo(user, appId) {
  if (!user || user.role === 'admin') return 'edit';
  return user.access?.[appId] ?? 'edit';
}

// { boards: 'edit', notes: 'view' } -> { notes: 'view' }, or undefined when nothing is restricted.
function restrictionsOf(access = {}) {
  const kept = Object.entries(access).filter(([, level]) => level !== 'edit');
  return kept.length ? Object.fromEntries(kept) : undefined;
}

module.exports = { ACCESS_LEVELS, accessTo, restrictionsOf };

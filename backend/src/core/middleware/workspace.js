'use strict';

const Workspace = require('../models/Workspace');
const Membership = require('../models/Membership');
const { runInWorkspace } = require('../tenancy');
const AppError = require('../utils/AppError');

// 3 to 40 characters: lowercase letters, digits and single hyphens, not at either end.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,39}$/;

// Use after requireAuth. The frontend names the workspace in the X-Workspace
// header (its slug, which is also in the page URL). Non-members get 404, so
// workspace slugs can't be probed. Everything after this runs scoped to the
// workspace (see tenancy.js). Membership is read on every request, so removing
// someone takes effect immediately.
async function requireWorkspace(req, _res, next) {
  const slug = String(req.get('x-workspace') || '').toLowerCase();
  if (!SLUG_RE.test(slug)) throw AppError.badRequest('Choose a workspace first', 'WORKSPACE_REQUIRED');
  const ws = await Workspace.findOne({ slug }).select('name slug plan apps').lean();
  const membership = ws && (await Membership.findOne({ workspace: ws._id, user: req.user.id }).select('role').lean());
  if (!membership) throw AppError.notFound('Workspace not found', 'WORKSPACE_NOT_FOUND');
  req.workspace = {
    id: String(ws._id),
    name: ws.name,
    slug: ws.slug,
    plan: ws.plan,
    apps: ws.apps ? { ...ws.apps } : {},
  };
  req.workspaceRole = membership.role;
  return runInWorkspace(ws._id, next);
}

function requireWorkspaceAdmin(req, _res, next) {
  if (req.workspaceRole !== 'admin') throw AppError.forbidden('Only workspace admins can do that');
  next();
}

module.exports = { requireWorkspace, requireWorkspaceAdmin, SLUG_RE };

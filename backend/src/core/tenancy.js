'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { Schema, Types } = require('mongoose');

// Tenant isolation. Every model that holds workspace data uses tenantPlugin, which
// adds a required `workspace` field and scopes every query, update, delete,
// aggregate and insert to the workspace of the current request. It fails closed:
// touching tenant data outside a workspace throws, instead of quietly reading or
// writing across workspaces. Code that really must span workspaces (migrations,
// platform stats, account-wide events) passes { allWorkspaces: true } explicitly:
// query.setOptions({ allWorkspaces: true }), aggregate([...], { allWorkspaces: true })
// or doc.$locals.allWorkspaces = true. Queries are lazy, so run them (await) inside
// runInWorkspace, not just build them there.

const als = new AsyncLocalStorage();

// Runs fn with every tenant query scoped to workspaceId.
const runInWorkspace = (workspaceId, fn) => als.run({ workspaceId: String(workspaceId) }, fn);

function currentWorkspace() {
  const id = als.getStore()?.workspaceId;
  if (!id) {
    const err = new Error('Tenant data accessed outside a workspace');
    err.code = 'NO_WORKSPACE_CONTEXT';
    throw err;
  }
  return id;
}

const QUERY_OPS = [
  'countDocuments', 'deleteMany', 'deleteOne', 'distinct', 'find', 'findOne',
  'findOneAndDelete', 'findOneAndReplace', 'findOneAndUpdate', 'replaceOne',
  'updateMany', 'updateOne',
];

function stamp(doc, ws) {
  if (doc.workspace == null) doc.workspace = ws;
  else if (String(doc.workspace) !== ws) throw new Error('Document belongs to another workspace');
}

function tenantPlugin(schema) {
  schema.add({ workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, immutable: true } });

  for (const op of QUERY_OPS) {
    schema.pre(op, function scopeQuery() {
      if (this.getOptions().allWorkspaces) return;
      const ws = currentWorkspace();
      // An ObjectId, not a string: cursors cast their filter before these hooks run.
      // The equality filter also makes upserts insert into this workspace.
      this.where({ workspace: new Types.ObjectId(ws) });
      // A replacement document must keep its workspace.
      if (op === 'replaceOne' || op === 'findOneAndReplace') this.setUpdate({ ...this.getUpdate(), workspace: ws });
    });
  }

  schema.pre('aggregate', function scopeAggregate() {
    if (this.options.allWorkspaces) return;
    this.pipeline().unshift({ $match: { workspace: new Types.ObjectId(currentWorkspace()) } });
  });

  // Before validation, so a new document gets its workspace before `required` is checked.
  schema.pre('validate', function scopeSave() {
    if (this.$locals.allWorkspaces) return;
    stamp(this, currentWorkspace());
  });

  // Mongoose doesn't pass insertMany's options to this hook, so there's no opt-out:
  // insert inside runInWorkspace().
  schema.pre('insertMany', function scopeInsertMany(docs) {
    const ws = currentWorkspace();
    for (const doc of Array.isArray(docs) ? docs : [docs]) stamp(doc, ws);
  });

  schema.pre('bulkWrite', function scopeBulkWrite(ops, options) {
    if (options?.allWorkspaces) return;
    const ws = currentWorkspace();
    for (const op of ops) {
      const [kind, spec] = Object.entries(op)[0];
      if (kind === 'insertOne') stamp(spec.document, ws);
      else spec.filter = { ...spec.filter, workspace: new Types.ObjectId(ws) };
    }
  });
}

module.exports = { tenantPlugin, runInWorkspace, currentWorkspace };

'use strict';

const Workspace = require('../models/Workspace');
const { planIncludesApp, planOf } = require('../plans');

// Which apps a workspace can use. An app is on when the workspace's plan includes
// it and its admins haven't turned it off.
function createAppState(manifests) {
  const byId = new Map(manifests.map((m) => [m.id, m]));

  // workspace: req.workspace (plan and apps overrides).
  function list(workspace) {
    return manifests.map((m) => {
      const included = planIncludesApp(workspace.plan, m.id);
      const override = workspace.apps?.[m.id];
      return {
        id: m.id,
        name: m.name,
        description: m.description,
        included,
        enabled: included && (typeof override === 'boolean' ? override : m.defaultEnabled),
      };
    });
  }

  const find = (workspace, id) => list(workspace).find((a) => a.id === id);

  async function setEnabled(workspace, id, enabled) {
    await Workspace.updateOne({ _id: workspace.id }, { $set: { [`apps.${id}`]: enabled } });
    workspace.apps = { ...workspace.apps, [id]: enabled };
  }

  return { list, find, setEnabled, has: (id) => byId.has(id), planName: (workspace) => planOf(workspace.plan).name };
}

module.exports = { createAppState };

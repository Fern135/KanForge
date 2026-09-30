'use strict';

const express = require('express');

// The apps the current workspace can open (and this person may use). Apps its
// plan doesn't include are listed separately, so the home screen can say which
// plan has them.
module.exports = function appsRouter({ appState }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const all = appState.list(req.workspace, req.user);
    res.json({
      apps: all.filter((a) => a.enabled && a.access !== 'none').map(({ id, name, description, access }) => ({ id, name, description, access })),
      locked: all.filter((a) => !a.included).map(({ id, name }) => ({ id, name })),
    });
  });

  return router;
};

'use strict';

const express = require('express');

// The apps the current workspace can open. Apps its plan doesn't include are
// listed separately, so the home screen can say which plan has them.
module.exports = function appsRouter({ appState }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const all = appState.list(req.workspace);
    res.json({
      apps: all.filter((a) => a.enabled).map(({ id, name, description }) => ({ id, name, description })),
      locked: all.filter((a) => !a.included).map(({ id, name }) => ({ id, name })),
    });
  });

  return router;
};

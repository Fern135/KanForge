'use strict';

const express = require('express');

// The apps a signed-in user can open. Turned-off apps are left out.
module.exports = function appsRouter({ appState }) {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    const apps = (await appState.list()).filter((a) => a.enabled).map(({ id, name, description }) => ({ id, name, description }));
    res.json({ apps });
  });

  return router;
};

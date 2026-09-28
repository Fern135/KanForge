'use strict';

// Every app Kanforge ships. Each one is mounted at /api/<id> and may depend on
// core, never on another app. See apps/boards/index.js for the manifest shape.
module.exports = [
  require('./boards'),
];

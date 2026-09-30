'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Workspace = require('../src/core/models/Workspace');
const Board = require('../src/apps/boards/models/Board');
const Card = require('../src/apps/boards/models/Card');
const List = require('../src/apps/boards/models/List');
const Note = require('../src/apps/notes/models/Note');
const { runInWorkspace } = require('../src/core/tenancy');
const { MAX_CREATED_PER_USER } = require('../src/core/services/workspaces');
const { setup, teardown, api, registerUser, auth, TEST_WORKSPACE } = require('./helpers');

// Limits hold when many requests arrive at the same moment: each is counted
// again after it's saved and undone if the limit was overshot.
describe('limits under concurrent requests', () => {
  let user;
  let ws;
  const burst = (n, send) => Promise.all(Array.from({ length: n }, (_, i) => send(i)));
  const inWs = (fn) => runInWorkspace(ws._id, fn);

  before(async () => {
    await setup();
    user = await registerUser();
    ws = await Workspace.findOne({ slug: TEST_WORKSPACE }).lean();
  });
  after(teardown);

  it('never creates more workspaces than allowed', async () => {
    const other = await registerUser({}, { joinTestWorkspace: false });
    await Workspace.insertMany(Array.from({ length: MAX_CREATED_PER_USER - 2 }, (_, i) => ({
      name: `W${i}`, slug: `seeded-${i}`, plan: 'self-hosted', createdBy: other.user.id,
    })));
    await burst(8, (i) => api().post('/api/workspaces').set(auth(other.token, null)).send({ name: 'Race', slug: `race-${i}` }));
    assert.ok((await Workspace.countDocuments({ createdBy: other.user.id })) <= MAX_CREATED_PER_USER);
  });

  it('never puts someone on more boards than their plan allows', async () => {
    await Workspace.updateOne({ _id: ws._id }, { $set: { plan: 'standard' } });
    await inWs(() => Board.insertMany(Array.from({ length: 98 }, (_, i) => ({ title: `B${i}`, members: [{ user: user.user.id, role: 'owner' }] }))));
    await burst(8, (i) => api().post('/api/boards').set(auth(user.token)).send({ title: `Race ${i}` }));
    assert.ok((await inWs(() => Board.countDocuments({ 'members.user': user.user.id }).exec())) <= 100);
    await Workspace.updateOne({ _id: ws._id }, { $set: { plan: 'self-hosted' } });
  });

  it('never puts more cards in a list than allowed', async () => {
    const { board } = (await api().post('/api/boards').set(auth(user.token)).send({ title: 'Cards' }).expect(201)).body;
    const { list } = (await api().post(`/api/boards/${board.id}/lists`).set(auth(user.token)).send({ title: 'L' }).expect(201)).body;
    await inWs(() => Card.insertMany(Array.from({ length: 497 }, (_, i) => ({
      board: board.id, list: list.id, title: `C${i}`, position: i + 1, createdBy: user.user.id,
    }))));
    await burst(8, (i) => api().post(`/api/boards/${board.id}/cards`).set(auth(user.token)).send({ listId: list.id, title: `Race ${i}` }));
    assert.ok((await inWs(() => Card.countDocuments({ list: list.id }).exec())) <= 500);
    assert.ok((await inWs(() => List.countDocuments({ board: board.id }).exec())) <= 100);
  });

  it('never keeps more notes than allowed', async () => {
    await inWs(() => Note.insertMany(Array.from({ length: 1997 }, () => ({ owner: user.user.id, content: { type: 'doc' } }))));
    await burst(8, (i) => api().post('/api/notes').set(auth(user.token)).send({ title: `Race ${i}` }));
    assert.ok((await Note.countDocuments({ owner: user.user.id }).setOptions({ allWorkspaces: true })) <= 2000);
  });
});

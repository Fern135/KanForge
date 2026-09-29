'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

describe('note folders', () => {
  let alice;
  let bob;
  const as = (u) => ({
    get: (p) => api().get(p).set(auth(u.token)),
    post: (p) => api().post(p).set(auth(u.token)),
    patch: (p) => api().patch(p).set(auth(u.token)),
    del: (p) => api().delete(p).set(auth(u.token)),
  });
  const mkFolder = async (u, name, parentId) => (await as(u).post('/api/notes/folders').send({ name, parentId }).expect(201)).body.folder;
  const mkNote = async (u, title, folderId) => (await as(u).post('/api/notes').send({ title, folderId }).expect(201)).body.note;
  const listIds = async (u, query) => (await as(u).get(`/api/notes?${query}`).expect(200)).body.notes.map((n) => n.title).sort();

  before(async () => {
    await setup();
    alice = await registerUser();
    bob = await registerUser();
  });
  after(teardown);

  it('nests folders and keeps them private', async () => {
    const work = await mkFolder(alice, 'Work');
    const clients = await mkFolder(alice, 'Clients', work.id);
    assert.equal(clients.parentId, work.id);

    const { folders, totalCount, unfiledCount } = (await as(alice).get('/api/notes/folders').expect(200)).body;
    assert.equal(totalCount, 0);
    assert.equal(unfiledCount, 0);
    assert.deepEqual(folders.map((f) => f.name), ['Clients', 'Work']);
    assert.equal((await as(bob).get('/api/notes/folders')).body.folders.length, 0);

    await as(bob).post('/api/notes/folders').send({ name: 'Sneaky', parentId: work.id }).expect(404);
    await as(bob).patch(`/api/notes/folders/${work.id}`).send({ name: 'Mine' }).expect(404);
    await as(bob).del(`/api/notes/folders/${work.id}`).expect(404);
    await as(bob).post('/api/notes').send({ folderId: work.id }).expect(404);
  });

  it('refuses duplicate names among siblings, case-insensitively', async () => {
    const u = await registerUser();
    const a = await mkFolder(u, 'Ideas');
    const dup = await as(u).post('/api/notes/folders').send({ name: 'ideas' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'FOLDER_EXISTS');
    await mkFolder(u, 'Ideas', a.id);
    const b = await mkFolder(u, 'Other');
    await as(u).patch(`/api/notes/folders/${b.id}`).send({ name: 'IDEAS' }).expect(409);
    for (const bad of ['', '   ', 'a/b', 'a\\b', '<x>', 'x'.repeat(101)]) {
      await as(u).post('/api/notes/folders').send({ name: bad }).expect(400);
    }
  });

  it('files notes, lists a folder with or without its subfolders, and lists unfiled notes', async () => {
    const u = await registerUser();
    const top = await mkFolder(u, 'Top');
    const sub = await mkFolder(u, 'Sub', top.id);
    await mkNote(u, 'in top', top.id);
    await mkNote(u, 'in sub', sub.id);
    const loose = await mkNote(u, 'loose');

    assert.deepEqual(await listIds(u, `folder=${top.id}`), ['in top']);
    assert.deepEqual(await listIds(u, `folder=${top.id}&deep=1`), ['in sub', 'in top']);
    assert.deepEqual(await listIds(u, 'folder=unfiled'), ['loose']);

    const moved = await as(u).patch(`/api/notes/${loose.id}`).send({ folderId: sub.id }).expect(200);
    assert.equal(moved.body.note.folderId, sub.id);
    assert.equal(moved.body.note.version, 1, 'moving a note does not bump its version');
    assert.deepEqual(await listIds(u, 'folder=unfiled'), []);
    await as(u).patch(`/api/notes/${loose.id}`).send({ folderId: null }).expect(200);
    assert.deepEqual(await listIds(u, 'folder=unfiled'), ['loose']);

    const counts = Object.fromEntries((await as(u).get('/api/notes/folders')).body.folders.map((f) => [f.name, f.itemCount]));
    assert.deepEqual(counts, { Sub: 1, Top: 1 });
  });

  it('moves folders with their subtree and refuses cycles', async () => {
    const u = await registerUser();
    const a = await mkFolder(u, 'A');
    const b = await mkFolder(u, 'B', a.id);
    const c = await mkFolder(u, 'C', b.id);
    const other = await mkFolder(u, 'Other');
    await mkNote(u, 'deep note', c.id);

    const inside = await as(u).patch(`/api/notes/folders/${a.id}`).send({ parentId: c.id });
    assert.equal(inside.status, 400);
    assert.equal(inside.body.error.code, 'FOLDER_CYCLE');
    await as(u).patch(`/api/notes/folders/${a.id}`).send({ parentId: a.id }).expect(400);

    await as(u).patch(`/api/notes/folders/${b.id}`).send({ parentId: other.id }).expect(200);
    assert.deepEqual(await listIds(u, `folder=${other.id}&deep=1`), ['deep note']);
    assert.deepEqual(await listIds(u, `folder=${a.id}&deep=1`), []);

    // C moved along with B, so it can now go to the top level on its own.
    const { folders } = (await as(u).patch(`/api/notes/folders/${c.id}`).send({ parentId: null }).expect(200)).body;
    assert.equal(folders.find((f) => f.id === c.id).parentId, null);
    assert.deepEqual(await listIds(u, `folder=${other.id}&deep=1`), []);
  });

  it('limits nesting to 10 levels, including when moving a subtree', async () => {
    const u = await registerUser();
    let parentId = null;
    const chain = [];
    for (let i = 1; i <= 10; i += 1) {
      const f = await mkFolder(u, `L${i}`, parentId);
      chain.push(f);
      parentId = f.id;
    }
    const tooDeep = await as(u).post('/api/notes/folders').send({ name: 'L11', parentId });
    assert.equal(tooDeep.status, 400);
    assert.equal(tooDeep.body.error.code, 'TOO_DEEP');

    const pair = await mkFolder(u, 'Pair');
    await mkFolder(u, 'Child', pair.id);
    await as(u).patch(`/api/notes/folders/${pair.id}`).send({ parentId: chain[8].id }).expect(400);
    await as(u).patch(`/api/notes/folders/${pair.id}`).send({ parentId: chain[7].id }).expect(200);
  });

  it('deleting a folder trashes its notes and removes its subfolders', async () => {
    const u = await registerUser();
    const top = await mkFolder(u, 'Top');
    const sub = await mkFolder(u, 'Sub', top.id);
    const keep = await mkFolder(u, 'Keep');
    const n1 = await mkNote(u, 'one', top.id);
    await mkNote(u, 'two', sub.id);
    await mkNote(u, 'safe', keep.id);

    const res = await as(u).del(`/api/notes/folders/${top.id}`).expect(200);
    assert.equal(res.body.deletedFolders, 2);
    assert.equal(res.body.trashedItems, 2);
    assert.deepEqual(res.body.folders.map((f) => f.name), ['Keep']);
    assert.deepEqual(await listIds(u, 'view=trash'), ['one', 'two']);
    assert.deepEqual(await listIds(u, ''), ['safe']);

    const restored = await as(u).post(`/api/notes/${n1.id}/restore`).expect(200);
    assert.equal(restored.body.note.folderId, null);
  });

  it('imports into folder paths and exports each note with its path', async () => {
    const u = await registerUser();
    const content = { type: 'doc', content: [{ type: 'paragraph' }] };
    const existing = await mkFolder(u, 'Vault');
    const res = await as(u).post('/api/notes/import').send({
      notes: [
        { title: 'root', content },
        { title: 'a', content, folderPath: ['vault', 'Projects'] },
        { title: 'b', content, folderPath: ['Vault', 'projects', 'Deep'] },
      ],
    }).expect(201);
    assert.equal(res.body.imported, 3);

    const { folders } = (await as(u).get('/api/notes/folders')).body;
    assert.equal(folders.length, 3, 'reuses Vault and Projects instead of duplicating them');
    assert.ok(folders.some((f) => f.id === existing.id));

    const exported = (await as(u).get('/api/notes/export').expect(200)).body.notes;
    const byTitle = Object.fromEntries(exported.map((n) => [n.title, n.folderPath]));
    assert.deepEqual(byTitle, { root: [], a: ['Vault', 'Projects'], b: ['Vault', 'Projects', 'Deep'] });

    await as(u).post('/api/notes/import').send({ notes: [{ title: 'x', content, folderPath: ['bad/name'] }] }).expect(400);
  });
});

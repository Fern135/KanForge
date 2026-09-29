'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, api, registerUser, auth, TEST_WORKSPACE } = require('./helpers');
const Workspace = require('../src/core/models/Workspace');

const para = (...content) => ({ type: 'paragraph', content });
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const doc = (...content) => ({ type: 'doc', content });

describe('notes', () => {
  let alice;
  let bob;
  const as = (u) => ({ get: (p) => api().get(p).set(auth(u.token)), post: (p) => api().post(p).set(auth(u.token)), patch: (p) => api().patch(p).set(auth(u.token)), del: (p) => api().delete(p).set(auth(u.token)) });

  before(async () => {
    await setup();
    alice = await registerUser();
    bob = await registerUser();
  });
  after(teardown);

  it('creates, reads and lists notes, scoped to their owner', async () => {
    const created = await as(alice).post('/api/notes').send({ title: 'Groceries', content: doc(para(text('milk and eggs'))), tags: ['Home', 'home'] }).expect(201);
    const { note } = created.body;
    assert.equal(note.title, 'Groceries');
    assert.deepEqual(note.tags, ['home']);
    assert.equal(note.preview, 'milk and eggs');
    assert.equal(note.version, 1);

    const read = await as(alice).get(`/api/notes/${note.id}`).expect(200);
    assert.deepEqual(read.body.note.content, doc(para(text('milk and eggs'))));

    await as(bob).get(`/api/notes/${note.id}`).expect(404);
    await as(bob).patch(`/api/notes/${note.id}`).send({ pinned: true }).expect(404);
    assert.equal((await as(bob).get('/api/notes')).body.notes.length, 0);
    assert.equal((await as(alice).get('/api/notes')).body.notes.length, 1);
    await api().get('/api/notes').expect(401);
  });

  it('starts with an empty document when no content is sent', async () => {
    const { note } = (await as(alice).post('/api/notes').send({}).expect(201)).body;
    assert.deepEqual(note.content, doc({ type: 'paragraph' }));
    assert.equal(note.title, '');
  });

  it('rebuilds content from the allow-list', async () => {
    const dirty = doc(
      { type: 'heading', attrs: { level: 9, onclick: 'x' }, content: [text('Title')] },
      para(
        text('safe', [{ type: 'link', attrs: { href: 'https://example.com', class: 'evil' } }]),
        text('bad', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }, { type: 'bold' }]),
      ),
      { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: 'yes' }, content: [para(text('todo'))] }] },
    );
    const { note } = (await as(alice).post('/api/notes').send({ content: dirty }).expect(201)).body;
    const [heading, p, tasks] = note.content.content;
    assert.deepEqual(heading.attrs, { level: 1 });
    assert.equal(p.content[0].marks[0].attrs.href, 'https://example.com');
    assert.equal(p.content[0].marks[0].attrs.class, null);
    assert.deepEqual(p.content[1].marks, [{ type: 'bold' }]);
    assert.deepEqual(tasks.content[0].attrs, { checked: false });
    assert.equal(note.preview, 'Title safebad todo');

    for (const bad of [
      { type: 'paragraph' },
      doc({ type: 'script', content: [] }),
      doc(para(text('x', [{ type: 'highlight' }]))),
      doc(para({ type: 'text', text: '' })),
      doc({ type: 'paragraph', content: 'nope' }),
    ]) {
      const res = await as(alice).post('/api/notes').send({ content: bad });
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  });

  it('refuses stale edits instead of overwriting them', async () => {
    const { note } = (await as(alice).post('/api/notes').send({ title: 'Draft' }).expect(201)).body;
    const first = await as(alice).patch(`/api/notes/${note.id}`).send({ title: 'Tab one', version: 1 }).expect(200);
    assert.equal(first.body.note.version, 2);

    const stale = await as(alice).patch(`/api/notes/${note.id}`).send({ title: 'Tab two', version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');

    await as(alice).patch(`/api/notes/${note.id}`).send({ title: 'No version' }).expect(400);
    // Pinning and tags don't need a version and don't bump it.
    const pinned = await as(alice).patch(`/api/notes/${note.id}`).send({ pinned: true, tags: ['x'] }).expect(200);
    assert.equal(pinned.body.note.version, 2);
    await as(alice).patch(`/api/notes/${note.id}`).send({ version: 2 }).expect(400);
  });

  it('searches, filters by tag, and lists pinned notes first', async () => {
    const u = await registerUser();
    const a = (await as(u).post('/api/notes').send({ title: 'Trip plan', content: doc(para(text('Book the (cheap) flights'))), tags: ['travel'] })).body.note;
    await as(u).post('/api/notes').send({ title: 'Recipes', tags: ['food'] });
    const c = (await as(u).post('/api/notes').send({ title: 'Ideas' })).body.note;
    await as(u).patch(`/api/notes/${c.id}`).send({ pinned: true });

    const all = (await as(u).get('/api/notes')).body.notes;
    assert.equal(all[0].id, c.id);
    assert.deepEqual((await as(u).get('/api/notes?q=(cheap)')).body.notes.map((n) => n.id), [a.id]);
    assert.deepEqual((await as(u).get('/api/notes?q=trip')).body.notes.map((n) => n.id), [a.id]);
    assert.deepEqual((await as(u).get('/api/notes?tag=travel')).body.notes.map((n) => n.id), [a.id]);
    assert.deepEqual((await as(u).get('/api/notes/tags')).body.tags, [{ name: 'food', count: 1 }, { name: 'travel', count: 1 }]);
    await as(u).get('/api/notes?view=everything').expect(400);
  });

  it('archives, trashes, restores and deletes', async () => {
    const u = await registerUser();
    const { note } = (await as(u).post('/api/notes').send({ title: 'Old' })).body;

    await as(u).patch(`/api/notes/${note.id}`).send({ archived: true }).expect(200);
    assert.equal((await as(u).get('/api/notes')).body.notes.length, 0);
    assert.equal((await as(u).get('/api/notes?view=archived')).body.notes.length, 1);

    await as(u).del(`/api/notes/${note.id}`).expect(400);
    await as(u).post(`/api/notes/${note.id}/trash`).expect(200);
    assert.equal((await as(u).get('/api/notes?view=trash')).body.notes.length, 1);
    await as(u).patch(`/api/notes/${note.id}`).send({ title: 'x', version: 1 }).expect(400);

    await as(u).post(`/api/notes/${note.id}/restore`).expect(200);
    await as(u).post(`/api/notes/${note.id}/restore`).expect(404);
    await as(u).post(`/api/notes/${note.id}/trash`).expect(200);
    await as(u).del(`/api/notes/${note.id}`).expect(204);
    await as(u).get(`/api/notes/${note.id}`).expect(404);

    await as(u).post(`/api/notes/${(await as(u).post('/api/notes').send({})).body.note.id}/trash`);
    assert.equal((await as(u).del('/api/notes/trash').expect(200)).body.deleted, 1);
  });

  it('imports all-or-nothing and exports everything outside the trash', async () => {
    const u = await registerUser();
    const good = { title: 'Imported', content: doc(para(text('hello'))), tags: ['md'] };
    await as(u).post('/api/notes/import').send({ notes: [good, { title: 'Broken', content: { type: 'nope' } }] }).expect(400);
    assert.equal((await as(u).get('/api/notes')).body.notes.length, 0);

    assert.equal((await as(u).post('/api/notes/import').send({ notes: [good, { ...good, title: 'Second' }] }).expect(201)).body.imported, 2);
    const trashed = (await as(u).post('/api/notes').send({ title: 'Gone' })).body.note;
    await as(u).post(`/api/notes/${trashed.id}/trash`);

    const exported = await as(u).get('/api/notes/export').expect(200);
    assert.deepEqual(exported.body.notes.map((n) => n.title).sort(), ['Imported', 'Second']);
    assert.deepEqual(exported.body.notes[0].content, good.content);
  });

  it('accepts notes larger than the default body limit', async () => {
    const big = doc(...Array.from({ length: 400 }, (_, i) => para(text(`Line ${i} `.repeat(10)))));
    await as(alice).post('/api/notes').send({ content: big }).expect(201);
  });

  it('is unavailable while the app is turned off', async () => {
    const off = (enabled) => Workspace.updateOne({ slug: TEST_WORKSPACE }, { $set: { 'apps.notes': enabled } });
    await off(false);
    const res = await as(bob).get('/api/notes');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'APP_DISABLED');
    await off(true);
  });
});

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mongoose } = require('../src/core/db/mongo');
const { SEARCH_TEXT_MAX, runSearch } = require('../src/core/services/search');
const { setup, teardown, api, registerUser, auth, flushRedis } = require('./helpers');

const paragraph = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
// A word near the start, and one past the searchable part.
const longText = `early-word ${'x'.repeat(SEARCH_TEXT_MAX)} late-word`;

describe('search limits', () => {
  let user;
  const get = (p) => api().get(p).set(auth(user.token));
  const post = (p) => api().post(p).set(auth(user.token));

  before(async () => {
    await setup();
    user = await registerUser();
  });
  after(teardown);

  it('searches the title and the first 20,000 characters of notes and documents', async () => {
    await post('/api/notes').send({ title: 'Long note', content: paragraph(longText) }).expect(201);
    await post('/api/office/documents').send({ kind: 'doc', title: 'Long doc', content: paragraph(longText) }).expect(201);

    assert.equal((await get('/api/notes?q=early-word').expect(200)).body.notes.length, 1);
    assert.equal((await get('/api/notes?q=late-word').expect(200)).body.notes.length, 0);
    assert.equal((await get('/api/notes?q=long%20note').expect(200)).body.notes.length, 1);
    assert.equal((await get('/api/office/documents?q=early-word').expect(200)).body.documents.length, 1);
    assert.equal((await get('/api/office/documents?q=late-word').expect(200)).body.documents.length, 0);
    // Partial words still match.
    assert.equal((await get('/api/office/documents?q=earl').expect(200)).body.documents.length, 1);
  });

  it('trims search copies already stored, and leaves the content alone', async () => {
    const db = mongoose.connection.db;
    const { note } = (await post('/api/notes').send({ title: 'Old', content: paragraph('old note') }).expect(201)).body;
    await db.collection('notes').updateOne({ _id: new mongoose.Types.ObjectId(note.id) }, { $set: { text: 'y'.repeat(SEARCH_TEXT_MAX + 500) } });
    await require('../migrations/20261003000001-search-text').up(db);
    const stored = await db.collection('notes').findOne({ _id: new mongoose.Types.ObjectId(note.id) });
    assert.equal(stored.text.length, SEARCH_TEXT_MAX);
    assert.deepEqual(stored.content, paragraph('old note'));
  });

  it('allows 60 searches a minute per person, and plain listing is never limited', async () => {
    await flushRedis();
    for (let i = 0; i < 60; i += 1) await get(`/api/notes?q=s${i}`).expect(200);
    const res = await get('/api/notes?q=one-more');
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    await get('/api/notes').expect(200);
    // Office has its own budget.
    await get('/api/office/documents?q=still-fine').expect(200);
    await flushRedis();
  });

  it('turns a search that runs out of time into a clear error', async () => {
    const slow = { maxTimeMS: () => Promise.reject(Object.assign(new Error('operation exceeded time limit'), { code: 50 })) };
    await assert.rejects(() => runSearch(slow, true), { code: 'SEARCH_TIMEOUT', status: 400 });
    const broken = { maxTimeMS: () => Promise.reject(new Error('other failure')) };
    await assert.rejects(() => runSearch(broken, true), /other failure/);
  });
});

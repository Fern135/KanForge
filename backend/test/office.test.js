'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const OfficeImage = require('../src/apps/office/models/OfficeImage');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content) => ({ type: 'paragraph', attrs: { textAlign: null }, content });
const doc = (...content) => ({ type: 'doc', content });
// A 1x1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('office documents', () => {
  let alice;
  let bob;
  const as = (u) => ({
    get: (p) => api().get(p).set(auth(u.token)),
    post: (p) => api().post(p).set(auth(u.token)),
    patch: (p) => api().patch(p).set(auth(u.token)),
    del: (p) => api().delete(p).set(auth(u.token)),
  });
  const D = '/api/office/documents';

  before(async () => {
    await setup();
    alice = await registerUser();
    bob = await registerUser();
  });
  after(teardown);

  it('creates a document with Word-like defaults, private to its owner', async () => {
    const { document } = (await as(alice).post(D).send({ kind: 'doc', title: 'Report' }).expect(201)).body;
    assert.equal(document.kind, 'doc');
    assert.deepEqual(document.settings, { pageSize: 'letter', orientation: 'portrait', margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } });
    assert.equal(document.content.type, 'doc');

    await as(bob).get(`${D}/${document.id}`).expect(404);
    await as(bob).patch(`${D}/${document.id}`).send({ folderId: null }).expect(404);
    assert.equal((await as(bob).get(D)).body.documents.length, 0);
    await as(alice).post(D).send({ kind: 'sheet' }).expect(400);
    await api().get(D).expect(401);
  });

  it('keeps formatting and rebuilds content from the allow-list', async () => {
    const content = doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center', style: 'x' }, content: [text('Title')] },
      para(
        text('big red', [{ type: 'textStyle', attrs: { fontSize: '18pt', color: '#ff0000', fontFamily: 'Georgia, serif' } }]),
        text(' evil', [{ type: 'textStyle', attrs: { fontFamily: 'x;background:url(evil)', color: 'expression(alert(1))' } }]),
        text(' mark', [{ type: 'highlight', attrs: { color: '#ffff00' } }, { type: 'superscript' }]),
      ),
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [para(text('cell'))] }] }] },
      { type: 'pageBreak' },
      { type: 'docImage', attrs: { imageId: 'not-an-id' } },
    );
    const { document } = (await as(alice).post(D).send({ kind: 'doc', content }).expect(201)).body;
    const [heading, p, table, pageBreak, ...rest] = document.content.content;
    assert.deepEqual(heading.attrs, { level: 2, textAlign: 'center' });
    assert.deepEqual(p.content[0].marks[0].attrs, { color: '#ff0000', backgroundColor: null, fontFamily: 'Georgia, serif', fontSize: '18pt', lineHeight: null });
    assert.equal(p.content[1].marks, undefined, 'unsafe styles are dropped');
    assert.equal(table.content[0].content[0].attrs.colwidth[0], 120);
    assert.equal(pageBreak.type, 'pageBreak');
    assert.equal(rest.length, 0, 'image without a valid id is removed');

    for (const bad of [doc({ type: 'script' }), doc(para(text('x', [{ type: 'code' }]))), { type: 'paragraph' }]) {
      await as(alice).post(D).send({ kind: 'doc', content: bad }).expect(400);
    }
  });

  it('versions edits, and page setup counts as an edit', async () => {
    const { document } = (await as(alice).post(D).send({ kind: 'doc' })).body;
    const settings = { pageSize: 'a4', orientation: 'landscape', margins: { top: 20, right: 20, bottom: 20, left: 20 } };
    const saved = await as(alice).patch(`${D}/${document.id}`).send({ settings, version: 1 }).expect(200);
    assert.equal(saved.body.document.version, 2);
    assert.deepEqual(saved.body.document.settings, settings);

    const stale = await as(alice).patch(`${D}/${document.id}`).send({ title: 'x', version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
    await as(alice).patch(`${D}/${document.id}`).send({ settings: { ...settings, pageSize: 'tabloid' }, version: 2 }).expect(400);
    await as(alice).patch(`${D}/${document.id}`).send({ title: 'no version' }).expect(400);
  });

  it('searches, files into folders, copies, trashes and restores', async () => {
    const u = await registerUser();
    const { folder } = (await as(u).post('/api/office/folders').send({ name: 'Work' }).expect(201)).body;
    const a = (await as(u).post(D).send({ kind: 'doc', title: 'Budget', content: doc(para(text('quarterly numbers'))), folderId: folder.id })).body.document;
    await as(u).post(D).send({ kind: 'doc', title: 'Letter' });

    assert.deepEqual((await as(u).get(`${D}?q=quarterly`)).body.documents.map((d) => d.id), [a.id]);
    assert.deepEqual((await as(u).get(`${D}?folder=${folder.id}`)).body.documents.map((d) => d.id), [a.id]);
    assert.equal((await as(u).get(`${D}?folder=unfiled`)).body.documents.length, 1);
    assert.equal((await as(u).get('/api/office/folders')).body.folders[0].itemCount, 1);

    const copy = (await as(u).post(`${D}/${a.id}/copy`).expect(201)).body.document;
    assert.equal(copy.title, 'Copy of Budget');
    assert.equal(copy.folderId, folder.id);

    await as(u).del(`${D}/${a.id}`).expect(400);
    await as(u).post(`${D}/${a.id}/trash`).expect(200);
    await as(u).patch(`${D}/${a.id}`).send({ title: 'x', version: 1 }).expect(400);
    assert.equal((await as(u).get(`${D}?view=trash`)).body.documents.length, 1);
    await as(u).post(`${D}/${a.id}/restore`).expect(200);
    await as(u).post(`${D}/${a.id}/trash`).expect(200);
    await as(u).del(`${D}/${a.id}`).expect(204);
    await as(u).get(`${D}/${a.id}`).expect(404);
  });

  it('stores images by content type, serves them only to their owner, and cleans up unused ones', async () => {
    const u = await registerUser();
    const up = await as(u).post('/api/office/images').send({ data: PNG }).expect(201);
    const { id } = up.body.image;
    assert.equal(up.body.image.mime, 'image/png');

    const got = await as(u).get(`/api/office/images/${id}`).expect(200);
    assert.equal(got.headers['content-type'], 'image/png');
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(got.body, Buffer.from(PNG, 'base64'));
    await as(bob).get(`/api/office/images/${id}`).expect(404);
    await api().get(`/api/office/images/${id}`).expect(401);

    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    await as(u).post('/api/office/images').send({ data: svg }).expect(400);
    await as(u).post('/api/office/images').send({ data: 'not base64!' }).expect(400);

    // Used by a document: kept. Unused and old: removed once the document is gone.
    const used = (await as(u).post(D).send({ kind: 'doc', content: doc({ type: 'docImage', attrs: { imageId: id, width: 100 } }) })).body.document;
    assert.equal(used.content.content[0].attrs.imageId, id);
    // Mongoose treats createdAt as immutable, so age the image through the raw collection.
    await OfficeImage.collection.updateMany({}, { $set: { createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    await as(u).post(`${D}/${used.id}/trash`);
    assert.equal(await OfficeImage.countDocuments({ _id: id }), 1, 'still used by a document in the trash');
    await as(u).del(`${D}/${used.id}`).expect(204);
    assert.equal(await OfficeImage.countDocuments({ _id: id }), 0);
  });

  it('accepts large documents', async () => {
    const big = doc(...Array.from({ length: 3000 }, (_, i) => para(text(`Paragraph ${i} `.repeat(20)))));
    await as(alice).post(D).send({ kind: 'doc', content: big }).expect(201);
  });
});

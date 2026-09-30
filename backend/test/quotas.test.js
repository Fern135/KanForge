'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Workspace = require('../src/core/models/Workspace');
const Note = require('../src/apps/notes/models/Note');
const OfficeDocument = require('../src/apps/office/models/OfficeDocument');
const OfficeImage = require('../src/apps/office/models/OfficeImage');
const { runInWorkspace } = require('../src/core/tenancy');
const { mongoose } = require('../src/core/db/mongo');
const { setup, teardown, api, registerUser, auth } = require('./helpers');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const MB = 1024 * 1024;

// Limits are per person, across every workspace: filling them in one workspace
// leaves no room in another.
describe('storage limits across workspaces', () => {
  let user;
  let other;
  const as = (ws) => ({
    post: (p) => api().post(p).set(auth(user.token, ws)),
    patch: (p) => api().patch(p).set(auth(user.token, ws)),
  });
  // Seeds data straight into the user's other workspace.
  const inOther = (fn) => runInWorkspace(other._id, fn);

  before(async () => {
    await setup();
    user = await registerUser();
    await api().post('/api/workspaces').set(auth(user.token, null)).send({ name: 'Side', slug: 'side' }).expect(201);
    other = await Workspace.findOne({ slug: 'side' }).lean();
  });
  after(teardown);

  const expectLimit = async (req) => {
    const res = await req;
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'LIMIT');
    return res;
  };

  it('counts notes in every workspace', async () => {
    await inOther(() => Note.insertMany(Array.from({ length: 2000 }, () => ({ owner: user.user.id, content: { type: 'doc' } }))));
    const res = await expectLimit(as().post('/api/notes').send({ title: 'One too many' }));
    assert.match(res.body.error.message, /across all your workspaces/);
    await inOther(() => Note.deleteMany({ owner: user.user.id }).exec());
    await as().post('/api/notes').send({ title: 'Room again' }).expect(201);
  });

  it('counts documents in every workspace', async () => {
    await inOther(() => OfficeDocument.insertMany(Array.from({ length: 1000 }, () => ({ owner: user.user.id, kind: 'doc', content: { type: 'doc' } }))));
    await expectLimit(as().post('/api/office/documents').send({ kind: 'doc' }));
    await inOther(() => OfficeDocument.deleteMany({ owner: user.user.id }).exec());
  });

  it('caps document storage at 1 GB in total, but always lets documents shrink', async () => {
    const { document } = (await as().post('/api/office/documents').send({ kind: 'doc' }).expect(201)).body;
    await inOther(() => OfficeDocument.create({ owner: user.user.id, kind: 'doc', content: { type: 'doc' }, size: 1024 * MB - 100 }));

    const bigger = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(500) }] }] };
    await expectLimit(as().patch(`/api/office/documents/${document.id}`).send({ content: bigger, version: document.version }));
    await expectLimit(as().post(`/api/office/documents/${document.id}/copy`));
    await expectLimit(as().post('/api/office/documents').send({ kind: 'doc', content: bigger }));
    // Same size or smaller is fine.
    await as().patch(`/api/office/documents/${document.id}`).send({ content: document.content, version: document.version }).expect(200);
    await inOther(() => OfficeDocument.deleteMany({ owner: user.user.id }).exec());
  });

  it('caps images at 200 MB in total', async () => {
    // 40 images of 5 MB (the most one image can be) in the other workspace.
    await inOther(() => OfficeImage.insertMany(Array.from({ length: 40 }, () => ({ owner: user.user.id, mime: 'image/png', data: Buffer.from('x'), size: 5 * MB }))));
    // Recent images aren't cleaned up (they may not be saved into a document yet), so this one still counts.
    await expectLimit(as().post('/api/office/images').send({ data: PNG }));
    // Unused and older than a day: cleaned up, from any workspace, which makes room.
    await mongoose.connection.db.collection('office_images').updateMany({ workspace: other._id }, { $set: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
    await as().post('/api/office/images').send({ data: PNG }).expect(201);
    assert.equal(await inOther(() => OfficeImage.countDocuments({ owner: user.user.id }).exec()), 0);
  });
});

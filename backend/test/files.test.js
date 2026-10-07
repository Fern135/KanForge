'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Workspace = require('../src/core/models/Workspace');
const FileNode = require('../src/apps/files/models/FileNode');
const FileGarbage = require('../src/apps/files/models/FileGarbage');
const FilesSettings = require('../src/apps/files/models/FilesSettings');
const FileQuota = require('../src/apps/files/models/FileQuota');
const storage = require('../src/apps/files/storage');
const sweeper = require('../src/apps/files/sweeper');
const { runInWorkspace } = require('../src/core/tenancy');
const { mongoose } = require('../src/core/db/mongo');
const {
  setup, teardown, api, registerUser, auth, TEST_WORKSPACE,
} = require('./helpers');

const MB = 1024 * 1024;

// The Files app against a real object store (the garage service in
// docker-compose.yml). Skipped when none is configured.
describe('files', { skip: !storage.configured() && 'no object storage configured (S3_*)' }, () => {
  let alice;
  let bob;
  let carol;
  let wsId;

  const as = (u) => ({
    get: (p) => api().get(p).set(auth(u.token)),
    post: (p) => api().post(p).set(auth(u.token)),
    patch: (p) => api().patch(p).set(auth(u.token)),
    put: (p) => api().put(p).set(auth(u.token)),
    del: (p) => api().delete(p).set(auth(u.token)),
  });

  const folder = async (u, name, parentId = null) => (await as(u).post('/api/files/folders').send({ name, parentId }).expect(201)).body.item;

  // Uploads `data` the way the browser does: start, every part, complete.
  async function upload(u, { name, data, parentId = null, mime = 'text/plain' }) {
    const start = await as(u).post('/api/files/uploads').send({ name, size: data.length, mime, parentId });
    if (start.status !== 201) return start;
    if (start.body.done) return start.body.item;
    const { id, partSize, partCount } = start.body.upload;
    for (let n = 1; n <= partCount; n += 1) {
      await as(u).put(`/api/files/uploads/${id}/parts/${n}`).set('Content-Type', 'application/octet-stream')
        .send(data.subarray((n - 1) * partSize, n * partSize)).expect(204);
    }
    return (await as(u).post(`/api/files/uploads/${id}/complete`).expect(200)).body.item;
  }

  // GETs a URL with no sign-in, with the body as a Buffer whatever its type.
  const fetchRaw = (url) => api().get(url).buffer(true).parse((res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  // Follows a signed download link and returns the response.
  async function download(u, id, { inline = false, range } = {}) {
    const { url } = (await as(u).post(`/api/files/nodes/${id}/download`).send({ inline }).expect(200)).body;
    const req = fetchRaw(url);
    if (range) req.set('Range', range);
    return req;
  }

  const objectExists = async (key) => storage.read(key).then((o) => { o.Body.destroy(); return true; }, (err) => {
    if (storage.isGone(err)) return false;
    throw err;
  });

  before(async () => {
    await setup();
    [alice, bob, carol] = [await registerUser(), await registerUser(), await registerUser()];
    wsId = (await Workspace.findOne({ slug: TEST_WORKSPACE }).lean())._id;
  });
  after(teardown);

  it('nests folders without a depth limit and shows the way back up', async () => {
    let parent = null;
    const chain = [];
    for (let i = 1; i <= 25; i += 1) {
      parent = await folder(alice, `Level ${i}`, parent?.id ?? null);
      chain.push(parent);
    }
    const res = await as(alice).get(`/api/files/browse?folder=${parent.id}`).expect(200);
    assert.equal(res.body.role, 'owner');
    assert.deepEqual(res.body.breadcrumbs.map((b) => b.name), chain.slice(0, -1).map((f) => f.name));
    // Moving the top folder carries the whole branch along.
    const home = await folder(alice, 'Home');
    await as(alice).patch(`/api/files/nodes/${chain[0].id}`).send({ parentId: home.id }).expect(200);
    const deep = await FileNode.findOne({ _id: parent.id }).setOptions({ allWorkspaces: true }).lean();
    assert.equal(String(deep.path[0]), home.id);
    assert.equal(deep.path.length, 25);
    // But never inside itself.
    const res2 = await as(alice).patch(`/api/files/nodes/${chain[0].id}`).send({ parentId: chain[10].id }).expect(400);
    assert.equal(res2.body.error.code, 'CYCLE');
  });

  it('uploads in parts and downloads, whole or by range', async () => {
    // Just over one part, so it goes up in two.
    const data = Buffer.alloc(5 * MB + 1234, 7);
    data.write('hello', 0);
    data.write('end!', data.length - 4);
    const file = await upload(alice, { name: 'big.bin', data, mime: 'application/octet-stream' });
    assert.equal(file.size, data.length);

    const whole = await download(alice, file.id);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers['content-type'], 'application/octet-stream');
    assert.match(whole.headers['content-disposition'], /^attachment; filename="big.bin"/);
    assert.ok(whole.body.equals(data));

    const tail = await download(alice, file.id, { range: 'bytes=-4' });
    assert.equal(tail.status, 206);
    assert.equal(tail.body.toString(), 'end!');
    assert.equal(tail.headers['content-range'], `bytes ${data.length - 4}-${data.length - 1}/${data.length}`);
  });

  it('only shows safe types in the browser, and never HTML', async () => {
    const html = await upload(alice, { name: 'page.html', data: Buffer.from('<script>alert(1)</script>'), mime: 'text/html' });
    const res = await download(alice, html.id, { inline: true });
    assert.equal(res.headers['content-type'], 'application/octet-stream');
    assert.match(res.headers['content-disposition'], /^attachment/);

    const text = await upload(alice, { name: 'notes.txt', data: Buffer.from('plain') });
    const shown = await download(alice, text.id, { inline: true });
    assert.equal(shown.headers['content-type'], 'text/plain; charset=utf-8');
    assert.match(shown.headers['content-disposition'], /^inline/);
  });

  it('checks every part: exact sizes, and nothing missing at the end', async () => {
    const start = await as(alice).post('/api/files/uploads').send({ name: 'parts.bin', size: 6 * MB }).expect(201);
    const { id } = start.body.upload;
    const wrong = await as(alice).put(`/api/files/uploads/${id}/parts/1`).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(10)).expect(400);
    assert.equal(wrong.body.error.code, 'BAD_PART');
    await as(alice).put(`/api/files/uploads/${id}/parts/3`).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(10)).expect(400);
    // Someone else can't send parts to it.
    await as(bob).put(`/api/files/uploads/${id}/parts/2`).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(MB)).expect(404);

    await as(alice).put(`/api/files/uploads/${id}/parts/2`).set('Content-Type', 'application/octet-stream').send(Buffer.alloc(MB)).expect(204);
    const early = await as(alice).post(`/api/files/uploads/${id}/complete`).expect(400);
    assert.deepEqual(early.body.error.missing, [1]);
    // Not listed while in progress; cancelling throws it away.
    const top = await as(alice).get('/api/files/browse').expect(200);
    assert.ok(!top.body.items.some((i) => i.name === 'parts.bin'));
    await as(alice).del(`/api/files/uploads/${id}`).expect(204);
    assert.equal(await FileGarbage.countDocuments({ uploadId: mongoose.trusted({ $exists: true }) }), 1);
    await sweeper.drainGarbage();
    assert.equal(await FileGarbage.countDocuments(), 0);
  });

  it('stores empty files without parts', async () => {
    const file = await upload(alice, { name: 'empty.txt', data: Buffer.alloc(0) });
    assert.equal(file.size, 0);
    const res = await download(alice, file.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 0);
  });

  it('trashes a folder with everything in it, restores it, and deletes it for good', async () => {
    const box = await folder(alice, 'Box');
    const inner = await folder(alice, 'Inner', box.id);
    const file = await upload(alice, { name: 'inside.txt', data: Buffer.from('inside'), parentId: inner.id });
    const key = (await FileNode.findById(file.id).setOptions({ allWorkspaces: true }).lean()).storageKey;

    await as(alice).post(`/api/files/nodes/${box.id}/trash`).expect(204);
    const trash = (await as(alice).get('/api/files/trash').expect(200)).body.items;
    // Only the folder that was trashed is listed, not what's inside it.
    assert.deepEqual(trash.map((i) => i.id), [box.id]);
    await as(alice).get(`/api/files/browse?folder=${inner.id}`).expect(404);

    await as(alice).post(`/api/files/nodes/${box.id}/restore`).expect(200);
    const restored = (await as(alice).get(`/api/files/browse?folder=${inner.id}`).expect(200)).body.items;
    assert.deepEqual(restored.map((i) => i.name), ['inside.txt']);

    await as(alice).post(`/api/files/nodes/${box.id}/trash`).expect(204);
    // Only items in the trash can be deleted for good.
    await as(alice).del(`/api/files/nodes/${inner.id}`).expect(400);
    await as(alice).del(`/api/files/nodes/${box.id}`).expect(204);
    assert.equal(await FileNode.countDocuments({ _id: mongoose.trusted({ $in: [box.id, inner.id, file.id] }) }).setOptions({ allWorkspaces: true }), 0);
    assert.equal(await objectExists(key), true);
    await sweeper.drainGarbage();
    assert.equal(await objectExists(key), false);
  });

  it('empties trash older than 30 days on its own', async () => {
    const old = await upload(alice, { name: 'old.txt', data: Buffer.from('old') });
    await as(alice).post(`/api/files/nodes/${old.id}/trash`).expect(204);
    await mongoose.connection.db.collection('file_nodes').updateOne({ _id: new mongoose.Types.ObjectId(old.id) }, { $set: { trashedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const result = await sweeper.sweep();
    assert.ok(result.trash >= 1);
    assert.equal(await FileNode.countDocuments({ _id: old.id }).setOptions({ allWorkspaces: true }), 0);
  });

  it('shares with people in the workspace: view, then edit', async () => {
    const team = await folder(alice, 'Team');
    const doc = await upload(alice, { name: 'plan.txt', data: Buffer.from('the plan'), parentId: team.id });

    // Nothing is visible until it's shared.
    await as(bob).get(`/api/files/browse?folder=${team.id}`).expect(404);
    await as(alice).post(`/api/files/nodes/${team.id}/shares`).send({ userId: bob.user.id, role: 'view' }).expect(201);

    const shared = (await as(bob).get('/api/files/shared').expect(200)).body.items;
    assert.deepEqual(shared.map((i) => [i.name, i.role, i.ownerName]), [['Team', 'view', alice.name]]);
    const inside = await as(bob).get(`/api/files/browse?folder=${team.id}`).expect(200);
    assert.equal(inside.body.role, 'view');
    // Bob sees from the shared folder down, nothing of Alice's drive above it.
    assert.deepEqual(inside.body.breadcrumbs, []);
    assert.equal((await download(bob, doc.id)).body.toString(), 'the plan');
    const refused = await as(bob).post('/api/files/uploads').send({ name: 'mine.txt', size: 3, parentId: team.id }).expect(403);
    assert.equal(refused.body.error.code, 'FILES_FORBIDDEN');
    // Search finds what's shared with him.
    const found = (await as(bob).get('/api/files/search?q=plan').expect(200)).body.items;
    assert.deepEqual(found.map((i) => i.id), [doc.id]);

    // With edit access, what he uploads belongs to Alice and counts against her storage.
    await as(alice).post(`/api/files/nodes/${team.id}/shares`).send({ userId: bob.user.id, role: 'edit' }).expect(201);
    const added = await upload(bob, { name: 'from-bob.txt', data: Buffer.from('hi'), parentId: team.id });
    assert.equal(added.ownerId, alice.user.id);
    // But he can't share it, move it out of Alice's drive, or delete it for good.
    await as(bob).post(`/api/files/nodes/${added.id}/shares`).send({ userId: carol.user.id, role: 'view' }).expect(403);
    await as(bob).patch(`/api/files/nodes/${added.id}`).send({ parentId: null }).expect(403);

    // Only members of the workspace can be added.
    const outsider = await registerUser({}, { joinTestWorkspace: false });
    const res = await as(alice).post(`/api/files/nodes/${team.id}/shares`).send({ userId: outsider.user.id, role: 'view' }).expect(400);
    assert.equal(res.body.error.code, 'NOT_A_MEMBER');

    // Removing the share takes access away at once.
    const { people } = (await as(alice).get(`/api/files/nodes/${team.id}/shares`).expect(200)).body;
    await as(alice).del(`/api/files/shares/${people[0].id}`).expect(204);
    await as(bob).get(`/api/files/browse?folder=${team.id}`).expect(404);
  });

  it('public links: anyone can view what was shared, and nothing outside it', async () => {
    const pub = await folder(alice, 'Public');
    const sub = await folder(alice, 'Sub', pub.id);
    const file = await upload(alice, { name: 'hello.txt', data: Buffer.from('hello world'), parentId: sub.id });
    const secret = await upload(alice, { name: 'secret.txt', data: Buffer.from('secret') });

    const { link } = (await as(alice).post(`/api/files/nodes/${pub.id}/link`).expect(201)).body;
    const token = link.url.split('/').pop();
    const top = await api().get(`/api/public/files/links/${token}`).expect(200);
    assert.equal(top.body.item.name, 'Public');
    assert.equal(top.body.ownerName, alice.name);
    assert.deepEqual(top.body.items.map((i) => i.name), ['Sub']);
    const down = await api().get(`/api/public/files/links/${token}?folder=${sub.id}`).expect(200);
    assert.deepEqual(down.body.breadcrumbs.map((b) => b.name), ['Public', 'Sub']);
    const got = await fetchRaw(`/api/public/files/links/${token}/download/${file.id}`).expect(200);
    assert.equal(got.body.toString(), 'hello world');

    // Files outside the shared folder can't be reached through the link.
    await api().get(`/api/public/files/links/${token}/download/${secret.id}`).expect(404);
    // A tampered token doesn't work.
    await api().get(`/api/public/files/links/${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`).expect(404);

    // Turned off on this server: every link stops working.
    await FilesSettings.updateOne({ _id: 'instance' }, { $set: { linkSharing: false } }, { upsert: true });
    await api().get(`/api/public/files/links/${token}`).expect(404);
    await FilesSettings.deleteMany({});
    await api().get(`/api/public/files/links/${token}`).expect(200);
    // Turned off for the item: gone for good.
    await as(alice).del(`/api/files/nodes/${pub.id}/link`).expect(200);
    await api().get(`/api/public/files/links/${token}`).expect(404);
  });

  it('enforces the storage limit a platform admin sets', async () => {
    const used = (await as(carol).get('/api/files/storage').expect(200)).body.storage;
    assert.equal(used.quotaBytes, null);
    await FilesSettings.updateOne({ _id: 'instance' }, { $set: { defaultQuotaBytes: 100, maxFileBytes: 60 } }, { upsert: true });
    await upload(carol, { name: 'a.txt', data: Buffer.alloc(50) });
    const tooBig = await upload(carol, { name: 'b.txt', data: Buffer.alloc(61) });
    assert.equal(tooBig.body.error.code, 'FILE_TOO_LARGE');
    const full = await upload(carol, { name: 'c.txt', data: Buffer.alloc(51) });
    assert.equal(full.body.error.code, 'STORAGE_FULL');
    // A personal limit wins over the default.
    await FileQuota.create({ _id: carol.user.id, bytes: null });
    await upload(carol, { name: 'd.txt', data: Buffer.alloc(51) });
    await FileQuota.deleteMany({});
    await FilesSettings.deleteMany({});
  });

  it('uses the plan\'s limits on hosted plans, counted per workspace', async () => {
    await Workspace.updateOne({ _id: wsId }, { $set: { plan: 'standard' } });
    try {
      const storageInfo = (await as(carol).get('/api/files/storage').expect(200)).body.storage;
      assert.equal(storageInfo.quotaBytes, 5 * 1024 ** 3);
      assert.equal(storageInfo.perWorkspace, true);
      const tooBig = await as(carol).post('/api/files/uploads').send({ name: 'huge.iso', size: 3 * 1024 ** 3 }).expect(400);
      assert.equal(tooBig.body.error.code, 'FILE_TOO_LARGE');
      // Fill the 5 GB with a record (no real bytes needed), then one more byte is refused.
      await runInWorkspace(wsId, () => FileNode.create({ owner: carol.user.id, kind: 'file', name: 'x', nameKey: 'x', size: 5 * 1024 ** 3, status: 'ready', storageKey: 'none' }));
      const full = await as(carol).post('/api/files/uploads').send({ name: 'one.txt', size: 1 }).expect(400);
      assert.equal(full.body.error.code, 'STORAGE_FULL');
    } finally {
      await Workspace.updateOne({ _id: wsId }, { $set: { plan: 'self-hosted' } });
      await FileNode.deleteMany({ storageKey: 'none' }).setOptions({ allWorkspaces: true });
    }
  });

  it('stores preview images from editors, serves them by signed link, and deletes them with the file', async () => {
    // The smallest valid PNG header, plus some bytes: enough for the type check.
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
    const shared = await folder(alice, 'Pictures');
    const file = await upload(alice, { name: 'photo.png', data: Buffer.from('pretend image'), parentId: shared.id, mime: 'image/png' });
    assert.equal(file.thumb, null);
    const putThumb = (u, body) => as(u).put(`/api/files/nodes/${file.id}/thumbnail`).set('Content-Type', 'application/octet-stream').send(body);

    // Only real images are accepted, and not too big.
    assert.equal((await putThumb(alice, Buffer.from('<svg onload=alert(1)>')).expect(400)).body.error.code, 'BAD_THUMBNAIL');
    assert.equal((await putThumb(alice, Buffer.concat([png, Buffer.alloc(401 * 1024)])).expect(413)).body.error.code, 'THUMBNAIL_TOO_LARGE');
    // Viewers can't set one; editors can.
    await as(alice).post(`/api/files/nodes/${shared.id}/shares`).send({ userId: bob.user.id, role: 'view' }).expect(201);
    await putThumb(bob, png).expect(403);
    const { item } = (await putThumb(alice, png).expect(200)).body;
    assert.equal(item.thumb, 'ready');

    // Listings carry a link that works without signing in, and stays the same within the hour.
    const listed = (await as(alice).get(`/api/files/browse?folder=${shared.id}`).expect(200)).body.items[0];
    assert.equal(listed.thumbUrl, item.thumbUrl);
    const got = await fetchRaw(listed.thumbUrl).expect(200);
    assert.equal(got.headers['content-type'], 'image/png');
    assert.deepEqual(got.body, png);
    await fetchRaw(`${listed.thumbUrl.slice(0, -3)}AAA`).expect(404);

    // "No preview" never replaces one that exists.
    await as(alice).post(`/api/files/nodes/${file.id}/no-thumbnail`).expect(204);
    assert.equal((await FileNode.findById(file.id).setOptions({ allWorkspaces: true }).lean()).thumb, 'ready');

    // Deleted for good: the preview goes too.
    const key = storage.thumbKeyFor((await FileNode.findById(file.id).setOptions({ allWorkspaces: true }).lean()).storageKey);
    assert.equal(await objectExists(key), true);
    await as(alice).post(`/api/files/nodes/${shared.id}/trash`).expect(204);
    await as(alice).del(`/api/files/nodes/${shared.id}`).expect(204);
    await sweeper.drainGarbage();
    assert.equal(await objectExists(key), false);
    await fetchRaw(listed.thumbUrl).expect(404);
  });

  it('accepts raw bytes only on upload parts', async () => {
    const res = await as(alice).post('/api/files/folders').set('Content-Type', 'application/octet-stream').send(Buffer.from('{}')).expect(415);
    assert.equal(res.body.error.code, 'UNSUPPORTED_MEDIA');
  });
});

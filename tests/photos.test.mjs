import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
import { photosSource } from '../server/photos-source.mjs';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
test('Photos exports enter the inbox with original metadata and retain deduplication after discard and restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-photos-'));
  const app = join(root, 'Helper.app');
  mkdirSync(app);
  const options = {
    capture: {
      intervalMs: 3600000,
      photos: { platform: 'darwin', appPath: app, launch: async () => {} },
    },
  };
  let api = createApi(join(root, 'test.sqlite'), options);
  const settings = { enabled: true, scope: 'all', includeExisting: false };
  async function configure(value) {
    await api.inbox.handle(
      { method: 'PUT' },
      {},
      new URL('http://localhost/api/inbox/photos'),
      value,
      () => {},
    );
  }
  function enqueue(key, bytes = png) {
    const base = join(root, 'photos/queue', key.repeat(64));
    writeFileSync(base + '.media', bytes);
    writeFileSync(
      base + '.json',
      JSON.stringify({
        name: 'IMG_1234.PNG',
        assetId: 'asset/1234',
        modified: '2026-09-21T12:00:00Z',
      }),
    );
    return base;
  }
  try {
    await assert.rejects(
      configure({ ...settings, scope: '../all' }),
      /valid Photos scope/,
    );
    await configure(settings);
    const base = enqueue('a');
    await api.inbox.scanNow();
    const files = api.inbox.status().files;
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'IMG_1234.PNG');
    assert.equal(files[0].sourcePath, 'photos:asset/1234');
    assert.equal(files[0].sourceModified, '2026-09-21T12:00:00Z');
    assert.deepEqual(readFileSync(join(root, 'attachments', files[0].id)), png);
    assert.equal(existsSync(base + '.json'), false);
    await api.inbox.handle(
      { method: 'DELETE' },
      {},
      new URL('http://localhost/api/inbox/' + files[0].id),
      {},
      () => {},
    );
    await Promise.resolve(api.close());
    assert.equal(
      JSON.parse(readFileSync(join(root, 'photos/lease.json'))).at,
      0,
    );
    api = createApi(join(root, 'test.sqlite'), options);
    const duplicate = enqueue('b');
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    assert.equal(existsSync(duplicate + '.media'), false);
    await configure({ ...settings, enabled: false });
    const pending = enqueue('c', Buffer.concat([png, Buffer.from('new')]));
    await api.inbox.scanNow();
    assert.equal(existsSync(pending + '.json'), true);
    assert.equal(api.inbox.status().files.length, 0);
    await configure(settings);
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 1);
  } finally {
    await Promise.resolve(api.close());
    rmSync(root, { recursive: true, force: true });
  }
});

test('Photos queue retains failed exports for retry and non-Mac platforms cannot enable it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-photos-queue-'));
  const source = photosSource(root, {
    platform: 'darwin',
    appPath: root,
    launch: async () => {},
  });
  const other = photosSource(join(root, 'windows'), { platform: 'win32' });
  try {
    await assert.rejects(
      other.configure({ enabled: true, scope: 'all', includeExisting: false }),
      /macOS/,
    );
    await source.configure({
      enabled: true,
      scope: 'all',
      includeExisting: false,
    });
    const base = join(root, 'photos/queue', 'd'.repeat(64));
    writeFileSync(base + '.media', png);
    writeFileSync(
      base + '.json',
      JSON.stringify({
        name: 'photo.png',
        assetId: 'x',
        modified: new Date().toISOString(),
      }),
    );
    await source.drain(async () => {
      throw Error('Disk full');
    });
    assert.equal(existsSync(base + '.media'), true);
    assert.equal(existsSync(base + '.json'), true);
    assert.equal(source.status().error, 'Disk full');
    await source.drain(async () => true);
    assert.equal(existsSync(base + '.json'), false);
    assert.equal(source.status().error, '');
  } finally {
    source.close();
    other.close();
    rmSync(root, { recursive: true, force: true });
  }
});

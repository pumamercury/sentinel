import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  truncateSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
import { isLocallyAvailable } from '../server/capture-inbox.mjs';
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const draft = {
  title: 'Capture issue',
  project: 'Test',
  issueType: 'Bug',
  description: '',
  steps: '',
  expected: '',
  actual: '',
  environment: '',
  assignee: '',
  labels: '',
  version: '',
  dueDate: '',
  status: 'Open',
  priority: 'Medium',
  severity: 'Major',
};

test('inbox monitors stable new files, deduplicates, resumes, attaches atomically, previews and backs up', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-inbox-'));
  const source = join(root, 'captures'),
    data = join(root, 'data');
  mkdirSync(source);
  mkdirSync(data);
  let api,
    server,
    online = true;
  async function start() {
    api = createApi(join(data, 'test.sqlite'), {
      capture: {
        intervalMs: 3600000,
        stableMs: 0,
        available: async () => online,
      },
    });
    server = createServer((req, res) =>
      api.handler(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
  }
  async function stop() {
    await new Promise((r) => server.close(r));
    await api.close();
  }
  async function request(path, method = 'GET', body) {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return { status: res.status, data: await res.json() };
  }
  const settings = {
    folder: source,
    enabled: true,
    extensions: ['.png', '.mov'],
    nameContains: '',
  };
  await start();
  try {
    writeFileSync(join(source, 'old.png'), png);
    assert.equal(await isLocallyAvailable(join(source, 'old.png')), true);
    assert.equal(
      (await request('inbox/settings', 'PUT', { ...settings, folder: data }))
        .status,
      400,
    );
    assert.equal(
      (await request('inbox/settings', 'PUT', settings)).status,
      200,
    );
    assert.equal(api.inbox.status().counts.ignored, 1);
    assert.equal(api.inbox.status().files.length, 0);
    writeFileSync(
      join(source, 'new.png'),
      Buffer.concat([png, Buffer.from('new')]),
    );
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    // Changes between scans reset the stable observation.
    writeFileSync(
      join(source, 'new.png'),
      Buffer.concat([png, Buffer.from('finished')]),
    );
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 1);
    const first = api.inbox.status().files[0];
    assert.equal(first.previewType, 'image');
    assert.ok(existsSync(join(source, 'new.png')));
    const preview = await fetch(
      `http://127.0.0.1:${server.address().port}/api/inbox/${first.id}?preview=1`,
      { headers: { Range: 'bytes=0-7' } },
    );
    assert.equal(preview.status, 206);
    assert.deepEqual(
      Buffer.from(await preview.arrayBuffer()),
      png.subarray(0, 8),
    );
    writeFileSync(
      join(source, 'copy.png'),
      readFileSync(join(source, 'new.png')),
    );
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 1);
    assert.equal(api.inbox.status().counts.duplicate, 1);
    online = false;
    writeFileSync(
      join(source, 'cloud.png'),
      Buffer.concat([png, Buffer.from('cloud')]),
    );
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 1);
    assert.match(
      api.inbox.status().problems.find((p) => p.path === 'cloud.png').message,
      /iCloud/,
    );
    online = true;
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 2);
    const issue = (await request('bugs', 'POST', draft)).data;
    assert.equal(
      (
        await request('inbox/assign', 'POST', {
          ids: [first.id, 'missing'],
          issueId: issue.id,
        })
      ).status,
      400,
    );
    assert.equal(api.inbox.status().files.length, 2);
    assert.equal(
      (await request(`bugs/${issue.id}/attachments`)).data.length,
      0,
    );
    assert.equal(
      (
        await request('inbox/assign', 'POST', {
          ids: [first.id],
          issueId: issue.id,
        })
      ).status,
      200,
    );
    assert.equal(api.inbox.status().files.length, 1);
    assert.equal(
      (await request(`bugs/${issue.id}/attachments`)).data[0].id,
      first.id,
    );
    const bytes = await fetch(
      `http://127.0.0.1:${server.address().port}/api/bugs/${issue.id}/attachments/${first.id}`,
    );
    assert.deepEqual(
      Buffer.from(await bytes.arrayBuffer()),
      readFileSync(join(source, 'new.png')),
    );
    const discarded = api.inbox.status().files[0];
    await request('inbox/' + discarded.id, 'DELETE');
    assert.ok(existsSync(join(source, 'cloud.png')));
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    writeFileSync(
      join(source, 'discard-copy.png'),
      readFileSync(join(source, 'cloud.png')),
    );
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    await request('inbox/settings', 'PUT', { ...settings, enabled: false });
    writeFileSync(
      join(source, 'paused.png'),
      Buffer.concat([png, Buffer.from('paused')]),
    );
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 0);
    await stop();
    await start();
    assert.equal(api.inbox.status().settings.enabled, false);
    await request('inbox/settings', 'PUT', settings);
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 1);
    // Restart preserves baseline and deduplication; files arriving while stopped are collected.
    await stop();
    writeFileSync(
      join(source, 'restart.png'),
      Buffer.concat([png, Buffer.from('restart')]),
    );
    await start();
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 2);
    writeFileSync(join(source, 'huge.mov'), Buffer.alloc(1));
    truncateSync(join(source, 'huge.mov'), 250000001);
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().counts.skipped, 1);
    assert.equal(
      readdirSync(join(data, 'attachments')).filter((name) =>
        name.endsWith('.part'),
      ).length,
      0,
    );
    const backup = (await request('backup')).data;
    assert.equal(backup.inbox.length, 2);
    assert.ok(!('settings' in backup.inbox[0]));
    assert.equal(
      (
        await request('import', 'POST', {
          ...backup,
          inbox: [{ ...backup.inbox[0], base64: 'invalid' }],
        })
      ).status,
      400,
    );
    const restoredData = join(root, 'restored');
    mkdirSync(restoredData);
    const restored = createApi(join(restoredData, 'test.sqlite'), {
      capture: {
        intervalMs: 3600000,
        stableMs: 0,
        available: async () => true,
      },
    });
    try {
      restored.inbox.prepareImport(backup.inbox)();
      assert.equal(restored.inbox.status().files.length, 2);
      restored.inbox.prepareImport(backup.inbox)();
      assert.equal(restored.inbox.status().files.length, 2);
      assert.equal(restored.inbox.status().settings.enabled, false);
    } finally {
      await restored.close();
    }
    await request(`bugs/${issue.id}`, 'DELETE');
    assert.ok(existsSync(join(source, 'new.png')));
  } finally {
    await stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch cloud metadata skips offline files and detects hydration without size or timestamp changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-cloud-scan-'));
  const source = join(root, 'captures');
  mkdirSync(source);
  const oldCloud = join(source, 'old-cloud.png');
  writeFileSync(oldCloud, png);
  let hydrated = false,
    checks = 0;
  const api = createApi(join(root, 'data', 'test.sqlite'), {
    capture: {
      intervalMs: 3600000,
      stableMs: 0,
      available: async () => {
        checks++;
        return true;
      },
      availabilitySnapshot: async () =>
        new Map(
          readdirSync(source).map((name) => [
            join(source, name).toLowerCase(),
            name === 'old-cloud.png' ? hydrated : name === 'ready.png',
          ]),
        ),
    },
  });
  const server = createServer((req, res) =>
    api.handler(req, res, () => res.end()),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/inbox/settings`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: source,
          enabled: true,
          extensions: ['.png'],
          nameContains: '',
        }),
      },
    );
    assert.equal(res.status, 200);
    for (let i = 0; i < 40; i++)
      writeFileSync(join(source, `offline-${i}.png`), png);
    writeFileSync(
      join(source, 'ready.png'),
      Buffer.concat([png, Buffer.from('ready')]),
    );
    await api.inbox.scanNow();
    await api.inbox.scanNow();
    assert.equal(
      checks,
      1,
      'offline files do not launch individual availability checks',
    );
    assert.deepEqual(
      api.inbox.status().files.map((f) => f.name),
      ['ready.png'],
    );
    hydrated = true;
    await api.inbox.scanNow();
    assert.equal(checks, 2);
    assert.equal(api.inbox.status().files.length, 2);
    assert.ok(api.inbox.status().files.some((f) => f.name === 'old-cloud.png'));
    await api.inbox.scanNow();
    assert.equal(api.inbox.status().files.length, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await api.close();
    rmSync(root, { recursive: true, force: true });
  }
});

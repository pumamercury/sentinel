import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
const report = {
  title: 'Login fails',
  project: 'Project1',
  description: 'Test report',
  steps: 'Open login',
  expected: 'Signed in',
  actual: 'Error',
  environment: 'Windows',
  assignee: '',
  labels: 'auth',
  version: '1',
  dueDate: '',
  status: 'Open',
  priority: 'Medium',
  severity: 'Major',
  reproRate: '3/5 (60%)',
  component: 'Login',
  customFields: {},
};
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bugbook-workspace-'));
  const path = join(dir, 'test.sqlite');
  let api, server;
  const open = async () => {
    api = createApi(path);
    server = createServer((req, res) =>
      api.handler(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const config = (await request('fields')).data;
    const env = config.find((f) => f.key === 'environment');
    if (!env.options.includes('Windows')) {
      env.options.push('Windows');
      assert.equal((await request('fields', 'PUT', config)).status, 200);
    }
  };
  const close = async () => {
    if (server) {
      await new Promise((r) => server.close(r));
      api.close();
      server = null;
    }
  };
  const fetchApi = (route, method = 'GET', body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const request = async (...args) => {
    const r = await fetchApi(...args);
    return { status: r.status, data: await r.json() };
  };
  return {
    url: (route) => `http://127.0.0.1:${server.address().port}/api/${route}`,
    path,
    open,
    close,
    request,
    fetchApi,
    destroy: async () => {
      await close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('legacy bugs become projects; project edits and required/hidden fields persist', async () => {
  const f = await fixture();
  try {
    const db = new DatabaseSync(f.path);
    db.exec(
      'CREATE TABLE bugs(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL)',
    );
    const { reproRate, component, customFields, ...legacy } = report;
    db.prepare('INSERT INTO bugs(data) VALUES(?)').run(
      JSON.stringify({
        ...legacy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        comments: [],
        history: [],
      }),
    );
    db.close();
    await f.open();
    assert.equal((await f.request('bugs')).data[0].component, '');
    const p = (await f.request('projects')).data[0];
    assert.equal(p.name, 'Project1');
    const image =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    assert.equal(
      (
        await f.request('projects/' + p.id, 'PUT', {
          ...p,
          name: 'Mobile app',
          description: 'App under test',
          icon: '📱',
          image,
        })
      ).status,
      200,
    );
    assert.equal((await f.request('bugs')).data[0].project, 'Mobile app');
    assert.equal(
      (await f.request('projects', 'POST', { name: 'mobile APP' })).status,
      400,
    );
    assert.equal(
      (
        await f.request('projects/' + p.id, 'PUT', {
          ...p,
          image: 'data:image/svg+xml;base64,PHN2Zz4=',
        })
      ).status,
      400,
    );
    let fields = (await f.request('fields')).data;
    assert.equal(
      (
        await f.request(
          'fields',
          'PUT',
          fields.map((d) => (d.key === 'title' ? { ...d, enabled: false } : d)),
        )
      ).status,
      400,
    );
    fields.push({
      key: 'custom_build',
      label: 'Build number',
      type: 'number',
      enabled: true,
      required: true,
      options: [],
      builtin: false,
    });
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    assert.equal((await f.request('bugs', 'POST', report)).status, 400);
    assert.equal(
      (
        await f.request('bugs', 'POST', {
          ...report,
          customFields: { custom_build: 'oops' },
        })
      ).status,
      400,
    );
    const b = (
      await f.request('bugs', 'POST', {
        ...report,
        project: 'Mobile app',
        customFields: { custom_build: '42' },
      })
    ).data;
    assert.equal(b.component, 'Login');
    assert.equal(b.reproRate, '3/5 (60%)');
    assert.equal(b.customFields.custom_build, '42');
    fields = fields.map((d) =>
      d.key === 'custom_build' ? { ...d, enabled: false } : d,
    );
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    assert.equal(
      (await f.request('bugs/' + b.id, 'PUT', { ...b, title: 'Updated title' }))
        .data.customFields.custom_build,
      '42',
    );
    await f.close();
    await f.open();
    assert.equal((await f.request('projects')).data[0].image, image);
    assert.equal(
      (await f.request('fields')).data.find((d) => d.key === 'custom_build')
        .enabled,
      false,
    );
  } finally {
    await f.destroy();
  }
});
test('attachments are byte-exact, scoped, bounded, backed up, and retained in Trash', async () => {
  const f = await fixture(),
    restored = await fixture();
  try {
    await f.open();
    await restored.open();
    const bug = (await f.request('bugs', 'POST', report)).data;
    const bytes = Buffer.alloc(1_000_000, 0xa9);
    const payload = {
      name: 'screen capture 🐛.bin',
      base64: bytes.toString('base64'),
    };
    const upload = await f.request(
      `bugs/${bug.id}/attachments`,
      'POST',
      payload,
    );
    assert.equal(upload.status, 201);
    assert.equal(upload.data.size, bytes.length);
    const download = await f.fetchApi(
      `bugs/${bug.id}/attachments/${upload.data.id}`,
    );
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    assert.equal(
      (await f.request('bugs/999/attachments/' + upload.data.id)).status,
      404,
    );
    assert.equal(
      (
        await f.request(`bugs/${bug.id}/attachments`, 'POST', {
          name: 'too big',
          base64: Buffer.alloc(10_000_001).toString('base64'),
        })
      ).status,
      400,
    );
    for (let i = 1; i < 20; i++)
      assert.equal(
        (
          await f.request(`bugs/${bug.id}/attachments`, 'POST', {
            name: 'log' + i,
            base64: 'eA==',
          })
        ).status,
        201,
      );
    assert.equal(
      (
        await f.request(`bugs/${bug.id}/attachments`, 'POST', {
          name: 'extra',
          base64: 'eA==',
        })
      ).status,
      400,
    );
    const backup = (await f.request('backup')).data;
    assert.equal(backup.schemaVersion, 2);
    assert.equal(backup.bugs[0].attachments.length, 20);
    assert.equal(
      (
        await restored.request('import', 'POST', {
          ...backup,
          bugs: [
            {
              ...backup.bugs[0],
              attachments: [{ name: 'broken', base64: '$bad' }],
            },
          ],
        })
      ).status,
      400,
    );
    assert.equal((await restored.request('bugs')).data.length, 0);
    assert.equal((await restored.request('projects')).data.length, 0);
    const existing = (await restored.request('bugs', 'POST', report)).data;
    assert.equal(
      (await restored.request('import', 'POST', backup)).data.imported,
      1,
    );
    const imported = (await restored.request('bugs')).data.find(
      (b) => b.id !== existing.id,
    );
    const files = (await restored.request(`bugs/${imported.id}/attachments`))
      .data;
    assert.equal(files.length, 20);
    assert.notEqual(files[0].id, upload.data.id);
    const restoredBytes = await restored.fetchApi(
      `bugs/${imported.id}/attachments/${files.find((f) => f.name === payload.name).id}`,
    );
    assert.deepEqual(Buffer.from(await restoredBytes.arrayBuffer()), bytes);
    await restored.request(
      `bugs/${imported.id}/attachments/${files[0].id}`,
      'DELETE',
    );
    assert.equal(
      (await restored.request(`bugs/${imported.id}/attachments`)).data.length,
      19,
    );
    await restored.request('bugs/' + imported.id, 'DELETE');
    const reused = (await restored.request('bugs', 'POST', report)).data;
    assert.notEqual(reused.id, imported.id);
    assert.deepEqual(
      (await restored.request(`bugs/${reused.id}/attachments`)).data,
      [],
    );
  } finally {
    await f.destroy();
    await restored.destroy();
  }
});

test('built-in select options can change and drive validation and backup restore', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    let fields = (await f.request('fields')).data.map((d) =>
      d.key === 'status'
        ? { ...d, options: ['Triage', 'Testing', 'Done'] }
        : d.key === 'priority'
          ? { ...d, options: ['Normal', 'Urgent'] }
          : d.key === 'severity'
            ? { ...d, options: ['Cosmetic', 'Functional'] }
            : d,
    );
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    const custom = {
      ...report,
      status: 'Testing',
      priority: 'Urgent',
      severity: 'Functional',
    };
    const result = await f.request('bugs', 'POST', custom);
    assert.equal(result.status, 201);
    assert.equal((await f.request('bugs', 'POST', report)).status, 400);
    assert.equal(
      (
        await f.request(
          'fields',
          'PUT',
          fields.map((d) =>
            d.key === 'status' ? { ...d, options: ['Triage', 'Done'] } : d,
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request('bugs/' + result.data.id, 'PUT', {
          ...custom,
          status: 'Done',
        })
      ).status,
      200,
    );
    fields = fields.map((d) =>
      d.key === 'status' ? { ...d, options: ['Triage', 'Done'] } : d,
    );
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    const backup = (await f.request('backup')).data;
    assert.equal((await target.request('import', 'POST', backup)).status, 200);
    assert.equal((await target.request('bugs')).data[0].status, 'Done');
    assert.deepEqual(
      (await target.request('fields')).data.find((d) => d.key === 'priority')
        .options,
      ['Normal', 'Urgent'],
    );
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('issue types upgrade existing settings and persist across edits and backups', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    const oldFields = (await f.request('fields')).data
      .filter((d) => d.key !== 'issueType')
      .map((d) =>
        d.key === 'component' ? { ...d, label: 'App component' } : d,
      );
    await f.close();
    const db = new DatabaseSync(f.path);
    db.prepare(
      "INSERT INTO settings(key,data) VALUES('fields',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
    ).run(JSON.stringify(oldFields));
    db.close();
    await f.open();
    const upgraded = (await f.request('fields')).data;
    assert.equal(upgraded.filter((d) => d.key === 'issueType').length, 1);
    assert.equal(
      upgraded.find((d) => d.key === 'component').label,
      'App component',
    );
    assert.deepEqual(upgraded.find((d) => d.key === 'issueType').options, [
      'Bug',
      'Idea',
      'Task',
      'Feature request',
    ]);
    assert.equal(
      (await f.request('bugs', 'POST', report)).data.issueType,
      'Bug',
    );
    for (const issueType of ['Bug', 'Idea', 'Task', 'Feature request']) {
      const r = await f.request('bugs', 'POST', { ...report, issueType });
      assert.equal(r.status, 201);
      assert.equal(r.data.issueType, issueType);
    }
    assert.equal(
      (await f.request('bugs', 'POST', { ...report, issueType: 'Unknown' }))
        .status,
      400,
    );
    const item = (await f.request('bugs')).data[0];
    assert.equal(
      (
        await f.request('bugs/' + item.id, 'PUT', {
          ...item,
          issueType: 'Task',
        })
      ).data.issueType,
      'Task',
    );
    const backup = (await f.request('backup')).data;
    assert.equal((await target.request('import', 'POST', backup)).status, 200);
    assert.deepEqual(
      (await target.request('bugs')).data.map((b) => b.issueType).sort(),
      (await f.request('bugs')).data.map((b) => b.issueType).sort(),
    );
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('large binary uploads stream to disk, restore, and survive issue deletion', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    const bug = (await f.request('bugs', 'POST', report)).data;
    const bytes = Buffer.alloc(12_000_000, 0xa7);
    const r = await fetch(f.url(`bugs/${bug.id}/attachments`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent('iOS recording.mov'),
      },
      body: bytes,
    });
    assert.equal(r.status, 201);
    const attachment = await r.json();
    assert.equal(attachment.size, bytes.length);
    const diskDir = join(f.path, '..', 'attachments');
    assert.deepEqual(readdirSync(diskDir), [attachment.id]);
    const inspection = new DatabaseSync(f.path);
    assert.equal(
      inspection
        .prepare('SELECT length(bytes) AS size FROM attachments WHERE id=?')
        .get(attachment.id).size,
      0,
    );
    inspection.close();
    await f.close();
    await f.open();
    const download = await f.fetchApi(
      `bugs/${bug.id}/attachments/${attachment.id}`,
    );
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const backup = (await f.request('backup')).data;
    assert.equal((await target.request('import', 'POST', backup)).status, 200);
    const imported = (await target.request('bugs')).data[0];
    const files = (await target.request(`bugs/${imported.id}/attachments`))
      .data;
    assert.equal(files[0].size, bytes.length);
    const restored = await target.fetchApi(
      `bugs/${imported.id}/attachments/${files[0].id}`,
    );
    assert.deepEqual(Buffer.from(await restored.arrayBuffer()), bytes);
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(
        f.url(`bugs/${bug.id}/attachments`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': '250000001',
            'X-File-Name': 'oversized.mov',
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
          req.destroy();
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 413);
    assert.equal(
      (await f.request(`bugs/${bug.id}/attachments`)).data.length,
      1,
    );
    await f.request('bugs/' + bug.id, 'DELETE');
    assert.equal(
      readdirSync(diskDir).length,
      1,
      'Trash retains attachment bytes',
    );
    assert.equal((await f.request(`bugs/${bug.id}/attachments`)).status, 404);
    assert.equal(
      (await f.request(`trash/${bug.id}/restore`, 'POST')).status,
      200,
    );
    assert.equal(
      (await f.request(`bugs/${bug.id}/attachments`)).data.length,
      1,
    );
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('inline media previews support ranges while downloads and unsafe files stay separate', async () => {
  const f = await fixture();
  try {
    await f.open();
    const bug = (await f.request('bugs', 'POST', report)).data;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    );
    const photo = (
      await f.request(`bugs/${bug.id}/attachments`, 'POST', {
        name: 'screenshot.png',
        base64: png.toString('base64'),
      })
    ).data;
    assert.equal(photo.previewType, 'image');
    const image = await f.fetchApi(
      `bugs/${bug.id}/attachments/${photo.id}?preview=1`,
    );
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('content-disposition'), 'inline');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const video = Buffer.concat([
      Buffer.from('000000186674797069736f6d0000000069736f6d6d703432', 'hex'),
      Buffer.alloc(4096, 0x11),
    ]);
    const upload = await fetch(f.url(`bugs/${bug.id}/attachments`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': 'recording.mp4',
      },
      body: video,
    });
    const clip = await upload.json();
    assert.equal(clip.previewType, 'video');
    const uri = f.url(`bugs/${bug.id}/attachments/${clip.id}?preview=1`);
    const partial = await fetch(uri, { headers: { Range: 'bytes=10-99' } });
    assert.equal(partial.status, 206);
    assert.equal(
      partial.headers.get('content-range'),
      `bytes 10-99/${video.length}`,
    );
    assert.deepEqual(
      Buffer.from(await partial.arrayBuffer()),
      video.subarray(10, 100),
    );
    const suffix = await fetch(uri, { headers: { Range: 'bytes=-16' } });
    assert.equal(suffix.status, 206);
    assert.deepEqual(
      Buffer.from(await suffix.arrayBuffer()),
      video.subarray(-16),
    );
    const head = await fetch(uri, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(video.length));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const invalid = await fetch(uri, { headers: { Range: 'bytes=999999-' } });
    assert.equal(invalid.status, 416);
    const download = await f.fetchApi(`bugs/${bug.id}/attachments/${clip.id}`);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    await download.arrayBuffer();
    const fake = (
      await f.request(`bugs/${bug.id}/attachments`, 'POST', {
        name: 'fake.png',
        base64: Buffer.from('<script>alert(1)</script>').toString('base64'),
      })
    ).data;
    assert.equal(fake.previewType, null);
    assert.equal(
      (await f.fetchApi(`bugs/${bug.id}/attachments/${fake.id}?preview=1`))
        .status,
      415,
    );
  } finally {
    await f.destroy();
  }
});

test('quick reports keep core validation and can be enriched without completing every required field', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    const fields = (await f.request('fields')).data.map((field) =>
      ['steps', 'expected', 'component', 'environment'].includes(field.key)
        ? { ...field, required: true }
        : field,
    );
    fields.push(
      {
        key: 'custom_build',
        label: 'Build number',
        type: 'number',
        required: true,
        enabled: true,
        builtin: false,
        options: [],
      },
      {
        key: 'custom_date',
        label: 'Test date',
        type: 'date',
        required: true,
        enabled: true,
        builtin: false,
        options: [],
      },
      {
        key: 'custom_device',
        label: 'Device',
        type: 'select',
        required: true,
        enabled: true,
        builtin: false,
        options: ['iPhone', 'iPad'],
      },
    );
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    assert.equal((await f.request('bugs', 'POST', report)).status, 400);
    const quick = {
      title: 'Capture now, investigate later',
      project: 'Project1',
      status: 'Open',
      priority: 'Medium',
      quickReport: true,
    };
    const created = await f.request('bugs', 'POST', quick);
    assert.equal(created.status, 201);
    assert.equal(created.data.quickReport, true);
    assert.equal(created.data.steps, '');
    assert.equal(created.data.component, '');
    for (const invalid of [
      { title: '' },
      { project: '' },
      { status: '' },
      { priority: '' },
      { status: 'Unknown' },
      { priority: 'Unknown' },
      { quickReport: 'true' },
      { environment: 'Unconfigured' },
      { steps: 42 },
      { customFields: { custom_build: 'not a number' } },
      { customFields: { custom_date: 'not a date' } },
      { customFields: { custom_device: 'Android' } },
      { status: 'Resolved' },
    ])
      assert.equal(
        (await f.request('bugs', 'POST', { ...quick, ...invalid })).status,
        400,
        JSON.stringify(invalid),
      );
    const id = created.data.id;
    let updated = await f.request(`bugs/${id}`, 'PUT', {
      ...created.data,
      description: 'Screen flashes',
      quickReport: false,
    });
    assert.equal(updated.status, 200);
    assert.equal(
      updated.data.quickReport,
      true,
      'reporting mode is retained on edit',
    );
    updated = await f.request(`bugs/${id}`, 'PATCH', {
      field: 'component',
      previous: '',
      value: 'Home',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.expected, '');
    assert.equal(
      (
        await f.request(`bugs/${id}`, 'PATCH', {
          field: 'environment',
          previous: '',
          value: 'Unknown',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.request(`bugs/${id}`, 'PATCH', {
          field: 'component',
          previous: '',
          value: 'Stale',
        })
      ).status,
      409,
    );
    assert.equal(
      (await f.request(`bugs/${id}/quick`, 'POST', { status: 'Resolved' }))
        .status,
      400,
    );
    assert.equal(
      (
        await f.request(`bugs/${id}`, 'PATCH', {
          field: 'fixVersion',
          previous: '',
          value: '1.2',
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.request(`bugs/${id}/quick`, 'POST', { status: 'Resolved' }))
        .status,
      200,
    );
    assert.equal(
      (
        await f.request(`bugs/${id}`, 'PATCH', {
          field: 'fixVersion',
          previous: '1.2',
          value: '',
        })
      ).status,
      400,
    );
    const full = await f.request('bugs', 'POST', {
      ...report,
      customFields: {
        custom_build: '42',
        custom_date: '2026-09-23',
        custom_device: 'iPhone',
      },
    });
    assert.equal(full.status, 201);
    assert.equal(
      (
        await f.request(`bugs/${full.data.id}`, 'PUT', {
          ...full.data,
          steps: '',
          quickReport: true,
        })
      ).status,
      400,
      'a full report cannot bypass required fields by claiming to be quick',
    );
    const backup = (await f.request('backup')).data;
    assert.equal((await target.request('import', 'POST', backup)).status, 200);
    const restored = (await target.request('bugs')).data.find(
      (bug) => bug.title === quick.title,
    );
    assert.equal(restored.quickReport, true);
    assert.equal(
      (
        await target.request(`bugs/${restored.id}`, 'PATCH', {
          field: 'expected',
          previous: '',
          value: 'Stable screen',
        })
      ).status,
      200,
    );
    await f.close();
    await f.open();
    assert.equal(
      (await f.request('bugs')).data.find((bug) => bug.id === id).quickReport,
      true,
    );
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('legacy Fix version consolidation preserves conflicts, history and backups without refilling cleared values', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    const fields = (await f.request('fields')).data;
    fields.push({
      key: 'custom_fix',
      label: 'Fix version',
      type: 'text',
      enabled: true,
      required: false,
      builtin: false,
      options: [],
    });
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    const backfill = (
      await f.request('bugs', 'POST', {
        ...report,
        title: 'Legacy only',
        customFields: { custom_fix: '1.2' },
      })
    ).data;
    const conflict = (
      await f.request('bugs', 'POST', {
        ...report,
        title: 'Conflicting versions',
        fixVersion: '2.0',
        customFields: { custom_fix: '1.5' },
      })
    ).data;
    const legacyBackup = (await f.request('backup')).data;
    legacyBackup.bugs.find((bug) => bug.id === backfill.id).status = 'Resolved';
    assert.equal(
      (await target.request('import', 'POST', legacyBackup)).status,
      200,
      'legacy backups receive the same migration before import',
    );
    assert.equal(
      (await target.request('bugs')).data.find(
        (bug) => bug.title === backfill.title,
      ).fixVersion,
      '1.2',
    );
    assert.equal(
      (await target.request('fields')).data.find(
        (field) => field.key === 'custom_fix',
      ).enabled,
      false,
    );
    await f.close();
    await f.open();
    let bugs = (await f.request('bugs')).data;
    const copied = bugs.find((bug) => bug.id === backfill.id);
    assert.equal(copied.fixVersion, '1.2');
    assert.equal(copied.customFields.custom_fix, '1.2');
    assert.equal(copied.updatedAt, backfill.updatedAt);
    assert.deepEqual(copied.history, backfill.history);
    const kept = bugs.find((bug) => bug.id === conflict.id);
    assert.equal(kept.fixVersion, '2.0');
    assert.equal(kept.customFields.custom_fix, '1.5');
    const config = (await f.request('fields')).data;
    assert.equal(
      config.find((field) => field.key === 'fixVersion').label,
      'Fix version',
    );
    assert.equal(
      config.find((field) => field.key === 'custom_fix').enabled,
      false,
    );
    assert.equal(
      (
        await f.request(`bugs/${backfill.id}`, 'PATCH', {
          field: 'fixVersion',
          previous: '1.2',
          value: '',
        })
      ).status,
      200,
    );
    await f.close();
    await f.open();
    bugs = (await f.request('bugs')).data;
    assert.equal(
      bugs.find((bug) => bug.id === backfill.id).fixVersion,
      '',
      'restart must not restore intentionally cleared values',
    );
    const backup = (await f.request('backup')).data;
    assert.equal(
      backup.bugs.find((bug) => bug.id === conflict.id).customFields.custom_fix,
      '1.5',
    );
    assert.equal(
      (await target.request('import', 'POST', backup)).status,
      200,
      'migrated backups remain compatible with migrated workspace',
    );
    assert.ok(
      (await target.request('bugs')).data.some(
        (bug) =>
          bug.title === backfill.title &&
          bug.fixVersion === '' &&
          bug.customFields.custom_fix === '1.2',
      ),
    );
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('ambiguous duplicate Fix version fields are left intact', async () => {
  const f = await fixture();
  try {
    await f.open();
    const fields = (await f.request('fields')).data;
    for (const key of ['custom_fix_a', 'custom_fix_b'])
      fields.push({
        key,
        label: 'Fix version',
        type: 'text',
        enabled: true,
        required: false,
        builtin: false,
        options: [],
      });
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    assert.equal(
      (
        await f.request('bugs', 'POST', {
          ...report,
          customFields: { custom_fix_a: '1.0', custom_fix_b: '2.0' },
        })
      ).status,
      201,
    );
    await f.close();
    await f.open();
    assert.equal((await f.request('bugs')).data[0].fixVersion, '');
    assert.deepEqual((await f.request('bugs')).data[0].customFields, {
      custom_fix_a: '1.0',
      custom_fix_b: '2.0',
    });
    assert.ok(
      (await f.request('fields')).data
        .filter((field) => field.key.startsWith('custom_fix'))
        .every((field) => field.enabled),
    );
  } finally {
    await f.destroy();
  }
});

test('quick report creation tokens make retries idempotent and are excluded from backup copies', async () => {
  const f = await fixture(),
    target = await fixture();
  try {
    await f.open();
    await target.open();
    const input = {
      title: 'One captured problem',
      project: 'Project1',
      status: 'Open',
      priority: 'Medium',
      quickReport: true,
      creationToken: '88888888-aaaa-4bbb-8ccc-123456789abc',
    };
    for (const invalid of [
      { creationToken: '' },
      { creationToken: 1 },
      { creationToken: 'not-a-uuid' },
      { quickReport: false },
      { title: '' },
    ])
      assert.equal(
        (await f.request('bugs', 'POST', { ...input, ...invalid })).status,
        400,
      );
    const requests = await Promise.all(
      Array.from({ length: 3 }, () => f.request('bugs', 'POST', input)),
    );
    assert.deepEqual(requests.map((r) => r.status).sort(), [200, 200, 201]);
    const saved = requests[0].data;
    assert.ok(requests.every((r) => r.data.id === saved.id));
    assert.ok(
      requests
        .filter((r) => r.status === 200)
        .every((r) => r.data.creationReplayed === true),
    );
    assert.ok(
      !('creationReplayed' in requests.find((r) => r.status === 201).data),
    );
    assert.equal((await f.request('bugs')).data.length, 1);
    assert.ok(!('creationReplayed' in (await f.request('bugs')).data[0]));
    const edited = await f.request(`bugs/${saved.id}`, 'PUT', {
      ...saved,
      title: 'Investigated problem',
      expectedCreatedAt: saved.createdAt,
    });
    assert.equal(edited.status, 200);
    const mismatch = await f.request(`bugs/${saved.id}`, 'PUT', {
      ...edited.data,
      title: 'Wrong issue',
      expectedCreatedAt: '1999-01-01T00:00:00.000Z',
    });
    assert.equal(mismatch.status, 409);
    assert.equal(
      (await f.request('bugs')).data[0].title,
      'Investigated problem',
    );
    await f.close();
    await f.open();
    const retried = await f.request('bugs', 'POST', {
      ...input,
      title: 'Retry must not overwrite',
      creationToken: input.creationToken.toUpperCase(),
    });
    assert.equal(retried.status, 200);
    assert.equal(retried.data.creationReplayed, true);
    assert.equal(retried.data.id, saved.id);
    assert.equal(retried.data.title, 'Investigated problem');
    assert.equal(retried.data.history.length, edited.data.history.length);
    const backup = (await f.request('backup')).data;
    assert.ok(!('creationToken' in backup.bugs[0]));
    assert.ok(!('creationAccountId' in backup.bugs[0]));
    assert.ok(!('creationReplayed' in backup.bugs[0]));
    assert.equal((await f.request('import', 'POST', backup)).status, 200);
    assert.equal(
      (await f.request('bugs', 'POST', input)).data.id,
      saved.id,
      'imported copy cannot claim the original token',
    );
    // Older/hand-edited backups must not inject tokens into a destination.
    backup.bugs[0].creationToken = input.creationToken;
    backup.bugs[0].creationAccountId = null;
    assert.equal((await target.request('import', 'POST', backup)).status, 200);
    assert.ok(!('creationToken' in (await target.request('bugs')).data[0]));
    assert.equal((await target.request('bugs', 'POST', input)).status, 201);
    assert.equal((await target.request('bugs')).data.length, 2);
  } finally {
    await f.destroy();
    await target.destroy();
  }
});

test('field type changes retain existing values and reject incompatible conversions', async () => {
  const f = await fixture();
  try {
    await f.open();
    const bug = (await f.request('bugs', 'POST', report)).data;
    let fields = (await f.request('fields')).data;
    const repro = fields.find((field) => field.key === 'reproRate');
    repro.type = 'select';
    repro.options = ['Always', 'Sometimes'];
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    fields = (await f.request('fields')).data;
    assert.ok(
      fields
        .find((field) => field.key === 'reproRate')
        .options.includes(report.reproRate),
    );
    assert.equal((await f.request('bugs')).data[0].reproRate, report.reproRate);
    assert.equal(
      (
        await f.request(`bugs/${bug.id}`, 'PATCH', {
          field: 'reproRate',
          previous: report.reproRate,
          value: 'Always',
        })
      ).status,
      200,
    );
    fields.find((field) => field.key === 'reproRate').type = 'text';
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    fields.push({
      key: 'custom_conversion',
      label: 'Reference',
      type: 'text',
      options: [],
      required: false,
      enabled: true,
      builtin: false,
      issueTypes: [],
    });
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    assert.equal(
      (
        await f.request(`bugs/${bug.id}`, 'PATCH', {
          field: 'custom_conversion',
          previous: '',
          value: 'Not numeric',
        })
      ).status,
      200,
    );
    fields.find((field) => field.key === 'custom_conversion').type = 'number';
    assert.equal((await f.request('fields', 'PUT', fields)).status, 400);
    fields.find((field) => field.key === 'custom_conversion').type = 'select';
    assert.equal((await f.request('fields', 'PUT', fields)).status, 200);
    fields = (await f.request('fields')).data;
    assert.deepEqual(
      fields.find((field) => field.key === 'custom_conversion').options,
      ['Not numeric'],
    );
    fields.find((field) => field.key === 'project').type = 'select';
    assert.equal((await f.request('fields', 'PUT', fields)).status, 400);
  } finally {
    await f.destroy();
  }
});

test('affected versions are remembered per project and retained in backups after clearing an issue', async () => {
  const f = await fixture(),
    restored = await fixture();
  try {
    await f.open();
    await restored.open();
    const first = (
      await f.request('bugs', 'POST', { ...report, version: 'Release-1' })
    ).data;
    const reused = (
      await f.request('bugs', 'POST', { ...report, version: 'release-1' })
    ).data;
    assert.equal(reused.version, 'Release-1');
    await f.request('bugs', 'POST', {
      ...report,
      project: 'Other app',
      version: '2.0',
    });
    let projects = (await f.request('projects')).data;
    assert.deepEqual(projects.find((p) => p.name === report.project).versions, [
      'Release-1',
    ]);
    assert.deepEqual(projects.find((p) => p.name === 'Other app').versions, [
      '2.0',
    ]);
    await f.request(`bugs/${first.id}`, 'PATCH', {
      field: 'version',
      previous: 'Release-1',
      value: '',
    });
    await f.request(`bugs/${reused.id}`, 'PATCH', {
      field: 'version',
      previous: 'Release-1',
      value: '',
    });
    const backup = (await f.request('backup')).data;
    assert.equal(
      (await restored.request('import', 'POST', backup)).status,
      200,
    );
    projects = (await restored.request('projects')).data;
    assert.deepEqual(projects.find((p) => p.name === report.project).versions, [
      'Release-1',
    ]);
    assert.deepEqual(projects.find((p) => p.name === 'Other app').versions, [
      '2.0',
    ]);
  } finally {
    await f.destroy();
    await restored.destroy();
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';

test('CRUD, comments, persistence, backup validation and local access protection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bugbook-test-'));
  let api;
  let server;
  async function open() {
    api = createApi(join(dir, 'test.sqlite'));
    server = createServer((req, res) =>
      api.handler(req, res, () => {
        res.writeHead(404);
        res.end();
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
  }
  async function close() {
    await new Promise((r) => server.close(r));
    api.close();
  }
  await open();
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  try {
    const config = (await request('fields')).data;
    config.find((f) => f.key === 'environment').options = ['Windows'];
    assert.equal((await request('fields', 'PUT', config)).status, 200);
    const input = {
      title: 'Unicode 🐛 <script>alert(1)</script>',
      project: 'Test',
      description: 'Detailed report',
      steps: '1. Open\n2. Click',
      expected: 'Works',
      actual: 'Fails',
      environment: 'Windows',
      assignee: '',
      labels: 'ui',
      version: '1.0',
      dueDate: '',
      status: 'Open',
      priority: 'High',
      severity: 'Major',
    };
    assert.deepEqual((await request('bugs')).data, []);
    assert.equal(
      (await request('bugs', 'POST', { ...input, title: ' ' })).status,
      400,
    );
    let created = await request('bugs', 'POST', input);
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal(
      (await request('bugs/' + id, 'PUT', { ...input, status: 'In progress' }))
        .data.status,
      'In progress',
    );
    assert.equal(
      (
        await request('bugs/' + id + '/comments', 'POST', {
          text: 'Investigating',
        })
      ).data.comments.length,
      1,
    );
    await close();
    await open();
    let saved = (await request('bugs')).data[0];
    assert.equal(saved.title, input.title);
    assert.equal(saved.comments[0].text, 'Investigating');
    assert.equal(saved.history.length, 2);
    const backup = (await request('backup')).data;
    assert.equal(
      (
        await request('import', 'POST', {
          ...backup,
          bugs: [backup.bugs[0], { ...backup.bugs[0], status: 'invalid' }],
        })
      ).status,
      400,
    );
    assert.equal((await request('bugs')).data.length, 1);
    assert.equal((await request('import', 'POST', backup)).data.imported, 1);
    saved = (await request('bugs')).data;
    assert.equal(saved.length, 2);
    assert.notEqual(saved[0].id, saved[1].id);
    assert.equal(saved[0].comments[0].text, 'Investigating');
    assert.equal(
      (await request('bugs', 'POST', input, { Origin: 'https://example.com' }))
        .status,
      403,
    );
    assert.equal((await request('bugs/' + id, 'DELETE')).status, 200);
    assert.equal((await request('bugs/' + id, 'DELETE')).status, 404);
    assert.equal((await request('bugs')).data.length, 1);
    const replacement = (await request('bugs', 'POST', input)).data;
    assert.equal(replacement.id, 3, 'trashed issue numbers stay reserved');
    assert.equal((await request('bugs')).data.length, 2);
    const next = (await request('bugs', 'POST', input)).data;
    assert.equal(next.id, 4, 'occupied numbers are never reused');
    for (const bug of (await request('bugs')).data) {
      await request('bugs/' + bug.id, 'DELETE');
    }
    await close();
    await open();
    assert.equal(
      (await request('bugs', 'POST', input)).data.id,
      5,
      'trashed numbers remain reserved after reopening',
    );
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

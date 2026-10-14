import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';

test('project numbering migrates and persists; CSV scopes project, date and type with Excel-safe values', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-project-'));
  const path = join(dir, 'test.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(
    'CREATE TABLE bugs(id INTEGER PRIMARY KEY AUTOINCREMENT,data TEXT NOT NULL)',
  );
  const draft = {
    quickReport: true,
    title: 'Report',
    project: 'Ferment Tracker - Crock',
    issueType: 'Bug',
    status: 'Open',
    priority: 'Medium',
  };
  legacy.prepare('INSERT INTO bugs(id,data) VALUES(12,?)').run(
    JSON.stringify({
      ...draft,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comments: [],
      history: [],
    }),
  );
  legacy.close();
  let api, server, origin;
  async function open() {
    api = createApi(path);
    server = createServer((req, res) => api.handler(req, res, () => res.end()));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  }
  async function close() {
    await new Promise((resolve) => server.close(resolve));
    await api.close();
  }
  async function request(path, method = 'GET', body) {
    const response = await fetch(origin + '/api/' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  await open();
  try {
    assert.equal((await request('bugs')).data[0].issueKey, 'FT-BUG-1');
    const a = (await request('bugs', 'POST', draft)).data;
    assert.equal(a.issueKey, 'FT-BUG-2');
    const idea = (
      await request('bugs', 'POST', { ...draft, issueType: 'Idea' })
    ).data;
    assert.equal(idea.issueKey, 'FT-IDEA-1');
    const other = (
      await request('bugs', 'POST', { ...draft, project: 'Fitness Tracker' })
    ).data;
    assert.equal(other.issueKey, 'FT2-BUG-1');
    await request(`bugs/${a.id}`, 'DELETE');
    const next = (await request('bugs', 'POST', draft)).data;
    assert.equal(next.issueKey, 'FT-BUG-3');
    assert.equal(
      (await request(`trash/${a.id}/restore`, 'POST')).data.issueKey,
      'FT-BUG-2',
    );
    const moved = await request(`bugs/${other.id}`, 'PATCH', {
      field: 'project',
      previous: 'Fitness Tracker',
      value: 'Ferment Tracker - Crock',
    });
    assert.equal(moved.data.issueKey, 'FT-BUG-4');
    const changed = await request(`bugs/${other.id}`, 'PATCH', {
      field: 'issueType',
      previous: 'Bug',
      value: 'Idea',
    });
    assert.equal(changed.data.issueKey, 'FT-IDEA-2');
    await close();
    await open();
    assert.equal(
      (await request('bugs')).data.find((b) => b.id === next.id).issueKey,
      'FT-BUG-3',
    );
    const projects = (await request('projects')).data;
    const project = projects.find((p) => p.name === 'Ferment Tracker - Crock');
    const renamed = await request(`projects/${project.id}`, 'PUT', {
      ...project,
      name: 'Ferment Journal',
    });
    assert.equal(renamed.status, 200);
    assert.equal(
      (await request('bugs')).data.find((b) => b.id === next.id).issueKey,
      'FT-BUG-3',
    );
    await request(`bugs/${next.id}`, 'PATCH', {
      field: 'title',
      previous: next.title,
      value: '=HYPERLINK("danger")',
    });
    await request(`bugs/${next.id}/comments`, 'POST', {
      text: 'One, two\n"Quoted" 🐛',
    });
    const url = `${origin}/api/projects/${project.id}/export`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'efbbbf');
    const csv = bytes.toString('utf8');
    assert.ok(csv.includes('FT-BUG-3'));
    assert.ok(csv.includes('FT-IDEA-1'));
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(csv.includes('🐛'));
    const past = await (
      await fetch(url + '?from=2026-01-01T00:00:00Z&to=2026-01-02T00:00:00Z')
    ).text();
    assert.ok(past.includes('FT-BUG-1'));
    assert.ok(!past.includes('FT-BUG-3'));
    const ideas = await (await fetch(url + '?type=Idea')).text();
    assert.ok(ideas.includes('FT-IDEA-1'));
    assert.ok(!ideas.includes('FT-BUG-'));
    const otherCsv = await (
      await fetch(
        `${origin}/api/projects/${projects.find((p) => p.name === 'Fitness Tracker').id}/export`,
      )
    ).text();
    assert.ok(!otherCsv.includes('FT-BUG-'));
    assert.equal((await fetch(url + '?from=invalid')).status, 400);
    assert.equal((await fetch(url + '?basis=password')).status, 400);
    await request(`bugs/${idea.id}`, 'DELETE');
    assert.ok(!(await (await fetch(url)).text()).includes('FT-IDEA-1'));
    const backup = (await request('backup')).data;
    assert.equal((await request('import', 'POST', backup)).status, 200);
    const all = [
      ...(await request('bugs')).data,
      ...(await request('trash')).data,
    ];
    assert.equal(new Set(all.map((b) => b.issueKey)).size, all.length);
  } finally {
    await close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
import { fieldApplies, statusCategory } from '../lib/field-schema.mjs';

test('type scopes, status categories, quick updates, bidirectional links and backup remapping', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentinel-workflows-'));
  const api = createApi(join(dir, 'test.sqlite'));
  const server = createServer((req, res) =>
    api.handler(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const request = async (path, method = 'GET', body) => {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    return { status: res.status, data: await res.json() };
  };
  const draft = {
    title: 'Login',
    project: 'HomeHero',
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
  try {
    const envConfig = (await request('fields')).data;
    envConfig.find((f) => f.key === 'environment').options = ['iOS'];
    assert.equal((await request('fields', 'PUT', envConfig)).status, 200);
    const componentIssue = (
      await request('bugs', 'POST', { ...draft, component: ' Login ' })
    ).data;
    assert.equal(componentIssue.component, 'Login');
    assert.equal(
      (
        await request('bugs/' + componentIssue.id + '/quick', 'POST', {
          status: 'Resolved',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'status',
          previous: 'Open',
          value: 'Resolved',
        })
      ).status,
      400,
    );
    assert.equal(
      (await request('bugs', 'POST', { ...draft, status: 'Resolved' })).status,
      400,
    );
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'fixVersion',
          previous: '',
          value: '2.1.0',
        })
      ).status,
      200,
    );
    const resolved = await request(
      'bugs/' + componentIssue.id + '/quick',
      'POST',
      { status: 'Resolved' },
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.data.fixVersion, '2.1.0');
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'fixVersion',
          previous: '2.1.0',
          value: '',
        })
      ).status,
      400,
    );
    await request('bugs/' + componentIssue.id + '/quick', 'POST', {
      status: 'Open',
    });
    assert.equal(componentIssue.reporter, '');
    const reported = await request('bugs/' + componentIssue.id, 'PATCH', {
      field: 'reporter',
      previous: '',
      value: 'Rafal',
    });
    assert.equal(reported.status, 200);
    assert.equal(reported.data.reporter, 'Rafal');
    assert.equal(reported.data.assignee, '');
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'environment',
          previous: '',
          value: 'Unconfigured',
        })
      ).status,
      400,
    );
    const inline = await request('bugs/' + componentIssue.id, 'PATCH', {
      field: 'expected',
      previous: '',
      value: 'Welcome screen appears',
    });
    assert.equal(inline.status, 200);
    assert.equal(inline.data.expected, 'Welcome screen appears');
    assert.equal(inline.data.component, 'Login');
    assert.ok(
      inline.data.history.some((h) =>
        h.text.includes('Welcome screen appears'),
      ),
    );
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'expected',
          previous: '',
          value: 'Stale overwrite',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'title',
          previous: draft.title,
          value: '',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request('bugs/' + componentIssue.id, 'PATCH', {
          field: 'history',
          previous: '',
          value: 'Invalid',
        })
      ).status,
      400,
    );
    const secondInline = await request('bugs/' + componentIssue.id, 'PATCH', {
      field: 'environment',
      previous: '',
      value: 'iOS',
    });
    assert.equal(secondInline.data.expected, 'Welcome screen appears');
    assert.equal(secondInline.data.environment, 'iOS');
    const reusedComponent = (
      await request('bugs', 'POST', { ...draft, component: 'login' })
    ).data;
    assert.equal(reusedComponent.component, 'Login');
    await request('bugs/' + componentIssue.id, 'DELETE');
    await request('bugs/' + reusedComponent.id, 'DELETE');
    assert.deepEqual(
      (await request('projects')).data.find((p) => p.name === 'HomeHero')
        .components,
      ['Login'],
    );
    await request('bugs', 'POST', {
      ...draft,
      project: 'Other app',
      component: 'Payments',
    });
    assert.deepEqual(
      (await request('projects')).data.find((p) => p.name === 'Other app')
        .components,
      ['Payments'],
    );
    const componentBackup = (await request('backup')).data;
    assert.deepEqual(
      componentBackup.projects.find((p) => p.name === 'HomeHero').components,
      ['Login'],
    );
    const componentRestore = await request('import', 'POST', {
      ...componentBackup,
      bugs: [],
      links: [],
      inbox: [],
      projects: [{ name: 'Restored app', components: ['Search'] }],
    });
    assert.equal(componentRestore.status, 200);
    assert.deepEqual(
      (await request('projects')).data.find((p) => p.name === 'Restored app')
        .components,
      ['Search'],
    );
    const fields = (await request('fields')).data;
    fields.find((f) => f.key === 'steps').required = true;
    const status = fields.find((f) => f.key === 'status');
    status.options.push('Shipped');
    status.categories = { Shipped: 'completed' };
    const types = fields.find((f) => f.key === 'issueType');
    types.options.push('Investigation');
    const savedFields = await request('fields', 'PUT', fields);
    assert.equal(savedFields.status, 200);
    assert.equal(statusCategory('Shipped', savedFields.data), 'completed');
    assert.equal(
      fieldApplies(
        savedFields.data.find((f) => f.key === 'steps'),
        'Idea',
      ),
      false,
    );
    assert.equal((await request('bugs', 'POST', draft)).status, 400);
    const idea = (
      await request('bugs', 'POST', {
        ...draft,
        issueType: 'Idea',
        solution: 'Simplify login',
      })
    ).data;
    assert.ok(idea.id);
    const bug = (
      await request('bugs', 'POST', { ...draft, steps: 'Open login' })
    ).data;
    const custom = (
      await request('bugs', 'POST', { ...draft, issueType: 'Investigation' })
    ).data;
    assert.ok(custom.id);
    const quick = await request(`bugs/${bug.id}/quick`, 'POST', {
      status: 'Shipped',
      priority: 'High',
    });
    assert.equal(quick.status, 200);
    assert.equal(quick.data.status, 'Shipped');
    assert.match(quick.data.history.at(-1).text, /Open → Shipped/);
    assert.equal(
      (await request(`bugs/${bug.id}/quick`, 'POST', { title: 'no' })).status,
      400,
    );
    assert.equal(
      (await request(`bugs/${bug.id}/quick`, 'POST', { status: 'Unknown' }))
        .status,
      400,
    );
    const edited = await request(`bugs/${idea.id}`, 'PUT', {
      ...idea,
      solution: 'Use biometrics',
      acceptance: '',
    });
    assert.equal(edited.status, 200);
    assert.match(
      edited.data.history.at(-1).text,
      /Simplify login.*Use biometrics/,
    );
    assert.equal(
      (
        await request(`bugs/${bug.id}/links`, 'POST', {
          target: bug.id,
          type: 'blocks',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`bugs/${bug.id}/links`, 'POST', {
          target: 999999,
          type: 'blocks',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(`bugs/${bug.id}/links`, 'POST', {
          target: idea.id,
          type: 'blocks',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(`bugs/${bug.id}/links`, 'POST', {
          target: idea.id,
          type: 'blocks',
        })
      ).status,
      200,
    );
    const reverse = (await request(`bugs/${idea.id}/links`)).data;
    assert.equal(reverse.length, 1);
    assert.equal(reverse[0].label, 'is blocked by');
    assert.equal(reverse[0].issue.id, bug.id);
    await request(`bugs/${bug.id}/links`, 'POST', {
      target: custom.id,
      type: 'relates to',
    });
    await request(`bugs/${custom.id}/links`, 'POST', {
      target: bug.id,
      type: 'relates to',
    });
    assert.equal((await request(`bugs/${custom.id}/links`)).data.length, 1);
    const backup = (await request('backup')).data;
    assert.equal(backup.links.length, 2);
    assert.equal((await request('import', 'POST', backup)).status, 200);
    const afterImport = (await request('backup')).data;
    assert.equal(afterImport.links.length, 4);
    const oldIds = new Set(backup.bugs.map((b) => b.id));
    for (const link of afterImport.links.slice(2)) {
      assert.ok(!oldIds.has(link.source));
      assert.ok(!oldIds.has(link.target));
    }
    const beforeInvalid = (await request('bugs')).data.length;
    assert.equal(
      (
        await request('import', 'POST', {
          ...backup,
          links: [{ source: bug.id, target: 99999, type: 'blocks' }],
        })
      ).status,
      400,
    );
    assert.equal((await request('bugs')).data.length, beforeInvalid);
    await request(`bugs/${idea.id}/links`, 'POST', {
      source: bug.id,
      target: idea.id,
      type: 'blocks',
      remove: true,
    });
    assert.equal((await request(`bugs/${idea.id}/links`)).data.length, 0);
    await request(`bugs/${custom.id}`, 'DELETE');
    const reused = (await request('bugs', 'POST', { ...draft, steps: 'Again' }))
      .data;
    assert.equal(reused.id, custom.id);
    assert.equal((await request(`bugs/${reused.id}/links`)).data.length, 0);
    assert.equal((await request(`bugs/${bug.id}/links`)).data.length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    api.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

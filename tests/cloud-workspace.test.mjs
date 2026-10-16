import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkspace,
  workspaceRequest,
  workspaceFromExport,
} from '../cloud/workspace.mjs';
const owner = {
  id: 1,
  email: 'owner@example.com',
  role: 'owner',
  disabled: false,
};
const member = {
  id: 2,
  email: 'member@example.com',
  role: 'member',
  disabled: false,
};
const members = [owner, member];
const draft = {
  title: 'Cannot sign in',
  project: 'Ferment Tracker',
  quickReport: true,
  issueType: 'Bug',
  status: 'Open',
  priority: 'Medium',
};
const act = (state, path, method = 'GET', body = {}, actor = owner) =>
  workspaceRequest(state, actor, members, path, method, body);
test('cloud reducer preserves per-project numbering, idempotency, field conflicts, accounts and Trash', () => {
  const s = emptyWorkspace();
  const token = '12345678-1234-1234-1234-123456789012';
  const bug = act(s, 'bugs', 'POST', { ...draft, creationToken: token });
  assert.equal(bug.issueKey, 'FT-BUG-1');
  assert.equal(bug.reporter, owner.email);
  assert.equal(
    act(s, 'bugs', 'POST', { ...draft, creationToken: token }).id,
    bug.id,
  );
  assert.equal(s.bugs.length, 1);
  assert.equal(
    act(s, 'bugs', 'POST', { ...draft, project: 'Other App' }).issueKey,
    'OA-BUG-1',
  );
  assert.equal(
    act(s, 'bugs', 'POST', { ...draft, issueType: 'Idea' }).issueKey,
    'FT-IDEA-1',
  );
  act(s, `bugs/${bug.id}`, 'PATCH', {
    field: 'assignee',
    previous: '',
    value: member.email,
  });
  assert.equal(bug.assignee, member.email);
  assert.throws(
    () =>
      act(s, `bugs/${bug.id}`, 'PATCH', {
        field: 'assignee',
        previous: '',
        value: '',
      }),
    /changed/,
  );
  assert.throws(
    () =>
      act(s, `bugs/${bug.id}`, 'PATCH', {
        field: 'reporter',
        previous: owner.email,
        value: 'Stranger',
      }),
    /invited/,
  );
  act(
    s,
    `bugs/${bug.id}/comments`,
    'POST',
    { text: 'Verified on iOS' },
    member,
  );
  assert.equal(bug.comments[0].actor.email, member.email);
  act(s, `bugs/${bug.id}`, 'DELETE');
  assert.equal(act(s, 'bugs').length, 2);
  assert.equal(act(s, 'trash').length, 1);
  assert.throws(
    () => act(s, 'bugs', 'POST', { ...draft, creationToken: token }),
    /Trash/,
  );
  act(s, `trash/${bug.id}/restore`, 'POST');
  assert.equal(bug.issueKey, 'FT-BUG-1');
  assert.equal(act(s, 'bugs', 'POST', draft).issueKey, 'FT-BUG-2');
});
test('members cannot mutate settings and inbox assignment is validated before mutation', () => {
  const s = emptyWorkspace();
  const bug = act(s, 'bugs', 'POST', draft);
  assert.throws(
    () => act(s, 'projects', 'POST', { name: 'Changed' }, member),
    /Owner/,
  );
  assert.throws(() => act(s, 'fields', 'PUT', s.fields, member), /Owner/);
  s.files = [
    {
      id: 'capture-1',
      source: 'inbox',
      issueId: null,
      name: 'screenshot.webp',
      size: 100,
      path: 'capture-1',
    },
  ];
  assert.throws(
    () =>
      act(s, 'inbox/assign', 'POST', {
        ids: ['capture-1', 'missing'],
        issueId: bug.id,
      }),
    /no longer/,
  );
  assert.equal(s.files[0].source, 'inbox');
  act(
    s,
    'inbox/assign',
    'POST',
    { ids: ['capture-1'], issueId: bug.id },
    member,
  );
  assert.equal(s.files[0].issueId, bug.id);
  act(s, `bugs/${bug.id}`, 'DELETE');
  assert.equal(s.files.length, 1);
  act(s, `trash/${bug.id}/restore`, 'POST');
  assert.equal(act(s, `bugs/${bug.id}/attachments`).length, 1);
  const csv = act(s, `projects/${s.projects[0].id}/export?basis=createdAt`).csv;
  assert.match(csv, /FT-BUG-1/);
  assert.match(csv, /screenshot.webp/);
});
test('migration keeps stable IDs and numbering reservations for deleted issues', () => {
  const s = workspaceFromExport({
    bugs: [
      {
        id: 12,
        project: 'Ferment Tracker',
        issueType: 'Bug',
        issueNumber: 12,
        issueKey: 'FT-BUG-12',
        numberingProjectId: 7,
        numberingType: 'BUG',
        deletedAt: '2026-01-01',
      },
    ],
    projects: [{ id: 7, name: 'Ferment Tracker' }],
    projectKeys: [{ project_id: 7, prefix: 'FT' }],
    components: [],
    versions: [],
    issueSequences: [{ project_id: 7, type: 'BUG', last_number: 12 }],
    files: [],
    links: [],
  });
  assert.equal(act(s, 'bugs', 'POST', draft).issueKey, 'FT-BUG-13');
  assert.equal(s.bugs[1].id, 13);
});
test('inbox deletion is retry-safe and retains the capture deduplication ledger', () => {
  const s = emptyWorkspace();
  s.captureHashes = ['already-imported'];
  s.files = [
    {
      id: 'capture-retry',
      source: 'inbox',
      pending: false,
      captureHash: 'already-imported',
    },
  ];
  assert.deepEqual(act(s, 'inbox/capture-retry', 'DELETE'), { deleted: true });
  assert.deepEqual(act(s, 'inbox/capture-retry', 'DELETE'), { deleted: true });
  assert.equal(s.files.length, 0);
  assert.deepEqual(s.captureHashes, ['already-imported']);
});

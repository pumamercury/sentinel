import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const { accounts } = JSON.parse(
  readFileSync(join(directory, 'test-accounts.json'), 'utf8'),
);
const { url, publishableKey } = JSON.parse(
  readFileSync(new URL('../hosted/supabase.json', import.meta.url), 'utf8'),
);
const actor = (role) => accounts.find((a) => a.role === role);
async function request(
  path,
  { role = 'owner', method = 'GET', body, origin } = {},
) {
  const headers = {
    apikey: publishableKey,
    'Content-Type': 'application/json',
  };
  if (role) headers.Authorization = 'Bearer ' + actor(role).token;
  if (origin) headers.Origin = origin;
  return fetch(url + '/functions/v1/sentinel-api/' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(path, options) {
  const response = await request(path, options);
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
assert.equal((await request('bugs', { role: null })).status, 401);
assert.equal((await request('bugs', { role: 'outsider' })).status, 403);
assert.equal(
  (await request('bugs', { origin: 'https://untrusted.example' })).status,
  403,
);
const manifest = JSON.parse(
  readFileSync(join(directory, 'manifest.json'), 'utf8'),
);
const original = await ok('bugs');
assert.equal(original.length, manifest.bugs.filter((b) => !b.deletedAt).length);
assert.ok((await ok('inbox')).files.length >= 42);
for (const role of [null, 'member', 'outsider']) {
  const response = await fetch(url + '/rest/v1/sentinel_workspace?select=*', {
    headers: {
      apikey: publishableKey,
      ...(role ? { Authorization: 'Bearer ' + actor(role).token } : {}),
    },
  });
  assert.ok(
    [401, 403].includes(response.status),
    'Direct workspace table must not be exposed',
  );
}
assert.equal(
  (
    await request('projects', {
      role: 'member',
      method: 'POST',
      body: { name: 'Unauthorized' },
    })
  ).status,
  403,
);
assert.equal((await request('auth/users', { role: 'member' })).status, 403);
const bug = await ok('bugs', {
  method: 'POST',
  body: {
    title: 'Hosted deployment check',
    project: 'Sentinel deployment check',
    quickReport: true,
    issueType: 'Bug',
    status: 'Open',
    priority: 'Medium',
  },
});
assert.match(bug.issueKey, /-BUG-1$/);
const comment = await ok(`bugs/${bug.id}/comments`, {
  role: 'member',
  method: 'POST',
  body: { text: 'Member comment verified' },
});
assert.equal(comment.comments.at(-1).actor.email, actor('member').email);
await ok(`bugs/${bug.id}`, {
  method: 'PATCH',
  body: {
    field: 'title',
    previous: bug.title,
    value: 'Hosted editing verified',
  },
});
assert.equal(
  (
    await request(`bugs/${bug.id}`, {
      method: 'PATCH',
      body: {
        field: 'title',
        previous: bug.title,
        value: 'Must not overwrite',
      },
    })
  ).status,
  409,
);
const bytes = Buffer.from('Sentinel private attachment verification');
const upload = await ok('uploads/prepare', {
  method: 'POST',
  body: { issueId: bug.id, name: 'check.txt', size: bytes.length },
});
let response = await fetch(upload.signedUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain' },
  body: bytes,
});
assert.ok(response.ok, await response.text());
const file = await ok('uploads/complete', {
  method: 'POST',
  body: { id: upload.id },
});
response = await fetch(file.downloadUrl);
assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
response = await fetch(
  url + '/storage/v1/object/public/sentinel-attachments/' + file.path,
);
assert.ok(!response.ok);
await ok(`bugs/${bug.id}/attachments/${file.id}`, { method: 'DELETE' });
await ok(`bugs/${bug.id}`, { method: 'DELETE' });
assert.ok((await ok('trash')).some((b) => b.id === bug.id));
await ok(`trash/${bug.id}/restore`, { method: 'POST', body: {} });
const member = (await ok('members')).find(
  (m) => m.email === actor('member').email,
);
await ok('auth/users/' + member.id, {
  method: 'PATCH',
  body: { disabled: true },
});
assert.equal((await request('bugs', { role: 'member' })).status, 403);
await ok('auth/users/' + member.id, {
  method: 'PATCH',
  body: { disabled: false },
});
assert.equal((await request('bugs', { role: 'member' })).status, 200);
const p = (await ok('projects')).find(
  (p) => p.name === 'Sentinel deployment check',
);
response = await request(`projects/${p.id}/export?basis=createdAt`);
assert.equal(response.status, 200);
assert.match(await response.text(), /Hosted editing verified/);
console.log(
  'Verified hosted authentication, denied public table/storage access, owner/member roles, issue creation/edit conflicts, comments, private upload/download, Trash restore, account revocation and CSV export.',
);

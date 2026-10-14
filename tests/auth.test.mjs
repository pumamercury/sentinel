import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi } from '../server/api.mjs';
import { initializeOwner, recoveryLinkToken } from '../server/auth.mjs';

test('invitation-only accounts enforce sessions and roles on every API, including binary media and backups', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-auth-'));
  const file = join(root, 'test.sqlite');
  const db = new DatabaseSync(file);
  const setup = initializeOwner(db);
  const api = createApi(file);
  const server = createServer((req, res) =>
    api.handler(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(
    path,
    method = 'GET',
    body,
    cookie = '',
    headers = {},
  ) {
    const options = {
      method,
      headers: {
        Origin: origin,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Cookie: cookie,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    };
    const res = await fetch(origin + '/api/' + path, options);
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
      fullCookie: res.headers.get('set-cookie'),
    };
  }
  const owner = {
    email: 'owner@example.com',
    password: 'Owner unique passphrase 123!',
  };
  const member = {
    email: 'member@example.com',
    password: 'Member unique passphrase 123!',
  };
  try {
    for (const path of [
      'bugs',
      'members',
      'trash',
      'fields',
      'projects',
      'backup',
      'inbox',
      'bugs/1/attachments',
      'inbox/00000000-0000-0000-0000-000000000000',
    ])
      assert.equal((await request(path)).status, 401, path);
    assert.equal((await request('bugs', 'POST', {})).status, 401);
    assert.equal((await request('auth/signup', 'POST', member)).status, 401);
    assert.equal((await request('auth/session')).data.enabled, true);
    assert.equal(
      (
        await request('auth/accept', 'POST', { ...owner, token: setup }, '', {
          Origin: 'https://attacker.invalid',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('auth/accept', 'POST', { ...owner, token: setup }, '', {
          Origin: '',
        })
      ).status,
      403,
    );
    const accepted = await request('auth/accept', 'POST', {
      ...owner,
      token: setup,
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.data.user.role, 'owner');
    assert.match(accepted.fullCookie, /HttpOnly/);
    assert.match(accepted.fullCookie, /SameSite=Strict/);
    let ownerCookie = accepted.cookie;
    assert.equal(
      (await request('auth/accept', 'POST', { ...owner, token: setup })).status,
      400,
    );
    assert.equal((await request('bugs', 'GET', null, ownerCookie)).status, 200);
    const invite = await request(
      'auth/invite',
      'POST',
      { email: member.email },
      ownerCookie,
    );
    assert.equal(invite.status, 200);
    const value = new URL(invite.data.url).hash.slice('#invite='.length);
    assert.equal(
      (
        await request('auth/accept', 'POST', {
          ...member,
          email: 'wrong@example.com',
          token: value,
        })
      ).status,
      400,
    );
    const joined = await request('auth/accept', 'POST', {
      ...member,
      token: value,
    });
    assert.equal(joined.status, 200);
    assert.equal(joined.data.user.role, 'member');
    const memberCookie = joined.cookie;
    const quickReport = {
      title: 'Account-scoped quick report',
      project: 'App',
      status: 'Open',
      priority: 'Medium',
      quickReport: true,
      creationToken: '11111111-2222-4333-8444-555555555555',
    };
    const ownerReport = await request('bugs', 'POST', quickReport, ownerCookie);
    assert.equal(ownerReport.status, 201);
    assert.equal((await request('bugs', 'POST', quickReport)).status, 401);
    const memberReport = await request(
      'bugs',
      'POST',
      { ...quickReport, creationAccountId: accepted.data.user.id },
      memberCookie,
    );
    assert.equal(
      memberReport.status,
      201,
      'client-supplied account scope cannot claim another account token',
    );
    assert.notEqual(memberReport.data.id, ownerReport.data.id);
    assert.equal(
      (await request('bugs', 'POST', quickReport, ownerCookie)).data.id,
      ownerReport.data.id,
    );
    assert.equal(
      (await request('bugs', 'POST', quickReport, memberCookie)).data.id,
      memberReport.data.id,
    );
    assert.equal(
      (await request('bugs', 'GET', null, memberCookie)).status,
      200,
    );
    for (const [path, method] of [
      ['backup', 'GET'],
      ['import', 'POST'],
      ['fields', 'PUT'],
      ['projects', 'POST'],
      ['inbox/photos', 'PUT'],
      ['inbox/settings', 'PUT'],
      ['auth/users', 'GET'],
      ['auth/invite', 'POST'],
    ])
      assert.equal(
        (
          await request(
            path,
            method,
            method === 'GET' ? null : {},
            memberCookie,
          )
        ).status,
        403,
        path,
      );
    // Account identity comes from the session, never client-supplied activity.
    const directory = await request('members', 'GET', null, memberCookie);
    assert.equal(directory.status, 200);
    assert.deepEqual(
      directory.data.map((m) => m.email).sort(),
      [member.email, owner.email].sort(),
    );
    assert.ok(directory.data.every((m) => !('password' in m)));
    assert.equal(ownerReport.data.reporter, owner.email);
    assert.equal(memberReport.data.history[0].actor.email, member.email);
    const reportId = ownerReport.data.id;
    assert.equal(
      (
        await request(
          `bugs/${reportId}`,
          'PATCH',
          { field: 'assignee', previous: '', value: 'Raf' },
          memberCookie,
        )
      ).status,
      400,
    );
    const assigned = await request(
      `bugs/${reportId}`,
      'PATCH',
      {
        field: 'assignee',
        previous: '',
        value: member.email,
        actor: { email: owner.email },
      },
      memberCookie,
    );
    assert.equal(assigned.status, 200);
    assert.equal(assigned.data.assignee, member.email);
    assert.equal(assigned.data.history.at(-1).actor.email, member.email);
    const concurrent = await Promise.all([
      request(
        `bugs/${reportId}/comments`,
        'POST',
        { text: 'Member note', actor: { email: owner.email } },
        memberCookie,
      ),
      request(
        `bugs/${memberReport.data.id}/comments`,
        'POST',
        { text: 'Owner note' },
        ownerCookie,
      ),
    ]);
    assert.equal(concurrent[0].data.comments.at(-1).actor.email, member.email);
    assert.equal(concurrent[1].data.comments.at(-1).actor.email, owner.email);
    const attachment = await request(
      `bugs/${reportId}/attachments`,
      'POST',
      {
        name: 'proof.txt',
        base64: Buffer.from('retained evidence').toString('base64'),
      },
      memberCookie,
    );
    assert.equal(attachment.status, 201);
    await request(
      `bugs/${reportId}/links`,
      'POST',
      { target: memberReport.data.id, type: 'blocks' },
      ownerCookie,
    );
    assert.equal(
      (await request(`bugs/${reportId}`, 'DELETE', null, memberCookie)).status,
      200,
    );
    assert.ok(
      !(await request('bugs', 'GET', null, ownerCookie)).data.some(
        (b) => b.id === reportId,
      ),
    );
    const trashed = (
      await request('trash', 'GET', null, ownerCookie)
    ).data.find((b) => b.id === reportId);
    assert.equal(trashed.deletedBy.email, member.email);
    assert.equal(trashed.history.at(-1).actor.email, member.email);
    assert.equal(
      (await request(`bugs/${reportId}/attachments`, 'GET', null, ownerCookie))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `bugs/${reportId}/comments`,
          'POST',
          { text: 'hidden change' },
          ownerCookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          `bugs/${memberReport.data.id}/links`,
          'GET',
          null,
          ownerCookie,
        )
      ).data.length,
      0,
    );
    assert.equal(
      (await request('bugs', 'POST', quickReport, ownerCookie)).status,
      400,
    );
    const savedBackup = (await request('backup', 'GET', null, ownerCookie))
      .data;
    assert.equal(
      savedBackup.bugs.find((b) => b.id === reportId).attachments.length,
      1,
    );
    assert.ok(savedBackup.bugs.find((b) => b.id === reportId).deletedAt);
    const restored = await request(
      `trash/${reportId}/restore`,
      'POST',
      {},
      ownerCookie,
    );
    assert.equal(restored.status, 200);
    assert.equal(restored.data.id, reportId);
    assert.equal(restored.data.history.at(-1).actor.email, owner.email);
    assert.equal(restored.data.comments.at(-1).text, 'Member note');
    assert.equal(
      (await request(`bugs/${reportId}/attachments`, 'GET', null, memberCookie))
        .data[0].id,
      attachment.data.id,
    );
    assert.equal(
      (
        await request(
          `bugs/${memberReport.data.id}/links`,
          'GET',
          null,
          memberCookie,
        )
      ).data.length,
      1,
    );
    assert.equal(
      (await request(`trash/${reportId}/restore`, 'POST', {}, memberCookie))
        .status,
      404,
    );
    // Preserve old names until an owner explicitly maps them to a real account.
    const old = JSON.parse(
      db.prepare('SELECT data FROM bugs WHERE id=?').get(reportId).data,
    );
    old.reporter = 'Raf';
    old.assignee = 'Raf';
    db.prepare('UPDATE bugs SET data=? WHERE id=?').run(
      JSON.stringify(old),
      reportId,
    );
    assert.equal(
      (
        await request(
          'people/link',
          'POST',
          { legacy: 'Raf', email: owner.email },
          memberCookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          'people/link',
          'POST',
          { legacy: 'Raf', email: owner.email },
          ownerCookie,
        )
      ).data.updated,
      1,
    );
    const linked = (await request('bugs', 'GET', null, memberCookie)).data.find(
      (b) => b.id === reportId,
    );
    assert.equal(linked.reporter, owner.email);
    assert.equal(linked.assignee, owner.email);
    assert.equal(linked.history.at(-1).actor.email, owner.email);
    assert.equal(
      (await request('import', 'POST', savedBackup, ownerCookie)).status,
      200,
    );
    const importedTrash = (await request('trash', 'GET', null, ownerCookie))
      .data;
    assert.equal(importedTrash.length, 1);
    assert.equal(importedTrash[0].history.at(-1).actor.email, member.email);
    assert.equal(
      (
        await request(
          `trash/${importedTrash[0].id}/restore`,
          'POST',
          {},
          memberCookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          `bugs/${importedTrash[0].id}/attachments`,
          'GET',
          null,
          memberCookie,
        )
      ).data.length,
      1,
    );
    const id = joined.data.user.id;
    assert.equal(
      (
        await request(
          'auth/users/' + id,
          'PATCH',
          { disabled: true },
          ownerCookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('bugs', 'GET', null, memberCookie)).status,
      401,
    );
    assert.equal((await request('auth/login', 'POST', member)).status, 401);
    await request(
      'auth/users/' + id,
      'PATCH',
      { disabled: false },
      ownerCookie,
    );
    assert.equal(
      (await request('bugs', 'GET', null, memberCookie)).status,
      401,
    );
    const recovery = recoveryLinkToken(db, owner.email);
    const recovered = await request('auth/accept', 'POST', {
      ...owner,
      password: 'Replacement owner passphrase!',
      token: recovery,
    });
    assert.equal(recovered.status, 200);
    assert.equal((await request('bugs', 'GET', null, ownerCookie)).status, 401);
    ownerCookie = recovered.cookie;
    assert.equal(
      (await request('auth/accept', 'POST', { ...owner, token: recovery }))
        .status,
      400,
    );
    assert.equal(
      (await request('auth/logout', 'POST', null, ownerCookie)).status,
      200,
    );
    assert.equal((await request('bugs', 'GET', null, ownerCookie)).status, 401);
    const stored = db
      .prepare('SELECT password FROM auth_users WHERE email=?')
      .get(owner.email).password;
    assert.ok(!stored.includes('Replacement'));
    assert.throws(() => initializeOwner(db), /already exists/);
    // The next login is throttled before password work, even with spoofed proxy headers.
    db.prepare('UPDATE auth_limits SET count=20').run();
    assert.equal(
      (
        await request('auth/login', 'POST', owner, '', {
          'X-Forwarded-For': '1.2.3.4',
        })
      ).status,
      429,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await Promise.resolve(api.close());
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('public origin requires authentication even without any configured owner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-auth-origin-'));
  const api = createApi(join(root, 'test.sqlite'), {
    auth: { origin: 'https://sentinel.example.com' },
  });
  const server = createServer((req, res) =>
    api.handler(req, res, () => res.end()),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/bugs`;
    const status = (headers) =>
      new Promise((resolve, reject) => {
        const req = httpRequest(url, { headers }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        });
        req.on('error', reject);
        req.end();
      });
    assert.equal((await fetch(url)).status, 403);
    assert.equal(await status({ Host: 'sentinel.example.com' }), 401);
    assert.equal(
      await status({
        Host: 'sentinel.example.com',
        Origin: 'https://other.example.com',
      }),
      403,
    );
  } finally {
    await new Promise((r) => server.close(r));
    await Promise.resolve(api.close());
    rmSync(root, { recursive: true, force: true });
  }
});

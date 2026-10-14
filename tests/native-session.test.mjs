import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApi } from '../server/api.mjs';
import { initializeOwner } from '../server/auth.mjs';

test('remembered sign-in survives restart, renews, expires and revokes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-remember-'));
  const file = join(root, 'test.sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE auth_sessions(hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL)');
  const token = initializeOwner(db);
  let api = createApi(file);
  const server = createServer((req, res) => api.handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const credentials = { email: 'remember@example.com', password: 'Remember this unique password 123!' };
  async function request(path, method = 'GET', body, cookie = '') {
    const response = await fetch(origin + '/api/auth/' + path, { method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
  }
  try {
    const accepted = await request('accept', 'POST', { ...credentials, token });
    assert.equal(accepted.status, 200);
    assert.match(accepted.cookie, /Max-Age=43200/);
    const signedIn = await request('login', 'POST', { ...credentials, remember: true });
    assert.match(signedIn.cookie, /Max-Age=2592000/);
    const cookie = signedIn.cookie.split(';')[0];
    const hash = createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex');
    assert.equal(db.prepare('SELECT remembered FROM auth_sessions WHERE hash=?').get(hash).remembered, 1);
    await api.close(); api = createApi(file);
    assert.equal((await request('session', 'GET', undefined, cookie)).data.user.email, credentials.email);
    db.prepare('UPDATE auth_sessions SET expires=? WHERE hash=?').run(Date.now() + 2 * 86400000, hash);
    const renewed = await request('session', 'GET', undefined, cookie);
    assert.match(renewed.cookie, /Max-Age=2592000/);
    assert.ok(db.prepare('SELECT expires FROM auth_sessions WHERE hash=?').get(hash).expires > Date.now() + 29 * 86400000);
    assert.equal((await request('logout', 'POST', {}, cookie)).status, 200);
    assert.equal((await request('session', 'GET', undefined, cookie)).data.user, null);
    const again = await request('login', 'POST', { ...credentials, remember: true });
    db.prepare('UPDATE auth_sessions SET expires=? WHERE remembered=1').run(Date.now() - 1);
    const expired = await request('session', 'GET', undefined, again.cookie.split(';')[0]);
    assert.equal(expired.data.user, null);
    assert.equal(expired.cookie, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await api.close(); db.close(); rmSync(root, { recursive: true, force: true });
  }
});

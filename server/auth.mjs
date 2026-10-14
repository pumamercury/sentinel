import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const sessionAge = 12 * 60 * 60 * 1000;
const rememberedSessionAge = 30 * 24 * 60 * 60 * 1000;
const publicUser = (u) =>
  u ? { id: u.id, email: u.email, role: u.role } : null;
const email = (value) => {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
    throw Error('Enter a valid email address.');
  return value.trim().toLowerCase();
};
async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (
    typeof password !== 'string' ||
    password.length < 15 ||
    password.length > 128
  )
    throw Error('Use a password between 15 and 128 characters.');
  const key = await derive(password, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 160 * 1024 * 1024,
  });
  return salt + ':' + key.toString('hex');
}
export function authSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS auth_users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_invites(hash TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_resets(hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_config(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  if (!db.prepare("PRAGMA table_info(auth_sessions)").all().some((column) => column.name === "remembered"))
    db.exec("ALTER TABLE auth_sessions ADD COLUMN remembered INTEGER NOT NULL DEFAULT 0");
}
export function recoveryLinkToken(db, address) {
  authSchema(db);
  const account = db
    .prepare('SELECT * FROM auth_users WHERE email=? AND disabled=0')
    .get(email(address));
  if (!account) throw Error('Active account not found.');
  const value = token();
  db.prepare('DELETE FROM auth_resets WHERE user_id=? OR expires<?').run(
    account.id,
    Date.now(),
  );
  db.prepare('INSERT INTO auth_resets VALUES(?,?,?)').run(
    digest(value),
    account.id,
    Date.now() + 3600000,
  );
  return value;
}
export function initializeOwner(db) {
  authSchema(db);
  if (db.prepare('SELECT 1 FROM auth_users WHERE role=?').get('owner'))
    throw Error('An owner already exists.');
  const invitation = token();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM auth_invites WHERE role=?').run('owner');
    db.prepare('INSERT INTO auth_invites VALUES(?,?,?,?)').run(
      digest(invitation),
      '',
      'owner',
      Date.now() + 86400000,
    );
    db.prepare(
      "INSERT OR REPLACE INTO auth_config VALUES('enabled','true')",
    ).run();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return invitation;
}
export function authentication(db, options = {}) {
  authSchema(db);
  const origin = options.origin ?? process.env.SENTINEL_PUBLIC_ORIGIN ?? '';
  if (origin) {
    const u = new URL(origin);
    if (
      u.origin !== origin ||
      (u.protocol !== 'https:' &&
        !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
      throw Error(
        'SENTINEL_PUBLIC_ORIGIN must be an HTTPS origin (HTTP is allowed only on localhost).',
      );
  }
  const enabled = () =>
    !!origin ||
    db.prepare("SELECT value FROM auth_config WHERE key='enabled'").get()
      ?.value === 'true';
  const cookieName = origin.startsWith('https:')
    ? '__Host-sentinel'
    : 'sentinel-session';
  const cookie = (value, age) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
  let hashing = 0;
  async function costly(work) {
    if (hashing >= 2) throw Error('Sign-in is busy. Try again shortly.');
    hashing++;
    try {
      return await work();
    } finally {
      hashing--;
    }
  }
  const sessionToken = (req) =>
    (req.headers.cookie ?? '')
      .split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1) ?? '';
  function user(req) {
    const value = sessionToken(req);
    if (!/^[a-f0-9]{64}$/.test(value)) return null;
    return (
      db
        .prepare(
          'SELECT u.* FROM auth_users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires>? AND u.disabled=0',
        )
        .get(digest(value), Date.now()) ?? null
    );
  }
  function issueSession(req, res, u, remember = false) {
    const age = remember ? rememberedSessionAge : sessionAge;
    db.prepare('DELETE FROM auth_sessions WHERE expires<? OR hash=?').run(
      Date.now(),
      digest(sessionToken(req)),
    );
    const value = token();
    db.prepare('INSERT INTO auth_sessions(hash,user_id,expires,remembered) VALUES(?,?,?,?)').run(
      digest(value),
      u.id,
      Date.now() + age,
      remember ? 1 : 0,
    );
    res.setHeader('Set-Cookie', cookie(value, age / 1000));
  }
  function limit(key) {
    db.prepare('DELETE FROM auth_limits WHERE expires<?').run(Date.now());
    const k = digest(key);
    db.prepare(
      'INSERT INTO auth_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',
    ).run(k, Date.now() + 15 * 60000);
    return (
      db.prepare('SELECT count FROM auth_limits WHERE key=?').get(k).count <= 20
    );
  }
  async function readBody(req) {
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw Error('JSON required.');
    let body = '',
      size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw Error('Request too large.');
      body += chunk;
    }
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw Error('Invalid request.');
    return parsed;
  }
  async function guard(req, res, url, send) {
    const active = enabled();
    const expectedOrigin = origin || `http://${req.headers.host}`;
    if (origin && req.headers.host !== new URL(origin).host) {
      send(403, { error: 'Host rejected.' });
      return true;
    }
    if (req.headers.origin && req.headers.origin !== expectedOrigin) {
      send(403, { error: 'Origin rejected.' });
      return true;
    }
    if (
      active &&
      !['GET', 'HEAD'].includes(req.method) &&
      req.headers.origin !== expectedOrigin
    ) {
      send(403, { error: 'Same-origin request required.' });
      return true;
    }
    const u = active ? user(req) : null;
    // Internal request identity for account-scoped operations after this guard.
    req.sentinelAccountId = u?.id ?? null;
    if (url.pathname === '/api/auth/session' && req.method === 'GET') {
      if (u) {
        const value = sessionToken(req);
        const saved = db.prepare('SELECT remembered,expires FROM auth_sessions WHERE hash=?').get(digest(value));
        // Renew active remembered sessions at most once a day. Expired and
        // revoked sessions never reach this branch because user() rejects them.
        if (saved?.remembered && saved.expires < Date.now() + rememberedSessionAge - 24 * 60 * 60 * 1000) {
          db.prepare('UPDATE auth_sessions SET expires=? WHERE hash=?').run(Date.now() + rememberedSessionAge, digest(value));
          res.setHeader('Set-Cookie', cookie(value, rememberedSessionAge / 1000));
        }
      }
      send(200, { enabled: active, user: publicUser(u) });
      return true;
    }
    if (!active) {
      if (url.pathname.startsWith('/api/auth/')) {
        send(404, { error: 'Accounts are not configured.' });
        return true;
      }
      return false;
    }
    try {
      if (
        ['/api/auth/login', '/api/auth/accept'].includes(url.pathname) &&
        req.method === 'POST'
      ) {
        // Do not trust forwarded IP headers. A proxy may share this conservative limit.
        if (!limit(req.socket.remoteAddress ?? 'unknown')) {
          send(429, { error: 'Too many attempts. Try again in 15 minutes.' });
          return true;
        }
        const body = await readBody(req);
        const address = email(body.email);
        if (!limit('account:' + address)) {
          send(429, { error: 'Too many attempts. Try again in 15 minutes.' });
          return true;
        }
        if (url.pathname.endsWith('/login')) {
          const account = db
            .prepare('SELECT * FROM auth_users WHERE email=?')
            .get(address);
          const stored =
            account?.password ?? '0'.repeat(32) + ':' + '0'.repeat(64);
          const computed = await costly(() =>
            passwordHash(body.password, stored.split(':')[0]),
          );
          const valid = timingSafeEqual(
            Buffer.from(stored),
            Buffer.from(computed),
          );
          if (!valid || !account || account.disabled) {
            send(401, { error: 'Email or password is incorrect.' });
            return true;
          }
          issueSession(req, res, account, body.remember === true);
          send(200, { user: publicUser(account) });
          return true;
        }
        if (
          typeof body.token !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.token)
        )
          throw Error('Invitation is invalid or expired.');
        const hash = digest(body.token);
        const reset = db
          .prepare(
            'SELECT r.user_id,u.email FROM auth_resets r JOIN auth_users u ON u.id=r.user_id WHERE r.hash=? AND r.expires>? AND u.disabled=0',
          )
          .get(hash, Date.now());
        if (reset && reset.email === address) {
          const password = await costly(() => passwordHash(body.password));
          db.exec('BEGIN IMMEDIATE');
          try {
            if (
              !db
                .prepare(
                  'SELECT 1 FROM auth_resets r JOIN auth_users u ON u.id=r.user_id WHERE r.hash=? AND r.expires>? AND u.disabled=0',
                )
                .get(hash, Date.now())
            )
              throw Error('Recovery link is invalid or expired.');
            db.prepare('UPDATE auth_users SET password=? WHERE id=?').run(
              password,
              reset.user_id,
            );
            db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(
              reset.user_id,
            );
            db.prepare('DELETE FROM auth_resets WHERE user_id=?').run(
              reset.user_id,
            );
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          const account = db
            .prepare('SELECT * FROM auth_users WHERE id=?')
            .get(reset.user_id);
          issueSession(req, res, account);
          send(200, { user: publicUser(account) });
          return true;
        }
        const invitation = db
          .prepare('SELECT * FROM auth_invites WHERE hash=? AND expires>?')
          .get(hash, Date.now());
        if (!invitation || (invitation.email && invitation.email !== address))
          throw Error('Invitation is invalid or expired.');
        const password = await costly(() => passwordHash(body.password));
        // Recheck after password derivation: concurrent requests must not reuse a token.
        db.exec('BEGIN IMMEDIATE');
        let account;
        try {
          if (
            !db
              .prepare('SELECT 1 FROM auth_invites WHERE hash=? AND expires>?')
              .get(hash, Date.now())
          )
            throw Error('Invitation is invalid or expired.');
          const exists = db
            .prepare('SELECT * FROM auth_users WHERE email=?')
            .get(address);
          if (exists)
            throw Error(
              'This account already exists. Ask the owner for account recovery.',
            );
          const created = db
            .prepare(
              'INSERT INTO auth_users(email,password,role) VALUES(?,?,?)',
            )
            .run(address, password, invitation.role);
          db.prepare('DELETE FROM auth_invites WHERE hash=?').run(hash);
          account = db
            .prepare('SELECT * FROM auth_users WHERE id=?')
            .get(created.lastInsertRowid);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        issueSession(req, res, account);
        send(200, { user: publicUser(account) });
        return true;
      }
      if (!u) {
        send(401, { error: 'Sign in to continue.' });
        return true;
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM auth_sessions WHERE hash=?').run(
          digest(sessionToken(req)),
        );
        res.setHeader('Set-Cookie', cookie('', 0));
        send(200, { signedOut: true });
        return true;
      }
      if (url.pathname === '/api/auth/password' && req.method === 'POST') {
        if (!limit('password:' + u.id)) {
          send(429, { error: 'Too many attempts.' });
          return true;
        }
        const body = await readBody(req);
        const previous = await costly(() =>
          passwordHash(body.currentPassword, u.password.split(':')[0]),
        );
        if (!timingSafeEqual(Buffer.from(previous), Buffer.from(u.password)))
          throw Error('Current password is incorrect.');
        const password = await costly(() => passwordHash(body.password));
        db.prepare('UPDATE auth_users SET password=? WHERE id=?').run(
          password,
          u.id,
        );
        db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(u.id);
        issueSession(req, res, u);
        send(200, { updated: true });
        return true;
      }
      const admin =
        url.pathname.startsWith('/api/auth/') ||
        ['/api/backup', '/api/import'].includes(url.pathname) ||
        (!['GET', 'HEAD'].includes(req.method) &&
          (/^\/api\/(fields|projects)(\/|$)/.test(url.pathname) ||
            [
              '/api/inbox/settings',
              '/api/inbox/photos',
              '/api/inbox/scan',
            ].includes(url.pathname)));
      if (admin && u.role !== 'owner') {
        send(403, { error: 'Owner access required.' });
        return true;
      }
      if (url.pathname === '/api/auth/users' && req.method === 'GET') {
        send(200, {
          users: db
            .prepare(
              'SELECT id,email,role,disabled FROM auth_users ORDER BY id',
            )
            .all(),
          invitations: db
            .prepare(
              'SELECT hash AS id,email,expires FROM auth_invites WHERE expires>?',
            )
            .all(Date.now()),
        });
        return true;
      }
      if (url.pathname === '/api/auth/invite' && req.method === 'POST') {
        const body = await readBody(req),
          address = email(body.email);
        if (db.prepare('SELECT 1 FROM auth_users WHERE email=?').get(address))
          throw Error('An account with that email already exists.');
        const invitation = token();
        db.prepare('DELETE FROM auth_invites WHERE email=? OR expires<?').run(
          address,
          Date.now(),
        );
        db.prepare('INSERT INTO auth_invites VALUES(?,?,?,?)').run(
          digest(invitation),
          address,
          'member',
          Date.now() + 48 * 3600000,
        );
        send(200, { url: expectedOrigin + '/#invite=' + invitation });
        return true;
      }
      const revoke = url.pathname.match(
        /^\/api\/auth\/invites\/([a-f0-9]{64})$/,
      );
      if (revoke && req.method === 'DELETE') {
        db.prepare('DELETE FROM auth_invites WHERE hash=? AND role=?').run(
          revoke[1],
          'member',
        );
        send(200, { revoked: true });
        return true;
      }
      const member = url.pathname.match(/^\/api\/auth\/users\/(\d+)$/);
      const recovery = url.pathname.match(
        /^\/api\/auth\/users\/(\d+)\/recovery$/,
      );
      if (recovery && req.method === 'POST') {
        const target = db
          .prepare('SELECT * FROM auth_users WHERE id=? AND role=?')
          .get(Number(recovery[1]), 'member');
        if (!target) throw Error('Member not found.');
        const value = recoveryLinkToken(db, target.email);
        send(200, { url: expectedOrigin + '/#invite=' + value });
        return true;
      }
      if (member && req.method === 'PATCH') {
        const body = await readBody(req);
        if (typeof body.disabled !== 'boolean')
          throw Error('Invalid account status.');
        const target = db
          .prepare('SELECT * FROM auth_users WHERE id=?')
          .get(Number(member[1]));
        if (!target || target.role === 'owner')
          throw Error('Only member accounts can be disabled.');
        db.prepare('UPDATE auth_users SET disabled=? WHERE id=?').run(
          Number(body.disabled),
          target.id,
        );
        db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(target.id);
        db.prepare('DELETE FROM auth_resets WHERE user_id=?').run(target.id);
        send(200, { updated: true });
        return true;
      }
      if (url.pathname.startsWith('/api/auth/')) {
        send(404, { error: 'Not found.' });
        return true;
      }
      return false;
    } catch (e) {
      send(400, { error: e.message });
      return true;
    }
  }
  return { guard, origin };
}

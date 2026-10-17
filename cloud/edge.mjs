import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { Buffer } from 'node:buffer';
import {
  workspaceRequest,
  workspaceFromExport,
  HttpError,
} from './workspace.mjs';
const url = Deno.env.get('SUPABASE_URL');
const secret =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
  JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = admin.storage.from('sentinel-attachments');
const site = 'https://pumamercury.github.io/sentinel/';
const origins = new Set([
  'https://pumamercury.github.io',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
]);
const checked = (result) => {
  if (result.error) throw Error(result.error.message);
  return result.data;
};
const sha = async (value) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
const fail = (message, status = 400) => {
  throw new HttpError(message, status);
};
const ownerOnly = (member) => {
  if (member.role !== 'owner') fail('Owner access required.', 403);
};
const mime = (bytes) => {
  const b = Buffer.from(bytes),
    hex = b.subarray(0, 12).toString('hex'),
    a = b.subarray(0, 16).toString('ascii');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (a.startsWith('GIF87a') || a.startsWith('GIF89a')) return 'image/gif';
  if (a.startsWith('RIFF') && a.slice(8, 12) === 'WEBP') return 'image/webp';
  if (a.slice(4, 8) === 'ftyp')
    return a.slice(8, 12) === 'qt  '
      ? 'video/quicktime'
      : ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].includes(
            a.slice(8, 12),
          )
        ? 'video/mp4'
        : 'application/octet-stream';
  if (hex.startsWith('1a45dfa3') && b.toString('ascii').includes('webm'))
    return 'video/webm';
  return 'application/octet-stream';
};
const workspace = async () =>
  checked(
    await admin
      .from('sentinel_workspace')
      .select('version,data')
      .eq('id', true)
      .single(),
  );
async function mutate(work) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await workspace();
    const result = await work(row.data);
    const committed = checked(
      await admin.rpc('sentinel_commit', {
        expected_version: row.version,
        next_data: row.data,
      }),
    );
    if (committed !== null) return result;
  }
  fail('Workspace is busy. Please retry.', 409);
}
async function signedFiles(files) {
  if (!files.length) return [];
  const urls = checked(
    await bucket.createSignedUrls(
      files.map((file) => file.path),
      900,
    ),
  );
  const byPath = new Map(urls.map((entry) => [entry.path, entry]));
  return files.map((file) => {
    const entry = byPath.get(file.path);
    if (!entry?.signedUrl)
      return {
        ...file,
        previewType: null,
        previewUrl: undefined,
        downloadUrl: undefined,
        unavailable: true,
      };
    const download = new URL(entry.signedUrl);
    download.searchParams.set('download', file.name);
    return { ...file, previewUrl: entry.signedUrl, downloadUrl: download.href };
  });
}
async function signed(file) {
  return (await signedFiles([file]))[0];
}
async function migration(req, path, body) {
  const config = checked(
    await admin
      .from('sentinel_control')
      .select('data')
      .eq('key', 'migration')
      .maybeSingle(),
  )?.data;
  const token = req.headers.get('x-sentinel-migration') || '';
  if (
    !config ||
    config.closed ||
    Date.now() > config.expires ||
    !token ||
    (await sha(token)) !== config.hash
  )
    fail('Migration access denied.', 403);
  if (path === 'migration/initialize') {
    const existing = checked(
      await admin.from('sentinel_workspace').select('id').maybeSingle(),
    );
    if (existing) fail('Workspace already initialized.', 409);
    const { manifest } = body;
    if (
      manifest?.schemaVersion !== 1 ||
      !Array.isArray(manifest.files) ||
      !manifest.members.some((m) => m.role === 'owner' && !m.disabled)
    )
      fail('Invalid migration manifest.');
    const state = workspaceFromExport(manifest);
    checked(
      await admin.from('sentinel_workspace').insert({ id: true, data: state }),
    );
    for (const member of manifest.members)
      checked(
        await admin.from('sentinel_members').insert({
          id: member.id,
          email: member.email,
          role: member.role,
          disabled: !!member.disabled,
        }),
      );
    checked(await admin.rpc('sentinel_reserve_member_ids'));
    return { initialized: true };
  }
  if (path === 'migration/upload') {
    const row = await workspace();
    const file = row.data.files.find((f) => f.id === body.id);
    if (!file) fail('Unknown migration file.');
    const upload = checked(
      await bucket.createSignedUploadUrl(file.path, { upsert: false }),
    );
    return upload;
  }
  if (path === 'migration/verify') {
    const row = await workspace();
    const file = row.data.files.find((f) => f.id === body.id);
    if (!file) fail('Unknown migration file.');
    return signed(file);
  }
  if (path === 'migration/test-accounts') {
    if (config.tests) fail('Test accounts already exist.', 409);
    const accounts = [];
    for (const role of ['owner', 'member', 'outsider']) {
      const email = `sentinel-check-${crypto.randomUUID()}@example.invalid`,
        password = crypto.randomUUID() + crypto.randomUUID();
      const created = checked(
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        }),
      );
      if (role !== 'outsider')
        checked(
          await admin
            .from('sentinel_members')
            .insert({ auth_id: created.user.id, email, role }),
        );
      const loginClient = createClient(url, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const login = checked(
        await loginClient.auth.signInWithPassword({ email, password }),
      );
      accounts.push({
        id: created.user.id,
        email,
        role,
        token: login.session.access_token,
      });
    }
    checked(
      await admin
        .from('sentinel_control')
        .update({
          data: {
            ...config,
            tests: accounts.map((a) => a.id),
            testWorkspace: (await workspace()).data,
          },
        })
        .eq('key', 'migration'),
    );
    return { accounts };
  }
  if (path === 'migration/cleanup-tests') {
    for (const id of config.tests || []) {
      checked(await admin.from('sentinel_members').delete().eq('auth_id', id));
      checked(await admin.auth.admin.deleteUser(id));
    }
    if (config.testWorkspace)
      await mutate((state) => {
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, config.testWorkspace);
        return true;
      });
    const { tests, testWorkspace, ...clean } = config;
    checked(
      await admin
        .from('sentinel_control')
        .update({ data: clean })
        .eq('key', 'migration'),
    );
    return { cleaned: true };
  }
  if (path === 'migration/finish') {
    if (config.tests?.length)
      fail('Remove temporary access-test accounts before finishing.');
    const row = await workspace();
    for (const file of row.data.files) {
      const info = checked(await bucket.info(file.path));
      if (info.size !== file.size) fail('File verification failed: ' + file.id);
    }
    const owners = checked(
      await admin
        .from('sentinel_members')
        .select('*')
        .eq('role', 'owner')
        .eq('disabled', false),
    );
    const links = [];
    for (const member of owners) {
      const result = checked(
        await admin.auth.admin.generateLink({
          type: 'invite',
          email: member.email,
          options: { redirectTo: site },
        }),
      );
      checked(
        await admin
          .from('sentinel_members')
          .update({ auth_id: result.user.id })
          .eq('id', member.id),
      );
      links.push({
        email: member.email,
        url: site + '#invite=' + result.properties.hashed_token,
      });
    }
    const companionToken = crypto.randomUUID() + crypto.randomUUID();
    checked(
      await admin.from('sentinel_companions').insert({
        token_hash: await sha(companionToken),
        member_id: owners[0].id,
      }),
    );
    checked(
      await admin
        .from('sentinel_control')
        .update({
          data: {
            ...config,
            closed: true,
            finishedAt: new Date().toISOString(),
          },
        })
        .eq('key', 'migration'),
    );
    return { complete: true, owners: links, companionToken };
  }
  fail('Unknown migration action.', 404);
}
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...(origin && origins.has(origin)
      ? { 'Access-Control-Allow-Origin': origin }
      : {}),
    'Access-Control-Allow-Headers':
      'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const response = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !origins.has(origin))
    return response({ error: 'Origin rejected.' }, 403);
  if (req.method === 'OPTIONS')
    return new Response(null, { status: 204, headers });
  try {
    const parsed = new URL(req.url);
    const path = parsed.pathname.replace(/^.*\/sentinel-api\/?/, '');
    if (Number(req.headers.get('content-length') || 0) > 20_000_000)
      fail('Request too large.', 413);
    let body = {};
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const value = await req.text();
      if (value.length > 20_000_000) fail('Request too large.', 413);
      body = value ? JSON.parse(value) : {};
    }
    if (path.startsWith('migration/'))
      return response(await migration(req, path, body));
    let companion = null;
    const companionToken = req.headers.get('x-sentinel-companion');
    if (companionToken) {
      const entry = checked(
        await admin
          .from('sentinel_companions')
          .select('member_id,expires_at')
          .eq('token_hash', await sha(companionToken))
          .maybeSingle(),
      );
      if (!entry || Date.parse(entry.expires_at) < Date.now())
        fail('Mac connection expired. Reconnect this Mac.', 401);
      companion = checked(
        await admin
          .from('sentinel_members')
          .select('*')
          .eq('id', entry.member_id)
          .single(),
      );
      if (companion.disabled || companion.role !== 'owner')
        fail('Mac connection is disabled.', 403);
      if (
        !['uploads/prepare', 'uploads/complete', 'companion/status'].includes(
          path,
        )
      )
        fail('Mac connection cannot perform this action.', 403);
    }
    const token = (req.headers.get('authorization') || '').replace(
      /^Bearer /i,
      '',
    );
    if (!token && !companion) {
      if (path === 'auth/session')
        return response({ enabled: true, user: null });
      fail('Sign in required.', 401);
    }
    const auth = companion
      ? { data: { user: { id: companion.auth_id } }, error: null }
      : await admin.auth.getUser(token);
    if (auth.error || !auth.data.user) {
      if (path === 'auth/session')
        return response({ enabled: true, user: null });
      fail('Sign in required.', 401);
    }
    const user = auth.data.user;
    const member =
      companion ||
      checked(
        await admin
          .from('sentinel_members')
          .select('*')
          .eq('auth_id', user.id)
          .maybeSingle(),
      );
    if (
      !member ||
      member.disabled ||
      (member.invitation_id &&
        Date.parse(member.invitation_expires) < Date.now())
    ) {
      if (path === 'auth/session')
        return response({ enabled: true, user: null });
      fail('This account does not have workspace access.', 403);
    }
    const { id, email, role } = member;
    if (path === 'auth/session')
      return response({ enabled: true, user: { id, email, role } });
    if (path === 'auth/users' && req.method === 'GET') {
      ownerOnly(member);
      const users = checked(
        await admin.from('sentinel_members').select('*').order('id'),
      );
      return response({
        users: users.map((m) => ({
          id: m.id,
          email: m.email,
          role: m.role,
          disabled: Number(m.disabled),
        })),
        invitations: users
          .filter(
            (m) =>
              m.invitation_id && Date.parse(m.invitation_expires) > Date.now(),
          )
          .map((m) => ({
            id: m.invitation_id,
            email: m.email,
            expires: Date.parse(m.invitation_expires),
          })),
      });
    }
    if (path === 'auth/invite' && req.method === 'POST') {
      ownerOnly(member);
      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        fail('Enter a valid email.');
      if (
        checked(
          await admin
            .from('sentinel_members')
            .select('id')
            .eq('email', email)
            .maybeSingle(),
        )
      )
        fail('This email already has an account. Restore access from Members.');
      const result = checked(
        await admin.auth.admin.generateLink({
          type: 'invite',
          email,
          options: { redirectTo: site },
        }),
      );
      const invitation = crypto.randomUUID();
      checked(
        await admin.from('sentinel_members').insert({
          auth_id: result.user.id,
          email,
          role: 'member',
          invitation_id: invitation,
          invitation_expires: new Date(Date.now() + 48 * 3600000).toISOString(),
        }),
      );
      return response({
        url: site + '#invite=' + result.properties.hashed_token,
      });
    }
    const um = path.match(/^auth\/users\/(\d+)$/);
    if (um && req.method === 'PATCH') {
      ownerOnly(member);
      if (typeof body.disabled !== 'boolean') fail('Invalid access setting.');
      const target = checked(
        await admin
          .from('sentinel_members')
          .select('*')
          .eq('id', Number(um[1]))
          .single(),
      );
      if (target.role === 'owner') fail('Owner access cannot be disabled.');
      checked(
        await admin
          .from('sentinel_members')
          .update({ disabled: body.disabled })
          .eq('id', target.id),
      );
      return response({ saved: true });
    }
    const im = path.match(/^auth\/invites\/([a-f0-9-]+)$/);
    if (im && req.method === 'DELETE') {
      ownerOnly(member);
      checked(
        await admin
          .from('sentinel_members')
          .update({
            disabled: true,
            invitation_id: null,
            invitation_expires: null,
          })
          .eq('invitation_id', im[1])
          .eq('role', 'member'),
      );
      return response({ revoked: true });
    }
    if (path === 'auth/accepted' && req.method === 'POST') {
      checked(
        await admin
          .from('sentinel_members')
          .update({ invitation_id: null, invitation_expires: null })
          .eq('id', id),
      );
      return response({ saved: true });
    }
    const members = checked(
      await admin.from('sentinel_members').select('id,email,role,disabled'),
    );
    if (path === 'companion/status' && req.method === 'GET')
      return response({
        hashes:
          (await workspace()).data.captureHashes ||
          (await workspace()).data.files
            .map((f) => f.captureHash)
            .filter(Boolean),
      });
    if (path === 'uploads/prepare' && req.method === 'POST') {
      if (companion && body.issueId !== null)
        fail('Mac companion uploads to the inbox only.', 403);
      const state = (await workspace()).data;
      if (
        body.issueId !== null &&
        !state.bugs.some((b) => b.id === body.issueId && !b.deletedAt)
      )
        fail('Issue not found.', 404);
      if (body.issueId === null) ownerOnly(member);
      if (
        !Number.isSafeInteger(body.size) ||
        body.size < 1 ||
        body.size > 50_000_000
      )
        fail('Each hosted attachment must be at most 50 MB.');
      if (
        body.captureHash &&
        (typeof body.captureHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(body.captureHash))
      )
        fail('Invalid capture fingerprint.');
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 255
      )
        fail('Invalid file name.');
      const key = crypto.randomUUID();
      const metadata = {
        id: key,
        path: key,
        name: body.name.replace(/[\x00-\x1f\x7f/\\]/g, '_'),
        size: body.size,
        issueId: body.issueId,
        source: body.issueId === null ? 'inbox' : 'issue',
        createdAt: new Date().toISOString(),
        captureHash: body.captureHash || null,
      };
      checked(
        await admin
          .from('sentinel_uploads')
          .insert({ id: key, auth_id: user.id, metadata }),
      );
      const upload = checked(await bucket.createSignedUploadUrl(key));
      return response({ ...upload, id: key });
    }
    if (path === 'uploads/complete' && req.method === 'POST') {
      const pending = checked(
        await admin
          .from('sentinel_uploads')
          .select('*')
          .eq('id', body.id)
          .eq('auth_id', user.id)
          .single(),
      );
      if (Date.parse(pending.expires_at) < Date.now())
        fail('Upload expired. Please retry.');
      const f = pending.metadata;
      const info = checked(await bucket.info(f.path));
      if (info.size !== f.size) fail('Uploaded file size does not match.');
      const link = checked(await bucket.createSignedUrl(f.path, 60));
      const source = await fetch(link.signedUrl, {
        headers: { Range: 'bytes=0-511' },
      });
      if (!source.ok) fail('Cannot verify uploaded file.');
      const reader = source.body.getReader();
      const first = await reader.read();
      await reader.cancel();
      const type = mime(first.value || new Uint8Array());
      f.previewType = type.startsWith('image/')
        ? 'image'
        : type.startsWith('video/')
          ? 'video'
          : null;
      // Storage accepts the browser's content type, but previews are only enabled after signature checks.
      const result = await mutate((state) => {
        const old = state.files.find((x) => x.id === f.id);
        if (old) return old;
        if (f.issueId !== null) {
          const bug = state.bugs.find(
            (b) => b.id === f.issueId && !b.deletedAt,
          );
          if (!bug) fail('Issue no longer exists.');
          if (state.files.filter((x) => x.issueId === f.issueId).length >= 20)
            fail('An issue can have up to 20 attachments.');
          bug.updatedAt = new Date().toISOString();
          bug.history.push({
            at: bug.updatedAt,
            text: 'Added attachment: ' + f.name,
            actor: { id, email },
          });
        }
        if (f.captureHash) {
          const existing = state.files.find(
            (x) => x.captureHash === f.captureHash,
          );
          if (existing) return existing;
          if ((state.captureHashes || []).includes(f.captureHash))
            return { ...f, skipped: true };
          state.captureHashes = [...(state.captureHashes || []), f.captureHash];
        }
        state.files.push(f);
        return f;
      });
      if (result.skipped || result.path !== f.path)
        await bucket.remove([f.path]);
      return response(
        result.skipped ? { skipped: true } : await signed(result),
      );
    }
    if (path === 'import' && req.method === 'POST') {
      ownerOnly(member);
      if (
        ![1, 2].includes(body.schemaVersion) ||
        !Array.isArray(body.bugs) ||
        body.bugs.length > 10000
      )
        fail('Unsupported backup.');
      const files = [];
      for (const bug of body.bugs) {
        if (
          !Array.isArray(bug.attachments || []) ||
          (bug.attachments || []).length > 20
        )
          fail('Invalid attachments.');
        for (const f of bug.attachments || [])
          files.push({ ...f, source: 'issue', originalIssueId: bug.id });
      }
      if (!Array.isArray(body.inbox || []) || (body.inbox || []).length > 10000)
        fail('Invalid inbox backup.');
      files.push(...(body.inbox || []).map((f) => ({ ...f, source: 'inbox' })));
      const prepared = files.map((f) => {
        if (
          typeof f.base64 !== 'string' ||
          !/[A-Za-z0-9+/]*={0,2}$/.test(f.base64)
        )
          fail('Invalid attachment encoding.');
        const bytes = Buffer.from(f.base64, 'base64');
        if (bytes.toString('base64') !== f.base64 || bytes.length > 50_000_000)
          fail('Invalid attachment bytes.');
        if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 255)
          fail('Invalid attachment name.');
        const id = crypto.randomUUID(),
          type = mime(bytes);
        return {
          bytes,
          type,
          metadata: {
            id,
            path: id,
            name: f.name.replace(/[\x00-\x1f\x7f/\\]/g, '_'),
            size: bytes.length,
            source: f.source,
            originalIssueId: f.originalIssueId,
            createdAt: new Date().toISOString(),
            previewType: type.startsWith('image/')
              ? 'image'
              : type.startsWith('video/')
                ? 'video'
                : null,
          },
        };
      });
      const input = { ...body, preparedFiles: prepared.map((f) => f.metadata) };
      workspaceRequest(
        structuredClone((await workspace()).data),
        member,
        members,
        'import',
        'POST',
        input,
      );
      const uploaded = [];
      try {
        for (const file of prepared) {
          checked(
            await bucket.upload(file.metadata.path, file.bytes, {
              contentType: file.type,
            }),
          );
          uploaded.push(file.metadata.path);
        }
        return response(
          await mutate((state) =>
            workspaceRequest(state, member, members, 'import', 'POST', input),
          ),
        );
      } catch (error) {
        if (uploaded.length) await bucket.remove(uploaded);
        throw error;
      }
    }
    if (path === 'backup/manifest' && req.method === 'GET') {
      ownerOnly(member);
      const state = (await workspace()).data;
      if (state.files.reduce((n, f) => n + f.size, 0) > 250_000_000)
        fail(
          'This workspace is too large for a browser JSON backup. Use database and Storage backups in Supabase.',
          413,
        );
      const files = await signedFiles(state.files);
      return response({
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        bugs: state.bugs.map((b) => ({
          ...b,
          creationToken: undefined,
          creationAccountId: undefined,
        })),
        fields: state.fields,
        projects: state.projects,
        links: state.links,
        files,
      });
    }
    if (path === 'backup' && req.method === 'GET') {
      ownerOnly(member);
      const state = (await workspace()).data;
      const total = state.files.reduce((n, f) => n + f.size, 0);
      if (total > 60_000_000)
        fail(
          'This workspace has more than 60 MB of files. Use the cloud export tool for a complete backup.',
          413,
        );
      const files = [];
      for (const f of state.files) {
        const blob = checked(await bucket.download(f.path));
        files.push({
          ...f,
          base64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
        });
      }
      return response({
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        bugs: state.bugs.map((b) => ({
          ...b,
          creationToken: undefined,
          creationAccountId: undefined,
          attachments: files.filter((f) => f.issueId === b.id),
        })),
        fields: state.fields,
        projects: state.projects,
        links: state.links,
        inbox: files.filter((f) => f.source === 'inbox'),
      });
    }
    const removedFile =
      req.method === 'DELETE' &&
      (/^bugs\/\d+\/attachments\//.test(path) ||
        /^inbox\/[a-zA-Z0-9-]+$/.test(path))
        ? (await workspace()).data.files.find(
            (f) => f.id === path.split('/').at(-1),
          )
        : null;
    const fullPath = path + parsed.search;
    let result;
    if (req.method === 'GET')
      result = workspaceRequest(
        (await workspace()).data,
        member,
        members,
        fullPath,
        req.method,
        body,
      );
    else
      result = await mutate((state) =>
        workspaceRequest(state, member, members, fullPath, req.method, body),
      );
    if (removedFile) {
      const removed = await bucket.remove([removedFile.path]);
      if (removed.error)
        console.error('Attachment cleanup failed:', removed.error.message);
    }
    if (path === 'inbox' && req.method === 'GET')
      result.files = await signedFiles(result.files);
    if (/^bugs\/\d+\/attachments$/.test(path) && req.method === 'GET')
      result = await signedFiles(result);
    if (result?.csv !== undefined)
      return new Response(result.csv, {
        headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8' },
      });
    return response(result);
  } catch (error) {
    console.error('Sentinel request failed:', error.message);
    return response(
      { error: error.message || 'Unable to complete request.' },
      error.status || 400,
    );
  }
});

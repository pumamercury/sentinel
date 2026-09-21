import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { lstat, readdir, realpath, open } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readMediaHeader, mediaInfo, sendMedia } from './media.mjs';

const execFileAsync = promisify(execFile);
const MAX_SIZE = 250_000_000;
const SUPPORTED = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.heic',
  '.heif',
];
const defaults = {
  folder: '',
  enabled: false,
  extensions: ['.png', '.mp4', '.mov', '.m4v'],
  nameContains: '',
};
const within = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
const stamp = (stat) => `${stat.size}:${stat.mtimeMs}`;
const safeName = (name) =>
  String(name)
    .replace(/[\x00-\x1f\x7f/\\]/g, '_')
    .slice(0, 255) || 'Capture';

export async function isLocallyAvailable(path) {
  if (process.platform !== 'win32') return true;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference="Stop"; [int](Get-Item -LiteralPath $env:SENTINEL_CAPTURE_FILE -Force).Attributes',
    ],
    {
      windowsHide: true,
      timeout: 10000,
      env: { ...process.env, SENTINEL_CAPTURE_FILE: path },
    },
  );
  const attrs = Number(stdout.trim());
  if (!Number.isFinite(attrs))
    throw Error('Unable to check whether the capture is downloaded.');
  return !(attrs & (4096 | 262144 | 4194304));
}

// Read cloud metadata in one process; never open or hydrate the photos here.
export async function localAvailability(folder) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$ErrorActionPreference="Stop"; $items = @(Get-ChildItem -LiteralPath $env:SENTINEL_CAPTURE_FOLDER -File -Recurse -Force | ForEach-Object { @{ path=$_.FullName; available=(([int]$_.Attributes -band 4460544) -eq 0) } }); ConvertTo-Json -InputObject $items -Compress',
    ],
    {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 20_000_000,
      env: { ...process.env, SENTINEL_CAPTURE_FOLDER: folder },
    },
  );
  return new Map(
    JSON.parse(stdout).map((item) => [item.path.toLowerCase(), item.available]),
  );
}

export function captureInbox(db, { get, save }, directory, options = {}) {
  const fileRoot = join(directory, 'attachments');
  mkdirSync(fileRoot, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS capture_inbox (
    id TEXT PRIMARY KEY,name TEXT NOT NULL,bytes BLOB,storage_size INTEGER,created_at TEXT NOT NULL,
    source_path TEXT NOT NULL,source_modified TEXT NOT NULL,hash TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS capture_seen (
    folder TEXT NOT NULL,path TEXT NOT NULL,stamp TEXT NOT NULL,state TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',
    stable_since INTEGER NOT NULL, PRIMARY KEY(folder,path));
    CREATE TABLE IF NOT EXISTS capture_hashes(hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS capture_roots(folder TEXT PRIMARY KEY);`);
  const intervalMs = options.intervalMs ?? 5000;
  const stableMs = options.stableMs ?? 5000;
  const available = options.available ?? isLocallyAvailable;
  const availabilitySnapshot =
    options.availabilitySnapshot ??
    (!options.available && process.platform === 'win32'
      ? localAvailability
      : null);
  let stopped = false,
    configuring = false,
    job = null,
    controller = null;
  let lastScan = null,
    scanStage = '',
    scanError = '',
    importing = '';
  const settings = () => ({
    ...defaults,
    ...JSON.parse(
      db.prepare("SELECT data FROM settings WHERE key='capture-inbox'").get()
        ?.data ?? '{}',
    ),
  });
  const setSettings = (value) =>
    db
      .prepare(
        "INSERT INTO settings(key,data) VALUES('capture-inbox',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(value));
  const removeFile = (id) => {
    try {
      unlinkSync(join(fileRoot, id));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  };
  const putSeen = (
    folder,
    path,
    signature,
    state,
    message = '',
    since = Date.now(),
  ) =>
    db
      .prepare(`INSERT INTO capture_seen(folder,path,stamp,state,message,stable_since)
    VALUES(?,?,?,?,?,?) ON CONFLICT(folder,path) DO UPDATE SET stamp=excluded.stamp,state=excluded.state,message=excluded.message,stable_since=excluded.stable_since`)
      .run(folder, path, signature, state, message, since);

  async function enumerate(folder) {
    const found = [];
    let count = 0;
    async function visit(path) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (stopped) throw Error('Monitoring stopped.');
        if (++count > 50000)
          throw Error(
            'This folder is too large to monitor. Choose a smaller captures folder (up to 50,000 entries).',
          );
        const file = join(path, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          const actual = await realpath(file);
          if (within(folder, actual)) await visit(file);
        } else if (
          entry.isFile() &&
          SUPPORTED.includes(extname(entry.name).toLowerCase())
        ) {
          try {
            const stat = await lstat(file);
            if (stat.isFile() && !stat.isSymbolicLink())
              found.push({ file, stat });
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        }
      }
    }
    await visit(folder);
    return found;
  }
  async function validateFolder(value) {
    if (
      typeof value !== 'string' ||
      value.length > 2000 ||
      !isAbsolute(value.trim())
    )
      throw Error('Enter the full path to a local captures folder.');
    const folder = await realpath(value.trim());
    if (!(await lstat(folder)).isDirectory()) throw Error('Choose a folder.');
    if (
      dirname(folder) === folder ||
      within(folder, resolve(directory)) ||
      within(resolve(directory), folder)
    )
      throw Error(
        'Choose a dedicated captures folder outside Sentinel’s data folder.',
      );
    return folder;
  }
  async function configure(input) {
    if (configuring) throw Error('Folder settings are already being updated.');
    configuring = true;
    try {
      if (job) await job;
      if (typeof input.enabled !== 'boolean')
        throw Error('Choose whether monitoring is enabled.');
      const folder = input.folder?.trim()
        ? await validateFolder(input.folder)
        : '';
      if (input.enabled && !folder)
        throw Error('Choose a folder before starting monitoring.');
      const extensions = [...new Set(input.extensions ?? defaults.extensions)];
      if (!extensions.length || extensions.some((e) => !SUPPORTED.includes(e)))
        throw Error('Choose supported image or video extensions.');
      const nameContains = input.nameContains ?? '';
      if (typeof nameContains !== 'string' || nameContains.length > 100)
        throw Error('Filename filter must be at most 100 characters.');
      // Baseline once per folder: never import a historical photo library by accident.
      if (
        folder &&
        !db.prepare('SELECT 1 FROM capture_roots WHERE folder=?').get(folder)
      ) {
        const existing = await enumerate(folder);
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const { file, stat } of existing)
            putSeen(folder, relative(folder, file), stamp(stat), 'ignored');
          db.prepare('INSERT INTO capture_roots(folder) VALUES(?)').run(folder);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      }
      setSettings({
        folder,
        enabled: input.enabled,
        extensions,
        nameContains: nameContains.trim(),
      });
      scanError = '';
      return status();
    } finally {
      configuring = false;
    }
  }
  async function importFile(config, file, stat) {
    const id = randomUUID(),
      part = `inbox-${id}.part`;
    const signature = stamp(stat),
      rel = relative(config.folder, file);
    let handle;
    try {
      const canonical = await realpath(file);
      if (
        !within(config.folder, canonical) ||
        (await lstat(file)).isSymbolicLink()
      )
        throw Error('Capture moved outside the selected folder.');
      if (!(await available(file))) {
        putSeen(
          config.folder,
          rel,
          signature,
          'waiting',
          'Waiting for iCloud to download this file.',
        );
        return;
      }
      handle = await open(file, 'r');
      const before = await handle.stat();
      if (!before.isFile() || stamp(before) !== signature)
        throw Error('File is still changing; will retry.');
      const hash = createHash('sha256');
      let size = 0;
      const inspect = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          if (size > MAX_SIZE) return callback(Error('File exceeds 250 MB.'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      importing = basename(file);
      await pipeline(
        handle.createReadStream({ autoClose: false }),
        inspect,
        createWriteStream(join(fileRoot, part), { flags: 'wx' }),
        { signal: controller.signal },
      );
      const after = await handle.stat();
      if (
        stamp(after) !== signature ||
        size !== stat.size ||
        stamp(await lstat(file)) !== signature
      )
        throw Error('File changed while importing; will retry.');
      await handle.close();
      handle = null;
      const digest = hash.digest('hex');
      if (db.prepare('SELECT 1 FROM capture_hashes WHERE hash=?').get(digest)) {
        putSeen(config.folder, rel, signature, 'duplicate');
        return;
      }
      if (stopped) return;
      renameSync(join(fileRoot, part), join(fileRoot, id));
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          'INSERT INTO capture_inbox(id,name,storage_size,created_at,source_path,source_modified,hash) VALUES(?,?,?,?,?,?,?)',
        ).run(
          id,
          safeName(basename(file)),
          size,
          new Date().toISOString(),
          file,
          new Date(stat.mtimeMs).toISOString(),
          digest,
        );
        db.prepare('INSERT INTO capture_hashes(hash) VALUES(?)').run(digest);
        putSeen(config.folder, rel, signature, 'imported');
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        removeFile(id);
        throw e;
      }
    } finally {
      await handle?.close();
      removeFile(part);
      importing = '';
    }
  }
  async function scan() {
    const config = settings();
    if (stopped || configuring || !config.enabled || !config.folder) return;
    controller = new AbortController();
    scanError = '';
    try {
      scanStage = 'Listing capture files';
      const found = await enumerate(config.folder);
      scanStage = 'Checking iCloud download status';
      const availability = availabilitySnapshot
        ? await availabilitySnapshot(config.folder)
        : null;
      for (const { file, stat } of found) {
        scanStage = 'Checking ' + basename(file);
        if (stopped) break;
        const rel = relative(config.folder, file),
          signature = stamp(stat);
        const prior = db
          .prepare('SELECT * FROM capture_seen WHERE folder=? AND path=?')
          .get(config.folder, rel);
        // Already-local historical files stay excluded. Cloud-only baseline files
        // become candidates so a later user download can be collected.
        if (prior?.state === 'ignored') {
          if (availability?.get(file.toLowerCase()) === false) {
            putSeen(
              config.folder,
              rel,
              signature,
              'waiting',
              'Waiting for iCloud to download this file.',
            );
          }
          continue;
        }
        if (
          !config.extensions.includes(extname(file).toLowerCase()) ||
          !basename(file)
            .toLowerCase()
            .includes(config.nameContains.toLowerCase())
        )
          continue;
        if (
          prior?.stamp === signature &&
          ['imported', 'duplicate', 'skipped'].includes(prior.state)
        )
          continue;
        if (stat.size > MAX_SIZE) {
          putSeen(
            config.folder,
            rel,
            signature,
            'skipped',
            'File exceeds 250 MB.',
          );
          continue;
        }
        if (!stat.size || !prior || prior.stamp !== signature) {
          putSeen(
            config.folder,
            rel,
            signature,
            'waiting',
            'Waiting for file to finish syncing.',
          );
          continue;
        }
        if (Date.now() - prior.stable_since < stableMs) continue;
        if (availability && availability.get(file.toLowerCase()) !== true) {
          putSeen(
            config.folder,
            rel,
            signature,
            'waiting',
            'Waiting for iCloud to download this file.',
            prior.stable_since,
          );
          continue;
        }
        try {
          await importFile(config, file, stat);
        } catch (e) {
          if (stopped) break;
          putSeen(
            config.folder,
            rel,
            signature,
            'error',
            e.code === 'ENOENT'
              ? 'File is no longer in the watched folder.'
              : e.message,
          );
        }
      }
      lastScan = new Date().toISOString();
    } catch (e) {
      if (!stopped)
        scanError =
          e.code === 'ENOENT'
            ? 'Watched folder is unavailable. Check iCloud and the folder path.'
            : e.message;
    } finally { scanStage = ''; }
  }
  function scanNow() {
    if (job) return job;
    job = scan().finally(() => {
      job = null;
      controller = null;
    });
    return job;
  }
  const timer = setInterval(() => void scanNow(), intervalMs);
  timer.unref();
  const describe = (a) => ({
    id: a.id,
    name: a.name,
    size: a.storage_size ?? a.bytes.length,
    createdAt: a.created_at,
    sourcePath: a.source_path,
    sourceModified: a.source_modified,
    previewType:
      (a.storage_size === null
        ? mediaInfo(Buffer.from(a.bytes))
        : readMediaHeader(join(fileRoot, a.id))
      )?.kind ?? null,
  });
  function status() {
    const config = settings();
    const counts = db
      .prepare(
        'SELECT state,count(*) AS count FROM capture_seen WHERE folder=? GROUP BY state',
      )
      .all(config.folder);
    return {
      settings: config,
      scanStage,
      lastScan,
      error: scanError,
      importing,
      running: !!job,
      configuring,
      counts: Object.fromEntries(counts.map((c) => [c.state, c.count])),
      suggestedFolder: join(homedir(), 'Pictures', 'iCloud Photos', 'Photos'),
      supportedExtensions: SUPPORTED,
      problems: db
        .prepare(
          "SELECT path,state,message FROM capture_seen WHERE folder=? AND state IN ('waiting','error','skipped') ORDER BY stable_since DESC LIMIT 30",
        )
        .all(config.folder),
      files: db
        .prepare('SELECT * FROM capture_inbox ORDER BY created_at DESC')
        .all()
        .map((a) => {
          try {
            return describe(a);
          } catch {
            return {
              ...a,
              bytes: undefined,
              size: a.storage_size,
              createdAt: a.created_at,
              previewType: null,
            };
          }
        }),
    };
  }
  function assign(ids, issueId) {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string')
    )
      throw Error('Select between 1 and 20 captures.');
    if (!Number.isSafeInteger(issueId)) throw Error('Select an issue.');
    db.exec('BEGIN IMMEDIATE');
    try {
      const issue = get(issueId);
      if (!issue) throw Error('Issue no longer exists.');
      const count = db
        .prepare('SELECT count(*) AS count FROM attachments WHERE bug_id=?')
        .get(issueId).count;
      if (count + ids.length > 20)
        throw Error('An issue can have up to 20 attachments.');
      const captures = ids.map((id) =>
        db.prepare('SELECT * FROM capture_inbox WHERE id=?').get(id),
      );
      if (captures.some((a) => !a))
        throw Error(
          'A selected capture is no longer in the inbox. Refresh and try again.',
        );
      for (const a of captures) {
        if (a.storage_size !== null) readMediaHeader(join(fileRoot, a.id)); // Ensure the source copy is present.
        db.prepare(
          'INSERT INTO attachments(id,bug_id,name,bytes,created_at,storage_size) VALUES(?,?,?,?,?,?)',
        ).run(
          a.id,
          issueId,
          a.name,
          a.bytes ?? Buffer.alloc(0),
          a.created_at,
          a.storage_size,
        );
        db.prepare('DELETE FROM capture_inbox WHERE id=?').run(a.id);
      }
      issue.updatedAt = new Date().toISOString();
      issue.history.push({
        at: issue.updatedAt,
        text: 'Attached from inbox: ' + captures.map((a) => a.name).join(', '),
      });
      save(issue);
      db.exec('COMMIT');
      return { assigned: ids.length };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  async function handle(req, res, url, body, send) {
    if (url.pathname === '/api/inbox' && req.method === 'GET') {
      send(200, status());
      return true;
    }
    if (url.pathname === '/api/inbox/settings' && req.method === 'PUT') {
      send(200, await configure(body));
      return true;
    }
    if (url.pathname === '/api/inbox/scan' && req.method === 'POST') {
      await scanNow();
      send(200, status());
      return true;
    }
    if (url.pathname === '/api/inbox/assign' && req.method === 'POST') {
      send(200, assign(body.ids, body.issueId));
      return true;
    }
    const match = url.pathname.match(/^\/api\/inbox\/([a-f0-9-]{36})$/);
    if (!match) return false;
    const a = db
      .prepare('SELECT * FROM capture_inbox WHERE id=?')
      .get(match[1]);
    if (!a) {
      send(404, { error: 'Capture no longer in inbox.' });
      return true;
    }
    if (req.method === 'DELETE') {
      if (a.storage_size !== null) removeFile(a.id);
      db.prepare('DELETE FROM capture_inbox WHERE id=?').run(a.id);
      send(200, { deleted: true });
      return true;
    }
    if (['GET', 'HEAD'].includes(req.method)) {
      if (url.searchParams.get('preview') === '1')
        sendMedia(
          req,
          res,
          a,
          a.storage_size === null ? null : join(fileRoot, a.id),
        );
      else {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': a.storage_size ?? a.bytes.length,
          'Content-Disposition': `attachment; filename="capture"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        if (req.method === 'HEAD') res.end();
        else if (a.storage_size === null) res.end(Buffer.from(a.bytes));
        else {
          const stream = createReadStream(join(fileRoot, a.id));
          stream.on('error', () => res.destroy());
          res.on('close', () => stream.destroy());
          stream.pipe(res);
        }
      }
      return true;
    }
    return false;
  }
  const byteSize = () =>
    db
      .prepare(
        'SELECT COALESCE(SUM(COALESCE(storage_size,length(bytes))),0) AS size FROM capture_inbox',
      )
      .get().size;
  const exportFiles = () =>
    db
      .prepare('SELECT * FROM capture_inbox')
      .all()
      .map((a) => ({
        name: a.name,
        createdAt: a.created_at,
        sourceModified: a.source_modified,
        base64: (a.storage_size === null
          ? Buffer.from(a.bytes)
          : readFileSync(join(fileRoot, a.id))
        ).toString('base64'),
      }));
  function prepareImport(value = []) {
    if (!Array.isArray(value) || value.length > 10000)
      throw Error('Invalid inbox backup.');
    const files = value.map((a) => {
      if (
        !a ||
        typeof a.name !== 'string' ||
        a.name.length > 255 ||
        !a.name.trim() ||
        typeof a.base64 !== 'string' ||
        a.base64.length > 80_000_000
      )
        throw Error('Invalid inbox capture.');
      const bytes = Buffer.from(a.base64, 'base64');
      if (bytes.toString('base64') !== a.base64 || bytes.length > 60_000_000)
        throw Error('Invalid inbox encoding.');
      if (
        !a.createdAt ||
        !Number.isFinite(Date.parse(a.createdAt)) ||
        !a.sourceModified ||
        !Number.isFinite(Date.parse(a.sourceModified))
      )
        throw Error('Invalid capture date.');
      return {
        ...a,
        bytes,
        hash: createHash('sha256').update(bytes).digest('hex'),
      };
    });
    return () => {
      for (const a of files) {
        if (db.prepare('SELECT 1 FROM capture_hashes WHERE hash=?').get(a.hash))
          continue;
        db.prepare(
          'INSERT INTO capture_inbox(id,name,bytes,created_at,source_path,source_modified,hash) VALUES(?,?,?,?,?,?,?)',
        ).run(
          randomUUID(),
          safeName(a.name),
          a.bytes,
          a.createdAt,
          '',
          a.sourceModified,
          a.hash,
        );
        db.prepare('INSERT INTO capture_hashes(hash) VALUES(?)').run(a.hash);
      }
    };
  }
  function close() {
    stopped = true;
    clearInterval(timer);
    controller?.abort();
    if (configuring)
      return (async () => {
        while (configuring)
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (job) await job;
      })();
    return job;
  }
  return {
    handle,
    configure,
    scanNow,
    status,
    assign,
    close,
    byteSize,
    exportFiles,
    prepareImport,
  };
}

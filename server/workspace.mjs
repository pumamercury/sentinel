import { randomUUID } from 'node:crypto';
import { mediaInfo, readMediaHeader, sendMedia } from './media.mjs';
import {
  mkdirSync,
  createWriteStream,
  createReadStream,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  defaultFields,
  lockedFields,
  fieldApplies,
  statusCategory,
} from '../lib/field-schema.mjs';
const str = (v, max = 500) => {
  if (typeof v !== 'string' || v.length > max)
    throw Error('Invalid text value.');
  return v.trim();
};
export function validateFieldConfig(value) {
  if (!Array.isArray(value) || value.length > 60)
    throw Error('Use up to 60 fields.');
  value = upgradeFields(value);
  const keys = new Set();
  const clean = value.map((f) => {
    if (!f || typeof f.key !== 'string' || keys.has(f.key))
      throw Error('Invalid or duplicate field key.');
    keys.add(f.key);
    const base = defaultFields.find((b) => b.key === f.key);
    if (!base && !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(f.key))
      throw Error('Invalid custom field key.');
    if (
      !['text', 'textarea', 'number', 'date', 'select'].includes(f.type) ||
      typeof f.enabled !== 'boolean' ||
      typeof f.required !== 'boolean'
    )
      throw Error('Invalid field settings.');
    const label = str(f.label, 80);
    if (!label) throw Error('Field label is required.');
    if (!Array.isArray(f.options) || f.options.length > 100)
      throw Error('Invalid options.');
    const options = [
      ...new Set(
        f.options
          .map((o) => str(o, f.key === 'environment' ? 500 : 200))
          .filter(Boolean),
      ),
    ];
    if (
      f.type === 'select' &&
      !options.length &&
      (f.key !== 'environment' || f.required)
    )
      throw Error('Select fields need options.');
    if (base && base.type !== f.type)
      throw Error('Built-in field types cannot change.');
    if (lockedFields.includes(f.key) && (!f.enabled || !f.required))
      throw Error(
        'Title, project, status and priority must stay enabled and required.',
      );
    const issueTypes = f.issueTypes ?? base?.issueTypes ?? [];
    if (
      !Array.isArray(issueTypes) ||
      issueTypes.some((type) => typeof type !== 'string' || type.length > 200)
    )
      throw Error('Invalid issue type scope.');
    const categories = {};
    if (f.key === 'status')
      for (const option of options) {
        const category = f.categories?.[option] ?? statusCategory(option);
        if (!['open', 'in-progress', 'completed'].includes(category))
          throw Error('Invalid status category.');
        categories[option] = category;
      }
    return {
      key: f.key,
      label,
      type: f.type,
      enabled: f.enabled,
      required: f.required,
      options,
      builtin: !!base,
      issueTypes:
        lockedFields.includes(f.key) || f.key === 'issueType' ? [] : issueTypes,
      ...(f.key === 'status' ? { categories } : {}),
    };
  });
  if (defaultFields.some((f) => !keys.has(f.key)))
    throw Error('Hide built-in fields instead of removing them.');
  return clean;
}
function upgradeFields(fields) {
  return [
    ...fields.map((f) => ({
      ...f,
      ...(f.key === 'environment'
        ? {
            type: 'select',
            label:
              f.label === 'Environment / browser / device'
                ? 'Environment'
                : f.label,
          }
        : {}),
      issueTypes:
        f.issueTypes ??
        defaultFields.find((b) => b.key === f.key)?.issueTypes ??
        [],
    })),
    ...defaultFields.filter((base) => !fields.some((f) => f?.key === base.key)),
  ];
}
export function validateImage(image) {
  if (!image) return '';
  if (typeof image !== 'string' || image.length > 2_800_000)
    throw Error('Project image must be at most 2 MB.');
  const m = image.match(
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/,
  );
  if (!m) throw Error('Use a PNG, JPEG or WebP image.');
  const b = Buffer.from(m[2], 'base64');
  if (
    b.length > 2_000_000 ||
    !(
      (m[1] === 'png' &&
        b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') ||
      (m[1] === 'jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255) ||
      (m[1] === 'webp' &&
        b.subarray(0, 4).toString() === 'RIFF' &&
        b.subarray(8, 12).toString() === 'WEBP')
    )
  )
    throw Error('Invalid image file.');
  return image;
}
function projectData(p) {
  const name = str(p.name);
  if (!name) throw Error('Project name is required.');
  return {
    name,
    description: str(p.description ?? '', 10000),
    icon: str(p.icon ?? '', 16),
    image: validateImage(p.image ?? ''),
  };
}
function fileData(a, limit = 10_000_000) {
  if (
    !a ||
    typeof a.base64 !== 'string' ||
    a.base64.length > Math.ceil(limit / 3) * 4 ||
    a.base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(a.base64)
  )
    throw Error('Invalid attachment.');
  const bytes = Buffer.from(a.base64, 'base64');
  if (bytes.toString('base64') !== a.base64)
    throw Error('Invalid attachment encoding.');
  if (bytes.length > limit)
    throw Error('Attachment exceeds the import size limit.');
  const name = str(a.name, 255).replace(/[\x00-\x1f\x7f/\\]/g, '_');
  if (!name) throw Error('Attachment name is required.');
  return { name, bytes };
}
export function workspace(db, { list, get, save }, directory) {
  db.exec(`CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '',icon TEXT NOT NULL DEFAULT '',image TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_components(project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,name TEXT NOT NULL COLLATE NOCASE,PRIMARY KEY(project_id,name));
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,bug_id INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,name TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_attachments_bug ON attachments(bug_id);`);
  if (
    !db
      .prepare('PRAGMA table_info(attachments)')
      .all()
      .some((c) => c.name === 'storage_size')
  )
    db.exec('ALTER TABLE attachments ADD COLUMN storage_size INTEGER');
  const fileRoot = join(directory, 'attachments');
  mkdirSync(fileRoot, { recursive: true });
  const removeDiskFile = (id) => {
    try {
      unlinkSync(join(fileRoot, id));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  };
  const bugFileIds = (id) =>
    db
      .prepare(
        'SELECT id FROM attachments WHERE bug_id=? AND storage_size IS NOT NULL',
      )
      .all(id)
      .map((f) => f.id);
  async function upload(req, res, id, send) {
    if (!get(id)) return send(404, { error: 'Bug not found.' });
    if (files(id).length >= 20)
      return send(400, { error: 'An issue can have up to 20 attachments.' });
    const limit = 250_000_000;
    if (Number(req.headers['content-length']) > limit)
      return send(413, { error: 'Each attachment must be at most 250 MB.' });
    const name = str(
      decodeURIComponent(String(req.headers['x-file-name'] ?? '')),
      255,
    ).replace(/[\x00-\x1f\x7f/\\]/g, '_');
    if (!name) throw Error('Attachment name is required.');
    const key = randomUUID();
    let size = 0;
    try {
      const limiter = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length;
          callback(
            size > limit
              ? Error('Each attachment must be at most 250 MB.')
              : null,
            chunk,
          );
        },
      });
      await pipeline(
        req,
        limiter,
        createWriteStream(join(fileRoot, key), { flags: 'wx' }),
      );
      if (files(id).length >= 20)
        throw Error('An issue can have up to 20 attachments.');
      db.prepare(
        'INSERT INTO attachments(id,bug_id,name,bytes,created_at,storage_size) VALUES (?,?,?,?,?,?)',
      ).run(key, id, name, Buffer.alloc(0), new Date().toISOString(), size);
      send(
        201,
        files(id).find((f) => f.id === key),
      );
    } catch (e) {
      removeDiskFile(key);
      if (!res.destroyed) send(400, { error: e.message });
    }
  }
  const ensureProject = (name) => {
    db.prepare('INSERT OR IGNORE INTO projects(name) VALUES (?)').run(name);
    return db.prepare('SELECT name FROM projects WHERE name=?').get(name).name;
  };
  const ensureComponent = (project, value) => {
    const name = str(value ?? '');
    if (!name) return '';
    const id = db
      .prepare('SELECT id FROM projects WHERE name=?')
      .get(project).id;
    db.prepare(
      'INSERT OR IGNORE INTO project_components(project_id,name) VALUES (?,?)',
    ).run(id, name);
    return db
      .prepare(
        'SELECT name FROM project_components WHERE project_id=? AND name=?',
      )
      .get(id, name).name;
  };
  for (const bug of list()) {
    ensureProject(bug.project);
    ensureComponent(bug.project, bug.component);
  }
  const projects = () =>
    db
      .prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE')
      .all()
      .map((p) => ({
        ...p,
        components: db
          .prepare(
            'SELECT name FROM project_components WHERE project_id=? ORDER BY name COLLATE NOCASE',
          )
          .all(p.id)
          .map((c) => c.name),
      }));
  const config = () =>
    upgradeFields(
      JSON.parse(
        db.prepare("SELECT data FROM settings WHERE key='fields'").get()
          ?.data ?? JSON.stringify(defaultFields),
      ),
    );
  const setConfig = (fields) =>
    db
      .prepare(
        "INSERT INTO settings(key,data) VALUES ('fields',?) ON CONFLICT(key) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(fields));
  // Seed the new dropdown with existing reports so no saved environment is lost.
  const upgradedConfig = config();
  const environment = upgradedConfig.find((f) => f.key === 'environment');
  environment.options = [
    ...new Set([
      ...environment.options,
      ...list()
        .map((b) => b.environment)
        .filter(Boolean),
    ]),
  ];
  setConfig(upgradedConfig);
  const files = (id) =>
    db
      .prepare(
        'SELECT id,name,COALESCE(storage_size,length(bytes)) AS size,created_at AS createdAt,storage_size,substr(bytes,1,512) AS header FROM attachments WHERE bug_id=? ORDER BY created_at',
      )
      .all(id)
      .map(({ storage_size, header, ...file }) => {
        let media = null;
        try {
          media =
            storage_size === null
              ? mediaInfo(Buffer.from(header))
              : readMediaHeader(join(fileRoot, file.id));
        } catch {}
        return { ...file, previewType: media?.kind ?? null };
      });
  const addFile = (id, data, limit) => {
    const f = fileData(data, limit);
    if (files(id).length >= 20)
      throw Error('A bug can have up to 20 attachments.');
    const key = randomUUID();
    db.prepare(
      'INSERT INTO attachments(id,bug_id,name,bytes,created_at) VALUES (?,?,?,?,?)',
    ).run(key, id, f.name, f.bytes, new Date().toISOString());
    return key;
  };
  const exportBug = (b) => ({
    ...b,
    attachments: db
      .prepare(
        'SELECT id,name,bytes,storage_size FROM attachments WHERE bug_id=?',
      )
      .all(b.id)
      .map((f) => ({
        name: f.name,
        base64: (f.storage_size === null
          ? Buffer.from(f.bytes)
          : readFileSync(join(fileRoot, f.id))
        ).toString('base64'),
      })),
  });
  function validateValues(data) {
    for (const f of config().filter((f) => fieldApplies(f, data.issueType))) {
      const value = f.builtin
        ? data[f.key]
        : (data.customFields?.[f.key] ?? '');
      if (f.required && !value?.trim()) throw Error(`${f.label} is required.`);
      if (value && f.type === 'select' && !f.options.includes(value))
        throw Error(`Choose a valid ${f.label}.`);
      if (value && f.type === 'number' && !Number.isFinite(Number(value)))
        throw Error(`${f.label} must be a number.`);
      if (
        value &&
        f.type === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))
      )
        throw Error(`${f.label} must be a date.`);
    }
  }
  function prepareImport(body) {
    const incomingProjects = body.projects ?? [];
    if (!Array.isArray(incomingProjects) || incomingProjects.length > 10000)
      throw Error('Invalid projects.');
    const ps = incomingProjects.map((p) => {
      if (
        !Array.isArray(p.components ?? []) ||
        (p.components ?? []).length > 10000
      )
        throw Error('Invalid components.');
      return {
        ...projectData(p),
        components: (p.components ?? [])
          .map((name) => str(name))
          .filter(Boolean),
      };
    });
    const fs = body.fields ? validateFieldConfig(body.fields) : config();
    const importedEnvironment = fs.find((f) => f.key === 'environment');
    importedEnvironment.options = [
      ...new Set([
        ...importedEnvironment.options,
        ...body.bugs.map((b) => b.environment).filter(Boolean),
      ]),
    ];
    for (const b of body.bugs) {
      if (
        !Array.isArray(b.attachments ?? []) ||
        (b.attachments ?? []).length > 20
      )
        throw Error('Invalid attachments.');
      for (const a of b.attachments ?? []) fileData(a, 60_000_000);
    }
    if (fs)
      for (const f of fs.filter((f) => !f.builtin)) {
        const old = config().find((c) => c.key === f.key);
        if (old && JSON.stringify(old) !== JSON.stringify(f))
          throw Error(
            'A custom field conflicts with this workspace. Import into an empty workspace.',
          );
      }
    return () => {
      for (const p of ps) {
        db.prepare(
          'INSERT OR IGNORE INTO projects(name,description,icon,image) VALUES (?,?,?,?)',
        ).run(p.name, p.description, p.icon, p.image);
        for (const name of p.components) ensureComponent(p.name, name);
      }
      if (fs)
        setConfig(
          list().length === 0
            ? fs
            : [
                ...config().map((current) => {
                  const incoming = fs.find((f) => f.key === current.key);
                  return current.builtin &&
                    current.type === 'select' &&
                    incoming
                    ? {
                        ...current,
                        options: [
                          ...new Set([...current.options, ...incoming.options]),
                        ],
                        ...(current.key === 'status'
                          ? {
                              categories: {
                                ...incoming.categories,
                                ...current.categories,
                              },
                            }
                          : {}),
                      }
                    : current;
                }),
                ...fs.filter((f) => !config().some((c) => c.key === f.key)),
              ],
        );
    };
  }
  function handle(req, res, url, body, send) {
    const path = url.pathname,
      method = req.method;
    if (path === '/api/projects' && method === 'GET') {
      send(200, projects());
      return true;
    }
    if (path === '/api/fields' && method === 'GET') {
      send(200, config());
      return true;
    }
    if (path === '/api/fields' && method === 'PUT') {
      const clean = validateFieldConfig(body);
      const old = config();
      for (const field of clean.filter((f) => f.type === 'select')) {
        const used = list()
          .map((b) =>
            field.builtin ? b[field.key] : b.customFields?.[field.key],
          )
          .filter(Boolean);
        const missing = used.find((value) => !field.options.includes(value));
        if (missing)
          throw Error(
            `${field.label}: "${missing}" is used by existing bugs. Change those bugs to another option before removing it.`,
          );
      }
      if (old.some((f) => !clean.some((c) => c.key === f.key)))
        throw Error(
          'Hide fields instead of removing them, so saved values are preserved.',
        );
      for (const f of old.filter((f) => !f.builtin)) {
        const next = clean.find((c) => c.key === f.key);
        if (next.type !== f.type)
          throw Error(
            'Existing field types cannot change. Add a new field instead.',
          );
      }
      setConfig(clean);
      send(200, clean);
      return true;
    }
    const pm = path.match(/^\/api\/projects\/(\d+)$/);
    if (
      (path === '/api/projects' && method === 'POST') ||
      (pm && method === 'PUT')
    ) {
      const p = projectData(body);
      const old = pm
        ? db.prepare('SELECT * FROM projects WHERE id=?').get(Number(pm[1]))
        : null;
      if (pm && !old) {
        send(404, { error: 'Project not found.' });
        return true;
      }
      const duplicate = db
        .prepare('SELECT id FROM projects WHERE name=?')
        .get(p.name);
      if (duplicate && duplicate.id !== old?.id)
        throw Error('A project with that name already exists.');
      db.exec('BEGIN IMMEDIATE');
      try {
        let id;
        if (old) {
          id = old.id;
          db.prepare(
            'UPDATE projects SET name=?,description=?,icon=?,image=? WHERE id=?',
          ).run(p.name, p.description, p.icon, p.image, id);
          for (const b of list().filter(
            (b) => b.project.toLowerCase() === old.name.toLowerCase(),
          )) {
            b.project = p.name;
            if (old.name !== p.name) {
              b.updatedAt = new Date().toISOString();
              b.history.push({
                at: b.updatedAt,
                text: `Project renamed to ${p.name}`,
              });
              save(b);
            }
          }
        } else
          id = Number(
            db
              .prepare(
                'INSERT INTO projects(name,description,icon,image) VALUES (?,?,?,?)',
              )
              .run(p.name, p.description, p.icon, p.image).lastInsertRowid,
          );
        db.exec('COMMIT');
        send(
          200,
          projects().find((p) => p.id === id),
        );
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return true;
    }
    const am = path.match(
      /^\/api\/bugs\/(\d+)\/attachments(?:\/([a-zA-Z0-9-]+))?$/,
    );
    if (am) {
      const id = Number(am[1]);
      if (!get(id)) {
        send(404, { error: 'Bug not found.' });
        return true;
      }
      if (method === 'GET' && !am[2]) {
        send(200, files(id));
        return true;
      }
      if (method === 'POST' && !am[2]) {
        const key = addFile(id, body);
        send(
          201,
          files(id).find((f) => f.id === key),
        );
        return true;
      }
      const a = am[2]
        ? db
            .prepare('SELECT * FROM attachments WHERE bug_id=? AND id=?')
            .get(id, am[2])
        : null;
      if (!a) {
        send(404, { error: 'Attachment not found.' });
        return true;
      }
      if (
        (method === 'GET' || method === 'HEAD') &&
        url.searchParams.get('preview') === '1'
      ) {
        sendMedia(
          req,
          res,
          a,
          a.storage_size === null ? null : join(fileRoot, a.id),
        );
        return true;
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM attachments WHERE id=?').run(a.id);
        if (a.storage_size !== null) removeDiskFile(a.id);
        send(200, { deleted: true });
        return true;
      }
      if (method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': a.storage_size ?? a.bytes.length,
          'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        });
        if (a.storage_size !== null) {
          const stream = createReadStream(join(fileRoot, a.id));
          stream.on('error', () => res.destroy());
          stream.pipe(res);
        } else res.end(Buffer.from(a.bytes));
        return true;
      }
    }
    return false;
  }
  return {
    upload,
    bugFileIds,
    removeDiskFile,
    handle,
    projects,
    config,
    ensureProject,
    ensureComponent,
    exportBug,
    addFile,
    prepareImport,
    validateValues,
  };
}

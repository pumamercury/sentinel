import { defaultFields, fieldApplies } from '../lib/field-schema.mjs';
import { workspace } from './workspace.mjs';
import { captureInbox } from './capture-inbox.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
export const statuses = [
  'Open',
  'In progress',
  'In review',
  'Resolved',
  'Closed',
];
export const priorities = ['Low', 'Medium', 'High', 'Critical'];
const fields = [
  'title',
  'project',
  'description',
  'steps',
  'expected',
  'actual',
  'environment',
  'assignee',
  'labels',
  'version',
  'dueDate',
  'status',
  'priority',
  'severity',
];
function validate(input, definitions = defaultFields) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid bug report.');
  const out = {};
  out.issueType = input.issueType ?? 'Bug';
  if (typeof out.issueType !== 'string' || out.issueType.length > 500)
    throw Error('Invalid issue type.');
  out.issueType = out.issueType.trim();
  const typeOptions = definitions.find((f) => f.key === 'issueType')
    ?.options ?? ['Bug', 'Idea', 'Task', 'Feature request'];
  if (out.issueType && !typeOptions.includes(out.issueType))
    throw Error('Invalid issue type.');
  for (const key of fields) {
    if (
      typeof input[key] !== 'string' ||
      input[key].length >
        (['description', 'steps', 'expected', 'actual'].includes(key)
          ? 20000
          : 500)
    )
      throw Error(`Invalid ${key}.`);
    out[key] = input[key].trim();
  }
  for (const key of ['reproRate', 'component', 'reporter', 'fixVersion']) {
    out[key] = input[key] === undefined ? '' : input[key];
    if (typeof out[key] !== 'string' || out[key].length > 500)
      throw Error('Invalid ' + key);
    out[key] = out[key].trim();
  }
  if (out.status === 'Resolved' && !out.fixVersion)
    throw Error('Fix Version is required to resolve an issue.');
  for (const key of ['solution', 'acceptance']) {
    if (
      input[key] !== undefined &&
      (typeof input[key] !== 'string' || input[key].length > 20000)
    )
      throw Error('Invalid ' + key);
    out[key] = (input[key] ?? '').trim();
  }
  out.customFields = {};
  if (input.customFields !== undefined) {
    if (
      !input.customFields ||
      typeof input.customFields !== 'object' ||
      Array.isArray(input.customFields) ||
      Object.keys(input.customFields).length > 60
    )
      throw Error('Invalid custom fields.');
    for (const [key, value] of Object.entries(input.customFields)) {
      if (
        !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(key) ||
        typeof value !== 'string' ||
        value.length > 20000
      )
        throw Error('Invalid custom field value.');
      out.customFields[key] = value.trim();
    }
  }
  if (!out.title || !out.project)
    throw Error('Title and project are required.');
  for (const key of ['status', 'priority', 'severity']) {
    const options = definitions.find((f) => f.key === key)?.options ?? [];
    if (out[key] && !options.includes(out[key]))
      throw Error('Invalid ' + key + '.');
  }
  if (out.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(out.dueDate))
    throw Error('Invalid due date.');
  return out;
}
export function createApi(path = resolve('data/bugbook.sqlite'), options = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS bugs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);',
  );
  const list = () =>
    db
      .prepare('SELECT id,data FROM bugs ORDER BY id DESC')
      .all()
      .map((row) => ({
        reproRate: '',
        issueType: 'Bug',
        component: '',
        reporter: '',
        fixVersion: '',
        customFields: {},
        ...JSON.parse(row.data),
        id: row.id,
      }));
  const get = (id) => {
    const row = db.prepare('SELECT data FROM bugs WHERE id=?').get(id);
    return row
      ? {
          reproRate: '',
          issueType: 'Bug',
          component: '',
          reporter: '',
          fixVersion: '',
          customFields: {},
          ...JSON.parse(row.data),
          id,
        }
      : null;
  };
  const save = (bug) =>
    db
      .prepare('UPDATE bugs SET data=? WHERE id=?')
      .run(JSON.stringify(bug), bug.id);
  const insert = (bug) =>
    Number(
      db
        .prepare(`INSERT INTO bugs(id,data)
        SELECT MIN(candidate), ? FROM (
          SELECT 1 AS candidate UNION ALL SELECT id + 1 FROM bugs
        ) WHERE NOT EXISTS (SELECT 1 FROM bugs WHERE id = candidate)`)
        .run(JSON.stringify(bug)).lastInsertRowid,
    );
  const ws = workspace(db, { list, get, save }, dirname(path));
  const inbox = captureInbox(db, { get, save }, dirname(path), options.capture);
  db.exec(`CREATE TABLE IF NOT EXISTS issue_links (
    source INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    target INTEGER NOT NULL REFERENCES bugs(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('relates to','blocks','duplicates')),
    PRIMARY KEY(source,target,type), CHECK(source != target));
    CREATE INDEX IF NOT EXISTS issue_links_target ON issue_links(target);`);
  const allLinks = () =>
    db.prepare('SELECT source,target,type FROM issue_links').all();
  const recordChange = (bug, text) => {
    bug.updatedAt = new Date().toISOString();
    bug.history.push({ at: bug.updatedAt, text });
    save(bug);
  };
  async function handler(req, res, next) {
    if (!req.url?.startsWith('/api/')) return next();
    const send = (code, data) => {
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    const host = req.headers.host;
    if (
      !host ||
      !['127.0.0.1', 'localhost', '[::1]'].some(
        (h) => host === h || host.startsWith(h + ':'),
      )
    )
      return send(403, { error: 'Local access only.' });
    if (req.headers.origin && req.headers.origin !== `http://${host}`)
      return send(403, { error: 'Origin rejected.' });
    const url = new URL(req.url, `http://${host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/bugs')
        return send(200, list());
      if (req.method === 'GET' && url.pathname === '/api/backup') {
        const size = db
          .prepare(
            'SELECT COALESCE(SUM(COALESCE(storage_size,length(bytes))),0) AS size FROM attachments',
          )
          .get().size;
        if (size + inbox.byteSize() > 60_000_000)
          return send(413, {
            error:
              'Attachments exceed the JSON backup limit. Close Sentinel and copy the entire data folder (database and attachments) for a complete backup.',
          });
        return send(200, {
          schemaVersion: 2,
          exportedAt: new Date().toISOString(),
          bugs: list().map(ws.exportBug),
          projects: ws.projects(),
          fields: ws.config(),
          links: allLinks(),
          inbox: inbox.exportFiles(),
        });
      }
      const rawUpload = url.pathname.match(/^\/api\/bugs\/(\d+)\/attachments$/);
      if (
        rawUpload &&
        req.method === 'POST' &&
        req.headers['content-type'] === 'application/octet-stream'
      )
        return await ws.upload(req, res, Number(rawUpload[1]), send);
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return send(415, { error: 'JSON required.' });
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          chunks.push(chunk);
          total += chunk.length;
          if (
            total > (url.pathname === '/api/import' ? 100_000_000 : 15_000_000)
          )
            return send(413, { error: 'Request exceeds the size limit.' });
        }
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'Invalid JSON.' });
        }
      }
      if (await inbox.handle(req, res, url, body, send)) return;
      if (ws.handle(req, res, url, body, send)) return;
      const quick = url.pathname.match(/^\/api\/bugs\/(\d+)\/quick$/);
      if (quick && req.method === 'POST') {
        const bug = get(Number(quick[1]));
        if (!bug) return send(404, { error: 'Issue not found.' });
        const keys = Object.keys(body);
        if (
          !keys.length ||
          keys.some((key) => !['status', 'priority'].includes(key))
        )
          throw Error('Only status and priority can be changed here.');
        for (const key of keys) {
          if (
            !ws
              .config()
              .find((f) => f.key === key)
              ?.options.includes(body[key])
          )
            throw Error('Invalid ' + key);
        }
        if (
          (body.status ?? bug.status) === 'Resolved' &&
          !bug.fixVersion?.trim()
        )
          throw Error('Fix Version is required to resolve an issue.');
        const changes = keys.filter((key) => bug[key] !== body[key]);
        const text = changes
          .map((key) => `${key}: ${bug[key]} → ${body[key]}`)
          .join('; ');
        Object.assign(bug, body);
        if (changes.length) recordChange(bug, text);
        return send(200, bug);
      }
      const linked = url.pathname.match(/^\/api\/bugs\/(\d+)\/links$/);
      if (linked) {
        const id = Number(linked[1]);
        const bug = get(id);
        if (!bug) return send(404, { error: 'Issue not found.' });
        if (req.method === 'GET')
          return send(
            200,
            allLinks()
              .filter((l) => l.source === id || l.target === id)
              .map((l) => ({
                ...l,
                label:
                  l.source === id
                    ? l.type
                    : {
                        blocks: 'is blocked by',
                        duplicates: 'is duplicated by',
                        'relates to': 'relates to',
                      }[l.type],
                issue: get(l.source === id ? l.target : l.source),
              })),
          );
        if (req.method === 'POST') {
          let { source = id, target, type, remove = false } = body;
          if (
            !Number.isSafeInteger(source) ||
            !Number.isSafeInteger(target) ||
            source === target ||
            (source !== id && target !== id) ||
            !['blocks', 'duplicates', 'relates to'].includes(type)
          )
            throw Error('Invalid issue relationship.');
          if (!get(source) || !get(target))
            throw Error('Linked issue no longer exists.');
          if (type === 'relates to' && source > target)
            [source, target] = [target, source];
          db.exec('BEGIN');
          try {
            const result = remove
              ? db
                  .prepare(
                    'DELETE FROM issue_links WHERE source=? AND target=? AND type=?',
                  )
                  .run(source, target, type)
              : db
                  .prepare(
                    'INSERT OR IGNORE INTO issue_links(source,target,type) VALUES(?,?,?)',
                  )
                  .run(source, target, type);
            if (result.changes) {
              recordChange(
                get(source),
                `${remove ? 'Removed link' : 'Linked'}: ${type} issue ${target}`,
              );
              recordChange(
                get(target),
                `${remove ? 'Removed link' : 'Linked'}: issue ${source} ${type} this issue`,
              );
            }
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
          return send(200, { saved: true });
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/bugs') {
        const data = validate(body, ws.config());
        ws.validateValues(data);
        data.project = ws.ensureProject(data.project);
        data.component = ws.ensureComponent(data.project, data.component);
        const now = new Date().toISOString();
        const bug = {
          ...data,
          createdAt: now,
          updatedAt: now,
          comments: [],
          history: [{ at: now, text: 'Issue created' }],
        };
        return send(201, { ...bug, id: insert(bug) });
      }
      if (req.method === 'POST' && url.pathname === '/api/import') {
        if (
          ![1, 2].includes(body.schemaVersion) ||
          !Array.isArray(body.bugs) ||
          body.bugs.length > 10000
        )
          throw Error('Unsupported backup.');
        const importWorkspace = ws.prepareImport(body);
        const importInbox = inbox.prepareImport(body.inbox);
        if (
          body.links?.length &&
          new Set(body.bugs.map((b) => b.id)).size !== body.bugs.length
        )
          throw Error(
            'Backup issue IDs must be unique when links are present.',
          );
        const incoming = body.bugs.map((b) => {
          const clean = validate(b, body.fields ?? defaultFields);
          if (!Array.isArray(b.comments) || !Array.isArray(b.history))
            throw Error('Invalid backup history.');
          const date = (v) =>
            typeof v === 'string' && !Number.isNaN(Date.parse(v));
          if (
            !date(b.createdAt) ||
            !date(b.updatedAt) ||
            b.comments.some(
              (c) =>
                !c ||
                typeof c.text !== 'string' ||
                c.text.length > 20000 ||
                !date(c.at),
            ) ||
            b.history.some(
              (h) =>
                !h ||
                typeof h.text !== 'string' ||
                h.text.length > 20000 ||
                !date(h.at),
            )
          )
            throw Error('Invalid backup details.');
          return {
            ...clean,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
            comments: b.comments.map((c) => ({ text: c.text, at: c.at })),
            history: b.history.map((h) => ({ text: h.text, at: h.at })),
          };
        });
        db.exec('BEGIN');
        try {
          importWorkspace();
          importInbox();
          const idMap = new Map();
          for (const [index, bug] of incoming.entries()) {
            bug.project = ws.ensureProject(bug.project);
            bug.component = ws.ensureComponent(bug.project, bug.component);
            const id = insert(bug);
            idMap.set(body.bugs[index].id, id);
            for (const file of body.bugs[index].attachments ?? [])
              ws.addFile(id, file, 60_000_000);
          }
          if (
            body.links !== undefined &&
            (!Array.isArray(body.links) || body.links.length > 100000)
          )
            throw Error('Invalid backup links.');
          for (const link of body.links ?? []) {
            const source = idMap.get(link?.source),
              target = idMap.get(link?.target);
            if (
              !source ||
              !target ||
              source === target ||
              !['blocks', 'duplicates', 'relates to'].includes(link.type)
            )
              throw Error('Invalid backup links.');
            db.prepare(
              'INSERT OR IGNORE INTO issue_links(source,target,type) VALUES(?,?,?)',
            ).run(source, target, link.type);
          }
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        return send(200, { imported: incoming.length });
      }
      const match = url.pathname.match(/^\/api\/bugs\/(\d+)(\/comments)?$/);
      if (match) {
        const bug = get(Number(match[1]));
        if (!bug) return send(404, { error: 'Bug not found.' });
        if (req.method === 'DELETE' && !match[2]) {
          const fileIds = ws.bugFileIds(bug.id);
          db.prepare('DELETE FROM bugs WHERE id=?').run(bug.id);
          for (const id of fileIds) ws.removeDiskFile(id);
          return send(200, { deleted: true });
        }
        const now = new Date().toISOString();
        if (['PUT', 'PATCH'].includes(req.method) && !match[2]) {
          let input = body;
          if (req.method === 'PATCH') {
            const field = ws.config().find((f) => f.key === body.field);
            if (
              !field ||
              !fieldApplies(field, bug.issueType) ||
              !['text', 'textarea', 'number', 'date', 'select'].includes(
                field.type,
              )
            )
              throw Error('This field cannot be edited.');
            const current = field.builtin
              ? (bug[field.key] ?? '')
              : (bug.customFields?.[field.key] ?? '');
            if (body.previous !== current)
              return send(409, {
                error:
                  'This field changed since you opened it. Cancel and try again to use the latest value.',
              });
            input = field.builtin
              ? { ...bug, [field.key]: body.value }
              : {
                  ...bug,
                  customFields: {
                    ...bug.customFields,
                    [field.key]: body.value,
                  },
                };
          }
          const data = validate(input, ws.config());
          ws.validateValues(data);
          data.project = ws.ensureProject(data.project);
          data.component = ws.ensureComponent(data.project, data.component);
          const changes = [
            ...fields,
            'reproRate',
            'issueType',
            'component',
            'reporter',
            'fixVersion',
            'customFields',
            'solution',
            'acceptance',
          ].filter((f) => JSON.stringify(data[f]) !== JSON.stringify(bug[f]));
          const updated = {
            ...bug,
            ...data,
            updatedAt: now,
            history: changes.length
              ? [
                  ...bug.history,
                  ...changes.flatMap((key) => {
                    const value = (v) => {
                      const text = JSON.stringify(v ?? '');
                      return text.length > 8000
                        ? text.slice(0, 8000) + '… [truncated]'
                        : text;
                    };
                    if (key === 'customFields')
                      return [
                        ...new Set([
                          ...Object.keys(bug.customFields ?? {}),
                          ...Object.keys(data.customFields),
                        ]),
                      ]
                        .filter(
                          (field) =>
                            bug.customFields?.[field] !==
                            data.customFields[field],
                        )
                        .map((field) => ({
                          at: now,
                          text: `${ws.config().find((f) => f.key === field)?.label ?? field}: ${value(bug.customFields?.[field])} → ${value(data.customFields[field])}`,
                        }));
                    return [
                      {
                        at: now,
                        text: `${ws.config().find((f) => f.key === key)?.label ?? key}: ${value(bug[key])} → ${value(data[key])}`,
                      },
                    ];
                  }),
                ]
              : bug.history,
          };
          save(updated);
          return send(200, updated);
        }
        if (req.method === 'POST' && match[2]) {
          if (
            typeof body.text !== 'string' ||
            !body.text.trim() ||
            body.text.length > 20000
          )
            throw Error('Enter a comment (up to 20,000 characters).');
          bug.comments.push({ text: body.text.trim(), at: now });
          bug.updatedAt = now;
          save(bug);
          return send(200, bug);
        }
      }
      return send(404, { error: 'Not found.' });
    } catch (e) {
      return send(400, { error: e.message || 'Unable to save.' });
    }
  }
  return {
    handler,
    inbox,
    close: () => {
      const pending = inbox.close();
      if (pending) return pending.finally(() => db.close());
      db.close();
    },
  };
}

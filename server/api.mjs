import { validateReport as validate, reportFields as fields } from '../lib/report-validation.mjs';
import { projectCsv } from './project-export.mjs';
import { issueNumbering } from './issue-numbering.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultFields, fieldApplies } from '../lib/field-schema.mjs';
import { workspace } from './workspace.mjs';
import { captureInbox } from './capture-inbox.mjs';
import { authentication } from './auth.mjs';
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
export function createApi(
  path = resolve(process.env.SENTINEL_DATA_DIR || 'data', 'bugbook.sqlite'),
  options = {},
) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  const auth = authentication(db, options.auth);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS bugs (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL);',
  );
  let assignNumber;
  const activity = new AsyncLocalStorage();
  const list = (includeTrash = false) =>
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
      }))
      .filter((bug) => includeTrash || !bug.deletedAt);
  const get = (id, includeTrash = false) => {
    const row = db.prepare('SELECT data FROM bugs WHERE id=?').get(id);
    return row && (includeTrash || !JSON.parse(row.data).deletedAt)
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
  const stamp = (bug, previous) => {
    const actor = activity.getStore()?.actor;
    if (!actor) return;
    for (const key of ['history', 'comments']) {
      for (const entry of (bug[key] ?? []).slice(previous?.[key]?.length ?? 0))
        entry.actor = actor;
    }
  };
  const save = (bug) => {
    assignNumber?.(bug);
    stamp(bug, get(bug.id, true));
    db.prepare('UPDATE bugs SET data=? WHERE id=?').run(
      JSON.stringify(bug),
      bug.id,
    );
  };
  const members = () =>
    db.prepare('SELECT id,email,disabled FROM auth_users ORDER BY email').all();
  const validatePeople = (data, previous) => {
    if (!activity.getStore()?.actor?.id) return;
    for (const key of ['assignee', 'reporter']) {
      if (!data[key] || data[key] === previous?.[key]) continue;
      const member = members().find(
        (m) => !m.disabled && m.email === data[key].trim().toLowerCase(),
      );
      if (!member) throw Error(`Choose an invited account for ${key}.`);
      data[key] = member.email;
    }
  };
  const insert = (bug) => {
    assignNumber?.(bug);
    return Number(
      db
        .prepare(`INSERT INTO bugs(id,data)
        SELECT MIN(candidate), ? FROM (
          SELECT 1 AS candidate UNION ALL SELECT id + 1 FROM bugs
        ) WHERE NOT EXISTS (SELECT 1 FROM bugs WHERE id = candidate)`)
        .run(JSON.stringify(bug)).lastInsertRowid,
    );
  };
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_creation_token
    ON bugs(json_extract(data, '$.creationToken'), COALESCE(json_extract(data, '$.creationAccountId'), 0))
    WHERE json_extract(data, '$.creationToken') IS NOT NULL`);
  const ws = workspace(
    db,
    { list: () => list(true), get, save },
    dirname(path),
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    assignNumber = issueNumbering(db);
    for (const bug of list(true).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
    )) {
      const before = JSON.stringify(bug);
      assignNumber(bug);
      if (JSON.stringify(bug) !== before) save(bug);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
  const handler = (req, res, next) =>
    activity.run({}, () => handleRequest(req, res, next));
  async function handleRequest(req, res, next) {
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
      (!auth.origin &&
        !['127.0.0.1', 'localhost', '[::1]'].some(
          (h) => host === h || host.startsWith(h + ':'),
        ))
    )
      return send(403, { error: 'Local access only.' });
    if (
      req.headers.origin &&
      req.headers.origin !== (auth.origin || `http://${host}`)
    )
      return send(403, { error: 'Origin rejected.' });
    const url = new URL(req.url, `http://${host}`);
    try {
      if (await auth.guard(req, res, url, send)) return;
      activity.getStore().actor = req.sentinelAccountId
        ? db
            .prepare('SELECT id,email FROM auth_users WHERE id=?')
            .get(req.sentinelAccountId)
        : { email: 'Local workspace' };
      if (req.method === 'GET' && url.pathname === '/api/members')
        return send(200, members());
      if (req.method === 'GET' && url.pathname === '/api/trash')
        return send(
          200,
          list(true).filter((b) => b.deletedAt),
        );
      if (req.method === 'GET' && url.pathname === '/api/bugs')
        return send(200, list());
      const projectExport = url.pathname.match(
        /^\/api\/projects\/(\d+)\/export$/,
      );
      if (req.method === 'GET' && projectExport) {
        const project = ws
          .projects()
          .find((p) => p.id === Number(projectExport[1]));
        if (!project) return send(404, { error: 'Project not found.' });
        const basis = url.searchParams.get('basis') || 'createdAt';
        if (!['createdAt', 'updatedAt'].includes(basis))
          throw Error('Choose created or updated date.');
        const from = url.searchParams.get('from'),
          to = url.searchParams.get('to');
        const lower = from ? Date.parse(from) : -Infinity,
          upper = to ? Date.parse(to) : Infinity;
        if (Number.isNaN(lower) || Number.isNaN(upper) || lower >= upper)
          throw Error('Choose a valid date range.');
        const type = url.searchParams.get('type');
        const reports = list()
          .filter(
            (b) =>
              b.project.toLowerCase() === project.name.toLowerCase() &&
              (!type || b.issueType === type) &&
              Date.parse(b[basis]) >= lower &&
              Date.parse(b[basis]) < upper,
          )
          .sort(
            (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
          );
        const csv = projectCsv(reports, ws.config(), (id) =>
          db
            .prepare(
              'SELECT name FROM attachments WHERE bug_id=? ORDER BY created_at,id',
            )
            .all(id),
        );
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Disposition':
            'attachment; filename="sentinel-project-' + project.id + '.csv"',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(csv);
        return;
      }
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
          bugs: list(true).map(ws.exportBug),
          projects: ws.projects(),
          fields: ws.config(),
          links: allLinks(),
          inbox: inbox.exportFiles(),
        });
      }
      const restoreMatch = url.pathname.match(/^\/api\/trash\/(\d+)\/restore$/);
      if (restoreMatch && req.method === 'POST') {
        const bug = get(Number(restoreMatch[1]), true);
        if (!bug?.deletedAt)
          return send(404, { error: 'This issue is no longer in Trash.' });
        delete bug.deletedAt;
        delete bug.deletedBy;
        recordChange(bug, 'Restored from Trash');
        return send(200, bug);
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
      if (await ws.handle(req, res, url, body, send)) return;
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
              .filter(
                (l) =>
                  (l.source === id || l.target === id) &&
                  get(l.source) &&
                  get(l.target),
              )
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
        let creationToken;
        if (body.creationToken !== undefined) {
          if (
            body.quickReport !== true ||
            typeof body.creationToken !== 'string' ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              body.creationToken,
            )
          )
            throw Error('Invalid report creation token.');
          creationToken = body.creationToken.toLowerCase();
        }
        const creationAccountId = req.sentinelAccountId ?? null;
        // Persist the token with the issue, and serialize lookup/create so a
        // retry after a lost response can never create a second live issue.
        db.exec('BEGIN IMMEDIATE');
        try {
          const existing =
            creationToken &&
            db
              .prepare(
                `SELECT id FROM bugs WHERE json_extract(data, '$.creationToken')=?
             AND COALESCE(json_extract(data, '$.creationAccountId'), 0)=?`,
              )
              .get(creationToken, creationAccountId ?? 0);
          if (existing) {
            const bug = get(existing.id);
            if (!bug)
              throw Error(
                'This report is in Trash. Restore it before continuing.',
              );
            db.exec('COMMIT');
            return send(200, { ...bug, creationReplayed: true });
          }
          const data = validate(
            {
              ...body,
              reporter:
                body.reporter ||
                (req.sentinelAccountId ? activity.getStore().actor?.email : ''),
            },
            ws.config(),
          );
          validatePeople(data);
          ws.validateValues(data);
          data.project = ws.ensureProject(data.project);
          data.component = ws.ensureComponent(data.project, data.component);
          data.version = ws.ensureVersion(data.project, data.version);
          const now = new Date().toISOString();
          const bug = {
            ...data,
            ...(creationToken ? { creationToken, creationAccountId } : {}),
            createdAt: now,
            updatedAt: now,
            comments: [],
            history: [{ at: now, text: 'Issue created' }],
          };
          stamp(bug);
          const id = insert(bug);
          db.exec('COMMIT');
          return send(201, { ...bug, id });
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      }
      if (req.method === 'POST' && url.pathname === '/api/people/link') {
        const actor = activity.getStore().actor;
        const account =
          actor.id &&
          db.prepare('SELECT role FROM auth_users WHERE id=?').get(actor.id);
        if (account?.role !== 'owner')
          return send(403, { error: 'Owner access required.' });
        const member = members().find(
          (m) => !m.disabled && m.email === body.email,
        );
        if (
          !member ||
          typeof body.legacy !== 'string' ||
          !body.legacy.trim() ||
          members().some((m) => m.email === body.legacy)
        )
          throw Error('Choose an older name and an active account.');
        let updated = 0;
        db.exec('BEGIN');
        try {
          for (const bug of list(true)) {
            const keys = ['assignee', 'reporter'].filter(
              (key) => bug[key] === body.legacy,
            );
            if (!keys.length) continue;
            for (const key of keys) bug[key] = member.email;
            recordChange(
              bug,
              `Linked ${keys.join(' and ')}: ${body.legacy} → ${member.email}`,
            );
            updated++;
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return send(200, { updated });
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
        const incoming = importWorkspace.bugs.map((b) => {
          const clean = validate(b, importWorkspace.fields);
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
            ...(typeof b.deletedAt === 'string' && date(b.deletedAt)
              ? {
                  deletedAt: b.deletedAt,
                  ...(typeof b.deletedBy?.email === 'string'
                    ? { deletedBy: { email: b.deletedBy.email.slice(0, 500) } }
                    : {}),
                }
              : {}),
            comments: b.comments.map((c) => ({
              text: c.text,
              at: c.at,
              ...(typeof c.actor?.email === 'string'
                ? { actor: { email: c.actor.email.slice(0, 500) } }
                : {}),
            })),
            history: b.history.map((h) => ({
              text: h.text,
              at: h.at,
              ...(typeof h.actor?.email === 'string'
                ? { actor: { email: h.actor.email.slice(0, 500) } }
                : {}),
            })),
          };
        });
        db.exec('BEGIN');
        try {
          importWorkspace.apply();
          importInbox();
          const idMap = new Map();
          for (const [index, bug] of incoming.entries()) {
            bug.project = ws.ensureProject(bug.project);
            bug.component = ws.ensureComponent(bug.project, bug.component);
            bug.version = ws.ensureVersion(bug.project, bug.version);
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
          bug.deletedAt = new Date().toISOString();
          bug.deletedBy = activity.getStore().actor;
          recordChange(bug, 'Moved to Trash');
          return send(200, { deleted: true });
        }
        const now = new Date().toISOString();
        if (['PUT', 'PATCH'].includes(req.method) && !match[2]) {
          if (
            req.method === 'PUT' &&
            body.expectedCreatedAt !== undefined &&
            body.expectedCreatedAt !== bug.createdAt
          )
            return send(409, {
              error:
                'The original issue is no longer available. This issue number now belongs to another report.',
            });
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
          // Reporting mode belongs to the saved issue; editing cannot bypass the
          // required fields of a full report by adding a quickReport flag.
          const data = validate(
            { ...input, quickReport: bug.quickReport === true },
            ws.config(),
          );
          validatePeople(data, bug);
          ws.validateValues(data);
          data.project = ws.ensureProject(data.project);
          data.component = ws.ensureComponent(data.project, data.component);
          data.version = ws.ensureVersion(data.project, data.version);
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

import {
  defaultFields,
  fieldApplies,
  lockedFields,
} from '../lib/field-schema.mjs';
import { validateReport } from '../lib/report-validation.mjs';
import {
  validateFieldConfig,
  projectData,
} from '../lib/workspace-validation.mjs';
import { projectCsv } from '../server/project-export.mjs';
export class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const reject = (message, status = 400) => {
  throw new HttpError(message, status);
};
const text = (value, max = 20000) =>
  typeof value === 'string' && value.length <= max
    ? value.trim()
    : reject('Invalid text.');
const ownerOnly = (actor) => {
  if (actor.role !== 'owner') reject('Owner access required.', 403);
};
export function emptyWorkspace() {
  return {
    bugs: [],
    projects: [],
    fields: structuredClone(defaultFields),
    links: [],
    files: [],
    sequences: {},
    captureHashes: [],
    nextIssueId: 1,
    nextProjectId: 1,
  };
}
export function workspaceFromExport(manifest) {
  const state = emptyWorkspace();
  state.bugs = manifest.bugs;
  state.fields = manifest.fields || state.fields;
  state.projects = manifest.projects.map((p) => ({
    ...p,
    prefix: manifest.projectKeys.find((k) => k.project_id === p.id)?.prefix,
    components: manifest.components
      .filter((c) => c.project_id === p.id)
      .map((c) => c.name),
    versions: manifest.versions
      .filter((c) => c.project_id === p.id)
      .map((c) => c.name),
  }));
  state.files = manifest.files.map((f) => ({
    ...f,
    path: f.id,
    previewType: f.previewType ?? null,
  }));
  state.links = manifest.links;
  state.captureHashes = [
    ...new Set([
      ...(manifest.capturesSeen || []),
      ...manifest.files.map((f) => f.captureHash).filter(Boolean),
    ]),
  ];
  state.sequences = Object.fromEntries(
    manifest.issueSequences.map((s) => [
      `${s.project_id}:${s.type}`,
      s.last_number,
    ]),
  );
  state.nextIssueId = Math.max(0, ...state.bugs.map((b) => b.id)) + 1;
  state.nextProjectId = Math.max(0, ...state.projects.map((p) => p.id)) + 1;
  return state;
}
// Pure reducer. The Edge Function commits its result using a version comparison;
// a conflict reruns the reducer against fresh state, never overwrites another request.
export function workspaceRequest(
  state,
  actor,
  members,
  path,
  method = 'GET',
  body = {},
) {
  const url = new URL(path, 'https://workspace.invalid/');
  path = url.pathname.replace(/^\//, '');
  const now = new Date().toISOString();
  const who = { id: actor.id, email: actor.email };
  const live = () => state.bugs.filter((b) => !b.deletedAt);
  const get = (id) =>
    state.bugs.find((b) => b.id === Number(id) && !b.deletedAt) ??
    reject('Issue not found.', 404);
  const record = (bug, message) => {
    bug.updatedAt = now;
    bug.history.push({ at: now, text: message, actor: who });
  };
  const project = (name) => {
    let p = state.projects.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (!p) {
      const words =
        name
          .split(/\s+[-–—|]\s+/)[0]
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .toUpperCase()
          .match(/[A-Z0-9]+/g) ?? [];
      const base =
        (words.length > 1
          ? words.map((w) => w[0]).join('')
          : words[0]?.slice(0, 3)) || 'P';
      let prefix = base,
        n = 2;
      while (state.projects.some((p) => p.prefix === prefix))
        prefix = base + n++;
      p = {
        id: state.nextProjectId++,
        name,
        prefix,
        description: '',
        icon: '',
        image: '',
        components: [],
        versions: [],
      };
      state.projects.push(p);
    }
    return p;
  };
  const number = (bug) => {
    const p = project(bug.project);
    bug.project = p.name;
    const type =
      { Bug: 'BUG', Idea: 'IDEA', Task: 'TASK', 'Feature request': 'FEAT' }[
        bug.issueType
      ] || 'ISSUE';
    if (
      bug.numberingProjectId !== p.id ||
      bug.numberingType !== type ||
      !bug.issueNumber
    ) {
      const key = `${p.id}:${type}`;
      bug.issueNumber = state.sequences[key] = (state.sequences[key] || 0) + 1;
      bug.numberingProjectId = p.id;
      bug.numberingType = type;
    }
    bug.issueKey = `${p.prefix}-${type}-${bug.issueNumber}`;
    for (const [field, list] of [
      ['component', 'components'],
      ['version', 'versions'],
    ]) {
      if (!bug[field]) continue;
      const old = p[list].find(
        (v) => v.toLowerCase() === bug[field].toLowerCase(),
      );
      if (old) bug[field] = old;
      else p[list].push(bug[field]);
    }
  };
  const validate = (input, old) => {
    const data = validateReport(input, state.fields);
    for (const field of state.fields.filter((f) =>
      fieldApplies(f, data.issueType),
    )) {
      const value = field.builtin
        ? data[field.key]
        : data.customFields[field.key];
      if (
        field.required &&
        (!data.quickReport || lockedFields.includes(field.key)) &&
        !value?.trim()
      )
        reject(`${field.label} is required.`);
      if (value && field.type === 'select' && !field.options.includes(value))
        reject(`Choose a valid ${field.label}.`);
      if (value && field.type === 'number' && !Number.isFinite(Number(value)))
        reject(`${field.label} must be a number.`);
      if (
        value &&
        field.type === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value)))
      )
        reject(`Invalid ${field.label}.`);
    }
    for (const key of ['assignee', 'reporter'])
      if (data[key] && data[key] !== old?.[key]) {
        const member = members.find(
          (m) => !m.disabled && m.email === data[key].toLowerCase(),
        );
        if (!member) reject(`Choose an invited account for ${key}.`);
        data[key] = member.email;
      }
    return data;
  };
  if (path === 'bugs' && method === 'GET')
    return live().toSorted((a, b) => b.id - a.id);
  if (path === 'trash' && method === 'GET')
    return state.bugs.filter((b) => b.deletedAt);
  if (path === 'members' && method === 'GET')
    return members.map(({ id, email, disabled }) => ({
      id,
      email,
      disabled: Number(disabled),
    }));
  if (path === 'projects' && method === 'GET') return state.projects;
  if (path === 'fields' && method === 'GET') return state.fields;
  if (path === 'fields' && method === 'PUT') {
    ownerOnly(actor);
    const incoming = Array.isArray(body)
      ? body.map((f) => {
          const old = state.fields.find((p) => p.key === f?.key);
          if (
            !old ||
            old.type === 'select' ||
            f.type !== 'select' ||
            !Array.isArray(f.options)
          )
            return f;
          return {
            ...f,
            options: [
              ...new Set([
                ...f.options,
                ...state.bugs
                  .map((b) =>
                    old.builtin ? b[f.key] : b.customFields?.[f.key],
                  )
                  .filter(Boolean),
              ]),
            ],
          };
        })
      : body;
    const clean = validateFieldConfig(incoming);
    if (state.fields.some((f) => !clean.some((c) => c.key === f.key)))
      reject('Hide fields instead of removing them.');
    for (const f of clean)
      for (const b of state.bugs) {
        const value = f.builtin ? b[f.key] : b.customFields?.[f.key];
        if (!value) continue;
        if (f.type === 'select' && !f.options.includes(value))
          reject(`${f.label}: an existing value is missing from the options.`);
        if (f.type === 'number' && !Number.isFinite(Number(value)))
          reject(`${f.label}: an existing value is not a number.`);
        if (
          f.type === 'date' &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            !Number.isFinite(Date.parse(value)))
        )
          reject(`${f.label}: an existing value is not a date.`);
      }
    state.fields = clean;
    return clean;
  }
  const pm = path.match(/^projects\/(\d+)$/);
  if ((path === 'projects' && method === 'POST') || (pm && method === 'PUT')) {
    ownerOnly(actor);
    const data = projectData(body);
    const old = pm && state.projects.find((p) => p.id === Number(pm[1]));
    if (pm && !old) reject('Project not found.', 404);
    if (
      state.projects.some(
        (p) =>
          p.id !== old?.id && p.name.toLowerCase() === data.name.toLowerCase(),
      )
    )
      reject('Project name already exists.');
    const p = old || project(data.name);
    for (const bug of state.bugs.filter((b) => b.project === p.name)) {
      bug.project = data.name;
      if (p.name !== data.name)
        record(bug, `Project renamed: ${p.name} → ${data.name}`);
    }
    Object.assign(p, data);
    return p;
  }
  if (pm && method === 'DELETE') {
    ownerOnly(actor);
    const p = state.projects.find((p) => p.id === Number(pm[1]));
    if (!p) reject('Project not found.', 404);
    if (state.bugs.some((b) => b.project === p.name))
      reject(
        'Move this project’s issues, including Trash, before deleting it.',
      );
    state.projects = state.projects.filter((x) => x !== p);
    return { deleted: true };
  }
  if (path === 'bugs' && method === 'POST') {
    if (
      body.creationToken !== undefined &&
      (body.quickReport !== true ||
        typeof body.creationToken !== 'string' ||
        !/^[a-f0-9-]{36}$/i.test(body.creationToken))
    )
      reject('Invalid report creation token.');
    const existing =
      body.creationToken &&
      state.bugs.find(
        (b) =>
          b.creationToken === body.creationToken &&
          b.creationAccountId === actor.id,
      );
    if (existing) {
      if (existing.deletedAt)
        reject('This report is in Trash. Restore it before continuing.');
      return { ...existing, creationReplayed: true };
    }
    const bug = {
      ...validate({ ...body, reporter: body.reporter || actor.email }),
      id: state.nextIssueId++,
      createdAt: now,
      updatedAt: now,
      comments: [],
      history: [{ at: now, text: 'Issue created', actor: who }],
      ...(body.creationToken
        ? { creationToken: body.creationToken, creationAccountId: actor.id }
        : {}),
    };
    number(bug);
    state.bugs.push(bug);
    return bug;
  }
  const restore = path.match(/^trash\/(\d+)\/restore$/);
  if (restore && method === 'POST') {
    const bug =
      state.bugs.find((b) => b.id === Number(restore[1]) && b.deletedAt) ??
      reject('Issue is not in Trash.', 404);
    delete bug.deletedAt;
    delete bug.deletedBy;
    record(bug, 'Restored from Trash');
    return bug;
  }
  const bm = path.match(/^bugs\/(\d+)(?:\/(comments|quick|links))?$/);
  if (bm) {
    const bug = get(bm[1]);
    if (!bm[2] && method === 'GET') return bug;
    if (!bm[2] && method === 'DELETE') {
      bug.deletedAt = now;
      bug.deletedBy = who;
      record(bug, 'Moved to Trash');
      return { deleted: true };
    }
    if (bm[2] === 'comments' && method === 'POST') {
      const value = text(body.text);
      if (!value) reject('Comment is required.');
      bug.comments.push({ at: now, text: value, actor: who });
      record(bug, 'Added comment');
      return bug;
    }
    if (bm[2] === 'links') {
      if (method === 'GET')
        return state.links
          .filter(
            (l) =>
              (l.source === bug.id || l.target === bug.id) &&
              live().some((b) => b.id === l.source) &&
              live().some((b) => b.id === l.target),
          )
          .map((l) => ({
            ...l,
            label:
              l.source === bug.id
                ? l.type
                : {
                    blocks: 'is blocked by',
                    duplicates: 'is duplicated by',
                    'relates to': 'relates to',
                  }[l.type],
            issue: get(l.source === bug.id ? l.target : l.source),
          }));
      if (method === 'POST') {
        let { source = bug.id, target, type, remove = false } = body;
        if (
          !Number.isSafeInteger(source) ||
          !Number.isSafeInteger(target) ||
          source === target ||
          (source !== bug.id && target !== bug.id) ||
          !['blocks', 'duplicates', 'relates to'].includes(type)
        )
          reject('Invalid relationship.');
        get(source);
        get(target);
        if (type === 'relates to' && source > target)
          [source, target] = [target, source];
        const existing = state.links.find(
          (l) => l.source === source && l.target === target && l.type === type,
        );
        if (remove) state.links = state.links.filter((l) => l !== existing);
        else if (!existing) state.links.push({ source, target, type });
        if ((remove && existing) || (!remove && !existing)) {
          record(
            get(source),
            `${remove ? 'Removed link' : 'Linked'}: ${type} issue ${target}`,
          );
          record(
            get(target),
            `${remove ? 'Removed link' : 'Linked'}: issue ${source} ${type} this issue`,
          );
        }
        return { saved: true };
      }
    }
    if (
      (!bm[2] && ['PUT', 'PATCH'].includes(method)) ||
      (bm[2] === 'quick' && method === 'POST')
    ) {
      let input = body;
      if (
        body.expectedCreatedAt !== undefined &&
        body.expectedCreatedAt !== bug.createdAt
      )
        reject('Original issue is no longer available.', 409);
      if (bm[2] === 'quick') {
        if (
          !Object.keys(body).length ||
          Object.keys(body).some((k) => !['status', 'priority'].includes(k))
        )
          reject('Only status and priority can change here.');
        input = { ...bug, ...body };
      }
      if (method === 'PATCH') {
        const f = state.fields.find(
          (f) => f.key === body.field && fieldApplies(f, bug.issueType),
        );
        if (!f) reject('This field cannot be edited.');
        const current = f.builtin
          ? (bug[f.key] ?? '')
          : (bug.customFields?.[f.key] ?? '');
        if (body.previous !== current)
          reject('This field changed. Refresh and try again.', 409);
        input = f.builtin
          ? { ...bug, [f.key]: body.value }
          : {
              ...bug,
              customFields: { ...bug.customFields, [f.key]: body.value },
            };
      }
      const data = validate(
        { ...input, quickReport: bug.quickReport === true },
        bug,
      );
      const changes = Object.keys(data).filter(
        (k) => JSON.stringify(data[k]) !== JSON.stringify(bug[k]),
      );
      for (const k of changes)
        record(
          bug,
          `${k}: ${JSON.stringify(bug[k] ?? '').slice(0, 8000)} → ${JSON.stringify(data[k] ?? '').slice(0, 8000)}`,
        );
      Object.assign(bug, data);
      number(bug);
      return bug;
    }
  }
  if (path === 'import' && method === 'POST') {
    ownerOnly(actor);
    if (
      ![1, 2].includes(body.schemaVersion) ||
      !Array.isArray(body.bugs) ||
      body.bugs.length > 10000
    )
      reject('Unsupported backup.');
    const incomingFields = validateFieldConfig(body.fields || state.fields);
    for (const field of incomingFields.filter((f) => !f.builtin)) {
      const old = state.fields.find((f) => f.key === field.key);
      if (old && JSON.stringify(old) !== JSON.stringify(field))
        reject(
          'Custom field settings conflict. Import into an empty workspace.',
        );
    }
    if (!state.bugs.length) state.fields = incomingFields;
    else
      state.fields = [
        ...state.fields.map((f) => {
          const next = incomingFields.find((n) => n.key === f.key);
          return f.builtin && next
            ? {
                ...f,
                options: [...new Set([...f.options, ...next.options])],
                ...(f.key === 'status'
                  ? { categories: { ...next.categories, ...f.categories } }
                  : {}),
              }
            : f;
        }),
        ...incomingFields.filter(
          (f) => !state.fields.some((old) => old.key === f.key),
        ),
      ];
    for (const input of body.projects || []) {
      const data = projectData(input),
        p = project(data.name);
      if (!p.description) p.description = data.description;
      if (!p.icon) p.icon = data.icon;
      if (!p.image) p.image = data.image;
      for (const key of ['components', 'versions']) {
        if (
          !Array.isArray(input[key] || []) ||
          (input[key] || []).length > 10000
        )
          reject('Invalid project values.');
        p[key] = [
          ...new Set([
            ...p[key],
            ...(input[key] || []).map((v) => text(v, 500)),
          ]),
        ];
      }
    }
    const ids = new Map();
    for (const input of body.bugs) {
      if (ids.has(input.id)) reject('Duplicate issue IDs in backup.');
      const data = validateReport(input, incomingFields);
      if (
        !Array.isArray(input.history) ||
        !Array.isArray(input.comments) ||
        !Number.isFinite(Date.parse(input.createdAt)) ||
        !Number.isFinite(Date.parse(input.updatedAt))
      )
        reject('Invalid backup history.');
      for (const entry of [...input.history, ...input.comments])
        if (
          typeof entry.text !== 'string' ||
          entry.text.length > 20000 ||
          !Number.isFinite(Date.parse(entry.at))
        )
          reject('Invalid backup activity.');
      const bug = {
        ...data,
        id: state.nextIssueId++,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        comments: input.comments,
        history: input.history,
        ...(input.deletedAt
          ? { deletedAt: input.deletedAt, deletedBy: input.deletedBy }
          : {}),
      };
      number(bug);
      state.bugs.push(bug);
      ids.set(input.id, bug.id);
    }
    for (const link of body.links || []) {
      const source = ids.get(link.source),
        target = ids.get(link.target);
      if (
        !source ||
        !target ||
        source === target ||
        !['blocks', 'duplicates', 'relates to'].includes(link.type)
      )
        reject('Invalid backup relationship.');
      state.links.push({ source, target, type: link.type });
    }
    for (const f of body.preparedFiles || []) {
      const issueId = f.source === 'inbox' ? null : ids.get(f.originalIssueId);
      if (f.source !== 'inbox' && !issueId) reject('Invalid attachment issue.');
      const { originalIssueId, ...file } = f;
      state.files.push({ ...file, issueId });
    }
    return { imported: body.bugs.length };
  }
  if (path === 'people/link' && method === 'POST') {
    ownerOnly(actor);
    const member = members.find((m) => !m.disabled && m.email === body.email);
    if (
      !member ||
      !text(body.legacy, 500) ||
      members.some((m) => m.email === body.legacy)
    )
      reject('Choose an older name and active account.');
    let updated = 0;
    for (const b of state.bugs) {
      const keys = ['reporter', 'assignee'].filter((k) => b[k] === body.legacy);
      if (!keys.length) continue;
      keys.forEach((k) => (b[k] = member.email));
      record(
        b,
        `Linked ${keys.join(' and ')}: ${body.legacy} → ${member.email}`,
      );
      updated++;
    }
    return { updated };
  }
  const am = path.match(/^bugs\/(\d+)\/attachments(?:\/([a-zA-Z0-9-]+))?$/);
  if (am) {
    const bug = get(am[1]);
    const files = state.files.filter((f) => f.issueId === bug.id && !f.pending);
    if (!am[2] && method === 'GET') return files;
    const file = files.find((f) => f.id === am[2]);
    if (file && method === 'DELETE') {
      state.files = state.files.filter((f) => f !== file);
      record(bug, `Removed attachment: ${file.name}`);
      return { deleted: true };
    }
  }
  if (path === 'inbox' && method === 'GET')
    return {
      files: state.files
        .filter((f) => f.source === 'inbox' && !f.pending)
        .map((f) => ({
          ...f,
          sourcePath: 'Mac companion',
          sourceModified: f.sourceModified || f.createdAt,
        })),
      settings: {
        folder: '',
        enabled: false,
        extensions: [],
        nameContains: '',
      },
      photos: {
        supported: false,
        installed: false,
        settings: { enabled: false, scope: 'all', includeExisting: false },
        helper: {
          state: 'cloud',
          message: 'Apple Photos imports run on your Mac companion.',
        },
        error: '',
      },
      lastScan: null,
      error: '',
      importing: '',
      running: false,
      configuring: false,
      counts: {},
      suggestedFolder: '',
      supportedExtensions: [],
      problems: [],
    };
  if (path === 'inbox/scan' && method === 'POST')
    return workspaceRequest(state, actor, members, 'inbox');
  if (path === 'inbox/assign' && method === 'POST') {
    const { ids, issueId } = body;
    const bug = get(issueId);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 20 ||
      new Set(ids).size !== ids.length
    )
      reject('Select 1–20 captures.');
    if (
      state.files.filter((f) => f.issueId === bug.id && !f.pending).length +
        ids.length >
      20
    )
      reject('An issue can have up to 20 attachments.');
    const files = ids.map(
      (id) =>
        state.files.find(
          (f) => f.id === id && f.source === 'inbox' && !f.pending,
        ) ?? reject('A capture is no longer in the inbox.'),
    );
    files.forEach((f) => {
      f.issueId = bug.id;
      f.source = 'issue';
    });
    record(bug, 'Attached from inbox: ' + files.map((f) => f.name).join(', '));
    return { assigned: ids.length };
  }
  const im = path.match(/^inbox\/([a-zA-Z0-9-]+)$/);
  if (im && method === 'DELETE') {
    const file = state.files.find(
      (f) => f.id === im[1] && f.source === 'inbox' && !f.pending,
    );
    if (!file) return { deleted: true };
    state.files = state.files.filter((f) => f !== file);
    return { deleted: true };
  }
  const csv = path.match(/^projects\/(\d+)\/export$/);
  if (csv && method === 'GET') {
    const p =
      state.projects.find((p) => p.id === Number(csv[1])) ??
      reject('Project not found.', 404);
    const basis = url.searchParams.get('basis') || 'createdAt';
    if (!['createdAt', 'updatedAt'].includes(basis))
      reject('Invalid date basis.');
    const from = url.searchParams.get('from'),
      to = url.searchParams.get('to'),
      lower = from ? Date.parse(from) : -Infinity,
      upper = to ? Date.parse(to) : Infinity;
    if (Number.isNaN(lower) || Number.isNaN(upper) || lower >= upper)
      reject('Invalid date range.');
    const type = url.searchParams.get('type');
    return {
      csv: projectCsv(
        live().filter(
          (b) =>
            b.project === p.name &&
            (!type || b.issueType === type) &&
            Date.parse(b[basis]) >= lower &&
            Date.parse(b[basis]) < upper,
        ),
        state.fields,
        (id) => state.files.filter((f) => f.issueId === id && !f.pending),
      ),
    };
  }
  reject('This action is not available.', 404);
}

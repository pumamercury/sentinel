'use client';
import { priorityLabel } from '../lib/priority';

import { useEffect, useState } from 'react';
import {
  Plus,
  Save,
  ArrowUp,
  ArrowDown,
  AppWindow,
  ChevronDown,
  Paperclip,
} from 'lucide-react';
import { api, type Project } from '../lib/bugs';
import {
  type FieldDefinition,
  lockedFields,
  fieldTypeOptions,
  statusCategory,
  fieldApplies,
  fieldLabel,
} from '../lib/field-schema.mjs';
import { ProjectBadge } from './project-badge';
import './workspace-settings.css';
type Props = {
  mode: 'projects' | 'admin';
  initialProjectId?: number | null;
  projects: Project[];
  fields: FieldDefinition[];
  onRefresh: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
};
const fieldGroups = [
  {
    key: 'basics',
    label: 'Report basics',
    description: 'Identity and classification',
    keys: [
      'title',
      'project',
      'issueType',
      'status',
      'priority',
      'description',
    ],
  },
  {
    key: 'reproduction',
    label: 'Reproduction & evidence',
    description: 'What happened and how to repeat it',
    keys: ['steps', 'expected', 'actual', 'severity', 'reproRate'],
  },
  {
    key: 'context',
    label: 'Testing context',
    description: 'App area, device and versions',
    keys: ['component', 'environment', 'version', 'fixVersion'],
  },
  {
    key: 'planning',
    label: 'People & planning',
    description: 'Ownership and follow-up',
    keys: [
      'reporter',
      'assignee',
      'dueDate',
      'labels',
      'solution',
      'acceptance',
    ],
  },
  {
    key: 'custom',
    label: 'Custom fields',
    description: 'Extra details for your workspace',
    keys: [] as string[],
  },
];
function groupFor(field: FieldDefinition) {
  if (!field.builtin) return 'custom';
  return (
    fieldGroups.find((group) => group.keys.includes(field.key))?.key ?? 'custom'
  );
}
const fieldTypeLabels = {
  text: 'Short text',
  textarea: 'Long text',
  select: 'Dropdown',
  date: 'Date',
  number: 'Number',
};
export function WorkspacePanel({
  mode,
  projects,
  fields,
  onRefresh,
  initialProjectId,
  onDirtyChange,
}: Props) {
  const [draft, setDraft] = useState<Partial<Project> | null>(() =>
      mode === 'projects'
        ? (projects.find((p) => p.id === initialProjectId) ?? null)
        : null,
    ),
    [definitions, setDefinitions] = useState(fields),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [savedDefinitions, setSavedDefinitions] = useState(fields);
  const fieldDirty =
    JSON.stringify(definitions) !== JSON.stringify(savedDefinitions);
  const changedFields = definitions.filter(
    (field, index) =>
      JSON.stringify(field) !==
        JSON.stringify(
          savedDefinitions.find((saved) => saved.key === field.key),
        ) || savedDefinitions[index]?.key !== field.key,
  ).length;
  const remoteSnapshot = JSON.stringify(fields);
  const [receivedSnapshot, setReceivedSnapshot] = useState(remoteSnapshot);
  if (receivedSnapshot !== remoteSnapshot) {
    setReceivedSnapshot(remoteSnapshot);
    if (!fieldDirty) {
      setDefinitions(fields);
      setSavedDefinitions(fields);
    }
  }
  const [openGroups, setOpenGroups] = useState<string[]>(['basics']);
  const [previewMode, setPreviewMode] = useState<'quick' | 'full'>('quick');
  const [previewType, setPreviewType] = useState('Bug');
  const [newLabel, setNewLabel] = useState(''),
    [newType, setNewType] = useState<FieldDefinition['type']>('text'),
    [newOptions, setNewOptions] = useState('');
  const projectSnapshot = (p: Partial<Project> | null) =>
    JSON.stringify(
      ['name', 'description', 'icon', 'image'].map(
        (key) => p?.[key as keyof Project] ?? '',
      ),
    );
  const [projectBaseline, setProjectBaseline] = useState(
    projectSnapshot(draft),
  );
  const projectDirty = projectSnapshot(draft) !== projectBaseline;
  const dirty = mode === 'projects' ? projectDirty : fieldDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const [fieldSearch, setFieldSearch] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  async function saveProject(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError('');
    try {
      const saved = await api<Project>(
        draft.id ? 'projects/' + draft.id : 'projects',
        draft.id ? 'PUT' : 'POST',
        draft,
      );
      await onRefresh();
      setDraft(saved);
      setProjectBaseline(projectSnapshot(saved));
      setNotice(
        'Project saved. Its name and image are updated in all linked issues.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editProject(p: Partial<Project>) {
    if (
      projectDirty &&
      !confirm('Switch projects? Any unsaved project edits will be discarded.')
    )
      return;
    setDraft(p);
    setProjectBaseline(projectSnapshot(p));
    setError('');
    setNotice('');
  }
  async function image(file?: File) {
    if (!file) return;
    setImageBusy(true);
    setError('');
    try {
      if (
        file.size > 2_000_000 ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      )
        throw Error('Use a PNG, JPEG or WebP image up to 2 MB.');
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(Error('Unable to read image.'));
        reader.onerror = () => reject(Error('Unable to read image.'));
        reader.readAsDataURL(file);
      });
      setDraft((d) => (d ? { ...d, image: data } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImageBusy(false);
    }
  }
  function change(index: number, patch: Partial<FieldDefinition>) {
    setNotice('');
    setDefinitions((d) =>
      d.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }
  function move(index: number, delta: number) {
    setNotice('');
    setDefinitions((d) => {
      const copy = [...d];
      [copy[index], copy[index + delta]] = [copy[index + delta], copy[index]];
      return copy;
    });
  }
  function addField() {
    if (!newLabel.trim()) {
      setError('Enter a field label.');
      return;
    }
    const options = newOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (newType === 'select' && !options.length) {
      setError('Add at least one option.');
      return;
    }
    if (definitions.length >= 60) {
      setError('Up to 60 fields are supported.');
      return;
    }
    setDefinitions((d) => [
      ...d,
      {
        key: 'custom_' + crypto.randomUUID(),
        label: newLabel.trim(),
        type: newType,
        options: newType === 'select' ? options : [],
        required: false,
        enabled: true,
        builtin: false,
      },
    ]);
    setNewLabel('');
    setNewOptions('');
    setError('');
    setNotice('Custom field added to your draft. Save fields to apply it.');
    setFieldSearch('');
    setOpenGroups((groups) => [...new Set([...groups, 'custom'])]);
  }
  function applyPreset(preset: 'flexible' | 'structured') {
    const required =
      preset === 'structured'
        ? ['issueType', 'description', 'steps', 'expected', 'actual']
        : [];
    setDefinitions((current) =>
      current.map((field) =>
        !field.builtin || lockedFields.includes(field.key)
          ? field
          : {
              ...field,
              required: field.enabled && required.includes(field.key),
            },
      ),
    );
    setPreviewMode('full');
    setError('');
    setNotice(
      `${preset === 'flexible' ? 'Flexible details' : 'Structured reports'} applied to your draft. Review the form preview, then save when ready.`,
    );
  }
  function discardFields() {
    setDefinitions(savedDefinitions);
    setError('');
    setNotice('Unsaved field changes discarded.');
  }
  async function saveFields() {
    setBusy(true);
    setError('');
    try {
      const saved = await api<FieldDefinition[]>('fields', 'PUT', definitions);
      setDefinitions(saved);
      setSavedDefinitions(saved);
      await onRefresh();
      setNotice('Field configuration saved for all issues.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const matchesSearch = (field: FieldDefinition) =>
    `${field.label} ${field.type} ${fieldTypeLabels[field.type]}`
      .toLowerCase()
      .includes(fieldSearch.trim().toLowerCase());
  const issueTypes =
    definitions
      .find((field) => field.key === 'issueType')
      ?.options.filter(Boolean) ?? [];
  const effectivePreviewType = issueTypes.includes(previewType)
    ? previewType
    : (issueTypes[0] ?? 'Bug');
  const fullPreviewFields = definitions.filter((field) =>
    fieldApplies(field, effectivePreviewType),
  );
  const quickPreviewFields = ['project', 'title', 'description']
    .map((key) => fullPreviewFields.find((field) => field.key === key))
    .filter((field): field is FieldDefinition => Boolean(field));
  const previewFields =
    previewMode === 'quick' ? quickPreviewFields : fullPreviewFields;
  return (
    <>
      <div className="breadcrumb settings-breadcrumb">
        Workspace / Admin / {mode === 'projects' ? 'Projects' : 'Issue fields'}
      </div>
      <header className="settings-header">
        <div>
          <p className="eyebrow">WORKSPACE SETTINGS</p>
          <h1>{mode === 'projects' ? 'Projects' : 'Issue fields'}</h1>
          <p className="muted">
            {mode === 'projects'
              ? 'Give every app its own identity.'
              : 'Configure the report form for everyone using this workspace.'}
          </p>
        </div>
        {mode === 'projects' ? (
          <button
            className="primary"
            disabled={busy || imageBusy}
            onClick={() =>
              editProject({ name: '', description: '', icon: '', image: '' })
            }
          >
            <Plus size={18} /> New project
          </button>
        ) : (
          <div className="settings-save-actions">
            <output className={fieldDirty ? 'settings-unsaved' : 'muted'}>
              {fieldDirty
                ? `${changedFields} field${changedFields === 1 ? '' : 's'} with unsaved changes`
                : 'All changes saved'}
            </output>
            {fieldDirty && (
              <button disabled={busy} onClick={discardFields}>
                Discard changes
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !fieldDirty}
              onClick={saveFields}
            >
              <Save size={18} /> {busy ? 'Saving…' : 'Save fields'}
            </button>
          </div>
        )}
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <output className="notice settings-notice">{notice}</output>}
      {mode === 'projects' ? (
        <div className="project-editor-grid">
          <section className="project-list">
            {projects.length ? (
              projects.map((p) => (
                <button
                  className={
                    'project-tile ' + (draft?.id === p.id ? 'selected' : '')
                  }
                  key={p.id}
                  disabled={busy || imageBusy}
                  onClick={() => editProject(p)}
                >
                  <ProjectBadge name={p.name} projects={projects} />
                  <p className="muted">
                    {p.description || 'Add project details'}
                  </p>
                </button>
              ))
            ) : (
              <p className="muted">
                Projects are created when you add a bug, or with New project.
              </p>
            )}
          </section>
          <section className="detail-panel">
            {draft ? (
              <form onSubmit={saveProject}>
                <fieldset disabled={busy || imageBusy} className="project-form">
                  <h2>{draft.id ? 'Edit project' : 'New project'}</h2>
                  <div className="project-preview">
                    {draft.image ? (
                      <img src={draft.image} alt="Project preview" />
                    ) : (
                      <span>{draft.icon || <AppWindow size={40} />}</span>
                    )}
                  </div>
                  <label>
                    Name
                    <input
                      required
                      maxLength={500}
                      value={draft.name || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Details
                    <textarea
                      maxLength={10000}
                      value={draft.description || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Icon (emoji or initials)
                    <input
                      maxLength={16}
                      placeholder="📱"
                      value={draft.icon || ''}
                      onChange={(e) =>
                        setDraft({ ...draft, icon: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Project picture
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => {
                        void image(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <p className="muted">
                    PNG, JPEG or WebP, up to 2 MB. A picture takes precedence
                    over the icon.
                  </p>
                  {draft.image && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, image: '' })}
                    >
                      Remove picture
                    </button>
                  )}
                  <button className="primary" type="submit">
                    {busy ? 'Saving…' : 'Save project'}
                  </button>
                </fieldset>
              </form>
            ) : (
              <div className="empty">
                <AppWindow size={35} />
                <h2>Select a project</h2>
                <p>Edit its name, description, icon, and picture here.</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="workspace-field-settings">
          <section
            className="settings-presets"
            aria-labelledby="settings-presets-title"
          >
            <div>
              <h2 id="settings-presets-title">A useful starting point</h2>
              <p className="muted">
                Try a preset, adjust the fields, then save. Labels, options,
                visibility and custom fields stay as you set them.
              </p>
            </div>
            <div className="settings-preset-options">
              <button disabled={busy} onClick={() => applyPreset('flexible')}>
                <strong>Flexible details</strong>
                <span>Keep supporting details optional.</span>
              </button>
              <button disabled={busy} onClick={() => applyPreset('structured')}>
                <strong>Structured reports</strong>
                <span>
                  Require a description and reproduction details in full
                  reports.
                </span>
              </button>
            </div>
          </section>
          <div className="settings-editor-layout">
            <section
              className="settings-field-editor"
              aria-label="Field configuration"
            >
              <div className="field-admin-search">
                <label>
                  Find a field
                  <input
                    value={fieldSearch}
                    onChange={(e) => setFieldSearch(e.target.value)}
                    placeholder="Search labels or field types…"
                  />
                </label>
                <span className="muted">
                  {definitions.filter((f) => f.enabled).length} visible ·{' '}
                  {definitions.length} total
                </span>
              </div>
              <p className="settings-help muted">
                Required fields apply to full reports. Quick reports can be
                filled in later. Hidden fields keep their saved values. Open a
                field to edit it or change its order in the full form.
              </p>
              <div className="settings-field-groups">
                {fieldGroups.map((group) => {
                  const groupFields = definitions.filter(
                    (field) =>
                      groupFor(field) === group.key && matchesSearch(field),
                  );
                  if (!groupFields.length) return null;
                  return (
                    <details
                      className="settings-field-group"
                      key={group.key}
                      open={
                        Boolean(fieldSearch.trim()) ||
                        openGroups.includes(group.key)
                      }
                      onToggle={(event) => {
                        if (fieldSearch.trim()) return;
                        const open = event.currentTarget.open;
                        setOpenGroups((groups) =>
                          open
                            ? [...new Set([...groups, group.key])]
                            : groups.filter((key) => key !== group.key),
                        );
                      }}
                    >
                      <summary>
                        <span>
                          <strong>{group.label}</strong>
                          <small>{group.description}</small>
                        </span>
                        <span className="settings-group-count">
                          {groupFields.length}
                          <ChevronDown size={16} aria-hidden="true" />
                        </span>
                      </summary>
                      <div className="settings-group-fields">
                        {groupFields.map((f) => {
                          const i = definitions.findIndex(
                            (field) => field.key === f.key,
                          );
                          return (
                            <details
                              className="field-admin-card settings-field-row"
                              key={f.key}
                            >
                              <summary>
                                <span className="settings-field-summary-name">
                                  {f.label || 'Unnamed field'}
                                  <small>{fieldTypeLabels[f.type]}</small>
                                </span>
                                <span className="settings-field-summary-state">
                                  {!f.enabled
                                    ? 'Hidden'
                                    : f.required
                                      ? 'Required'
                                      : 'Optional'}
                                  <ChevronDown size={15} aria-hidden="true" />
                                </span>
                              </summary>
                              <div className="settings-field-row-content">
                                <div className="field-admin-top">
                                  <div className="field-admin-name">
                                    <label>
                                      Field name
                                      <input
                                        aria-label={'Label for ' + f.label}
                                        maxLength={80}
                                        value={f.label}
                                        disabled={busy}
                                        onChange={(e) =>
                                          change(i, { label: e.target.value })
                                        }
                                      />
                                      <small className="id">
                                        {f.builtin ? 'Built-in' : 'Custom'}
                                        {' · Form position ' + (i + 1)}
                                      </small>
                                    </label>
                                    <label>
                                      Field type
                                      <select
                                        aria-label={'Type for ' + f.label}
                                        value={f.type}
                                        disabled={
                                          busy ||
                                          fieldTypeOptions(f).length === 1
                                        }
                                        onChange={(e) =>
                                          change(i, {
                                            type: e.target
                                              .value as FieldDefinition['type'],
                                          })
                                        }
                                      >
                                        {fieldTypeOptions(f).map((type) => (
                                          <option key={type} value={type}>
                                            {fieldTypeLabels[type]}
                                          </option>
                                        ))}
                                      </select>
                                      <small className="muted">
                                        {fieldTypeOptions(f).length === 1
                                          ? 'Fixed type for this built-in field.'
                                          : 'When changing to Dropdown, existing values are kept as options when you save.'}
                                      </small>
                                    </label>
                                  </div>
                                  <div className="field-admin-order">
                                    <div className="field-order">
                                      <button
                                        disabled={busy || i === 0}
                                        aria-label={'Move ' + f.label + ' up'}
                                        onClick={() => move(i, -1)}
                                      >
                                        <ArrowUp size={16} />
                                      </button>
                                      <button
                                        disabled={
                                          busy || i === definitions.length - 1
                                        }
                                        aria-label={'Move ' + f.label + ' down'}
                                        onClick={() => move(i, 1)}
                                      >
                                        <ArrowDown size={16} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                                <div className="field-admin-settings">
                                  <label>
                                    <input
                                      type="checkbox"
                                      aria-label={'Show ' + f.label}
                                      checked={f.enabled}
                                      disabled={
                                        busy || lockedFields.includes(f.key)
                                      }
                                      onChange={(e) =>
                                        change(i, { enabled: e.target.checked })
                                      }
                                    />
                                    Visible
                                  </label>
                                  <label>
                                    <input
                                      type="checkbox"
                                      aria-label={'Require ' + f.label}
                                      checked={f.required}
                                      disabled={
                                        busy || lockedFields.includes(f.key)
                                      }
                                      onChange={(e) =>
                                        change(i, {
                                          required: e.target.checked,
                                        })
                                      }
                                    />
                                    Required
                                  </label>
                                  {lockedFields.includes(f.key) && (
                                    <span className="muted">
                                      Essential field — always visible and
                                      required
                                    </span>
                                  )}
                                </div>

                                <details
                                  className="field-advanced"
                                  open={f.type === 'select'}
                                >
                                  <summary>Options &amp; applicability</summary>
                                  {f.key === 'priority' && (
                                    <p className="muted">
                                      {f.options.map(priorityLabel).join(' · ')}
                                    </p>
                                  )}
                                  {f.type === 'select' && (
                                    <label>
                                      Options — one per line
                                      <textarea
                                        aria-label={'Options for ' + f.label}
                                        value={f.options.join('\n')}
                                        disabled={busy}
                                        onChange={(e) =>
                                          change(i, {
                                            options: e.target.value.split('\n'),
                                          })
                                        }
                                      />
                                    </label>
                                  )}
                                  {f.key === 'status' &&
                                    [...new Set(f.options.filter(Boolean))].map(
                                      (option) => (
                                        <label
                                          className="status-category"
                                          key={option}
                                        >
                                          {option}
                                          <select
                                            aria-label={`Category for ${option}`}
                                            disabled={busy}
                                            value={
                                              f.categories?.[option] ??
                                              statusCategory(option)
                                            }
                                            onChange={(e) =>
                                              change(i, {
                                                categories: {
                                                  ...f.categories,
                                                  [option]: e.target.value as
                                                    | 'open'
                                                    | 'in-progress'
                                                    | 'completed',
                                                },
                                              })
                                            }
                                          >
                                            <option value="open">Open</option>
                                            <option value="in-progress">
                                              In progress
                                            </option>
                                            <option value="completed">
                                              Completed
                                            </option>
                                          </select>
                                        </label>
                                      ),
                                    )}
                                  {!lockedFields.includes(f.key) &&
                                    f.key !== 'issueType' && (
                                      <fieldset
                                        className="field-scope-choices"
                                        disabled={busy}
                                      >
                                        <legend>Show for issue types</legend>
                                        <p className="muted">
                                          Leave all unchecked to show for every
                                          issue type.
                                        </p>
                                        {(
                                          definitions.find(
                                            (field) =>
                                              field.key === 'issueType',
                                          )?.options ?? []
                                        )
                                          .filter(Boolean)
                                          .map((type) => (
                                            <label key={type}>
                                              <input
                                                type="checkbox"
                                                checked={(
                                                  f.issueTypes ?? []
                                                ).includes(type)}
                                                onChange={(e) =>
                                                  change(i, {
                                                    issueTypes: e.target.checked
                                                      ? [
                                                          ...(f.issueTypes ??
                                                            []),
                                                          type,
                                                        ]
                                                      : (
                                                          f.issueTypes ?? []
                                                        ).filter(
                                                          (t) => t !== type,
                                                        ),
                                                  })
                                                }
                                              />
                                              {type}
                                            </label>
                                          ))}
                                      </fieldset>
                                    )}
                                </details>
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
                {!definitions.some(matchesSearch) && (
                  <output className="muted">No matching fields.</output>
                )}
              </div>
              <details className="settings-new-field">
                <summary>
                  <Plus size={17} aria-hidden="true" /> Add custom field
                </summary>
                <div className="settings-new-field-content">
                  <div className="fields">
                    <label>
                      Label
                      <input
                        value={newLabel}
                        maxLength={80}
                        disabled={busy}
                        onChange={(e) => setNewLabel(e.target.value)}
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={newType}
                        disabled={busy}
                        onChange={(e) =>
                          setNewType(e.target.value as FieldDefinition['type'])
                        }
                      >
                        {['text', 'textarea', 'select', 'number', 'date'].map(
                          (t) => (
                            <option key={t}>{t}</option>
                          ),
                        )}
                      </select>
                    </label>
                    {newType === 'select' && (
                      <label>
                        Options (comma separated)
                        <input
                          value={newOptions}
                          disabled={busy}
                          onChange={(e) => setNewOptions(e.target.value)}
                        />
                      </label>
                    )}
                  </div>
                  <div className="actions">
                    <button disabled={busy} onClick={addField}>
                      <Plus size={16} /> Add field
                    </button>
                  </div>
                  <p className="muted">
                    Then choose Save fields to apply your changes.
                  </p>
                </div>
              </details>
            </section>
            <section
              className="settings-form-preview"
              aria-labelledby="settings-preview-title"
            >
              <div className="settings-preview-heading">
                <h2 id="settings-preview-title">Form preview</h2>
                <span className="settings-preview-badge">
                  {fieldDirty ? 'Unsaved draft' : 'Current settings'}
                </span>
              </div>
              <p className="muted">
                See how your settings shape a report. Preview fields cannot
                submit an issue.
              </p>
              <div
                className="settings-preview-modes"
                aria-label="Preview form mode"
              >
                <button
                  aria-pressed={previewMode === 'quick'}
                  onClick={() => setPreviewMode('quick')}
                >
                  Quick report
                </button>
                <button
                  aria-pressed={previewMode === 'full'}
                  onClick={() => setPreviewMode('full')}
                >
                  Full report
                </button>
              </div>
              {previewMode === 'full' && (
                <label className="settings-preview-type">
                  Preview issue type
                  <select
                    value={effectivePreviewType}
                    onChange={(event) => setPreviewType(event.target.value)}
                  >
                    {(issueTypes.length ? issueTypes : ['Bug']).map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
              )}
              <output className="settings-preview-count muted">
                {previewMode === 'quick'
                  ? 'Only project and title need your input to get started.'
                  : `${fullPreviewFields.length} visible fields · ${fullPreviewFields.filter((field) => field.required).length} required`}
              </output>
              <fieldset disabled className="settings-preview-fields">
                <legend className="sr-only">Report form preview</legend>
                {previewFields.map((field) => {
                  const required =
                    previewMode === 'quick'
                      ? ['title', 'project'].includes(field.key)
                      : field.required;
                  const label =
                    previewMode === 'quick' && field.key === 'description'
                      ? 'What went wrong?'
                      : fieldLabel(field, effectivePreviewType);
                  return (
                    <label key={field.key}>
                      <span>
                        {label}
                        {required && <span aria-label="required"> *</span>}
                      </span>
                      {field.key === 'project' ? (
                        <select
                          value={projects[0]?.name ?? ''}
                          aria-label={`${label} preview`}
                        >
                          {projects.length ? (
                            projects.map((project) => (
                              <option key={project.id}>{project.name}</option>
                            ))
                          ) : (
                            <option>Choose a project</option>
                          )}
                        </select>
                      ) : field.type === 'textarea' ? (
                        <textarea
                          rows={3}
                          placeholder={
                            field.key === 'description'
                              ? 'A short description of the problem…'
                              : `Add ${label.toLowerCase()}…`
                          }
                          aria-label={`${label} preview`}
                        />
                      ) : field.type === 'select' ? (
                        <select
                          value={
                            field.key === 'issueType'
                              ? effectivePreviewType
                              : ''
                          }
                          aria-label={`${label} preview`}
                        >
                          <option value="">
                            Choose {label.toLowerCase()}…
                          </option>
                          {field.options
                            .filter(Boolean)
                            .map((option, index) => (
                              <option key={`${option}-${index}`} value={option}>
                                {field.key === 'priority'
                                  ? priorityLabel(option)
                                  : option}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <input
                          type={
                            field.type === 'number' || field.type === 'date'
                              ? field.type
                              : 'text'
                          }
                          placeholder={
                            field.key === 'title'
                              ? 'Login closes when I tap Continue'
                              : `Add ${label.toLowerCase()}…`
                          }
                          aria-label={`${label} preview`}
                        />
                      )}
                    </label>
                  );
                })}
                <div className="settings-preview-evidence">
                  <Paperclip size={19} aria-hidden="true" />
                  <strong>Screenshots &amp; files</strong>
                  <span>Optional evidence</span>
                </div>
              </fieldset>
              {previewMode === 'quick' && (
                <p className="settings-preview-details muted">
                  Additional details are available when you need them.
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  );
}

'use client';
import { priorityLabel } from '../lib/priority';

import { useRef, useState } from 'react';
import { Plus, Save, ArrowUp, ArrowDown, AppWindow } from 'lucide-react';
import { api, type Project } from '../lib/bugs';
import {
  type FieldDefinition,
  lockedFields,
  statusCategory,
} from '../lib/field-schema.mjs';
import { ProjectBadge } from './project-badge';
type Props = {
  mode: 'projects' | 'admin';
  initialProjectId?: number | null;
  projects: Project[];
  fields: FieldDefinition[];
  onRefresh: () => Promise<void>;
};
export function WorkspacePanel({
  mode,
  projects,
  fields,
  onRefresh,
  initialProjectId,
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
  const [newLabel, setNewLabel] = useState(''),
    [newType, setNewType] = useState<FieldDefinition['type']>('text'),
    [newOptions, setNewOptions] = useState('');
  const projectSnapshot = (p: Partial<Project> | null) =>
    JSON.stringify(
      ['name', 'description', 'icon', 'image'].map(
        (key) => p?.[key as keyof Project] ?? '',
      ),
    );
  const projectBaseline = useRef(projectSnapshot(draft));
  const projectDirty = projectSnapshot(draft) !== projectBaseline.current;
  const [fieldSearch, setFieldSearch] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  async function saveProject(e: React.FormEvent) {
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
      projectBaseline.current = projectSnapshot(saved);
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
    projectBaseline.current = projectSnapshot(p);
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
        reader.onload = () => resolve(String(reader.result));
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
    setDefinitions((d) =>
      d.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    );
  }
  function move(index: number, delta: number) {
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
  }
  async function saveFields() {
    setBusy(true);
    setError('');
    try {
      setDefinitions(
        await api<FieldDefinition[]>('fields', 'PUT', definitions),
      );
      await onRefresh();
      setNotice('Field configuration saved for all issues.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="breadcrumb">
        Workspace / Admin / {mode === 'projects' ? 'Projects' : 'Issue fields'}
      </div>
      <header>
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
          <button className="primary" disabled={busy} onClick={saveFields}>
            <Save size={18} /> Save fields
          </button>
        )}
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
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
        <>
          <p className="notice">
            Hide a field to remove it from the form and details without losing
            saved values. Title, project, status, and priority stay required.
            Reorder fields with the arrows.
          </p>
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
          <div className="field-admin-cards">
            {definitions.map((f, i) => (
              <article
                className="field-admin-card"
                key={f.key}
                hidden={
                  !(f.label + ' ' + f.type)
                    .toLowerCase()
                    .includes(fieldSearch.toLowerCase())
                }
              >
                <div className="field-admin-top">
                  <div className="field-admin-name">
                    <label>
                      Field name
                      <input
                        aria-label={'Label for ' + f.label}
                        maxLength={80}
                        value={f.label}
                        disabled={busy}
                        onChange={(e) => change(i, { label: e.target.value })}
                      />
                      <small className="id">
                        {f.builtin ? 'Built-in' : 'Custom'}
                      </small>
                    </label>
                    <span className="muted">
                      {
                        {
                          text: 'Short text',
                          textarea: 'Long text',
                          select: 'Dropdown',
                          date: 'Date',
                          number: 'Number',
                        }[f.type]
                      }
                      {f.type === 'select'
                        ? ' · ' + f.options.length + ' options'
                        : ''}
                    </span>
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
                        disabled={busy || i === definitions.length - 1}
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
                      disabled={busy || lockedFields.includes(f.key)}
                      onChange={(e) => change(i, { enabled: e.target.checked })}
                    />
                    Visible
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={'Require ' + f.label}
                      checked={f.required}
                      disabled={busy || lockedFields.includes(f.key)}
                      onChange={(e) =>
                        change(i, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  {lockedFields.includes(f.key) && (
                    <span className="muted">
                      Essential field — always visible and required
                    </span>
                  )}
                </div>

                <details className="field-advanced">
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
                    [...new Set(f.options.filter(Boolean))].map((option) => (
                      <label className="status-category" key={option}>
                        {option}
                        <select
                          aria-label={`Category for ${option}`}
                          disabled={busy}
                          value={
                            f.categories?.[option] ?? statusCategory(option)
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
                          <option value="in-progress">In progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      </label>
                    ))}
                  {!lockedFields.includes(f.key) && f.key !== 'issueType' && (
                    <fieldset className="field-scope-choices" disabled={busy}>
                      <legend>Show for issue types</legend>
                      <p className="muted">
                        Leave all unchecked to show for every issue type.
                      </p>
                      {(
                        definitions.find((field) => field.key === 'issueType')
                          ?.options ?? []
                      )
                        .filter(Boolean)
                        .map((type) => (
                          <label key={type}>
                            <input
                              type="checkbox"
                              checked={(f.issueTypes ?? []).includes(type)}
                              onChange={(e) =>
                                change(i, {
                                  issueTypes: e.target.checked
                                    ? [...(f.issueTypes ?? []), type]
                                    : (f.issueTypes ?? []).filter(
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
              </article>
            ))}
            {!definitions.some((f) =>
              (f.label + ' ' + f.type)
                .toLowerCase()
                .includes(fieldSearch.toLowerCase()),
            ) && <p className="muted">No matching fields.</p>}
          </div>
          <section className="detail-panel new-field">
            <h2>Add custom field</h2>
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
                  {['text', 'textarea', 'select', 'number', 'date'].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
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
          </section>
        </>
      )}
    </>
  );
}

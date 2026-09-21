'use client';
import { useEffect, useState } from 'react';
import {
  Inbox,
  RefreshCw,
  Pause,
  Play,
  Download,
  Trash2,
  Plus,
  Link2,
  FolderOpen,
} from 'lucide-react';
import {
  api,
  date,
  type Attachment,
  type Issue,
  type Project,
} from '../lib/bugs';
import { issueLabel } from './issue-identity';
import { InboxPreview } from './inbox-preview';
export type Capture = Attachment & {
  sourcePath: string;
  sourceModified: string;
};
type CaptureSettings = {
  folder: string;
  enabled: boolean;
  extensions: string[];
  nameContains: string;
};
type State = {
  settings: CaptureSettings;
  lastScan: string | null;
  error: string;
  importing: string;
  running: boolean;
  configuring: boolean;
  counts: Record<string, number>;
  suggestedFolder: string;
  supportedExtensions: string[];
  problems: { path: string; state: string; message: string }[];
  files: Capture[];
};
export function AttachmentInbox({
  issues,
  projects,
  onNew,
  onRefresh,
}: {
  issues: Issue[];
  projects: Project[];
  onNew: (captures: Capture[], project?: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [data, setData] = useState<State | null>(null),
    [draft, setDraft] = useState<CaptureSettings | null>(null);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]),
    [issueId, setIssueId] = useState(''),
    [project, setProject] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<State>('inbox');
        if (alive) {
          setData(result);
          setDraft((d) => d ?? result.settings);
          setSelected((ids) =>
            ids.filter((id) => result.files.some((f) => f.id === id)),
          );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setData(await api<State>('inbox'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const chosen = data?.files.filter((f) => selected.includes(f.id)) ?? [];
  return (
    <>
      <div className="breadcrumb">Workspace / Attachment Inbox</div>
      <header>
        <div>
          <p className="eyebrow">CAPTURES FROM YOUR PHONE</p>
          <h1>
            Attachment Inbox{' '}
            <span className="count">{data?.files.length ?? 0}</span>
          </h1>
          <p className="muted">
            Collect first. Turn your evidence into issues when you’re ready.
          </p>
        </div>
        <button onClick={() => setSettingsOpen(!settingsOpen)}>
          <FolderOpen size={18} />
          {settingsOpen ? 'Hide setup' : 'Folder settings'}
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!data || !draft ? (
        <p role="status">Loading capture inbox…</p>
      ) : (
        <>
          <section className="surface inbox-agent-status">
            <div>
              <span
                className={
                  'capture-dot ' + (data.settings.enabled ? 'enabled' : '')
                }
              />
              <strong>
                {data.settings.enabled
                  ? 'Monitoring enabled'
                  : 'Monitoring paused'}
              </strong>
              <p className="muted">
                {data.settings.folder ||
                  'Choose your iCloud Photos folder to begin.'}
              </p>
              <small>
                {data.importing
                  ? 'Importing ' + data.importing
                  : data.running
                    ? 'Checking for new captures…'
                    : data.lastScan
                      ? 'Last checked ' + date(data.lastScan)
                      : 'Waiting for the first scan.'}
              </small>
            </div>
            <div className="actions">
              <button
                disabled={busy || !data.settings.folder}
                onClick={() =>
                  run(async () => {
                    const next = {
                      ...data.settings,
                      enabled: !data.settings.enabled,
                    };
                    const result = await api<State>(
                      'inbox/settings',
                      'PUT',
                      next,
                    );
                    setDraft(result.settings);
                  })
                }
              >
                {data.settings.enabled ? (
                  <Pause size={16} />
                ) : (
                  <Play size={16} />
                )}{' '}
                {data.settings.enabled ? 'Pause' : 'Resume'}
              </button>
              <button
                disabled={busy || !data.settings.enabled}
                onClick={() =>
                  run(async () => {
                    await api('inbox/scan', 'POST', {});
                  })
                }
              >
                <RefreshCw size={16} />
                Check now
              </button>
            </div>
          </section>
          {data.error && (
            <p role="alert" className="error">
              {data.error}
            </p>
          )}
          {(settingsOpen || !data.settings.folder) && (
            <form
              className="detail-panel inbox-settings"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const result = await api<State>(
                    'inbox/settings',
                    'PUT',
                    draft,
                  );
                  setDraft(result.settings);
                  setSettingsOpen(false);
                  setNotice(
                    'Folder configured. Existing files were skipped; new matching files will appear here.',
                  );
                });
              }}
            >
              <h2>Local capture agent</h2>
              <p className="muted">
                Runs while Sentinel is running, even when this page is closed.
                Originals remain in iCloud. Files must be downloaded on this
                computer before import.
              </p>
              <label>
                Folder path
                <input
                  required
                  value={draft.folder}
                  placeholder={data.suggestedFolder}
                  onChange={(e) =>
                    setDraft({ ...draft, folder: e.target.value })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, folder: data.suggestedFolder })
                }
              >
                Use default iCloud Photos path
              </button>
              <fieldset>
                <legend>File types to collect</legend>
                <div className="inbox-extensions">
                  {data.supportedExtensions.map((extension) => (
                    <label key={extension}>
                      <input
                        type="checkbox"
                        checked={draft.extensions.includes(extension)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            extensions: e.target.checked
                              ? [...draft.extensions, extension]
                              : draft.extensions.filter((x) => x !== extension),
                          })
                        }
                      />
                      {extension.slice(1).toUpperCase()}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label>
                Filename contains (optional)
                <input
                  value={draft.nameContains}
                  maxLength={100}
                  onChange={(e) =>
                    setDraft({ ...draft, nameContains: e.target.value })
                  }
                  placeholder="For example: Screenshot"
                />
              </label>
              <p className="muted">
                Matches file types and names. A video may be a camera recording
                or a screen recording; iCloud filenames don’t reliably
                distinguish them. HEIC/HEIF files can be collected but may need
                downloading to view.
              </p>
              <label className="inbox-enable">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, enabled: e.target.checked })
                  }
                />{' '}
                Enable monitoring
              </label>
              <button className="primary" disabled={busy}>
                {busy ? 'Configuring…' : 'Save folder settings'}
              </button>
            </form>
          )}
          {!!data.problems.length && (
            <details className="inbox-problems">
              <summary>
                {(data.counts.waiting ?? 0) +
                  (data.counts.error ?? 0) +
                  (data.counts.skipped ?? 0)}{' '}
                captures waiting or needing attention
              </summary>
              <ul>
                {data.problems.map((p) => (
                  <li key={p.path}>
                    <strong>{p.path}</strong>
                    <span>{p.message}</span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                For files waiting on iCloud, choose “Always keep on this device”
                in Windows Explorer. Oversized files need to be shortened or
                compressed below 250 MB.
              </p>
            </details>
          )}
          <div className="inbox-selection surface">
            <strong>{selected.length} selected</strong>
            <select
              aria-label="Project for captures"
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setIssueId('');
              }}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              className="primary"
              disabled={busy || !chosen.length}
              onClick={() => onNew(chosen, project || undefined)}
            >
              <Plus size={16} />
              New issue with captures
            </button>
            <select
              aria-label="Existing issue for captures"
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
            >
              <option value="" disabled>
                Choose existing issue…
              </option>
              {issues
                .filter((i) => !project || i.project === project)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {issueLabel(i.id, i.issueType)} · {i.title}
                  </option>
                ))}
            </select>
            <button
              disabled={busy || !selected.length || !issueId}
              onClick={() =>
                run(async () => {
                  await api('inbox/assign', 'POST', {
                    ids: selected,
                    issueId: Number(issueId),
                  });
                  await onRefresh();
                  setSelected([]);
                  setNotice('Captures attached to the issue.');
                })
              }
            >
              <Link2 size={16} />
              Attach
            </button>
            {!!selected.length && (
              <button disabled={busy} onClick={() => setSelected([])}>
                Clear selection
              </button>
            )}
          </div>
          {!data.files.length ? (
            <section className="empty">
              <Inbox size={42} />
              <h2>Ready for your next capture</h2>
              <p>
                New matching files will appear after iCloud downloads them and
                they finish syncing.
              </p>
            </section>
          ) : (
            <ul className="attachment-grid inbox-grid">
              {data.files.map((file) => (
                <li
                  className={
                    'attachment-card ' +
                    (selected.includes(file.id) ? 'capture-selected' : '')
                  }
                  key={file.id}
                >
                  <InboxPreview file={file} />
                  <div className="attachment-caption">
                    <label className="capture-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.name}`}
                        disabled={
                          busy ||
                          (!selected.includes(file.id) && selected.length >= 20)
                        }
                        checked={selected.includes(file.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, file.id]
                              : ids.filter((id) => id !== file.id),
                          )
                        }
                      />
                      <span className="attachment-name" title={file.name}>
                        {file.name}
                      </span>
                    </label>
                    <small>
                      {(file.size / 1_000_000).toFixed(1)} MB · Imported{' '}
                      {date(file.createdAt)}
                    </small>
                    <div className="attachment-controls">
                      <a
                        className="button"
                        href={'/api/inbox/' + file.id}
                        download={file.name}
                        aria-label={`Download ${file.name}`}
                      >
                        <Download size={16} />
                      </a>
                      <button
                        disabled={busy}
                        aria-label={`Discard ${file.name}`}
                        onClick={() => {
                          if (
                            confirm(
                              `Discard ${file.name} from Sentinel’s inbox? The iCloud original stays untouched.`,
                            )
                          )
                            run(async () => {
                              await api('inbox/' + file.id, 'DELETE');
                              setSelected((ids) =>
                                ids.filter((id) => id !== file.id),
                              );
                            });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted inbox-footnote">
            Up to 250 MB per file · Select up to 20 captures ·{' '}
            {data.counts.ignored ?? 0} existing files skipped ·{' '}
            {data.counts.duplicate ?? 0} duplicates skipped
          </p>
        </>
      )}
    </>
  );
}

'use client';
import { AccountPicker } from '../components/account-picker';
import { IssueTrash } from '../components/issue-trash';
import { PeopleSettings } from '../components/people-settings';
import { priorityLabel } from '../lib/priority';
import { useAccess } from '../components/account-gate';
import { createPortal } from 'react-dom';

import { IssueIdentity, issueLabel } from '../components/issue-identity';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bug,
  Plus,
  Search,
  List,
  Columns3,
  Download,
  Upload,
  X,
  Pencil,
  Settings,
  AppWindow,
  Inbox,
  Trash2,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { QuickField } from '../components/quick-fields';
import { ProjectBadge } from '../components/project-badge';
import { ComponentPicker } from '../components/component-picker';
import { ProjectPicker } from '../components/project-picker';
import { WorkspacePanel } from '../components/workspace-panel';
import { ProjectsOverview } from '../components/projects-overview';
import { AttachmentInbox, type Capture } from '../components/attachment-inbox';
import {
  defaultFields,
  fieldApplies,
  fieldLabel,
  statusCategory,
  type FieldDefinition,
} from '../lib/field-schema.mjs';
import { uploadAttachment, type Project } from '../lib/bugs';
import { BugDetails } from '../components/bug-details';
import { blank, api, badge, date, type Report, type Issue } from '../lib/bugs';
import {
  readDraft,
  writeDraft,
  readReportContext,
  rememberReportContext,
  type ReportDraft,
} from '../lib/report-drafts';
export default function Home({ bugId }: { bugId?: string }) {
  const { owner, enabled: accountsEnabled, user, searchSlot } = useAccess();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pageSize, setPageSize] = useState(25);
  const [issuePage, setIssuePage] = useState(1);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem('sentinel.pageSize'));
      if ([10, 25, 50, 100].includes(saved)) setPageSize(saved);
    } catch {}
  }, []);
  const activeProjectId = Number(searchParams.get('project')) || null;
  const returnProject = searchParams.get('fromProject');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState('');
  const [draggedIssue, setDraggedIssue] = useState<number | null>(null);
  const quickChange = async (
    issue: Issue,
    field: 'status' | 'priority',
    value: string,
  ) => {
    if (
      field === 'status' &&
      value === 'Resolved' &&
      !issue.fixVersion?.trim()
    ) {
      start(issue);
      setForm((current) => ({ ...current, status: 'Resolved' }));
      setFormError('Enter the Fix Version before resolving this issue.');
      return;
    }
    setQuickBusy(true);
    setQuickError('');
    try {
      await api('bugs/' + issue.id + '/quick', 'POST', { [field]: value });
      await load();
    } catch (e) {
      setQuickError((e as Error).message);
    } finally {
      setQuickBusy(false);
    }
  };
  useEffect(() => {
    const next = searchParams.get('view');
    if (next === 'admin' && searchParams.get('editProject'))
      setAdminSection('projects');
    setView(
      next &&
        ['board', 'projects', 'admin', 'inbox', 'mine', 'trash'].includes(next)
        ? next
        : 'list',
    );
  }, [searchParams.toString()]);
  const [adminSection, setAdminSection] = useState<
    'admin' | 'projects' | 'people'
  >('admin');
  const adminDirty = useRef<Record<string, boolean>>({});
  const [adminDirtyHandlers] = useState(() => ({
    admin: (dirty: boolean) => {
      adminDirty.current.admin = dirty;
    },
    projects: (dirty: boolean) => {
      adminDirty.current.projects = dirty;
    },
  }));
  useEffect(() => {
    const leave = (event: Event) => {
      if (
        Object.values(adminDirty.current).some(Boolean) &&
        !confirm('Leave Admin and discard unsaved settings?')
      )
        event.preventDefault();
    };
    window.addEventListener('sentinel-before-navigation', leave);
    return () =>
      window.removeEventListener('sentinel-before-navigation', leave);
  }, []);
  const navigate = (url: string) => {
    if (
      Object.values(adminDirty.current).some(Boolean) &&
      !confirm('Leave Admin and discard unsaved settings?')
    )
      return;
    adminDirty.current = {};
    router.push(url);
  };
  const pageContent = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const closeSearch = () => {
    setQuery('');
    searchInput.current?.focus();
  };
  const [uploadStatus, setUploadStatus] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [fieldConfig, setFieldConfig] =
    useState<FieldDefinition[]>(defaultFields);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingCaptures, setPendingCaptures] = useState<Capture[]>([]);
  const [bugs, setBugs] = useState<Issue[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [view, setView] = useState('list'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [priority, setPriority] = useState(''),
    [project, setProject] = useState(''),
    [sort, setSort] = useState('created');
  const [editing, setEditing] = useState<Issue | null>(null),
    [form, setForm] = useState<Report>(blank),
    [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(''),
    [comment, setComment] = useState('');
  const dialog = useRef<HTMLDialogElement>(null),
    file = useRef<HTMLInputElement>(null);
  const attachmentsInput = useRef<HTMLInputElement>(null);
  const reportTitleInput = useRef<HTMLInputElement>(null);
  const editorOrigin = useRef<DOMRect | null>(null);
  const draftBaseline = useRef<Report>(blank);
  const draftKey = user ? 'account:' + user.id + ':' + user.email : 'local';
  const [storedDraft, setStoredDraft] = useState<ReportDraft | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftActive, setDraftActive] = useState(false);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftError, setDraftError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const draftRevision = useRef(0);
  const creationToken = useRef('');
  const quickReport = !editing || !!editing.quickReport;
  const dirty = useCallback(
    () =>
      Object.keys(blank).some(
        (k) =>
          JSON.stringify(form[k as keyof Report]) !==
          JSON.stringify(draftBaseline.current[k as keyof Report]),
      ) ||
      !!comment.trim() ||
      pendingFiles.length > 0 ||
      pendingCaptures.length > 0,
    [form, comment, pendingFiles, pendingCaptures],
  );
  useEffect(() => {
    let active = true;
    readDraft(draftKey)
      .then((draft) => {
        if (active) setStoredDraft(draft);
      })
      .catch(() => {
        if (active)
          setDraftError(
            'Automatic draft saving is unavailable in this browser. Keep this page open until you submit.',
          );
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
    };
  }, [draftKey]);
  const snapshotDraft = useCallback(
    (): ReportDraft => ({
      creationToken: creationToken.current,
      form,
      files: pendingFiles,
      captures: pendingCaptures,
      comment,
      updatedAt: new Date().toISOString(),
      ...(editing
        ? { issueId: editing.id, issueCreatedAt: editing.createdAt }
        : {}),
    }),
    [form, pendingFiles, pendingCaptures, comment, editing],
  );
  const persistDraft = useCallback(
    async (draft: ReportDraft) => {
      await writeDraft(draftKey, draft);
      setStoredDraft(draft);
    },
    [draftKey],
  );
  const hasStoredDraft = storedDraft !== null;
  useEffect(() => {
    if (!opened || !draftActive || busy || (!dirty() && !hasStoredDraft))
      return;
    const revision = ++draftRevision.current;
    setDraftStatus('Saving draft…');
    const timer = setTimeout(() => {
      void persistDraft(snapshotDraft())
        .then(() => {
          if (revision === draftRevision.current) {
            setDraftStatus('Draft saved on this device');
            setDraftError('');
          }
        })
        .catch(() => {
          if (revision === draftRevision.current) {
            setDraftStatus('Draft not saved');
            setDraftError(
              'Could not save this draft on your device. Storage may be full. Keep this page open, remove large files, or submit your report.',
            );
          }
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      draftRevision.current++;
    };
  }, [
    form,
    pendingFiles,
    pendingCaptures,
    opened,
    draftActive,
    busy,
    editing?.id,
    dirty,
    hasStoredDraft,
    snapshotDraft,
    persistDraft,
  ]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        opened &&
        (busy ||
          (dirty() &&
            (!draftActive || draftStatus !== 'Draft saved on this device')))
      ) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [
    opened,
    busy,
    form,
    pendingFiles,
    pendingCaptures,
    draftActive,
    draftStatus,
    comment,
    dirty,
  ]);
  const navigation = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLButtonElement>('.nav.active');
      if (active)
        setHighlight({
          x: active.offsetLeft,
          y: active.offsetTop,
          width: active.offsetWidth,
          height: active.offsetHeight,
        });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    nav.querySelectorAll('.nav').forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [view]);
  const statuses = Array.from(
    new Set([
      ...(fieldConfig.find((f) => f.key === 'status')?.options ?? []),
      ...bugs.map((b) => b.status),
    ]),
  );
  const priorities = Array.from(
    new Set([
      ...(fieldConfig.find((f) => f.key === 'priority')?.options ?? []),
      ...bugs.map((b) => b.priority),
    ]),
  );
  const newReport = (): Report => {
    const context = readReportContext(draftKey);
    const chosen =
      projects.find((p) => p.id === activeProjectId) ??
      projects.find((p) => p.name === project) ??
      projects.find((p) => p.id === context.projectId) ??
      (projects.length === 1 ? projects[0] : undefined);
    const remembered = chosen ? context.byProject[chosen.id] : undefined;
    const draft = {
      ...blank,
      customFields: {},
      project: chosen?.name ?? '',
      reporter: user?.email ?? '',
      environment: remembered?.environment ?? '',
      version: remembered?.version ?? '',
    };
    for (const f of fieldConfig.filter(
      (f) => f.builtin && f.type === 'select',
    )) {
      if (!f.options.includes(String(draft[f.key as keyof Report])))
        (draft as unknown as Record<string, unknown>)[f.key] = f.required
          ? f.options[0]
          : '';
    }
    return draft;
  };
  const selected = bugId ? bugs.find((b) => String(b.id) === bugId) : undefined;
  const load = async () => {
    const [reports, profiles, config] = await Promise.all([
      api<Issue[]>('bugs'),
      api<Project[]>('projects'),
      api<FieldDefinition[]>('fields'),
    ]);
    setBugs(reports);
    setProjects(profiles);
    setProject((current) =>
      profiles.some((p) => p.name === current) ? current : '',
    );
    setFieldConfig(config);
  };
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('view');
    try {
      // Apply the requested creation-date default once, including existing browsers.
      if (!localStorage.getItem('sentinel.creationSortDefault')) {
        localStorage.setItem('sentinel.issueSort', 'created');
        localStorage.setItem('sentinel.creationSortDefault', '1');
      }
      const savedSort = localStorage.getItem('sentinel.issueSort');
      if (savedSort && ['updated', 'created', 'priority'].includes(savedSort)) {
        setSort(savedSort);
      }
    } catch {
      // Sorting still works when browser storage is unavailable.
    }
    const initialQuery = new URLSearchParams(window.location.search).get('q');
    if (initialQuery) {
      setQuery(initialQuery);
    }
    if (
      tab &&
      ['board', 'projects', 'admin', 'inbox', 'mine', 'trash'].includes(tab)
    )
      setView(tab);
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const editor = dialog.current;
    if (!editor) return;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (opened) {
      editor.showModal();
      reportTitleInput.current?.focus();
    } else if (!editor.open) return;
    if (reduced) {
      if (!opened) editor.close();
      return;
    }
    const target = editor.getBoundingClientRect();
    const origin = editorOrigin.current;
    const x = origin
      ? origin.x + origin.width / 2 - target.x - target.width / 2
      : 0;
    const y = origin
      ? origin.y + origin.height / 2 - target.y - target.height / 2
      : 24;
    const small = `translate(${x}px, ${y}px) scale(${origin ? Math.max(0.08, origin.width / target.width) : 0.9}, ${origin ? Math.max(0.06, origin.height / target.height) : 0.9})`;
    const animation = editor.animate(
      opened
        ? [
            { transform: small, opacity: 0.15 },
            {
              transform: 'translate(0, 0) scale(1.015)',
              opacity: 1,
              offset: 0.78,
            },
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          ]
        : [
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            { transform: small, opacity: 0 },
          ],
      {
        duration: opened ? 440 : 220,
        easing: opened ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease-in',
        fill: 'both',
      },
    );
    animation.onfinish = () => {
      if (!opened) editor.close();
      animation.cancel();
    };
    return () => animation.cancel();
  }, [opened]);
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: unknown,
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'search_bugs',
          description:
            'Search saved local bug reports and apply the search to the visible list.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: unknown) => {
            if (
              !input ||
              typeof (input as { query?: unknown }).query !== 'string'
            )
              throw Error('query must be a string');
            const q = (input as { query: string }).query;
            const data: Issue[] = await api<Issue[]>('bugs');
            setBugs(data);
            setQuery(q);
            setStatus('');
            setPriority('');
            setProject('');
            return data
              .filter((b) =>
                (
                  issueLabel(b.id, b.issueType, b.issueKey) +
                  ' BUG-' +
                  b.id +
                  ' ' +
                  JSON.stringify(b)
                )
                  .toLowerCase()
                  .includes(q.toLowerCase()),
              )
              .map((b) => ({ id: b.id, title: b.title, status: b.status }));
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  const start = async (
    issue?: Issue,
    projectName?: string,
    captures: Capture[] = [],
  ) => {
    if (!draftReady && !issue) return;
    editorOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.getBoundingClientRect()
        : null;
    let restored = !issue ? storedDraft : null;
    const restoredIssueId = restored?.issueId;
    const savedIssue = restoredIssueId
      ? bugs.find((b) => b.id === restoredIssueId)
      : undefined;
    if (
      restored?.issueId &&
      (!savedIssue || savedIssue.createdAt !== restored.issueCreatedAt)
    ) {
      setError(
        'The issue linked to your draft is no longer available. Discard the draft before starting a new report; no files have been attached.',
      );
      return;
    }
    let captureNotice = '';
    if (restored?.captures.length) {
      try {
        const inbox = await api<{ files: Capture[] }>('inbox');
        const available = restored.captures.filter((c) =>
          inbox.files.some((f) => f.id === c.id),
        );
        if (available.length !== restored.captures.length)
          captureNotice =
            'Some saved captures are no longer in the inbox and were removed from this draft.';
        restored = { ...restored, captures: available };
      } catch {
        setError(
          'Could not check your saved inbox captures. Please try again. Your draft is safe.',
        );
        return;
      }
    }
    const mergedCaptures = [
      ...(restored?.captures ?? []),
      ...captures.filter((c) => !restored?.captures.some((f) => f.id === c.id)),
    ];
    if (mergedCaptures.length + (restored?.files.length ?? 0) > 20) {
      setError(
        'Your saved draft and this selection contain more than 20 attachments. Resume the draft and remove some files first.',
      );
      return;
    }
    setEditing(issue || savedIssue || null);
    setPendingFiles(restored?.files ?? []);
    setPendingCaptures(mergedCaptures);
    const draft = issue
      ? { ...blank, ...issue }
      : restored
        ? { ...blank, ...restored.form }
        : { ...newReport(), ...(projectName ? { project: projectName } : {}) };
    if (!issue && !restored && projectName) {
      const chosen = projects.find((p) => p.name === projectName);
      const context = chosen
        ? readReportContext(draftKey).byProject[chosen.id]
        : undefined;
      draft.environment =
        context &&
        fieldConfig
          .find((f) => f.key === 'environment')
          ?.options.includes(context.environment)
          ? context.environment
          : '';
      draft.version = context?.version ?? '';
    }
    draftBaseline.current = draft;
    creationToken.current = restored?.creationToken || crypto.randomUUID();
    setForm(draft);
    setFormError(captureNotice);
    setDraftActive(!issue);
    setDraftStatus(
      restored
        ? 'Draft restored · saved on this device'
        : 'Drafts save automatically on this device',
    );
    setDetailsOpen(!!issue || !!savedIssue);
    setComment(restored?.comment ?? '');
    setOpened(true);
  };
  const close = async () => {
    if (busy) return;
    if (draftActive && (dirty() || storedDraft)) {
      setBusy(true);
      try {
        await persistDraft(snapshotDraft());
        setDraftError('');
      } catch {
        setDraftError(
          'Your draft could not be saved. Keep the form open to submit it, or choose Discard draft.',
        );
        return;
      } finally {
        setBusy(false);
      }
    } else if (dirty() && !confirm('Discard unsaved changes?')) return;
    setOpened(false);
  };
  const discardDraft = async () => {
    if (
      busy ||
      !confirm(
        'Discard this draft and its selected files? Inbox captures will stay in the inbox.',
      )
    )
      return;
    setBusy(true);
    try {
      await writeDraft(draftKey, null);
      setStoredDraft(null);
      setDraftActive(false);
      setPendingFiles([]);
      setPendingCaptures([]);
      setOpened(false);
      setDraftError('');
    } catch {
      setDraftError('Could not remove the saved draft. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const update = (key: string, value: string) => {
    setForm((f) => {
      if (key === 'project' && !editing) {
        const selectedProject = projects.find((p) => p.name === value);
        const context = selectedProject
          ? readReportContext(draftKey).byProject[selectedProject.id]
          : undefined;
        return {
          ...f,
          project: value,
          environment:
            context &&
            fieldConfig
              .find((field) => field.key === 'environment')
              ?.options.includes(context.environment)
              ? context.environment
              : '',
          version: context?.version ?? '',
        };
      }
      return key in blank
        ? { ...f, [key]: value }
        : { ...f, customFields: { ...f.customFields, [key]: value } };
    });
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (comment.trim()) {
      setFormError('Add your comment or clear it before saving the report.');
      return;
    }
    setBusy(true);
    setFormError('');
    let savedReport: Issue | undefined;
    try {
      if (draftActive && !editing)
        await persistDraft(snapshotDraft()).catch(() => {});
      const saved = await api<Issue & { creationReplayed?: boolean }>(
        editing ? 'bugs/' + editing.id : 'bugs',
        editing ? 'PUT' : 'POST',
        editing
          ? {
              ...form,
              ...(draftActive ? { expectedCreatedAt: editing.createdAt } : {}),
            }
          : {
              ...form,
              quickReport: true,
              creationToken: creationToken.current,
            },
      );
      setEditing(saved);
      setUploadStatus('');
      savedReport = saved;
      if (!editing && saved.creationReplayed) {
        await persistDraft({
          ...snapshotDraft(),
          issueId: saved.id,
          issueCreatedAt: saved.createdAt,
        }).catch(() => {});
        setDetailsOpen(true);
        setFormError(
          'This issue was already created. Your latest draft is still here. Review it and choose Save changes to apply your edits and attach the selected files.',
        );
        await load();
        return;
      }
      const savedProject =
        projects.find(
          (p) => p.name.toLowerCase() === saved.project.toLowerCase(),
        ) ??
        (await api<Project[]>('projects')).find(
          (p) => p.name.toLowerCase() === saved.project.toLowerCase(),
        );
      rememberReportContext(draftKey, savedProject?.id, saved);
      let remainingFiles = [...pendingFiles];
      let remainingCaptures = [...pendingCaptures];
      const saveRemaining = async () => {
        if (!draftActive) return;
        await persistDraft({
          creationToken: creationToken.current,
          form: saved,
          files: remainingFiles,
          captures: remainingCaptures,
          issueId: saved.id,
          issueCreatedAt: saved.createdAt,
          updatedAt: new Date().toISOString(),
        }).catch(() => {
          setDraftError(
            'The report was saved, but upload progress could not be saved on this device. Keep this form open until uploads finish.',
          );
        });
      };
      await saveRemaining();
      for (const file of pendingFiles) {
        await uploadAttachment(saved.id, file, (percent) =>
          setUploadStatus(file.name + ' — ' + percent + '%'),
        );
        setPendingFiles((files) => files.filter((f) => f !== file));
        remainingFiles = remainingFiles.filter((f) => f !== file);
        await saveRemaining();
      }
      if (pendingCaptures.length) {
        await api('inbox/assign', 'POST', {
          ids: pendingCaptures.map((capture) => capture.id),
          issueId: saved.id,
        });
        setPendingCaptures([]);
        remainingCaptures = [];
        await saveRemaining();
      }
      await load();
      if (draftActive) {
        await writeDraft(draftKey, null).catch(() => {});
        setStoredDraft(null);
        setDraftActive(false);
      }
      setOpened(false);
      setUploadStatus('');
      setNotice(editing ? 'Issue updated.' : 'Issue created.');
      if (!editing)
        router.push(
          '/bugs/' +
            saved.id +
            (activeProjectId ? '?fromProject=' + activeProjectId : ''),
        );
    } catch (e) {
      setFormError(
        savedReport
          ? 'Issue saved. ' +
              (e as Error).message +
              ' Remaining files are still selected; retry Save changes or remove them.'
          : (e as Error).message,
      );
      if (savedReport) await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !editing ||
      !confirm(
        'Move ' +
          issueLabel(editing.id, editing.issueType, editing.issueKey) +
          ' to Trash? You can restore it with its attachments later.',
      )
    )
      return;
    setBusy(true);
    try {
      await api('bugs/' + editing.id, 'DELETE');
      await load();
      setOpened(false);
      setUploadStatus('');
      setNotice(
        'Issue moved to Trash. Restore it any time from Trash in the sidebar.',
      );
      if (bugId) router.push('/');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addComment = async () => {
    const target = opened ? editing : selected;
    if (!target) return;
    setBusy(true);
    setFormError('');
    try {
      const saved = await api<Issue>(
        'bugs/' + target.id + '/comments',
        'POST',
        { text: comment },
      );
      if (opened) setEditing(saved);
      setComment('');
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const backup = async () => {
    try {
      const data = await api('backup');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download =
        'sentinel-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Backup exported. Keep it somewhere safe.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async (f?: File) => {
    if (!f) return;
    setError('');
    if (f.size > 100000000) {
      setError('Backup must be smaller than 100 MB.');
      return;
    }
    if (
      !confirm(
        'Import issues as new records? Existing issues will stay unchanged. Importing the same backup twice creates duplicates.',
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api<{ imported: number }>(
        'import',
        'POST',
        JSON.parse(await f.text()),
      );
      await load();
      setNotice('Imported ' + result.imported + ' issues with new IDs.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const scopedBugs =
    view === 'mine'
      ? bugs.filter(
          (b) =>
            !!user && (b.assignee === user.email || b.reporter === user.email),
        )
      : bugs;
  const visible = scopedBugs
    .filter(
      (b) =>
        (view !== 'mine' ||
          (!!user &&
            (b.assignee === user.email || b.reporter === user.email))) &&
        (!status || b.status === status) &&
        (!priority || b.priority === priority) &&
        (!project || b.project === project) &&
        (
          issueLabel(b.id, b.issueType, b.issueKey) +
          ' BUG-' +
          b.id +
          ' ' +
          JSON.stringify(b)
        )
          .toLowerCase()
          .includes(['list', 'mine'].includes(view) ? query.toLowerCase() : ''),
    )
    .sort((a, b) =>
      sort === 'priority'
        ? priorities.indexOf(b.priority) - priorities.indexOf(a.priority)
        : sort === 'created'
          ? b.createdAt.localeCompare(a.createdAt) || b.id - a.id
          : b.updatedAt.localeCompare(a.updatedAt),
    );
  useEffect(() => {
    setIssuePage(1);
  }, [query, project, status, priority, sort, pageSize, view]);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(issuePage, pageCount);
  const firstIssue = (currentPage - 1) * pageSize;
  const pageIssues = visible.slice(firstIssue, firstIssue + pageSize);
  useEffect(() => {
    if (issuePage > pageCount) setIssuePage(pageCount);
  }, [issuePage, pageCount]);
  const renderField = (definition: FieldDefinition) => {
    const f = quickReport
      ? {
          ...definition,
          required:
            ['title', 'project', 'status', 'priority'].includes(
              definition.key,
            ) ||
            (definition.key === 'fixVersion' && form.status === 'Resolved'),
        }
      : definition;
    const value = f.builtin
      ? String(form[f.key as keyof Report] ?? '')
      : (form.customFields[f.key] ?? '');
    if (['assignee', 'reporter'].includes(f.key))
      return (
        <AccountPicker
          key={f.key}
          value={value}
          label={f.label}
          required={f.required}
          onChange={(value) => update(f.key, value)}
        />
      );
    if (f.key === 'version' && f.type === 'text')
      return (
        <ComponentPicker
          key={'version-' + form.project}
          kind="version"
          label={f.label}
          required={f.required}
          value={value}
          onChange={(value) => update('version', value)}
          options={
            projects.find(
              (p) => p.name.toLowerCase() === form.project.trim().toLowerCase(),
            )?.versions ?? []
          }
        />
      );
    if (f.key === 'component')
      return (
        <ComponentPicker
          key={f.key}
          label={f.label}
          required={f.required}
          value={value}
          onChange={(value) => update('component', value)}
          options={
            projects.find(
              (p) => p.name.toLowerCase() === form.project.trim().toLowerCase(),
            )?.components ?? []
          }
        />
      );
    if (f.key === 'project')
      return (
        <ProjectPicker
          key={'project-' + opened + '-' + (editing?.id ?? 'new')}
          projects={projects}
          value={value}
          label={f.label}
          required={f.required}
          onChange={(value) => update('project', value)}
        />
      );
    return (
      <label
        key={f.key}
        className={f.key === 'title' || f.type === 'textarea' ? 'full' : ''}
      >
        {fieldLabel(f, form.issueType)}
        {f.required ? ' *' : ''}
        {f.type === 'textarea' ? (
          <textarea
            required={f.required}
            maxLength={20000}
            value={value}
            onChange={(e) => update(f.key, e.target.value)}
          />
        ) : f.type === 'select' ? (
          <select
            required={f.required}
            value={value}
            onChange={(e) => update(f.key, e.target.value)}
          >
            <option value="" disabled={f.required}>
              Choose…
            </option>
            {Array.from(new Set([...f.options, ...(value ? [value] : [])])).map(
              (o) => (
                <option key={o} value={o}>
                  {f.key === 'priority' ? priorityLabel(o) : o}
                </option>
              ),
            )}
          </select>
        ) : (
          <input
            ref={f.key === 'title' ? reportTitleInput : undefined}
            type={f.type}
            step={f.type === 'number' ? 'any' : undefined}
            autoFocus={f.key === 'title'}
            required={f.required}
            maxLength={500}
            placeholder={
              f.key === 'title'
                ? 'e.g. Login closes when I tap Continue'
                : f.key === 'reproRate'
                  ? 'e.g. 3/5 attempts (60%)'
                  : f.key === 'component'
                    ? 'e.g. Login, Payments, Settings'
                    : undefined
            }
            value={value}
            onChange={(e) => update(f.key, e.target.value)}
          />
        )}
      </label>
    );
  };
  const queueFiles = (files: File[]) => {
    if (busy || !files.length) return;
    if (files.some((f) => f.size > 250_000_000)) {
      setFormError('Each attachment must be at most 250 MB.');
      return;
    }
    if (pendingFiles.length + pendingCaptures.length + files.length > 20) {
      setFormError('Select up to 20 attachments.');
      return;
    }
    setPendingFiles((current) => [...current, ...files]);
    setFormError('');
  };
  const reportFields = fieldConfig
    .filter(
      (f) =>
        fieldApplies(f, form.issueType) ||
        (f.key === 'fixVersion' && form.status === 'Resolved'),
    )
    .map((f) =>
      f.key === 'fixVersion' && form.status === 'Resolved'
        ? { ...f, required: true }
        : f,
    );
  return (
    <div className="shell">
      {searchSlot &&
        createPortal(
          <form
            className="workspace-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              if (bugId) router.push('/?q=' + encodeURIComponent(query));
              else if (!['list', 'board'].includes(view)) setView('list');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSearch();
              }
            }}
          >
            <button
              type="button"
              className="search-toggle"
              aria-label="Search issues"
              aria-controls="floating-issue-search"
              onClick={() => {
                searchInput.current?.focus();
              }}
            >
              <Search size={21} />
            </button>
            <input
              id="floating-issue-search"
              ref={searchInput}
              aria-label="Search issues"
              placeholder={
                bugId
                  ? 'Search issues, then press Enter…'
                  : 'Search issues by title, ID, or details…'
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (!bugId && !['list', 'board'].includes(view))
                  setView('list');
              }}
            />
            {query && (
              <button
                type="button"
                className="search-close"
                aria-label="Clear search"
                onClick={closeSearch}
              >
                <X size={18} />
              </button>
            )}
          </form>,
          searchSlot,
        )}
      <aside>
        <p className="eyebrow">YOUR WORKSPACE</p>
        <nav className="workspace-nav" ref={navigation} aria-label="Workspace">
          <span
            className="nav-highlight"
            aria-hidden="true"
            style={{
              transform: `translate(${highlight.x}px, ${highlight.y}px)`,
              width: highlight.width,
              height: highlight.height,
              visibility: highlight.width ? 'visible' : 'hidden',
            }}
          />
          <button
            className={'nav ' + (view === 'list' ? 'active' : '')}
            onClick={() => navigate('/')}
          >
            <List size={18} /> All issues
          </button>
          {user && (
            <button
              className={'nav ' + (view === 'mine' ? 'active' : '')}
              onClick={() => navigate('/?view=mine')}
            >
              <UserRound size={18} /> My issues
            </button>
          )}
          <button
            className={'nav ' + (view === 'trash' ? 'active' : '')}
            onClick={() => navigate('/?view=trash')}
          >
            <Trash2 size={18} /> Trash
          </button>
          <button
            className={'nav ' + (view === 'board' ? 'active' : '')}
            onClick={() => navigate('/?view=board')}
          >
            <Columns3 size={18} /> Status board
          </button>
          <button
            className={'nav ' + (view === 'projects' ? 'active' : '')}
            onClick={() => navigate('/?view=projects')}
          >
            <AppWindow size={18} /> Projects
          </button>
          <button
            className={'nav ' + (view === 'inbox' ? 'active' : '')}
            onClick={() => navigate('/?view=inbox')}
          >
            <Inbox size={18} /> Attachment Inbox
          </button>
          {owner && (
            <button
              className={'nav ' + (view === 'admin' ? 'active' : '')}
              onClick={() => navigate('/?view=admin')}
            >
              <Settings size={18} /> Admin
            </button>
          )}
        </nav>
        <div className="local">
          ● {accountsEnabled ? 'Private workspace' : 'Local workspace'}
        </div>
      </aside>
      <main ref={pageContent}>
        {quickError && (
          <p role="alert" className="error">
            {quickError}
          </p>
        )}
        {!bugId &&
        (view === 'projects' ||
          view === 'admin' ||
          view === 'inbox' ||
          view === 'trash') ? (
          loading ? (
            <p role="status">Loading workspace…</p>
          ) : error ? (
            <div className="error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError('');
                  load().catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          ) : view === 'trash' ? (
            <IssueTrash onRefresh={load} />
          ) : view === 'inbox' ? (
            <AttachmentInbox
              issues={bugs}
              projects={projects}
              onRefresh={load}
              onNew={(captures, projectName) =>
                start(undefined, projectName, captures)
              }
            />
          ) : view === 'projects' ? (
            <ProjectsOverview
              projects={projects}
              issues={bugs}
              fields={fieldConfig}
              selectedId={activeProjectId}
              onNew={(name) => start(undefined, name)}
              onQuick={quickChange}
              busy={quickBusy}
            />
          ) : !owner ? (
            <p>Only the workspace owner can access administration.</p>
          ) : (
            <>
              <nav className="admin-sections" aria-label="Admin categories">
                <button
                  aria-pressed={adminSection === 'admin'}
                  onClick={() => setAdminSection('admin')}
                >
                  Issue fields
                </button>
                <button
                  aria-pressed={adminSection === 'projects'}
                  onClick={() => setAdminSection('projects')}
                >
                  Projects
                </button>
                {accountsEnabled && (
                  <button
                    aria-pressed={adminSection === 'people'}
                    onClick={() => setAdminSection('people')}
                  >
                    People
                  </button>
                )}
              </nav>
              {adminSection === 'people' && (
                <PeopleSettings issues={bugs} onRefresh={load} />
              )}
              {(['admin', 'projects'] as const).map((section) => (
                <div key={section} hidden={adminSection !== section}>
                  <WorkspacePanel
                    key={section + (searchParams.get('editProject') ?? '')}
                    initialProjectId={
                      Number(searchParams.get('editProject')) || null
                    }
                    mode={section}
                    projects={projects}
                    fields={fieldConfig}
                    onRefresh={load}
                    onDirtyChange={adminDirtyHandlers[section]}
                  />
                </div>
              ))}
            </>
          )
        ) : bugId ? (
          loading ? (
            <div className="empty" role="status">
              Loading issue details…
            </div>
          ) : error ? (
            <div className="error" role="alert">
              {error}
              <button
                onClick={() => {
                  setError('');
                  load().catch((e) => setError(e.message));
                }}
              >
                Retry
              </button>
            </div>
          ) : selected ? (
            <BugDetails
              issues={bugs}
              onRefresh={load}
              onQuick={quickChange}
              quickBusy={quickBusy}
              backHref={
                returnProject
                  ? '/?view=projects&project=' +
                    encodeURIComponent(returnProject)
                  : '/'
              }
              issue={selected}
              projects={projects}
              fields={fieldConfig}
              onEdit={() => {
                if (comment.trim() && !confirm('Discard your unsaved comment?'))
                  return;
                start(selected);
              }}
              comment={comment}
              onCommentChange={setComment}
              onAddComment={addComment}
              busy={busy}
              error={opened ? '' : formError}
              notice={notice}
            />
          ) : (
            <section className="empty">
              <h1>Issue not found</h1>
              <p>
                This issue may be in <Link href="/?view=trash">Trash</Link>,
                where you can restore it.
              </p>
              <Link className="button" href="/">
                Back to issues
              </Link>
            </section>
          )
        ) : (
          <>
            <div className="breadcrumb">Workspace / Issues</div>
            <header className="issues-heading">
              <div>
                <h1>
                  {view === 'mine'
                    ? 'My issues'
                    : view === 'list'
                      ? 'All issues'
                      : 'Status board'}
                  <span className="count">{scopedBugs.length}</span>
                </h1>
              </div>
              <button
                className="primary"
                onClick={() => start()}
                disabled={loading || !draftReady}
              >
                <Plus size={18} /> {storedDraft ? 'Resume draft' : 'New issue'}
              </button>
            </header>
            {view === 'mine' && (
              <p className="muted">
                Issues assigned to you or reported by you.
              </p>
            )}
            <div className="stats">
              {[
                [
                  'Open issues',
                  scopedBugs.filter(
                    (b) =>
                      statusCategory(b.status, fieldConfig) !== 'completed',
                  ).length,
                ],
                [
                  'In progress',
                  scopedBugs.filter(
                    (b) =>
                      statusCategory(b.status, fieldConfig) === 'in-progress',
                  ).length,
                ],
                [
                  priorityLabel('Critical') + ' priority',
                  scopedBugs.filter(
                    (b) =>
                      b.priority === 'Critical' &&
                      statusCategory(b.status, fieldConfig) !== 'completed',
                  ).length,
                ],
                [
                  'Resolved',
                  scopedBugs.filter(
                    (b) =>
                      statusCategory(b.status, fieldConfig) === 'completed',
                  ).length,
                ],
              ].map(([label, count]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            {storedDraft && (
              <div className="report-draft-banner">
                <span>
                  <strong>Unfinished report</strong> ·{' '}
                  {storedDraft.form.title || 'Untitled report'}
                  {storedDraft.form.project
                    ? ' · ' + storedDraft.form.project
                    : ''}
                </span>
                <button type="button" onClick={() => void discardDraft()}>
                  Discard draft
                </button>
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}{' '}
                <button
                  onClick={() => {
                    setError('');
                    load().catch((e) => setError(e.message));
                  }}
                >
                  Retry
                </button>
              </div>
            )}
            {notice && (
              <div className="notice" role="status">
                {notice}
              </div>
            )}
            <section className="surface">
              <div className="toolbar">
                <select
                  aria-label="Project filter"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">All projects</option>
                  {Array.from(new Set(bugs.map((b) => b.project)))
                    .sort()
                    .map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                </select>
                <select
                  aria-label="Status filter"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Priority filter"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="">All priorities</option>
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {priorityLabel(p)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Sort issues"
                  value={sort}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSort(value);
                    try {
                      localStorage.setItem('sentinel.issueSort', value);
                    } catch {
                      // Keep the selection usable when storage is blocked.
                    }
                  }}
                >
                  <option value="created">Newest created</option>
                  <option value="updated">Recently updated</option>
                  <option value="priority">Highest priority</option>
                </select>
              </div>
              {loading ? (
                <div className="empty" role="status">
                  Loading your workspace…
                </div>
              ) : !visible.length ? (
                <div className="empty">
                  <Bug size={38} />
                  <h2>
                    {view === 'mine' && !scopedBugs.length
                      ? 'No issues for you yet'
                      : bugs.length
                        ? 'No issues match these filters'
                        : 'A fresh start for your project'}
                  </h2>
                  <p>
                    {view === 'mine' && !scopedBugs.length
                      ? 'Issues you report or are assigned to will appear here.'
                      : bugs.length
                        ? 'Try another search or clear your filters.'
                        : 'Capture what went wrong, how to reproduce it, and what should happen.'}
                  </p>
                  <button
                    className="primary"
                    onClick={() =>
                      view === 'mine' && !scopedBugs.length
                        ? start()
                        : bugs.length
                          ? (setQuery(''),
                            setProject(''),
                            setStatus(''),
                            setPriority(''))
                          : start()
                    }
                  >
                    {view === 'mine' && !scopedBugs.length
                      ? 'Report an issue'
                      : bugs.length
                        ? 'Clear filters'
                        : 'Create your first issue'}
                  </button>
                </div>
              ) : ['list', 'mine'].includes(view) ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th className="project-column">Project</th>
                        <th className="issue-title-column">Issue</th>
                        <th>Status</th>
                        <th>Priority</th>

                        <th>Assignee</th>
                        <th>Created</th>
                        <th>Updated</th>
                        <th className="row-actions">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageIssues.map((b) => (
                        <tr key={b.id}>
                          <td className="project-column">
                            <ProjectBadge
                              name={b.project}
                              projects={projects}
                            />
                          </td>
                          <td className="issue-navigation-cell">
                            <Link
                              className="issue issue-cell-link"
                              href={'/bugs/' + b.id}
                            >
                              <span className="id bug-id">
                                <IssueIdentity
                                  id={b.id}
                                  type={b.issueType}
                                  issueKey={b.issueKey}
                                />
                              </span>
                              <span>{b.title}</span>
                            </Link>
                          </td>
                          <td>
                            <QuickField
                              issue={b}
                              field="status"
                              fields={fieldConfig}
                              busy={quickBusy}
                              onChange={quickChange}
                            />
                          </td>
                          <td>
                            <QuickField
                              issue={b}
                              field="priority"
                              fields={fieldConfig}
                              busy={quickBusy}
                              onChange={quickChange}
                            />
                          </td>

                          <td>{b.assignee || 'Unassigned'}</td>
                          <td className="muted">
                            <time dateTime={b.createdAt}>
                              {date(b.createdAt)}
                            </time>
                          </td>
                          <td className="muted">{date(b.updatedAt)}</td>
                          <td className="row-actions">
                            <button
                              className="edit-icon"
                              type="button"
                              aria-label={
                                'Edit ' +
                                issueLabel(b.id, b.issueType, b.issueKey)
                              }
                              title={
                                'Edit ' +
                                issueLabel(b.id, b.issueType, b.issueKey)
                              }
                              onClick={() => start(b)}
                              disabled={busy}
                            >
                              <Pencil size={18} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="board">
                  {statuses.map((s) => (
                    <div
                      className={
                        'column' + (draggedIssue !== null ? ' drop-ready' : '')
                      }
                      key={s}
                      onDragOver={(e) => {
                        if (draggedIssue !== null) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const issue = bugs.find((b) => b.id === draggedIssue);
                        setDraggedIssue(null);
                        if (issue && !quickBusy)
                          quickChange(issue, 'status', s);
                      }}
                    >
                      <h2>
                        {s}{' '}
                        <span className="count">
                          {visible.filter((b) => b.status === s).length}
                        </span>
                      </h2>
                      {visible
                        .filter((b) => b.status === s)
                        .map((b) => (
                          <div className="board-issue" key={b.id}>
                            <Link
                              className="card"
                              draggable={!quickBusy}
                              onDragStart={(e) => {
                                setDraggedIssue(b.id);
                                e.dataTransfer.setData(
                                  'text/plain',
                                  String(b.id),
                                );
                                e.dataTransfer.effectAllowed = 'move';
                              }}
                              onDragEnd={() => setDraggedIssue(null)}
                              key={b.id}
                              href={'/bugs/' + b.id}
                            >
                              <span className="id bug-id">
                                <IssueIdentity
                                  id={b.id}
                                  type={b.issueType}
                                  issueKey={b.issueKey}
                                />
                              </span>
                              <ProjectBadge
                                name={b.project}
                                projects={projects}
                              />
                              {b.title}
                              <div>{badge(b.priority)}</div>
                            </Link>
                            <QuickField
                              issue={b}
                              field="status"
                              fields={fieldConfig}
                              busy={quickBusy}
                              onChange={quickChange}
                            />
                          </div>
                        ))}
                    </div>
                  ))}
                </div>
              )}
              {['list', 'mine'].includes(view) && (
                <div className="issue-pagination">
                  <label>
                    Issues per page
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const size = Number(e.target.value);
                        setPageSize(size);
                        setIssuePage(1);
                        try {
                          localStorage.setItem(
                            'sentinel.pageSize',
                            String(size),
                          );
                        } catch {}
                      }}
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="muted">
                    {visible.length ? firstIssue + 1 : 0}–
                    {Math.min(firstIssue + pageSize, visible.length)} of{' '}
                    {visible.length} issues
                  </span>
                  {pageCount > 1 && (
                    <nav aria-label="Issue pages">
                      <button
                        disabled={currentPage === 1}
                        onClick={() => setIssuePage(currentPage - 1)}
                      >
                        Previous
                      </button>
                      {Array.from({ length: pageCount }, (_, i) => i + 1)
                        .filter(
                          (page) =>
                            page === 1 ||
                            page === pageCount ||
                            Math.abs(page - currentPage) <= 1,
                        )
                        .map((page, index, pages) => (
                          <span key={page}>
                            {index > 0 && page - pages[index - 1] > 1 && (
                              <span className="pagination-gap">…</span>
                            )}
                            <button
                              aria-label={'Page ' + page}
                              aria-current={
                                page === currentPage ? 'page' : undefined
                              }
                              onClick={() => setIssuePage(page)}
                            >
                              {page}
                            </button>
                          </span>
                        ))}
                      <button
                        disabled={currentPage === pageCount}
                        onClick={() => setIssuePage(currentPage + 1)}
                      >
                        Next
                      </button>
                    </nav>
                  )}
                </div>
              )}
              <div className="footer">
                <span>
                  {visible.length} of {bugs.length} issues
                </span>
                <span>Saved on this computer</span>
              </div>
            </section>
            {owner && (
              <div className="actions">
                <input
                  ref={file}
                  hidden
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    void restore(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  disabled={busy || loading}
                  onClick={() => file.current?.click()}
                >
                  <Upload size={16} /> Import backup
                </button>
                <button disabled={loading} onClick={backup}>
                  <Download size={16} /> Export backup
                </button>
              </div>
            )}
          </>
        )}
      </main>
      <dialog
        ref={dialog}
        className={'modal ' + (!editing ? 'quick-report-modal' : '')}
        aria-labelledby="report-heading"
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            queueFiles(files);
          }
        }}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">
              {editing
                ? issueLabel(editing.id, editing.issueType, editing.issueKey)
                : 'NEW REPORT'}
            </p>
            <h2 id="report-heading">
              {editing ? 'Edit issue' : 'Report a problem'}
            </h2>
            {!editing && (
              <p className="muted">
                Capture it now. Add the details when you’re ready.
              </p>
            )}
          </div>
          <button aria-label="Close issue details" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {formError && (
          <div className="error" role="alert">
            {formError}
          </div>
        )}
        {draftActive && draftError && (
          <p className="error" role="alert">
            {draftError}
          </p>
        )}
        <form onSubmit={save}>
          <fieldset
            disabled={busy}
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            {!editing ? (
              <div className="quick-report-fields">
                {['project', 'title'].map((key) =>
                  renderField(
                    fieldConfig.find((f) => f.key === key) ??
                      defaultFields.find((f) => f.key === key)!,
                  ),
                )}
                {fieldConfig.find((f) => f.key === 'description')?.enabled && (
                  <label>
                    What went wrong?{' '}
                    <span className="optional-label">Optional</span>
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={form.description}
                      placeholder="What were you doing, and what happened?"
                      onChange={(e) => update('description', e.target.value)}
                    />
                  </label>
                )}
              </div>
            ) : (
              <>
                {quickReport && (
                  <p className="muted quick-report-help">
                    This is a quick report. Add any details you have; only the
                    title, project, status and priority are required.
                  </p>
                )}
                <div className="form-grid">{reportFields.map(renderField)}</div>
              </>
            )}
            <section className="attachment-staging">
              {busy && uploadStatus && (
                <p role="status">Uploading {uploadStatus}</p>
              )}
              <div
                className="report-evidence"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  queueFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <div>
                  <strong>Screenshots &amp; files</strong>
                  <p className="muted">
                    Drop files here, paste a screenshot, or browse.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => attachmentsInput.current?.click()}
                >
                  <Upload size={16} /> Browse files
                </button>
                <input
                  ref={attachmentsInput}
                  hidden
                  aria-label="Add attachments"
                  type="file"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    queueFiles(files);
                  }}
                />
              </div>
              <p className="muted">
                Files upload when you save the issue. Up to 250 MB per file.
              </p>
              {!!pendingCaptures.length && (
                <div className="inbox-pending">
                  <strong>
                    {pendingCaptures.length} captures from Attachment Inbox
                  </strong>
                  <p className="muted">
                    These will be attached when you submit. They stay in the
                    inbox until then.
                  </p>
                  {pendingCaptures.map((capture) => (
                    <div key={capture.id}>
                      <span>{capture.name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setPendingCaptures((files) =>
                            files.filter((f) => f.id !== capture.id),
                          )
                        }
                      >
                        Remove from selection
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <ul className="attachment-list">
                {pendingFiles.map((f, i) => (
                  <li key={i}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      aria-label={'Remove ' + f.name}
                      onClick={() =>
                        setPendingFiles((files) =>
                          files.filter((_, index) => index !== i),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {!editing && (
              <section className="report-extra-details">
                <button
                  className="details-toggle"
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls="report-extra-fields"
                  onClick={() => setDetailsOpen(!detailsOpen)}
                >
                  <Plus size={16} />{' '}
                  {detailsOpen ? 'Hide additional details' : 'Add more details'}
                  <span>Type, steps, device, build, priority…</span>
                </button>
                {detailsOpen && (
                  <div className="form-grid" id="report-extra-fields">
                    {reportFields
                      .filter(
                        (f) =>
                          !['project', 'title', 'description'].includes(f.key),
                      )
                      .map(renderField)}
                  </div>
                )}
              </section>
            )}
            <div className="report-form-footer">
              {draftActive && (
                <span className="draft-save-status" role="status">
                  {draftStatus}
                </span>
              )}
              <div className="actions">
                {editing && (
                  <button type="button" className="danger" onClick={remove}>
                    Delete issue
                  </button>
                )}
                {draftActive && (
                  <button
                    type="button"
                    className="draft-discard"
                    onClick={() => void discardDraft()}
                  >
                    Discard draft
                  </button>
                )}
                <button type="button" onClick={close}>
                  {draftActive ? 'Save for later' : 'Cancel'}
                </button>
                <button className="primary" type="submit">
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create issue'}
                </button>
              </div>
            </div>
          </fieldset>
        </form>
        {editing && (
          <section className="activity">
            <p className="muted">
              Created {date(editing.createdAt)} · Updated{' '}
              {date(editing.updatedAt)}
            </p>
            <h2>Comments & notes</h2>
            {editing.comments.length ? (
              editing.comments.map((c, i) => (
                <div className="comment" key={i}>
                  <small>
                    {c.actor?.email ?? 'Earlier activity'} · {date(c.at)}
                  </small>
                  <p>{c.text}</p>
                </div>
              ))
            ) : (
              <p className="muted">
                Add investigation notes, links, or a resolution.
              </p>
            )}
            <label style={{ marginTop: 16 }}>
              New comment
              <textarea
                disabled={busy}
                value={comment}
                maxLength={20000}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <div className="actions">
              <button disabled={busy || !comment.trim()} onClick={addComment}>
                Add comment
              </button>
            </div>
            <h2>Activity</h2>
            {[...editing.history].reverse().map((h, i) => (
              <p key={i}>
                <small>
                  {h.actor?.email ?? 'Earlier activity'} · {date(h.at)}
                </small>
                <br />
                {h.text}
              </p>
            ))}
          </section>
        )}
      </dialog>
    </div>
  );
}

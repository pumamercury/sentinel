'use client';
import Link from 'next/link';
import { InlineField } from './inline-field';
import { IssueIdentity } from './issue-identity';
import {
  ArrowLeft,
  Pencil,
  FileText,
  MessageSquare,
  History,
} from 'lucide-react';
import {
  badge,
  date,
  type Issue,
  type Project,
  type Report,
} from '../lib/bugs';
import {
  fieldApplies,
  fieldLabel,
  type FieldDefinition,
} from '../lib/field-schema.mjs';
import { QuickField } from './quick-fields';
import { IssueLinks } from './issue-links';
import { ProjectBadge } from './project-badge';
import { Attachments } from './attachments';
type Props = {
  issues: Issue[];
  onRefresh: () => Promise<void>;
  backHref: string;
  quickBusy: boolean;
  onQuick: (issue: Issue, field: 'status' | 'priority', value: string) => void;
  issue: Issue;
  projects: Project[];
  fields: FieldDefinition[];
  onEdit: () => void;
  comment: string;
  onCommentChange: (value: string) => void;
  onAddComment: () => void;
  busy: boolean;
  error: string;
  notice: string;
};
export function BugDetails({
  issues,
  onRefresh,
  backHref,
  quickBusy,
  onQuick,
  issue: b,
  projects,
  fields,
  onEdit,
  comment,
  onCommentChange,
  onAddComment,
  busy,
  error,
  notice,
}: Props) {
  const enabled = fields.filter((f) => fieldApplies(f, b.issueType));
  const value = (f: FieldDefinition) =>
    String(
      f.builtin
        ? (b[f.key as keyof Report] ?? '')
        : (b.customFields?.[f.key] ?? ''),
    );
  const editable = (f: FieldDefinition) => (
    <InlineField
      key={b.id + ':' + f.key}
      issueId={b.id}
      field={{
        ...f,
        label: fieldLabel(f, b.issueType),
        required: b.quickReport
          ? ['title', 'project', 'status', 'priority'].includes(f.key) ||
            (f.key === 'fixVersion' && b.status === 'Resolved')
          : f.required,
      }}
      value={value(f)}
      projects={projects}
      project={b.project}
      onRefresh={onRefresh}
    />
  );
  const narrative = enabled.filter((f) => f.type === 'textarea');
  const properties = enabled.filter(
    (f) =>
      !['title', 'project', 'status', 'priority'].includes(f.key) &&
      f.type !== 'textarea',
  );
  const propertyGroups = [
    {
      label: 'Classification',
      keys: ['issueType', 'severity', 'component', 'reproRate'],
    },
    {
      label: 'Ownership & schedule',
      keys: ['reporter', 'assignee', 'dueDate'],
    },
    {
      label: 'Test environment',
      keys: ['environment', 'version', 'fixVersion'],
    },
    {
      label: 'Additional details',
      keys: properties
        .filter(
          (f) =>
            ![
              'issueType',
              'severity',
              'component',
              'reproRate',
              'reporter',
              'assignee',
              'dueDate',
              'environment',
              'version',
              'fixVersion',
            ].includes(f.key),
        )
        .map((f) => f.key),
    },
  ];
  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Workspace / Issues</Link>
        <span className="bug-id">
          {' '}
          / <IssueIdentity id={b.id} type={b.issueType} issueKey={b.issueKey} />
        </span>
      </div>
      <Link className="back-link" href={backHref}>
        <ArrowLeft size={16} />{' '}
        {backHref.includes('project=')
          ? 'Back to project'
          : 'Back to all issues'}
      </Link>
      <header className="detail-header">
        <div>
          <Link
            href={
              '/?view=projects&project=' +
              projects.find((p) => p.name === b.project)?.id
            }
          >
            <ProjectBadge name={b.project} projects={projects} details />
          </Link>
          <p className="eyebrow bug-id">
            <IssueIdentity id={b.id} type={b.issueType} issueKey={b.issueKey} />
          </p>
          <div className="inline-title">
            {enabled.find((f) => f.key === 'title') ? (
              editable(enabled.find((f) => f.key === 'title')!)
            ) : (
              <h1>{b.title}</h1>
            )}
          </div>
          <div className="detail-badges">
            <QuickField
              issue={b}
              field="status"
              fields={fields}
              busy={quickBusy}
              onChange={onQuick}
            />
            <QuickField
              issue={b}
              field="priority"
              fields={fields}
              busy={quickBusy}
              onChange={onQuick}
            />
          </div>
        </div>
        <button className="primary" onClick={onEdit}>
          <Pencil size={16} /> Edit issue
        </button>
      </header>
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="detail-grid">
        <div className="detail-content">
          {narrative.map((f) => {
            const pair = narrative.filter((item) =>
              ['expected', 'actual'].includes(item.key),
            );
            if (pair.length === 2 && f.key === pair[1].key) return null;
            const renderPanel = (f: FieldDefinition) => (
              <section
                className={
                  'detail-panel ' +
                  (f.key === 'expected'
                    ? 'expected'
                    : f.key === 'actual'
                      ? 'actual'
                      : '')
                }
                key={f.key}
              >
                <h2>
                  <FileText size={18} />
                  {fieldLabel(f, b.issueType)}
                </h2>
                <div className="report-text">{editable(f)}</div>
              </section>
            );
            return pair.length === 2 && f.key === pair[0].key ? (
              <div className="results-grid" key="results">
                {pair.map(renderPanel)}
              </div>
            ) : (
              renderPanel(f)
            );
          })}
          <Attachments key={b.updatedAt} bugId={b.id} onRefresh={onRefresh} />
          <IssueLinks
            key={b.id}
            issue={b}
            issues={issues}
            onRefresh={onRefresh}
          />
          <section className="detail-panel">
            <h2>
              <MessageSquare size={18} /> Comments & notes{' '}
              <span className="count">{b.comments.length}</span>
            </h2>
            {b.comments.length ? (
              b.comments.map((c, i) => (
                <article className="comment" key={i}>
                  <small>
                    {c.actor?.email ?? 'Earlier activity'} ·{' '}
                    <time dateTime={c.at}>{date(c.at)}</time>
                  </small>
                  <p className="report-text">{c.text}</p>
                </article>
              ))
            ) : (
              <p className="muted">
                Keep investigation notes and resolution details here.
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onAddComment();
              }}
            >
              <label className="comment-label">
                New comment
                <textarea
                  value={comment}
                  maxLength={20000}
                  onChange={(e) => onCommentChange(e.target.value)}
                  placeholder="What did you find?"
                  disabled={busy}
                />
              </label>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <div className="actions">
                <button className="primary" disabled={busy || !comment.trim()}>
                  {busy ? 'Saving…' : 'Add comment'}
                </button>
              </div>
            </form>
          </section>
        </div>
        <div className="detail-sidebar">
          <section className="detail-panel issue-properties">
            <h2>Properties</h2>
            <section className="property-group project-property-group">
              <h3>Project</h3>
              <div>
                {enabled.find((f) => f.key === 'project') ? (
                  editable(enabled.find((f) => f.key === 'project')!)
                ) : (
                  <ProjectBadge name={b.project} projects={projects} />
                )}
              </div>
            </section>
            {propertyGroups.map((group) => {
              const items = group.keys
                .map((key) => properties.find((f) => f.key === key))
                .filter((f): f is FieldDefinition => !!f);
              return items.length ? (
                <section className="property-group" key={group.label}>
                  <h3>{group.label}</h3>
                  <dl>
                    {items.map((f) => (
                      <div className="property" key={f.key}>
                        <dt>{f.label}</dt>
                        <dd>{editable(f)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null;
            })}
          </section>
          <section className="detail-panel">
            <h2>
              <History size={18} /> Activity
            </h2>
            <div className="timeline">
              {[...b.history].reverse().map((h, i) => (
                <div className="timeline-item" key={i}>
                  {h.text.length > 180 ? (
                    <details className="activity-change">
                      <summary>
                        {h.text.includes(':')
                          ? h.text.slice(0, h.text.indexOf(':')).slice(0, 60) +
                            ' updated'
                          : 'Issue updated'}{' '}
                        — Show changes
                      </summary>
                      <p>{h.text}</p>
                    </details>
                  ) : (
                    <p>{h.text}</p>
                  )}
                  <small>
                    {h.actor?.email ?? 'Earlier activity'} ·{' '}
                    <time dateTime={h.at}>{date(h.at)}</time>
                  </small>
                </div>
              ))}
            </div>
            <div className="timestamps">
              <p>
                Created <time dateTime={b.createdAt}>{date(b.createdAt)}</time>
              </p>
              <p>
                Updated <time dateTime={b.updatedAt}>{date(b.updatedAt)}</time>
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

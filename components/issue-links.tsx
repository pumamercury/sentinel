'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Link2, Plus, Search, X } from 'lucide-react';
import { api, type Issue } from '../lib/bugs';
import { IssueIdentity } from './issue-identity';
type Relationship = {
  source: number;
  target: number;
  type: string;
  label: string;
  issue: Issue;
};
export function IssueLinks({
  issue,
  issues,
  onRefresh,
}: {
  issue: Issue;
  issues: Issue[];
  onRefresh: () => Promise<void>;
}) {
  const [links, setLinks] = useState<Relationship[]>([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('relates to');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const load = async () =>
    setLinks(await api<Relationship[]>(`bugs/${issue.id}/links`));
  useEffect(() => {
    let active = true;
    api<Relationship[]>(`bugs/${issue.id}/links`)
      .then((data) => {
        if (active) setLinks(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [issue.id]);
  async function change(body: object) {
    setBusy(true);
    setError('');
    try {
      await api(`bugs/${issue.id}/links`, 'POST', body);
      await load();
      await onRefresh();
      setAdding(false);
      setQuery('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const candidates = issues.filter(
    (i) =>
      i.id !== issue.id &&
      !links.some(
        (link) =>
          link.issue.id === i.id &&
          link.type === type &&
          (type === 'relates to' || link.source === issue.id),
      ) &&
      (i.id + ' ' + i.title + ' ' + i.project)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="detail-panel related-panel">
      <div className="related-heading">
        <h2>
          <Link2 size={18} /> Related issues{' '}
          <span className="count">{links.length}</span>
        </h2>
        <button
          type="button"
          className="related-add"
          disabled={busy}
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? <X size={16} /> : <Plus size={16} />}
          {adding ? 'Close' : 'Add link'}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {links.length ? (
        <div className="related-list">
          {links.map((link) => (
            <div
              className="related-item"
              key={link.source + '-' + link.target + '-' + link.type}
            >
              <span className="related-kind">{link.label}</span>
              <Link href={'/bugs/' + link.issue.id} className="related-report">
                <span className="related-meta">
                  <IssueIdentity
                    id={link.issue.id}
                    type={link.issue.issueType}
                    issueKey={link.issue.issueKey}
                  />
                  <span>{link.issue.project}</span>
                </span>
                <span className="related-title">{link.issue.title}</span>
              </Link>
              <button
                type="button"
                className="related-remove"
                disabled={busy}
                title="Remove link"
                aria-label={
                  'Remove ' + link.label + ' link to ' + link.issue.title
                }
                onClick={() => change({ ...link, remove: true })}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !adding && (
          <p className="muted related-empty">
            No linked issues yet. Add a duplicate, blocker, or related report.
          </p>
        )
      )}
      {adding && (
        <div className="related-picker">
          <div className="related-controls">
            <label>
              Relationship
              <select
                value={type}
                disabled={busy}
                onChange={(e) => setType(e.target.value)}
              >
                {['relates to', 'blocks', 'duplicates'].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <label className="related-search">
              Find an issue
              <span>
                <Search size={16} aria-hidden="true" />
                <input
                  autoFocus
                  value={query}
                  disabled={busy}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title, project, or number…"
                />
              </span>
            </label>
          </div>
          <p className="muted related-hint">
            Choose a report to link it as “{type}”.
          </p>
          <div className="related-results" aria-busy={busy}>
            {candidates.slice(0, 30).map((i) => (
              <button
                type="button"
                className="related-option"
                disabled={busy}
                key={i.id}
                onClick={() => change({ target: i.id, type })}
              >
                <span className="related-report">
                  <span className="related-meta">
                    <IssueIdentity
                      id={i.id}
                      type={i.issueType}
                      issueKey={i.issueKey}
                    />
                    <span>{i.project}</span>
                  </span>
                  <span className="related-title">{i.title}</span>
                </span>
                <Plus size={16} aria-hidden="true" />
              </button>
            ))}
            {!candidates.length && (
              <p className="muted related-empty">
                {query
                  ? 'No matching issues. Try another title or project.'
                  : 'No other issues available for this relationship.'}
              </p>
            )}
          </div>
          {candidates.length > 30 && (
            <p className="muted related-hint">
              Showing 30 matches. Refine your search to find more.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

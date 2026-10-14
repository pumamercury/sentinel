'use client';
import { useEffect, useState } from 'react';
import { api, date, type Issue } from '../lib/bugs';
import { issueLabel } from './issue-identity';
export function IssueTrash({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = () => api<Issue[]>('trash').then(setIssues);
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <section className="detail-panel">
      <h1>Trash</h1>
      <p className="muted">
        Deleted issues stay here until you restore them. Their attachments,
        comments and links are kept. Nothing is automatically erased.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p>Loading Trash…</p>
      ) : issues.length ? (
        issues.map((b) => (
          <article className="trash-item" key={b.id}>
            <div>
              <strong>
                {issueLabel(b.id, b.issueType, b.issueKey)} · {b.title}
              </strong>
              <p className="muted">
                {b.project} · Deleted {date(b.deletedAt!)}
                {b.deletedBy && ` by ${b.deletedBy.email}`}
              </p>
            </div>
            <button
              disabled={busy !== null}
              onClick={async () => {
                setBusy(b.id);
                setError('');
                setNotice('');
                try {
                  await api(`trash/${b.id}/restore`, 'POST');
                  await load();
                  await onRefresh();
                  setNotice(
                    `${issueLabel(b.id, b.issueType, b.issueKey)} restored.`,
                  );
                } catch (e) {
                  setError((e as Error).message);
                  await load().catch(() => {});
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === b.id ? 'Restoring…' : 'Restore issue'}
            </button>
          </article>
        ))
      ) : (
        <p className="empty">Trash is empty.</p>
      )}
    </section>
  );
}

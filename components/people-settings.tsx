'use client';
import { useEffect, useState } from 'react';
import { api, type Issue, type Member } from '../lib/bugs';
export function PeopleSettings({
  issues,
  onRefresh,
}: {
  issues: Issue[];
  onRefresh: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [trash, setTrash] = useState<Issue[]>([]);
  const [legacy, setLegacy] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = async () => {
    const [m, t] = await Promise.all([
      api<Member[]>('members'),
      api<Issue[]>('trash'),
    ]);
    setMembers(m);
    setTrash(t);
  };
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, []);
  const names = [
    ...new Set([...issues, ...trash].flatMap((b) => [b.reporter, b.assignee])),
  ]
    .filter((name) => name && !members.some((m) => m.email === name))
    .sort();
  return (
    <section className="detail-panel">
      <h1>People</h1>
      <p className="muted">
        New assignments use invited accounts. Invite people from Account. Link
        older names to the correct account to make “My issues” consistent. This
        updates matching reporters and assignees, including issues in Trash;
        older activity keeps its original attribution.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            !confirm(
              `Link every “${legacy}” reporter and assignee to ${email}?`,
            )
          )
            return;
          setBusy(true);
          setMessage('');
          try {
            const result = await api<{ updated: number }>(
              'people/link',
              'POST',
              { legacy, email },
            );
            await onRefresh();
            await load();
            setLegacy('');
            setMessage(`Linked ${result.updated} issues to ${email}.`);
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Older name
              <select
                required
                value={legacy}
                onChange={(e) => setLegacy(e.target.value)}
              >
                <option value="">Choose name…</option>
                {names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Invited account
              <select
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              >
                <option value="">Choose account…</option>
                {members
                  .filter((m) => !m.disabled)
                  .map((m) => (
                    <option key={m.id}>{m.email}</option>
                  ))}
              </select>
            </label>
          </div>
          <div className="actions" style={{ marginTop: 16 }}>
            <button disabled={!legacy || !email}>
              {busy ? 'Linking…' : 'Link older name'}
            </button>
          </div>
        </fieldset>
      </form>
      {!names.length && <p>No older names to link.</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

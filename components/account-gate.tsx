'use client';
import { cloudEnabled, cloudAuth } from '../lib/cloud';
import { sitePath } from '../lib/site-path';
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
type User = { id: number; email: string; role: 'owner' | 'member' };
type Session = { enabled: boolean; user: User | null };
const Access = createContext<{
  owner: boolean;
  enabled: boolean;
  user: User | null;
  searchSlot: HTMLDivElement | null;
}>({ owner: true, enabled: false, user: null, searchSlot: null });
export const useAccess = () => useContext(Access);
async function request<T = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (cloudEnabled) return cloudAuth<T>(path, method, body);
  const options: RequestInit = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  };
  const response = await fetch('/api/auth/' + path, options);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Error(data.error || 'Unable to complete the request.');
  return data;
}
export function AccountGate({ children }: { children: React.ReactNode }) {
  const [searchSlot, setSearchSlot] = useState<HTMLDivElement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [invitation, setInvitation] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.hash.slice(1)).get('invite') ??
        ''),
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [accounts, setAccounts] = useState(false);
  useEffect(() => {
    const found = new URLSearchParams(location.hash.slice(1)).get('invite');
    if (found) {
      history.replaceState(null, '', location.pathname + location.search);
    }
    let alive = true;
    const refresh = () =>
      request<Session>('session')
        .then((value) => {
          if (alive) setSession(value);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener('sentinel-session-expired', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('sentinel-session-expired', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  if (!session)
    return (
      <div className="auth-screen">
        <main className="account-card">
          <h1>Sentinel</h1>
          <p>{error || 'Checking access…'}</p>
          {error && <button onClick={() => location.reload()}>Retry</button>}
        </main>
      </div>
    );
  if (session.enabled && (!session.user || invitation))
    return (
      <div className="auth-screen">
        <main className="account-card">
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h1>{invitation ? 'Set up your access' : 'Sign in to Sentinel'}</h1>
          <p>
            {invitation
              ? 'Choose your password. Use the email address your invitation was sent to.'
              : 'Access is by invitation only.'}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await request(invitation ? 'accept' : 'login', 'POST', {
                  email,
                  password,
                  token: invitation,
                });
                setPassword('');
                setInvitation('');
                setSession(await request<Session>('session'));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={invitation ? 'new-password' : 'current-password'}
                required
                minLength={15}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {invitation && (
              <p className="muted">
                Use 15–128 characters. A long, unique passphrase works well.
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy
                ? 'Please wait…'
                : invitation
                  ? 'Save password and sign in'
                  : 'Sign in'}
            </button>
          </form>
        </main>
      </div>
    );
  const owner = !session.enabled || session.user?.role === 'owner';
  return (
    <Access.Provider
      value={{
        owner,
        enabled: session.enabled,
        user: session.user,
        searchSlot,
      }}
    >
      <div className="account-bar workspace-topbar">
        <a
          className="topbar-brand"
          href={sitePath()}
          aria-label="Sentinel — all issues"
        >
          <img
            src={sitePath('favicon.svg?v=sentinel-robot-1')}
            width="28"
            height="28"
            alt=""
          />
          Sentinel
        </a>
        <div className="topbar-search-slot" ref={setSearchSlot} />
        {session.enabled && (
          <div className="topbar-account-controls">
            <div className="account-identity">
              <span>
                {session.user?.email} · {session.user?.role}
              </span>
              {accounts && (
                <a className="button" href={sitePath()}>
                  ← Back to issues
                </a>
              )}
            </div>
            {!accounts && (
              <button
                onClick={() => {
                  if (
                    window.dispatchEvent(
                      new Event('sentinel-before-navigation', {
                        cancelable: true,
                      }),
                    )
                  )
                    setAccounts(true);
                }}
              >
                Account
              </button>
            )}
            <button
              onClick={async () => {
                if (
                  !window.dispatchEvent(
                    new Event('sentinel-before-navigation', {
                      cancelable: true,
                    }),
                  )
                )
                  return;
                try {
                  await request('logout', 'POST');
                  setSession({ enabled: true, user: null });
                  setAccounts(false);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Sign out
            </button>
            {error && <span role="alert">{error}</span>}
          </div>
        )}
      </div>
      <Fragment
        key={
          session.user ? session.user.id + ':' + session.user.email : 'local'
        }
      >
        {accounts ? <AccountSettings owner={owner} /> : children}
      </Fragment>
    </Access.Provider>
  );
}
function AccountSettings({ owner }: { owner: boolean }) {
  const [users, setUsers] = useState<(User & { disabled: number })[]>([]);
  const [invitations, setInvitations] = useState<
    { id: string; email: string; expires: number }[]
  >([]);
  const [email, setEmail] = useState(''),
    [link, setLink] = useState('');
  const [currentPassword, setCurrentPassword] = useState(''),
    [password, setPassword] = useState('');
  const [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [removeMember, setRemoveMember] = useState<User | null>(null);
  async function refresh() {
    if (owner) {
      const data = await request<{
        users: (User & { disabled: number })[];
        invitations: { id: string; email: string; expires: number }[];
      }>('users');
      setUsers(data.users);
      setInvitations(data.invitations);
    }
  }
  useEffect(() => {
    let alive = true;
    if (owner)
      void request<{
        users: (User & { disabled: number })[];
        invitations: { id: string; email: string; expires: number }[];
      }>('users')
        .then((data) => {
          if (alive) {
            setUsers(data.users);
            setInvitations(data.invitations);
          }
        })
        .catch((e) => {
          if (alive) setMessage(e.message);
        });
    return () => {
      alive = false;
    };
  }, [owner]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="account-card account-management">
      <h1>Account</h1>
      {message && <output>{message}</output>}
      <h2>Change password</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await request('password', 'POST', { currentPassword, password });
            setPassword('');
            setCurrentPassword('');
            setMessage(
              'Password changed. Other sessions have been signed out.',
            );
          });
        }}
      >
        <label>
          Current password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={15}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>Change password</button>
      </form>
      {owner && (
        <>
          <h2>Invite a member</h2>
          <p>
            Members share all issues and attachments. Only you can manage
            accounts, project settings, fields, backups, and capture sources.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await request<{ url: string }>('invite', 'POST', {
                  email,
                });
                setLink(data.url);
                setEmail('');
              });
            }}
          >
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <button disabled={busy}>Create invitation link</button>
          </form>
          {link && (
            <label>
              Share this private link with the invitee promptly. Creating a new
              link replaces the previous invitation.
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
          )}
          <p className="muted">
            For an expired or failed invitation, enter the same email again to
            create a fresh link.
          </p>
          {removeMember && (
            <section
              className="detail-panel"
              role="alertdialog"
              aria-label="Remove member"
              aria-describedby="remove-member-description"
            >
              <h3>Remove {removeMember.email}?</h3>
              <p id="remove-member-description">
                This removes their account, access and invitation links. Their
                issues, comments and attachments stay in the workspace. You can
                invite this email again afterward.
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => setRemoveMember(null)}>
                  Cancel
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await request('users/' + removeMember.id, 'DELETE');
                      setRemoveMember(null);
                      setLink('');
                      setMessage(
                        'Member removed. You can now create a new invitation.',
                      );
                    })
                  }
                >
                  Confirm removal
                </button>
              </div>
            </section>
          )}
          <h2>Members</h2>
          <ul>
            {users.map((u) => (
              <li key={u.id}>
                {u.email} · {u.role}
                {u.disabled ? ' · disabled' : ''}{' '}
                {u.role !== 'owner' && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await request('users/' + u.id, 'PATCH', {
                            disabled: !u.disabled,
                          });
                        })
                      }
                    >
                      {u.disabled ? 'Restore access' : 'Disable access'}
                    </button>
                    <button disabled={busy} onClick={() => setRemoveMember(u)}>
                      Remove member
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!!invitations.length && (
            <>
              <h2>Pending invitations</h2>
              <ul>
                {invitations.map((i) => (
                  <li key={i.id}>
                    {i.email}{' '}
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await request<{ url: string }>(
                            'invite',
                            'POST',
                            { email: i.email },
                          );
                          setLink(result.url);
                          setMessage(
                            'New invitation link created. The old link is no longer valid.',
                          );
                        })
                      }
                    >
                      Create new link
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await request('invites/' + i.id, 'DELETE');
                          setLink('');
                        })
                      }
                    >
                      Revoke invitation
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}

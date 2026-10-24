import { useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LogIn, Users, Copy, LogOut, ShieldCheck } from 'lucide-react';
import { Button, Modal } from './UI';
import { useCollaboration } from '../state/CollaborationContext';
import { handoffApi } from '../services/handoffApi';
import '../styles/handoffs.css';

export function HandoffAccountGate({ children }: { children: ReactNode }) {
  const { account, loading, error: connectionError, refresh } = useCollaboration();
  const [params, setParams] = useSearchParams();
  const token = params.get('invite') || '';
  const [register, setRegister] = useState(Boolean(token));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function acceptInvite() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await handoffApi('/api/collaboration/accept-invite', { token });
      await refresh();
      setParams({}, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="handoff-empty" role="status">
        Opening team access…
      </div>
    );
  if (account && !token) return <>{children}</>;
  if (account && token)
    return (
      <section className="handoff-auth">
        <Users size={26} />
        <h2>Join your teammate’s workspace</h2>
        <p>This invitation grants access to the team’s handoffs and shared code snapshots.</p>
        {error && <p role="alert">{error}</p>}
        <Button variant="primary" disabled={busy} onClick={acceptInvite}>
          {busy ? 'Joining…' : 'Accept invitation'}
        </Button>
        <Button onClick={() => setParams({}, { replace: true })}>Cancel</Button>
      </section>
    );
  return (
    <section className="handoff-auth">
      <div className="handoff-emblem">
        <ShieldCheck size={25} />
      </div>
      <span className="eyebrow">PRIVATE TEAM DISCUSSIONS</span>
      <h2>{register ? 'Create your team account' : 'Sign in to collaborate'}</h2>
      <p>
        Share pinned code, ask a question, and review answers with your teammates. Shared links
        require team membership.
      </p>
      {token && (
        <p className="handoff-note">You’re joining an existing team using a one-time invitation.</p>
      )}
      <form
        className="handoff-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          const form = new FormData(e.currentTarget);
          try {
            await handoffApi(`/api/collaboration/${register ? 'register' : 'login'}`, {
              email: String(form.get('email')),
              password: String(form.get('password')),
              ...(register
                ? { name: String(form.get('name')), ...(token ? { inviteToken: token } : {}) }
                : {}),
            });
            if (!register && token) await handoffApi('/api/collaboration/accept-invite', { token });
            await refresh();
            if (token) setParams({}, { replace: true });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        {register && (
          <label>
            Your name
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" maxLength={200} />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={12}
            maxLength={200}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
          <small>At least 12 characters.</small>
        </label>
        {(error || connectionError) && (
          <p role="alert" className="handoff-error">
            {error || connectionError}
          </p>
        )}
        <Button type="submit" icon={LogIn} variant="primary" disabled={busy}>
          {busy
            ? 'Please wait…'
            : register
              ? token
                ? 'Create account & join'
                : 'Create account & workspace'
              : 'Sign in'}
        </Button>
      </form>
      <Button
        variant="ghost"
        onClick={() => {
          setRegister(!register);
          setError('');
        }}
      >
        {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </Button>
      <small>
        Accounts are stored on this backend. Email delivery and password recovery are not
        configured.
      </small>
    </section>
  );
}

export function HandoffTeamAccess() {
  const { account, workspace, refresh, select } = useCollaboration();
  const [open, setOpen] = useState(false),
    [role, setRole] = useState('reviewer');
  const [link, setLink] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <>
      <Button icon={Users} onClick={() => setOpen(true)}>
        Team access
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Your collaboration team"
        description="Only invited members can open this team’s handoffs."
      >
        <div className="handoff-form dialog-body">
          <p>
            Signed in as <strong>{account?.user.name}</strong> · {account?.user.email}
          </p>
          <label>
            Workspace
            <select
              value={workspace?.id || ''}
              onChange={(e) => {
                select(e.target.value);
                setLink('');
              }}
            >
              {account?.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.role}
                </option>
              ))}
            </select>
          </label>
          <p>Workspace members can access all repositories shared with this workspace.</p>
          {workspace?.role === 'maintainer' && (
            <>
              <label>
                Invite a teammate as
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="reviewer">Senior / reviewer</option>
                  <option value="developer">Developer</option>
                </select>
              </label>
              <Button
                disabled={busy}
                onClick={async () => {
                  if (!workspace) return;
                  setBusy(true);
                  setMessage('');
                  try {
                    const result = await handoffApi<{ token: string }>(
                      `/api/collaboration/workspaces/${workspace.id}/invites`,
                      { role },
                    );
                    setLink(
                      `${location.origin}${location.pathname}#/handoffs?invite=${result.token}`,
                    );
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? 'Creating…' : 'Create one-time invitation'}
              </Button>
              {link && (
                <>
                  <label>
                    Invitation link
                    <input value={link} readOnly onFocus={(e) => e.target.select()} />
                  </label>
                  <small>
                    Expires in 7 days. This link grants team access; send it privately to the
                    intended teammate.
                  </small>
                  <Button
                    icon={Copy}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setMessage('Invitation copied.');
                      } catch {
                        setMessage('Select the invitation link and copy it.');
                      }
                    }}
                  >
                    Copy invitation
                  </Button>
                </>
              )}
            </>
          )}
          {message && <p role="status">{message}</p>}
          <Button
            icon={LogOut}
            onClick={async () => {
              try {
                await handoffApi('/api/collaboration/logout', {});
                await refresh();
                setOpen(false);
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            Sign out
          </Button>
        </div>
      </Modal>
    </>
  );
}

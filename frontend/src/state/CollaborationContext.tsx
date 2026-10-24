import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  handoffApi,
  HandoffError,
  type TeamUser,
  type TeamWorkspace,
} from '../services/handoffApi';
type Account = { user: TeamUser; workspaces: TeamWorkspace[] };
const Context = createContext<{
  account: Account | null;
  workspace: TeamWorkspace | undefined;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  select: (id: string) => void;
} | null>(null);
export function CollaborationProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaceId, setWorkspaceId] = useState('');
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  async function refresh() {
    setError('');
    try {
      setAccount(await handoffApi<Account>('/api/collaboration/me'));
    } catch (e) {
      setAccount(null);
      if (!(e instanceof HandoffError && e.status === 401)) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const workspace = account?.workspaces.find((w) => w.id === workspaceId) || account?.workspaces[0];
  return (
    <Context.Provider
      value={{ account, workspace, loading, error, refresh, select: setWorkspaceId }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCollaboration() {
  const value = useContext(Context);
  if (!value) throw new Error('CollaborationProvider is required');
  return value;
}

import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BookOpen,
  Bot,
  ChevronDown,
  Code2,
  Compass,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Layers,
  LayoutGrid,
  MessageSquareText,
  Mic,
  Settings2,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import '../styles/mentor-navigation.css';
export const workspaceNavigation = [
  { label: '', links: [{ path: '/workspace', label: 'Workspace', icon: LayoutGrid }] },
  {
    label: 'Explore',
    links: [
      { path: '/repository', label: 'Architecture', icon: Layers },
      { path: '/journeys', label: 'Code Journeys', icon: Compass },
      { path: '/repository?tab=documentation', label: 'Documentation', icon: BookOpen },
    ],
  },
  {
    label: 'Learn',
    links: [
      { path: '/learn', label: 'My Learning Path', icon: BookOpen },
      { path: '/practice', label: 'Practice', icon: FlaskConical },
      { path: '/progress', label: 'Progress & Updates', icon: TrendingUp },
    ],
  },
  {
    label: 'Changes',
    links: [
      { path: '/changes', label: 'PR Impact', icon: GitPullRequest },
      { path: '/changes?tab=setup', label: 'Setup Changes', icon: Code2 },
    ],
  },
  {
    label: 'Collaborate',
    links: [
      { path: '/handoffs', label: 'Context Handoffs', icon: Users },
      { path: '/knowledge', label: 'Team Knowledge', icon: MessageSquareText },
    ],
  },
  {
    label: 'AI Mentor',
    links: [{ path: '/workspace?discuss=1', label: 'Text and Voice', icon: Mic }],
  },
];
export function MentorNavigation({
  collapsed = false,
  onSettings,
  onNavigate,
}: {
  collapsed?: boolean;
  onSettings: () => void;
  onNavigate?: () => void;
}) {
  const { snapshot, repositoryUrl } = useRepositoryAnalysis();
  const location = useLocation();
  const [closed, setClosed] = useState<string[]>([]);
  const repo = (snapshot?.repository || repositoryUrl).replace('https://github.com/', '');
  function active(path: string) {
    if (path === '/journeys' && location.pathname.startsWith('/journeys/')) return true;
    const [pathname, query = ''] = path.split('?');
    if (pathname === '/handoffs') return location.pathname.startsWith('/handoffs');
    return location.pathname === pathname && location.search === (query ? '?' + query : '');
  }
  return (
    <>
      <div className="sidebar-repository" title={repo || 'No repository selected'}>
        <small>SELECTED REPOSITORY</small>
        <strong>
          <GitBranch size={14} />
          <span>{repo || 'Select a repository'}</span>
        </strong>
        <span>
          {snapshot
            ? `${snapshot.branch || snapshot.revision || 'Pinned commit'} / ${snapshot.commit.slice(0, 8)}`
            : 'Open Architecture to choose your code'}
        </span>
      </div>
      <nav aria-label="Main navigation" className="mentor-navigation">
        {workspaceNavigation.map((group) => (
          <section key={group.label} className="mentor-nav-group">
            {group.label && (
              <button
                className="mentor-nav-heading"
                aria-label={`${closed.includes(group.label) ? 'Expand' : 'Collapse'} ${group.label}`}
                aria-expanded={collapsed || !closed.includes(group.label)}
                onClick={() =>
                  setClosed((old) =>
                    old.includes(group.label)
                      ? old.filter((x) => x !== group.label)
                      : [...old, group.label],
                  )
                }
              >
                <span>{group.label}</span>
                <ChevronDown size={12} />
              </button>
            )}
            {(collapsed || !closed.includes(group.label)) &&
              group.links.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  title={collapsed ? label : undefined}
                  aria-current={active(path) ? 'page' : false}
                  aria-label={label}
                  onClick={onNavigate}
                  className={`nav-item ${active(path) ? 'active' : ''}`}
                >
                  <Icon size={17} strokeWidth={1.7} />
                  <span>{label}</span>
                </NavLink>
              ))}
          </section>
        ))}
        <button
          className="nav-item mentor-nav-settings"
          onClick={() => {
            onNavigate?.();
            onSettings();
          }}
          title={collapsed ? 'Settings & Integrations' : undefined}
        >
          <Settings2 size={17} />
          <span>Settings & Integrations</span>
        </button>
      </nav>
    </>
  );
}
export function IntegrationLinks() {
  return (
    <div className="handoff-actions">
      <NavLink className="button" to="/agent-context">
        <Bot size={15} />
        Agent Context Bridge
      </NavLink>
      <NavLink className="button" to="/knowledge-demo">
        Prepared knowledge demo
      </NavLink>
    </div>
  );
}

import { useEffect, useState } from 'react';
import '../styles/workspace-header.css';
import {
  ArrowRight,
  Bell,
  Bot,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Code2,
  Command,
  Compass,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Globe2,
  LayoutGrid,
  Menu,
  MessageSquareText,
  Search,
  Settings2,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { graphNodes, journeys, versions } from '../data/fixtures';
import { getRoute } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { Badge, Button, IconButton, Modal, ProgressBar } from './UI';

const navigation = [
  { path: '/', label: 'Overview & Home', icon: Globe2 },
  { path: '/workspace', label: 'Mentor workspace', icon: LayoutGrid },
  { path: '/repository', label: 'Repository', icon: Code2 },
  { path: '/journeys', label: 'Code journeys', icon: Compass, count: '2' },
  { path: '/learn', label: 'My learning path', icon: BookOpen },
  { path: '/practice', label: 'Practice', icon: FlaskConical },
  { path: '/changes', label: 'Changes', icon: GitPullRequest, count: '2' },
  { path: '/agent-context', label: 'Agent Context Bridge', icon: Bot },
  { path: '/progress', label: 'My progress', icon: TrendingUp },
];

export function Shell() {
  const { snapshot: activeRepository } = useRepositoryAnalysis();
  const { state, patch, notice, startJourney, selectNode, notify } = useWorkspace();
  const location = useLocation();
  const go = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const current =
    location.pathname === '/demo-workspace'
      ? 'Demo workspace'
      : (navigation.find((x) => x.path === location.pathname)?.label ?? 'Team knowledge');
  const analyzingRepository =
    location.pathname === '/repository' || location.pathname === '/workspace';
  const learningRoute = getRoute(
    state.personalized ? state.profile : 'beginner',
    state.personalized ? state.goal : 'contribute',
  );
  const routeProgress =
    (learningRoute.filter((x) => state.completed.includes(x.id)).length / learningRoute.length) *
    100;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (analyzingRepository) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((s) => !s);
      } else if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [analyzingRepository]);

  useEffect(() => {
    setMobileOpen(false);
    patch({ playing: false });
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [location.pathname]);

  const searchItems = [
    ...navigation.map((x) => ({
      label: x.label,
      group: 'Page',
      description: 'Navigate to page',
      action: () => go(x.path),
    })),
    ...graphNodes.map((x) => ({
      label: x.label,
      group: 'Component',
      description: x.source?.path ?? 'External boundary',
      action: () => {
        selectNode(x.id);
        go('/demo-workspace');
      },
    })),
    ...journeys.map((x) => ({
      label: x.title,
      group: 'Journey',
      description: `${x.duration} · explained path`,
      action: () => {
        startJourney(x.id);
        go('/demo-workspace');
      },
    })),
  ]
    .filter((x) => `${x.label} ${x.description}`.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 9);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="Codebase Mentor home">
          <span className="brand-symbol">
            <Code2 size={20} strokeWidth={2.2} />
          </span>
          <span>
            Codebase<span className="brand-light">Mentor</span>
          </span>
          <Badge tone="violet">beta</Badge>
        </NavLink>
        {!analyzingRepository && (
          <button
            className="workspace-switcher"
            onClick={() => go('/repository')}
            title="Switch repository or inspect workspace"
          >
            <span className="repo-avatar">
              r<span>↗</span>
            </span>
            <span>
              <strong>{analyzingRepository ? 'Repository analysis' : 'Relay workspace'}</strong>
              <small>
                {analyzingRepository ? 'Public GitHub repositories' : 'acme / relay-api (demo)'}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        )}
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ path, label, icon: Icon, count }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
              {count && !analyzingRepository && <span className="nav-count">{count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="team-nav">
          <div className="nav-label">TEAM</div>
          <NavLink
            to="/knowledge"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <MessageSquareText size={17} strokeWidth={1.7} />
            <span>Knowledge & decisions</span>
            {!analyzingRepository && state.decision === 'open' && <span className="small-dot" />}
          </NavLink>
        </div>
        <div className="sidebar-bottom">
          {!analyzingRepository && (
            <div className="next-step-card">
              <div className="row between">
                <span className="tiny-label">DAILY PROGRESS</span>
                <Sparkles size={13} className="text-primary" />
              </div>
              <strong>Your first contribution starts here.</strong>
              <ProgressBar value={routeProgress} />
              <button onClick={() => go('/learn')}>
                Continue learning path <ArrowRight size={13} />
              </button>
            </div>
          )}
          {!analyzingRepository && (
            <button className="sidebar-setting" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} /> Preferences <span>⌘ ,</span>
            </button>
          )}
          <div className="sidebar-footer">
            <span className="status-dot" />{' '}
            {analyzingRepository ? 'Local repository analysis' : 'All work stays in browser'}{' '}
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="row gap-12 workspace-header-context">
            <IconButton
              icon={Menu}
              label="Open navigation"
              className="mobile-menu"
              onClick={() => setMobileOpen(true)}
            />
            <div className="workspace-location">
              {analyzingRepository ? (
                <span className="breadcrumb-repo">
                  <GitBranch size={13} />{' '}
                  {activeRepository
                    ? activeRepository.repository.replace('https://github.com/', '')
                    : 'Select a repository'}
                </span>
              ) : (
                <button
                  className="breadcrumb-repo"
                  onClick={() => go('/repository')}
                  aria-label="Open repository analysis"
                >
                  <GitBranch size={13} />{' '}
                  {analyzingRepository ? 'Repository analysis' : 'acme / relay-api'}{' '}
                  <ChevronDown size={12} />
                </button>
              )}
              <span className="breadcrumb-page">{current}</span>
            </div>
          </div>
          {!analyzingRepository && (
            <button
              className="global-search"
              aria-label="Search workspace"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={14} />
              <span>Search anything...</span>
              <kbd>
                <Command size={10} /> K
              </kbd>
            </button>
          )}
          {!analyzingRepository && (
            <div className="topbar-actions">
              <Badge tone="violet" className="workspace-demo-badge">
                <span className="tiny-dot" />{' '}
                {analyzingRepository ? 'Live analysis' : 'Demo workspace'}
              </Badge>
              <span className="topbar-divider" />
              <IconButton
                icon={CircleHelp}
                label="Workspace guide"
                onClick={() => setHelpOpen(true)}
              />
              <IconButton
                icon={Bell}
                label="Learning updates"
                onClick={() => setUpdatesOpen(true)}
              />
              <button
                className="user-avatar"
                aria-label="Open learner preferences"
                onClick={() => setSettingsOpen(true)}
              >
                JD
              </button>
            </div>
          )}
        </header>
        <main id="main-content" tabIndex={-1} key={location.pathname} className="main-content">
          <Outlet />
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <span className="status-dot" />
          {notice}
          <button aria-label="Dismiss notification" onClick={() => notify('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <Modal
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        title="Relay workspace"
        description="acme / relay-api · sample repository"
        className="nav-drawer"
      >
        <nav aria-label="Mobile navigation">
          {navigation.map(({ path, label, icon: Icon, count }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
              {count && <span className="nav-count">{count}</span>}
            </NavLink>
          ))}
          <NavLink to="/knowledge" onClick={() => setMobileOpen(false)} className="nav-item">
            <MessageSquareText size={18} />
            <span>Knowledge & decisions</span>
          </NavLink>
        </nav>
        <div className="dialog-body">
          <Button
            icon={Settings2}
            onClick={() => {
              setMobileOpen(false);
              setSettingsOpen(true);
            }}
          >
            Learner preferences
          </Button>
        </div>
      </Modal>
      <Modal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Find your next connection"
        description="Search pages, components, source files, and code journeys."
        className="search-dialog"
      >
        <div className="command-input">
          <Search size={19} />
          <input
            autoFocus
            placeholder="Try ‘signup’, ‘user.service’, or ‘practice’"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="command-results">
          {searchItems.length ? (
            searchItems.map((item) => (
              <button
                key={`${item.group}:${item.label}`}
                onClick={() => {
                  item.action();
                  setSearchOpen(false);
                  setQuery('');
                }}
              >
                <span className="command-icon">
                  {item.group === 'Journey' ? (
                    <Compass size={17} />
                  ) : item.group === 'Component' ? (
                    <Code2 size={17} />
                  ) : (
                    <LayoutGrid size={17} />
                  )}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Badge>{item.group}</Badge>
                <ArrowRight size={14} />
              </button>
            ))
          ) : (
            <div className="empty-state">
              <Search size={25} />
              <strong>No matches for “{query}”</strong>
              <p>Try a component name, source filename, or page.</p>
            </div>
          )}
        </div>
        <div className="command-footer">
          <kbd>esc</kbd> to close <span>Search across your sample workspace</span>
        </div>
      </Modal>
      <Modal
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="One codebase. A connected story."
        description="A quick guide to the Codebase Mentor prototype."
      >
        <div className="dialog-body stack-20">
          <p>
            Start with a component in the atlas, follow a source-linked journey, predict a branch,
            then try a small contribution. Changes show how the same story evolves.
          </p>
          <div className="help-steps">
            {[
              'Select a node to inspect its source and responsibility.',
              'Start signup and answer the prediction checkpoints.',
              'Try the password-validation exercise in Practice.',
              'Open PR #402, compare the code, and relearn the changed steps.',
            ].map((x, i) => (
              <div key={x}>
                <span>{i + 1}</span>
                {x}
              </div>
            ))}
          </div>
          <div className="info-callout">
            This workspace uses a synthetic repository. Source, answers, PRs, and in-product test
            outcomes are prepared samples. Real analysis, AI generation, and execution are future
            integrations.
          </div>
          <div className="shortcut-row">
            <span>Global search</span>
            <kbd>Ctrl / ⌘ K</kbd>
          </div>
          <div className="shortcut-row">
            <span>Journey steps</span>
            <kbd>← →</kbd>
          </div>
          <Button
            variant="primary"
            icon={Compass}
            onClick={() => {
              startJourney('signup');
              go('/demo-workspace');
              setHelpOpen(false);
            }}
          >
            Explore the signup journey
          </Button>
        </div>
      </Modal>
      <Modal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Make this workspace yours"
        description="Your preferences change explanations and the recommended learning route."
      >
        <div className="dialog-body stack-20">
          <div className="profile-line">
            <div className="large-avatar">JD</div>
            <div>
              <strong>Jordan Davis</strong>
              <p>Local demo learner · no account required</p>
            </div>
          </div>
          <label className="field-label">
            Experience
            <select
              value={state.profile}
              onChange={(e) => patch({ profile: e.target.value as typeof state.profile })}
            >
              <option value="beginner">New to backend development</option>
              <option value="experienced">Experienced developer, new codebase</option>
            </select>
          </label>
          <label className="field-label">
            Explanation detail
            <select
              value={state.detail}
              onChange={(e) => patch({ detail: e.target.value as typeof state.detail })}
            >
              <option value="beginner">Approachable explanations</option>
              <option value="technical">Technical source detail</option>
            </select>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={state.personalized}
              onChange={(e) => patch({ personalized: e.target.checked })}
            />
            <span>
              Personalize my learning route
              <small>Use my selected profile and goal to choose prerequisites.</small>
            </span>
          </label>
          <Button
            variant="primary"
            onClick={() => {
              setSettingsOpen(false);
              notify('Preferences saved in this browser.');
            }}
          >
            Save preferences
          </Button>
        </div>
      </Modal>
      <Modal
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
        title="Keep your understanding current"
        description="Learning updates are tied to specific source changes."
      >
        <div className="dialog-body stack-20">
          <Badge tone="violet">Prepared change · PR #402</Badge>
          <h3>Email verification changes the account lifecycle</h3>
          <p>
            Signup creates an unverified account, and login gains a verification guard.{' '}
            {state.review.length
              ? `${state.review.length} of your studied concepts need a review.`
              : 'Study a journey, then compare the prepared PR to see targeted relearning.'}
          </p>
          <div className="version-comparison">
            <span>
              <GitBranch size={14} />
              {versions.base.commit}
            </span>
            <ArrowRight size={14} />
            <span>{versions.head.commit}</span>
          </div>
          <Button
            variant="primary"
            icon={GitPullRequest}
            onClick={() => {
              go('/changes');
              setUpdatesOpen(false);
            }}
          >
            Explore the change
          </Button>
        </div>
      </Modal>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Code2,
  Columns2,
  Compass,
  FileCode2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Maximize2,
  Minimize2,
  PanelLeft,
  PanelRight,
  Search,
  Waypoints,
  X,
} from 'lucide-react';
import { Atlas } from '../components/Atlas';
import { ComponentStrip } from '../components/ComponentStrip';
import { CodeViewer } from '../components/CodeViewer';
import { JourneyPlayer } from '../components/JourneyPlayer';
import { MentorPanel } from '../components/MentorPanel';
import { files, versions } from '../data/fixtures';
import type { Snapshot } from '../data/types';
import { useWorkspace } from '../state/WorkspaceContext';
import '../styles/workspace-ide.css';

type View = 'code' | 'split' | 'map';

export default function Workspace() {
  const { state, startJourney, setSnapshot, openSource, patch } = useWorkspace();
  const [mentorVisible, setMentorVisible] = useState(() => window.innerWidth > 760);
  const [explorerVisible, setExplorerVisible] = useState(false);
  const [view, setView] = useState<View>('split');
  const [focus, setFocus] = useState(false);
  const [query, setQuery] = useState('');
  const go = useNavigate();
  const paths = Object.keys(files[state.snapshot]).filter((path) =>
    path.toLowerCase().includes(query.toLowerCase()),
  );
  const groups = [
    ...new Set(
      paths.map((path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root')),
    ),
  ];

  return (
    <div
      className={`workspace-page ide-workspace ${focus ? 'ide-focus' : ''} ${state.journeyId ? 'journey-mode' : ''}`}
    >
      <header className="ide-toolbar">
        <div className="ide-repo">
          <Code2 size={18} />
          <strong>relay-api</strong>
          <span>/</span>
          <span>workspace</span>
        </div>
        <label className="ide-branch">
          <GitBranch size={14} />
          <select
            aria-label="Repository version"
            value={state.snapshot}
            onChange={(e) => setSnapshot(e.target.value as Snapshot)}
          >
            <option value="base">main</option>
            <option value="head">feat/email-verification</option>
          </select>
        </label>
        <div className="ide-toolbar-actions">
          <button onClick={() => go('/journeys')} title="Browse journeys">
            <Compass size={15} />
            <span>Journeys</span>
          </button>
          <button className="ide-primary-action" onClick={() => startJourney('signup')}>
            <span>{state.journeyId ? 'Restart request' : 'Follow a request'}</span>
            <Compass size={14} />
          </button>
        </div>
      </header>
      <div className="ide-viewbar">
        <div className="ide-view-switch" role="group" aria-label="Workspace view">
          {(
            [
              { id: 'code', label: 'Code', icon: Code2 },
              { id: 'split', label: 'Split', icon: Columns2 },
              { id: 'map', label: 'Map', icon: Waypoints },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-pressed={view === id}
              className={view === id ? 'active' : ''}
              onClick={() => setView(id)}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
        <span className="ide-view-hint">
          {view === 'split'
            ? 'Explore the map. Read the connected code.'
            : view === 'code'
              ? 'Source, with context.'
              : 'Every connection, in view.'}
        </span>
        <div className="ide-panel-toggles" role="group" aria-label="Workspace panels">
          <button
            aria-label="Toggle file explorer"
            title="Toggle file explorer"
            aria-pressed={explorerVisible}
            onClick={() => setExplorerVisible((v) => !v)}
          >
            <PanelLeft size={16} />
            <span>Files</span>
          </button>
          <button
            aria-label="Toggle mentor panel"
            title="Toggle mentor panel"
            aria-pressed={mentorVisible}
            onClick={() => setMentorVisible((v) => !v)}
          >
            <PanelRight size={16} />
            <span>Mentor</span>
          </button>
          <button
            aria-label={focus ? 'Exit focus mode' : 'Enter focus mode'}
            title={focus ? 'Exit focus mode' : 'Enter focus mode'}
            aria-pressed={focus}
            onClick={() => setFocus((v) => !v)}
          >
            {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>
      {state.journeyId && (
        <div className="ide-journey">
          <button
            className="ide-end-journey"
            onClick={() => patch({ journeyId: null, playing: false })}
          >
            <X size={13} /> End journey
          </button>
          <JourneyPlayer mode={mentorVisible ? 'controls' : 'full'} />
        </div>
      )}
      <div
        className={`ide-panels ${explorerVisible ? 'with-explorer' : ''} ${mentorVisible ? 'with-mentor' : ''}`}
      >
        {explorerVisible && (
          <aside className="ide-explorer" aria-label="File explorer">
            <div className="ide-explorer-heading">
              <FolderOpen size={14} /> EXPLORER{' '}
              <span>{Object.keys(files[state.snapshot]).length}</span>
            </div>
            <label className="ide-file-search">
              <Search size={13} />
              <input
                aria-label="Filter files"
                placeholder="Find a file…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="ide-file-tree">
              {groups.map((group) => (
                <details open key={group}>
                  <summary>
                    <FolderOpen size={13} />
                    {group}
                  </summary>
                  {paths
                    .filter(
                      (path) =>
                        (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : 'root') ===
                        group,
                    )
                    .map((path) => (
                      <button
                        key={path}
                        title={path}
                        aria-current={state.source.path === path ? 'true' : undefined}
                        className={state.source.path === path ? 'active' : ''}
                        onClick={() => {
                          openSource({
                            path,
                            start: 1,
                            end: files[state.snapshot][path].split('\n').length,
                          });
                          if (view === 'map') setView('code');
                        }}
                      >
                        <FileCode2 size={14} />
                        <span>{path.split('/').pop()}</span>
                      </button>
                    ))}
                </details>
              ))}
              {!paths.length && <p className="ide-no-files">No matching files.</p>}
            </div>
            <div className="ide-explorer-note">Prepared repository snapshot</div>
          </aside>
        )}
        <div className={`ide-editor ide-view-${view}`}>
          {view === 'split' && <ComponentStrip onOpenMap={() => setView('map')} />}
          {view === 'map' && <Atlas />}
          {view !== 'map' && <CodeViewer fullFile title={state.source.path.split('/').pop()} />}
        </div>
        {mentorVisible && <MentorPanel />}
      </div>
      <footer className="ide-statusbar">
        <span>
          <span className="status-dot" /> Sample source · read only
        </span>
        <span>
          <GitCommitHorizontal size={13} />
          {versions[state.snapshot].commit}
        </span>
        <span className="ide-status-file">{state.source.path}</span>
        <span>
          Ln {state.source.start}–{state.source.end}
        </span>
      </footer>
    </div>
  );
}

import { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Layers3,
  Monitor,
  Search,
  Server,
  Sparkles,
} from 'lucide-react';
import {
  documentationModel,
  documentationRoleNames,
  scopedDocumentationMarkdown,
} from '../domain/repositoryDocumentation';
import type { DocumentationScope, DocumentationSnapshot } from '../domain/repositoryDocumentation';
import '../styles/repository-documentation.css';

const scopes = [
  {
    id: 'frontend',
    title: 'Frontend',
    subtitle: 'Explore the interface code',
    description: 'UI files, functions and imports in the analyzed frontend code.',
    icon: Monitor,
  },
  {
    id: 'backend',
    title: 'Backend',
    subtitle: 'Understand the server',
    description: 'Supported API routes, request handlers and database calls.',
    icon: Server,
  },
  {
    id: 'all',
    title: 'Full repository',
    subtitle: 'See how it fits together',
    description: 'Both sides, shared code and components we couldn’t assign.',
    icon: Layers3,
  },
] as const;

export function RepositoryDocumentation({
  snapshot,
  onInspect,
}: {
  snapshot: DocumentationSnapshot;
  onInspect: (id: string) => void;
}) {
  const [scope, setScope] = useState<DocumentationScope>('all');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(12);
  const [moduleLimit, setModuleLimit] = useState(8);
  const model = useMemo(() => documentationModel(snapshot, scope), [snapshot, scope]);
  const declarations = model.components.filter((c) => c.role !== 'module');
  const matching = declarations.filter((c) =>
    `${c.name} ${c.source?.file} ${c.role}`.toLowerCase().includes(search.toLowerCase()),
  );
  const title = scopes.find((s) => s.id === scope)!.title;
  const entryPoints = [...declarations]
    .sort(
      (a, b) =>
        Number(['application', 'router', 'route'].includes(b.role)) -
        Number(['application', 'router', 'route'].includes(a.role)),
    )
    .filter(
      (c) =>
        !c.name.startsWith('anonymous:') &&
        !/(^|\/)(__tests__|tests?)(\/|\.)|\.(test|spec)\.[jt]sx?$/i.test(c.source?.file || ''),
    )
    .slice(0, 3);
  const routes = declarations.filter((c) => c.role === 'route');
  const connections = model.relationships
    .filter((e) => e.type === 'imports' || e.type === 'calls')
    .slice(0, 8);
  const link = (id: string) => {
    const r = model.refs.get(id);
    return r ? (
      <a className="doc-source-link" href={r.url} target="_blank" rel="noreferrer">
        <FileCode2 size={12} />
        {r.file}:{r.startLine}–{r.endLine}
        <ExternalLink size={11} />
      </a>
    ) : null;
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([scopedDocumentationMarkdown(snapshot, scope)], {
        type: 'text/markdown;charset=utf-8',
      }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${scope}-guide-${snapshot.commit.slice(0, 12)}.md`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="repository-docs" data-snapshot-id={snapshot.snapshotId}>
      <div className="doc-intro">
        <span className="analysis-kicker">
          <BookOpen size={13} /> YOUR CODEBASE, EXPLAINED
        </span>
        <h2>What would you like to understand?</h2>
        <p>
          Choose a part of the project. Start with a quick overview, then explore the code at your
          own pace.
        </p>
      </div>
      <div className="doc-scope-options" role="group" aria-label="Documentation focus">
        {scopes.map((option) => {
          const Icon = option.icon;
          const count =
            option.id === 'all'
              ? snapshot.components.filter((c) => c.role !== 'module').length
              : model.counts[option.id];
          return (
            <button
              key={option.id}
              aria-pressed={scope === option.id}
              data-scope={option.id}
              onClick={() => {
                setScope(option.id);
                setSearch('');
                setLimit(12);
                setModuleLimit(8);
              }}
            >
              <span className="doc-scope-icon">
                <Icon size={21} />
              </span>
              <span className="doc-scope-title">
                {option.title}
                {scope === option.id && <Check size={15} />}
              </span>
              <strong>{option.subtitle}</strong>
              <p>{option.description}</p>
              <small>
                {count.toLocaleString()} analyzed components
                {option.id !== 'all' ? ' · grouping inferred where needed' : ''}
              </small>
            </button>
          );
        })}
      </div>
      <div className="doc-reader-toolbar">
        <div>
          <span className="doc-status-dot" />
          {title} guide <span>·</span> <code>{snapshot.commit.slice(0, 12)}</code>
        </div>
        <button onClick={download}>
          <ArrowDownToLine size={14} />
          Download this guide
        </button>
      </div>
      <div className="doc-reader-layout">
        <nav className="doc-contents" aria-label="Guide contents">
          <span>IN THIS GUIDE</span>
          {[
            ['overview', 'Quick overview'],
            ['modules', 'Project structure'],
            ['connections', scope === 'backend' ? 'Routes & connections' : 'Code connections'],
            ['components', 'Explore components'],
            ['coverage', 'What’s uncertain'],
          ].map(([id, text]) => (
            <a
              key={id}
              href={`#doc-${id}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(`doc-${id}`)?.scrollIntoView({
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                  block: 'start',
                });
              }}
            >
              {text}
            </a>
          ))}
          <p>Every source link opens the exact analyzed commit.</p>
        </nav>
        <div className="doc-reader-content">
          <section id="doc-overview" className="doc-section">
            <span className="doc-section-number">01 / OVERVIEW</span>
            <h2>{title}, at a glance</h2>
            {model.files.size ? (
              <>
                <p>
                  This guide covers <strong>{model.files.size} source files</strong> and{' '}
                  <strong>{declarations.length} code components</strong> in{' '}
                  {scope === 'all' ? 'the analyzed repository' : `the ${scope} group`}.{' '}
                  {routes.length
                    ? `${routes.length} supported HTTP route ${routes.length === 1 ? 'registration was' : 'registrations were'} found.`
                    : 'No supported HTTP route registrations were found in this selection.'}
                </p>
                <div className="doc-fact-pills">
                  <span>{snapshot.report.languages.join(' + ') || 'Language not determined'}</span>
                  {scope !== 'frontend' &&
                    snapshot.report.frameworks.map((f) => <span key={f}>{f}</span>)}
                  <span>{model.relationships.length} internal connections</span>
                </div>
                <div className="doc-explainer">
                  <Braces size={18} />
                  <div>
                    <strong>How to read this guide</strong>
                    <p>
                      Components are functions, classes and registrations extracted from code.
                      Connections show imports and calls we could resolve. They don’t prove the
                      order in which the application runs.
                    </p>
                  </div>
                </div>
                {scope === 'frontend' && (
                  <p className="doc-note">
                    Frontend grouping uses folder names and JSX/TSX extensions. React rendering,
                    page navigation and browser interactions are outside the current Express
                    analyzer’s coverage.
                  </p>
                )}
                <h3>Good places to start</h3>
                <div className="doc-starting-points">
                  {entryPoints.map((c) => (
                    <button key={c.id} onClick={() => onInspect(c.id)}>
                      <FileCode2 size={16} />
                      <span>
                        <strong>{c.name}</strong>
                        <small>
                          {documentationRoleNames[c.role] || c.role} · {c.source?.file}
                        </small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="doc-empty">
                <FolderOpen size={26} />
                <h3>No {scope} code identified in this snapshot</h3>
                <p>
                  This doesn’t mean the repository has no {scope}. Relevant files may be excluded,
                  unsupported, or have no clear grouping evidence.
                </p>
                <button onClick={() => setScope('all')}>
                  Explore the full repository <ArrowRight size={14} />
                </button>
              </div>
            )}
            {scope === 'all' && snapshot.readmeClaim && (
              <details className="doc-readme">
                <summary>
                  What the README says <span>Author’s description</span>
                  <ChevronDown size={14} />
                </summary>
                <p>
                  These are the repository author’s claims, not findings verified by the analyzer.
                </p>
                <blockquote>{snapshot.readmeClaim}</blockquote>
              </details>
            )}
          </section>
          <section id="doc-modules" className="doc-section">
            <span className="doc-section-number">02 / STRUCTURE</span>
            <h2>Where the code lives</h2>
            <p>
              Open a folder to see its analyzed files. Folder names provide context; they don’t
              establish a component’s responsibility.
            </p>
            <div className="doc-modules">
              {model.modules.slice(0, moduleLimit).map((module) => (
                <details key={module.folder}>
                  <summary>
                    <FolderOpen size={16} />
                    <strong>{module.folder}</strong>
                    <span>{new Set(module.components.map((c) => c.source!.file)).size} files</span>
                    <ChevronDown size={14} />
                  </summary>
                  <div>
                    {[...new Set(module.components.map((c) => c.source!.file))].map((file) => (
                      <div key={file}>
                        {link(module.components.find((c) => c.source!.file === file)!.referenceId)}
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            {model.modules.length > moduleLimit && (
              <button className="doc-more" onClick={() => setModuleLimit((n) => n + 12)}>
                Show more folders ({model.modules.length - moduleLimit} remaining)
              </button>
            )}
            {!model.modules.length && (
              <p className="doc-note">No source folders are available for this selection.</p>
            )}
          </section>
          <section id="doc-connections" className="doc-section">
            <span className="doc-section-number">03 / CONNECTIONS</span>
            <h2>{routes.length ? 'Where requests enter' : 'How the code connects'}</h2>
            <p>
              {routes.length
                ? 'These routes are registered in source. Open a route to inspect its handler and supporting code.'
                : 'These are source-resolved imports and function calls within your selected part of the repository.'}
            </p>
            {routes.slice(0, 8).map((route) => (
              <details className="doc-route" key={route.id}>
                <summary>
                  <span className="doc-route-method">{route.name.split(' ')[0]}</span>
                  <strong>
                    {route.fullPaths?.join(', ') || route.name.slice(route.name.indexOf(' ') + 1)}
                  </strong>
                  <ChevronDown size={14} />
                </summary>
                <div>
                  {link(route.referenceId)}
                  {!route.fullPaths?.length && (
                    <p className="doc-note">The full mounted path is unresolved.</p>
                  )}
                  {snapshot.relationships
                    .filter((e) => e.source === route.id && e.type === 'handles_route')
                    .map((e) => (
                      <p key={e.id}>
                        Registered handler:{' '}
                        <button className="doc-inline-button" onClick={() => onInspect(e.target)}>
                          {snapshot.components.find((c) => c.id === e.target)?.name}
                        </button>{' '}
                        {link(e.referenceId)}
                      </p>
                    ))}
                </div>
              </details>
            ))}
            {routes.length > 8 && (
              <p className="doc-note">
                Showing 8 of {routes.length} routes. Search all routes in Explore components below.
              </p>
            )}
            <div className="doc-connections">
              {connections.map((e) => (
                <div key={e.id}>
                  <p>
                    <strong>{snapshot.components.find((c) => c.id === e.source)?.name}</strong>
                    <span>{e.type === 'imports' ? 'imports' : 'calls'}</span>
                    <strong>{snapshot.components.find((c) => c.id === e.target)?.name}</strong>
                  </p>
                  {link(e.referenceId)}
                </div>
              ))}
            </div>
            {!connections.length && !routes.length && (
              <p className="doc-note">
                No internal connections could be resolved for this selection. No connections have
                been assumed.
              </p>
            )}
            <p className="doc-note">
              Cross-group dependencies and shared code are visible in the full repository guide.
            </p>
          </section>
          <section id="doc-components" className="doc-section">
            <span className="doc-section-number">04 / COMPONENTS</span>
            <h2>Understand one piece at a time</h2>
            <p>
              Search a component or file, then open its details. Everything here comes from the same
              analyzed version.
            </p>
            <label className="doc-search">
              <Search size={16} />
              <input
                aria-label="Search documentation components"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setLimit(12);
                }}
                placeholder="Search a function, route or file…"
              />
              <span>{matching.length} results</span>
            </label>
            <div className="doc-component-list">
              {matching.slice(0, limit).map((c) => {
                const ai =
                  snapshot.documentation.snapshotId === snapshot.snapshotId
                    ? snapshot.documentation.ai.explanations.find((a) => a.componentId === c.id)
                    : undefined;
                const relations = snapshot.relationships.filter(
                  (e) => e.source === c.id || e.target === c.id,
                );
                return (
                  <details key={c.id}>
                    <summary>
                      <span className="doc-component-symbol">
                        <FileCode2 size={17} />
                      </span>
                      <span>
                        <strong>{c.name}</strong>
                        <small>{c.source?.file}</small>
                      </span>
                      <span className="doc-role-label">
                        {documentationRoleNames[c.role] || c.role}
                        {c.inferred ? ' · inferred' : ''}
                      </span>
                      <ChevronDown size={14} />
                    </summary>
                    <div className="doc-component-body">
                      <h3>What it is</h3>
                      <p>
                        {c.evidence.join('. ') ||
                          `A ${c.role} declaration found in the analyzed source. Its business purpose has not been established.`}
                      </p>
                      {link(c.referenceId)}
                      <p className="doc-note">{c.classification.evidence}</p>
                      <div className="doc-input-output">
                        <div>
                          <strong>Inputs</strong>
                          <p>{c.inputs?.join(', ') || 'Not determined from source'}</p>
                        </div>
                        <div>
                          <strong>Output</strong>
                          <p>{c.output || 'Not determined from source'}</p>
                        </div>
                      </div>
                      <h3>Validation & errors</h3>
                      <p>{c.validation}</p>
                      {relations.length > 0 && (
                        <>
                          <h3>Connected code</h3>
                          <ul>
                            {relations.slice(0, 12).map((e) => (
                              <li key={e.id}>
                                {e.source === c.id ? 'Outgoing' : 'Incoming'} ·{' '}
                                {e.type.replaceAll('_', ' ')} ·{' '}
                                <button
                                  className="doc-inline-button"
                                  onClick={() => onInspect(e.source === c.id ? e.target : e.source)}
                                >
                                  {
                                    snapshot.components.find(
                                      (x) => x.id === (e.source === c.id ? e.target : e.source),
                                    )?.name
                                  }
                                </button>{' '}
                                {link(e.referenceId)}
                              </li>
                            ))}
                          </ul>
                          {relations.length > 12 && (
                            <p className="doc-note">
                              Showing 12 of {relations.length} connections. Open the architecture
                              for the full list.
                            </p>
                          )}
                        </>
                      )}
                      {ai && ai.referenceIds.every((id) => model.refs.has(id)) && (
                        <div className="doc-ai">
                          <strong>
                            <Sparkles size={14} /> AI explanation · inferred
                          </strong>
                          <p>{ai.explanation}</p>
                          {ai.referenceIds.map((id) => (
                            <div key={id}>{link(id)}</div>
                          ))}
                          <small>
                            Citations were validated; explanation correctness is not verified.
                          </small>
                        </div>
                      )}
                      <button className="doc-inspect" onClick={() => onInspect(c.id)}>
                        Find in architecture <ArrowRight size={14} />
                      </button>
                    </div>
                  </details>
                );
              })}
            </div>
            {matching.length > limit && (
              <button className="doc-more" onClick={() => setLimit((n) => n + 20)}>
                Show more components ({matching.length - limit} remaining)
              </button>
            )}
            {!matching.length && (
              <p className="doc-note">
                No matching components. Try another name or choose the full repository.
              </p>
            )}
          </section>
          <section id="doc-coverage" className="doc-section">
            <span className="doc-section-number">05 / COVERAGE</span>
            <h2>What still needs a closer look</h2>
            <p>
              {model.unresolved.length.toLocaleString()} items in this selection couldn’t be fully
              resolved. Missing information is left unknown.
            </p>
            <p className="doc-note">
              {model.counts.unassigned.toLocaleString()} shared or unassigned components are
              available in the full repository guide. Folder-based frontend/backend grouping is
              inferred.
            </p>
            <details className="doc-coverage-details">
              <summary>
                Analysis limitations <ChevronDown size={14} />
              </summary>
              <ul>
                {snapshot.report.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
            <details className="doc-coverage-details">
              <summary>
                Unresolved examples ({Math.min(10, model.unresolved.length)} of{' '}
                {model.unresolved.length}) <ChevronDown size={14} />
              </summary>
              {model.unresolved.slice(0, 10).map((u, i) => (
                <div key={i}>
                  <code>{u.text}</code>
                  <p>{u.reason}</p>
                  {link(u.referenceId)}
                </div>
              ))}
            </details>
            <div className="doc-ai-status">
              <Sparkles size={15} />
              <p>{snapshot.documentation.ai.message}</p>
            </div>
          </section>
          <footer className="doc-reader-footer">
            <BookOpen size={15} />
            <span>Source-grounded guide · Commit {snapshot.commit.slice(0, 12)}</span>
          </footer>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Copy, Check, Terminal, Settings2, Database } from 'lucide-react';
import { analysisApi } from '../services/analysisApi';
import '../styles/source-setup-guide.css';
type Evidence = { path: string; line: number; url: string };
type Environment = {
  name: string;
  directory: string;
  status: string;
  clientExposed: boolean;
  instruction: string;
  evidence: Evidence[];
  localDefault?: string | number;
};
type Service = {
  name: string;
  kind: string;
  directory: string;
  setup: string[];
  url: string;
  evidence: Evidence[];
};
type Project = {
  path: string;
  directory: string;
  node: string | null;
  runtimeFiles: Evidence[];
  manager: string | null;
  managerVersion: string | null;
  managerBasis: string | null;
  lockfile: string | null;
  managerConflict: boolean;
  scripts: Record<string, string>;
  recommendedScript: string | null;
  commands: { title: string; command: string }[];
  environmentFile: string | null;
  environmentLoader: boolean;
  environmentTemplate: string | null;
  environment: Environment[];
  services: Service[];
  ports: { port: number; environment: string | null; evidence: Evidence }[];
  evidence: Evidence;
  readmes: Evidence[];
};
type Plan = {
  schemaVersion: number;
  snapshotId: string;
  commit: string;
  repository: string;
  projects: Project[];
  environment: Environment[];
  services: Service[];
  warnings: string[];
};
type Setup = {
  comparisonId: string;
  before: Plan;
  after: Plan;
  changes: {
    addedEnvironment: Environment[];
    removedEnvironment: Environment[];
    addedServices: Service[];
  };
};
export function SourceSetupGuide({ comparisonId }: { comparisonId: string }) {
  const [setup, setSetup] = useState<Setup | null>(null),
    [side, setSide] = useState<'before' | 'after'>('after');
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0);
  const [shell, setShell] = useState<'powershell' | 'posix'>('powershell');
  const [managers, setManagers] = useState<Record<string, string>>({});
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    analysisApi<Setup>(`/api/pr/comparisons/${comparisonId}/setup`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.comparisonId !== comparisonId)
          throw new Error('Setup belongs to a different comparison.');
        setSetup(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [comparisonId, retry]);
  const plan = setup?.[side];
  const changed = new Set(
    (side === 'after' ? setup?.changes.addedEnvironment : setup?.changes.removedEnvironment)?.map(
      (e) => e.directory + '\0' + e.name,
    ),
  );
  const commandText = (command: string) =>
    shell === 'powershell'
      ? command
          .replace(/^npm(?=\s)/gm, 'npm.cmd')
          .replace(/^pnpm(?=\s)/gm, 'pnpm.cmd')
          .replace(/^yarn(?=\s)/gm, 'yarn.cmd')
      : command;
  return (
    <section className="source-setup-guide">
      <header className="setup-guide-heading">
        <div>
          <span className="tiny-label">SET UP THIS VERSION</span>
          <h2>What you need, and how to run it.</h2>
          <p>Requirements found in the saved source, not just changes introduced by this PR.</p>
        </div>
        <button onClick={() => setRetry((n) => n + 1)} disabled={loading}>
          <RefreshCw size={14} /> Retry setup scan
        </button>
      </header>
      {loading && (
        <p role="status">
          <LoaderCircle size={15} className="mentor-spin" /> Checking source, package manifests and
          pinned configuration paths…
        </p>
      )}
      {error && (
        <p className="pr-warning" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <>
          <div className="setup-guide-controls">
            <div className="pr-version-tabs">
              {(['before', 'after'] as const).map((value) => (
                <button key={value} aria-pressed={side === value} onClick={() => setSide(value)}>
                  {value === 'after' ? 'After this PR' : 'Before this PR'}
                </button>
              ))}
            </div>
            <label>
              Commands for{' '}
              <select
                aria-label="Setup command shell"
                value={shell}
                onChange={(e) => setShell(e.target.value as typeof shell)}
              >
                <option value="powershell">Windows PowerShell</option>
                <option value="posix">macOS / Linux</option>
              </select>
            </label>
          </div>
          <div className="pr-stats">
            <div>
              <Terminal size={17} />
              <strong>{plan.projects.length}</strong>
              <span>apps / packages found</span>
            </div>
            <div>
              <Settings2 size={17} />
              <strong>{plan.environment.length}</strong>
              <span>configuration names used</span>
            </div>
            <div>
              <Database size={17} />
              <strong>{plan.services.length}</strong>
              <span>service clients found</span>
            </div>
            <div>
              <strong>{plan.commit.slice(0, 8)}</strong>
              <span>exact source commit</span>
            </div>
          </div>
          <p className="setup-not-run">
            Commands are ready to copy but have not been run. Source checks do not establish that a
            service or credential is needed on every startup path.
          </p>
          <details className="pr-card setup-checkout">
            <summary>Need a separate checkout of this exact version?</summary>
            <p>
              Use a fresh directory. Then open each app’s instructions below from the new repository
              root.
            </p>
            <Command
              title="Get this version without changing your existing checkout"
              value={`git clone --no-checkout ${plan.repository} setup-${plan.commit.slice(0, 8)}\ncd setup-${plan.commit.slice(0, 8)}\ngit checkout --detach ${plan.commit}`}
            />
          </details>
          <div className="setup-projects">
            {plan.projects.map((project) => {
              const manager = project.manager || managers[project.path] || '';
              const manualCommands =
                !project.manager && manager
                  ? [
                      {
                        title: 'Install dependencies (your chosen tool)',
                        command: `${manager} install`,
                      },
                      ...(project.recommendedScript
                        ? [
                            {
                              title: `Run the declared ${project.recommendedScript} script`,
                              command: `${manager} run ${project.recommendedScript}`,
                            },
                          ]
                        : []),
                    ]
                  : [];
              return (
                <article className="pr-card setup-project" key={project.path}>
                  <header>
                    <h2>{project.directory === '.' ? 'Repository root' : project.directory}</h2>
                    <EvidenceLinks items={[project.evidence, ...project.readmes]} />
                  </header>
                  <div className="setup-requirement-pills">
                    <span>Node.js: {project.node || 'version not declared in package.json'}</span>
                    <span>
                      {project.manager
                        ? `${project.manager}${project.managerVersion ? ' ' + project.managerVersion : ''} · ${project.managerBasis}`
                        : 'Package manager not established'}
                    </span>
                    {project.lockfile && <span>{project.lockfile}</span>}
                  </div>
                  {!!project.runtimeFiles.length && (
                    <p>
                      Runtime version file: <EvidenceLinks items={project.runtimeFiles} />
                    </p>
                  )}
                  {project.managerConflict && (
                    <p className="pr-warning">
                      Multiple package-manager lockfiles exist. Confirm which one this project uses
                      before installing.
                    </p>
                  )}
                  <div className="setup-project-columns">
                    <section>
                      <h3>1. Configure this app</h3>
                      {!!project.environment.length && (
                        <p>
                          These names are read by the code. A missing-value guard is a source check;
                          a reference or fallback alone does not prove a value must be set manually.
                        </p>
                      )}
                      {project.environment.length ? (
                        <>
                          <p>
                            {project.environmentFile ? (
                              <>
                                Create or update <code>{project.environmentFile}</code> with your
                                development values.
                              </>
                            ) : (
                              <>
                                Set these names in the process environment. Automatic loading of a
                                specific environment file was not established.
                              </>
                            )}
                          </p>
                          {project.environmentTemplate && (
                            <p>
                              The repository includes <code>{project.environmentTemplate}</code>.
                              Review it for documented names; this guide does not expose its values.
                            </p>
                          )}
                          <Command
                            title="Configuration names — fill in your own values"
                            value={project.environment.map((e) => e.name + '=').join('\n')}
                          />
                          <div className="setup-environment-list">
                            {project.environment.map((env) => (
                              <article key={env.name}>
                                <div>
                                  <code>{env.name}</code>
                                  {changed.has(env.directory + '\0' + env.name) && (
                                    <span className="pr-status">
                                      {side === 'after' ? 'New in this PR' : 'Removed by this PR'}
                                    </span>
                                  )}
                                  <span className="pr-status">
                                    {env.status === 'checked'
                                      ? 'Missing-value guard in source'
                                      : env.status === 'fallback'
                                        ? 'Fallback in source'
                                        : 'Read by source'}
                                  </span>
                                </div>
                                <p>{env.instruction}</p>
                                {env.localDefault !== undefined && (
                                  <p>
                                    Local fallback found in this source:{' '}
                                    <code>{env.localDefault}</code>. Other configuration in the
                                    expression may override it.
                                  </p>
                                )}
                                <EvidenceLinks items={env.evidence.slice(0, 3)} />
                              </article>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p>
                          No statically named environment reads were found in the captured source
                          for this app. Dynamic names and excluded files may require additional
                          setup.
                        </p>
                      )}
                      <h3>2. Prepare connected services</h3>
                      {project.services.length ? (
                        project.services.map((service) => (
                          <article className="setup-service" key={service.name}>
                            <strong>{service.name}</strong>
                            <small>Client usage found in source · {service.kind}</small>
                            <ol>
                              {service.setup.map((step) => (
                                <li key={step}>{step}</li>
                              ))}
                            </ol>
                            <a href={service.url} target="_blank" rel="noreferrer">
                              Service setup documentation ↗
                            </a>
                            <EvidenceLinks items={service.evidence} />
                          </article>
                        ))
                      ) : (
                        <p>
                          No supported external-service client was found in this app’s captured
                          source. This is not proof that deployment has no external requirements.
                        </p>
                      )}
                    </section>
                    <section>
                      <h3>3. Install and start</h3>
                      <p>
                        Use a separate terminal for each app, starting at the repository root. These
                        commands select the app folder and use its actual scripts.
                      </p>
                      {!project.manager && (
                        <div className="setup-manager-choice">
                          <p>
                            No package-manager declaration or unambiguous local lockfile was found.
                            Choose the tool your project uses to generate install/start commands.
                          </p>
                          <select
                            aria-label={`Package manager for ${project.directory}`}
                            value={manager}
                            onChange={(e) =>
                              setManagers((old) => ({ ...old, [project.path]: e.target.value }))
                            }
                          >
                            <option value="">Choose a package manager</option>
                            {['npm', 'pnpm', 'yarn', 'bun'].map((name) => (
                              <option key={name}>{name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {[...project.commands, ...manualCommands].map((command, i) => (
                        <Command
                          key={i}
                          title={command.title}
                          value={commandText(command.command)}
                        />
                      ))}
                      {!project.recommendedScript && (
                        <p>
                          No dev, start or serve script was declared. Review the other recipes
                          below; a startup command is unknown.
                        </p>
                      )}
                      {!!project.ports.length && (
                        <div className="setup-ports">
                          <h3>Ports found in source</h3>
                          {project.ports.map((entry, i) => (
                            <p key={i}>
                              Port <strong>{entry.port}</strong>
                              {entry.environment
                                ? ` when ${entry.environment} is not set`
                                : ''}{' '}
                              <EvidenceLinks items={[entry.evidence]} />
                            </p>
                          ))}
                          <small>
                            Read the actual startup output for the host and final URL; configuration
                            may override these ports.
                          </small>
                        </div>
                      )}
                      <details>
                        <summary>Other declared scripts and their exact commands</summary>
                        {Object.entries(project.scripts).map(([name, value]) => (
                          <div key={name}>
                            <strong>{name}</strong>
                            <pre>{value}</pre>
                            {manager && /^[\w:-]+$/.test(name) && (
                              <Command
                                title={`Run ${name}`}
                                value={commandText(manager + ' run ' + name)}
                              />
                            )}
                          </div>
                        ))}
                      </details>
                    </section>
                  </div>
                </article>
              );
            })}
          </div>
          {!plan.projects.length && (
            <p className="pr-warning">
              No usable package manifests were captured. App folders and startup commands cannot be
              established.
            </p>
          )}
          <details className="pr-card setup-coverage">
            <summary>What this setup check could not verify</summary>
            <ul>
              {plan.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  );
}
function EvidenceLinks({ items }: { items: Evidence[] }) {
  return (
    <span className="setup-evidence">
      {items.map((item, i) => (
        <a key={i} href={item.url} target="_blank" rel="noreferrer">
          {item.path}:{item.line} ↗
        </a>
      ))}
    </span>
  );
}
function Command({ title, value }: { title: string; value: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <div className="setup-command">
      <div>
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`Copy ${title}`}
          onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error('Unavailable');
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre tabIndex={0}>{value}</pre>
      {error && (
        <small role="status">
          Copy is unavailable here. Select the command text to copy it manually.
        </small>
      )}
    </div>
  );
}

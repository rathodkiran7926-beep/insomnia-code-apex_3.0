import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  GitFork as Github,
  Layers3,
  LoaderCircle,
  Network,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useScrollReveal } from '../animations/gsapHooks';
import {
  Badge,
  Button,
  ChecklistItem,
  DemoNote,
  Modal,
  PageHeading,
  PanelHeading,
  ProgressBar,
  TiltCard,
} from '../components/UI';
import { files, versions } from '../data/fixtures';
import type { Snapshot } from '../data/types';
import { demoService } from '../services/demoService';
import { useWorkspace } from '../state/WorkspaceContext';

const indexingSteps = [
  'Resolve repository snapshot',
  'Load source and configuration',
  'Link architecture and journeys',
  'Prepare your learning workspace',
];

export default function Repository() {
  const { state, patch, setSnapshot } = useWorkspace();
  const go = useNavigate();
  const [name, setName] = useState('acme/relay-api');
  const [error, setError] = useState('');
  const [stage, setStage] = useState(-1);
  const [connecting, setConnecting] = useState(false);
  const [selector, setSelector] = useState(false);
  const [search, setSearch] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const gridRef = useScrollReveal<HTMLDivElement>({ stagger: 0.12 });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  async function connect() {
    if (connecting) return;
    setError('');
    setConnecting(true);
    setStage(-1);
    try {
      await demoService.connectRepository(name);
      if (!mounted.current) return;
      setStage(0);
      let index = 0;
      timer.current = setInterval(() => {
        index++;
        setStage(index);
        if (index >= indexingSteps.length) {
          clearInterval(timer.current!);
          patch({ connected: true });
          setConnecting(false);
        }
      }, 650);
    } catch (e) {
      setError((e as Error).message);
      setConnecting(false);
    }
  }

  const ready = state.connected && !connecting;

  return (
    <>
      <PageHeading
        eyebrow="REPOSITORY"
        title="A new codebase. A clear way in."
        description="Connect a repository and turn unfamiliar code into something you can navigate."
        actions={<Badge tone="amber">Simulated connection</Badge>}
      />
      <div ref={gridRef} className="repository-grid">
        <div className="stack-20">
          <TiltCard className="panel connect-panel" maxTilt={4}>
            <PanelHeading icon={Github} title="Connect your repository">
              <Badge tone="violet">GitHub demo</Badge>
            </PanelHeading>
            <div className="panel-body stack-20">
              <div className="row between">
                <div>
                  <h3>Start with a repository</h3>
                  <p className="muted">
                    Explore the prepared sample, without connecting an account.
                  </p>
                </div>
                <span className="provider-logo">
                  <Github size={30} />
                </span>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect();
                }}
              >
                <label className="field-label">
                  Repository URL or owner / name
                  <div className="input-action">
                    <input
                      aria-label="Repository URL or owner / name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="acme/relay-api"
                      aria-invalid={Boolean(error)}
                    />
                    <Button
                      variant="primary"
                      icon={connecting ? LoaderCircle : ArrowRight}
                      className={connecting ? 'loading-button' : ''}
                      disabled={connecting || !name.trim()}
                      type="submit"
                      magnetic
                    >
                      {connecting ? 'Connecting' : 'Connect'}
                    </Button>
                  </div>
                </label>
              </form>
              {error && (
                <div className="error-callout" role="alert">
                  <CircleAlert size={17} />
                  <div>
                    <strong>Repository unavailable in this demo</strong>
                    <p>{error}</p>
                    <button
                      onClick={() => {
                        setName('acme/relay-api');
                        setError('');
                      }}
                    >
                      Use the sample repository
                    </button>
                  </div>
                </div>
              )}
              <div className="or-divider">
                <span />
                or choose from your workspace
                <span />
              </div>
              <button className="repository-choice" onClick={() => setSelector(true)}>
                <span className="repo-mark">
                  <Code2 size={24} />
                </span>
                <span>
                  <strong>acme / relay-api</strong>
                  <small>A TypeScript authentication API, built for exploring.</small>
                  <span className="row gap-8">
                    <i className="language-dot" />
                    TypeScript<span className="subtle">·</span>Express
                    <span className="subtle">·</span>Sample fixture
                  </span>
                </span>
                <ChevronRight size={18} />
              </button>
              <DemoNote>
                The sample is synthetic. No GitHub authentication or live indexing occurs.
              </DemoNote>
            </div>
          </TiltCard>
          <TiltCard className="panel" maxTilt={4}>
            <PanelHeading icon={Network} title="Your repository at a glance">
              <Badge tone="green">{ready ? 'Ready to explore' : 'Prepared sample'}</Badge>
            </PanelHeading>
            <div className="panel-body">
              <div className="repository-stats">
                <div>
                  <FileCode2 size={19} />
                  <strong>{Object.keys(files[state.snapshot]).length}</strong>
                  <span>source & config files</span>
                </div>
                <div>
                  <Layers3 size={19} />
                  <strong>8</strong>
                  <span>mapped components</span>
                </div>
                <div>
                  <Network size={19} />
                  <strong>2</strong>
                  <span>guided journeys</span>
                </div>
              </div>
              <div className="repo-description">
                <h3>Small enough to understand. Realistic enough to learn.</h3>
                <p>
                  Follow signup and login through routes, validation, services, and storage. Then
                  see what changes when email verification is introduced.
                </p>
              </div>
              <div className="tag-list">
                <Badge tone="blue">TypeScript</Badge>
                <Badge>Express</Badge>
                <Badge>Prisma</Badge>
                <Badge>PostgreSQL boundary</Badge>
                <Badge>Zod</Badge>
              </div>
            </div>
          </TiltCard>
        </div>
        <div className="stack-20">
          <section className="panel">
            <PanelHeading icon={GitBranch} title="Version context" />
            <div className="panel-body stack-16">
              <label className="field-label">
                Branch / prepared revision
                <select
                  value={state.snapshot}
                  onChange={(e) => setSnapshot(e.target.value as Snapshot)}
                >
                  <option value="base">main · {versions.base.commit}</option>
                  <option value="head">feat/email-verification · {versions.head.commit}</option>
                </select>
              </label>
              <div className="version-info">
                <span className="tiny-label">SELECTED SNAPSHOT</span>
                <strong>{versions[state.snapshot].label}</strong>
                <span className="mono">
                  {versions[state.snapshot].commit} <Badge>Demo revision</Badge>
                </span>
              </div>
            </div>
          </section>
          <section className="panel">
            <PanelHeading
              icon={Database}
              title={connecting ? 'Preparing your workspace' : 'Workspace readiness'}
            />
            <div className="panel-body stack-20">
              {indexingSteps.map((text, i) => (
                <div className="indexing-step" key={text}>
                  {connecting && stage === i ? (
                    <LoaderCircle size={18} className="spinner violet-text" />
                  ) : ready || stage > i ? (
                    <CheckCircle2 size={18} className="green-text" />
                  ) : (
                    <span className="empty-circle" />
                  )}
                  <span>{text}</span>
                  <small>
                    {ready || stage > i ? 'Ready' : stage === i ? 'Preparing' : 'Waiting'}
                  </small>
                </div>
              ))}
              <ProgressBar value={connecting ? Math.max(5, (stage / 4) * 100) : ready ? 100 : 0} />
              <Button
                variant="primary"
                icon={ArrowRight}
                disabled={!ready}
                magnetic
                onClick={() => go('/workspace')}
              >
                Open mentor workspace
              </Button>
              <small className="muted">Preparation is simulated using bundled demo data.</small>
            </div>
          </section>
          <section className="panel capabilities">
            <PanelHeading icon={ShieldCheck} title="What this demo can show" />
            <div className="panel-body stack-12">
              <ChecklistItem checked>Source-linked component inspection</ChecklistItem>
              <ChecklistItem checked>Reviewed sample signup and login paths</ChecklistItem>
              <ChecklistItem checked>Prepared PR and setup comparison</ChecklistItem>
              <div className="capability-limit">
                <CircleAlert size={14} />
                Live parsing, AI answers, repository execution, and recorded traces are not
                connected.
              </div>
            </div>
          </section>
        </div>
      </div>
      <Modal
        open={selector}
        onOpenChange={setSelector}
        title="Choose a repository"
        description="One coherent sample connects every screen in this prototype."
      >
        <div className="dialog-body stack-16">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="Search repositories"
              placeholder="Search repositories"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {'acme/relay-api'.includes(search.toLowerCase()) ? (
            <button
              className="repository-choice"
              onClick={() => {
                setName('acme/relay-api');
                setSelector(false);
                patch({ connected: true });
                go('/workspace');
              }}
            >
              <span className="repo-mark">
                <Github size={23} />
              </span>
              <span>
                <strong>acme / relay-api</strong>
                <small>TypeScript · Express · prepared sample</small>
              </span>
              <Check size={18} className="violet-text" />
            </button>
          ) : (
            <div className="empty-state">
              <Search size={23} />
              <strong>No repositories found</strong>
              <p>Try “relay” or clear your search to see the sample.</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

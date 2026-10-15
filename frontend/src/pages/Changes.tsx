import { useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  FileCode2,
  GitCompareArrows,
  GitPullRequest,
  Layers3,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Waypoints,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CodeDiff } from '../components/CodeDiff';
import { Badge, Button, DemoNote, PageHeading, PanelHeading, SourceLink } from '../components/UI';
import { files, pullRequests, versions } from '../data/fixtures';
import { useWorkspace } from '../state/WorkspaceContext';

const changedSteps = [
  {
    title: 'Account creation',
    before: 'Create an account',
    after: 'Create an unverified account',
    detail: 'The new emailVerified: false field changes the initial account state.',
    path: 'src/services/user.service.ts',
    start: 16,
    end: 23,
    kind: 'Updated',
  },
  {
    title: 'Email verification',
    before: 'No verification step',
    after: 'Request a verification email',
    detail:
      'verification.send(user) is now awaited. Provider delivery remains outside the explained path.',
    path: 'src/services/verification.service.ts',
    start: 5,
    end: 12,
    kind: 'New',
  },
  {
    title: 'Login guard',
    before: 'Valid credentials allow a token',
    after: 'Verified email is also required',
    detail:
      'The new guard throws UnauthorizedError before token signing when emailVerified is false.',
    path: 'src/services/user.service.ts',
    start: 31,
    end: 34,
    kind: 'Updated',
  },
];

export default function Changes() {
  const { state, setSnapshot, startJourney, openSource, notify } = useWorkspace();
  const go = useNavigate();
  const [prId, setPrId] = useState('verification');
  const [tab, setTab] = useState('journey');
  const [selectedStep, setSelectedStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState('src/services/user.service.ts');
  const [setupChecked, setSetupChecked] = useState(false);
  const pr = pullRequests.find((p) => p.id === prId)!;
  const testOnly = prId === 'validation';
  const step = changedSteps[selectedStep];
  const path = testOnly ? 'tests/password-rule.test.ts' : selectedFile;
  const testPatch = `describe('password strength proposal', () => {\n  it('rejects a letters-only password', () => {\n    const result = signupSchema.safeParse({\n      email: 'new@relay.example',\n      name: 'New developer',\n      password: 'abcdefgh',\n    });\n    expect(result.success).toBe(false);\n  });\n});`;
  function relearn() {
    setSnapshot('head');
    startJourney('login');
    go('/workspace');
  }
  return (
    <>
      <PageHeading
        eyebrow="CHANGES / UNDERSTAND WHAT MOVED"
        title="Code evolves. Your understanding follows."
        description="See the source change, follow its impact, and revisit only the lessons that need it."
        actions={
          <Button
            icon={RefreshCw}
            onClick={() =>
              notify('Prepared comparison refreshed. No live repository analysis was run.')
            }
          >
            Refresh demo comparison
          </Button>
        }
      />
      <section className="panel pr-summary">
        <span className="pr-symbol">
          <GitPullRequest size={24} />
        </span>
        <div className="pr-summary-text">
          <label className="sr-only" htmlFor="pr-select">
            Select pull request
          </label>
          <select
            id="pr-select"
            value={prId}
            onChange={(e) => {
              setPrId(e.target.value);
              setTab(e.target.value === 'validation' ? 'files' : 'journey');
            }}
          >
            <option value="verification">#42 Require email verification for new accounts</option>
            <option value="validation">#39 Add password-rule regression test (proposal)</option>
          </select>
          <p>
            {testOnly
              ? 'Independent prepared proposal · no runtime change · no execution evidence'
              : `${pr.branch} → main · prepared source comparison`}
          </p>
        </div>
        <Badge tone="green">{testOnly ? 'Proposed patch' : 'Prepared PR'}</Badge>
        <div className="pr-version">
          <span>{versions.base.commit}</span>
          <ArrowRight size={13} />
          <span>{testOnly ? 'test-proposal-39' : versions.head.commit}</span>
        </div>
      </section>
      <div className="changes-tabs">
        <div className="workspace-tabs">
          {[
            ['journey', 'Journey comparison', Waypoints],
            ['files', 'Changed files & diff', Code2],
            ['setup', 'Setup drift', Terminal],
          ].map(([id, label, Icon]) => {
            const I = Icon as typeof Code2;
            return (
              <button
                key={String(id)}
                className={tab === id ? 'active' : ''}
                onClick={() => setTab(String(id))}
              >
                <I size={15} />
                {String(label)}
                {id === 'files' && <Badge>{testOnly ? 1 : 3}</Badge>}
              </button>
            );
          })}
        </div>
        <DemoNote>Preview stays separate from your selected branch</DemoNote>
      </div>
      {testOnly && tab !== 'files' ? (
        <section className="panel empty-state">
          <ShieldCheck size={30} />
          <strong>This proposal changes a test, not runtime behavior.</strong>
          <p>
            No journey or setup change is established by this prepared patch. Review the proposed
            check in the diff.
          </p>
          <Button onClick={() => setTab('files')}>View proposed test</Button>
        </section>
      ) : tab === 'journey' ? (
        <div className="change-layout">
          <div className="stack-20">
            <section className="panel journey-comparison">
              <PanelHeading icon={GitCompareArrows} title="Same feature. A new account lifecycle.">
                <Badge tone="amber">3 changed steps</Badge>
              </PanelHeading>
              <div className="comparison-labels">
                <span>
                  BEFORE <code>{versions.base.commit}</code>
                </span>
                <span>
                  AFTER <code>{versions.head.commit}</code>
                </span>
              </div>
              <div className="changed-step-list">
                {changedSteps.map((item, i) => (
                  <button
                    className={`changed-step ${i === selectedStep ? 'selected' : ''}`}
                    key={item.title}
                    onClick={() => setSelectedStep(i)}
                  >
                    <div className="changed-before">
                      <span className="compare-step-number">{i + 1}</span>
                      <div>
                        <small>{item.title}</small>
                        <strong>{item.before}</strong>
                      </div>
                    </div>
                    <ArrowRight size={15} />
                    <div className="changed-after">
                      <div>
                        <small>{item.title}</small>
                        <strong>{item.after}</strong>
                      </div>
                      <Badge tone={item.kind === 'New' ? 'green' : 'violet'}>{item.kind}</Badge>
                    </div>
                  </button>
                ))}
              </div>
              <div className="comparison-note">
                <CircleAlert size={14} />
                Source comparison shows a possible path. Neither version has been executed by this
                frontend.
              </div>
            </section>
            <section className="panel">
              <PanelHeading icon={FileCode2} title={step.title}>
                <Badge tone="violet">{step.kind}</Badge>
              </PanelHeading>
              <div className="panel-body stack-16">
                <p>{step.detail}</p>
                <CodeDiff
                  path={step.path}
                  before={files.base[step.path] ?? ''}
                  after={files.head[step.path] ?? ''}
                />
                <Button
                  variant="ghost"
                  icon={ArrowUpRight}
                  onClick={() => {
                    setSnapshot('head');
                    openSource({ path: step.path, start: step.start, end: step.end });
                    go('/workspace');
                  }}
                >
                  Inspect this source in the workspace
                </Button>
              </div>
            </section>
          </div>
          <ImpactPanel onRelearn={relearn} reviewCount={state.review.length} />
        </div>
      ) : tab === 'files' ? (
        <div className="change-layout">
          <section className="panel files-diff-panel">
            <PanelHeading
              icon={FileCode2}
              title={testOnly ? 'Proposed test patch' : 'Source changes'}
            >
              <Badge>{testOnly ? '1 file' : '3 files'}</Badge>
            </PanelHeading>
            <div className="changed-file-tabs">
              {(testOnly ? [{ path, additions: 10, deletions: 0 }] : pr.files).map((file) => (
                <button
                  key={file.path}
                  className={file.path === path ? 'active' : ''}
                  onClick={() => setSelectedFile(file.path)}
                >
                  <FileCode2 size={13} />
                  <span>{file.path}</span>
                  <small className="green-text">+{file.additions}</small>
                </button>
              ))}
            </div>
            <CodeDiff
              path={path}
              before={testOnly ? '' : (files.base[path] ?? '')}
              after={testOnly ? testPatch : (files.head[path] ?? '')}
            />
            <div className="comparison-note">
              {testOnly
                ? 'Independent synthetic proposal test-proposal-39. This check is intentionally red against the original schema; it has not been run.'
                : 'Base and head are immutable prepared demo snapshots. Green additions and red removals describe source changes.'}
            </div>
          </section>
          <ImpactPanel onRelearn={relearn} reviewCount={state.review.length} testOnly={testOnly} />
        </div>
      ) : (
        <div className="setup-layout">
          <section className="panel">
            <PanelHeading icon={Terminal} title="A new integration. Two configuration entries.">
              <Badge tone="amber">Static discovery</Badge>
            </PanelHeading>
            <div className="panel-body stack-20">
              <p>
                Email verification introduces a mail-provider configuration boundary. The sample
                environment template now names the local provider and sender.
              </p>
              <CodeDiff
                path=".env.example"
                before={files.base['.env.example']}
                after={files.head['.env.example']}
              />
              <div className="setup-finding">
                <Mail size={19} />
                <div>
                  <h3>Mail provider selection</h3>
                  <p>
                    <code>MAIL_PROVIDER=local</code> is proposed for a fake local provider. The
                    actual startup validation and provider adapter are outside this fixture, so a
                    mandatory runtime requirement cannot be established.
                  </p>
                  <Badge tone="amber">Requiredness unresolved</Badge>
                </div>
              </div>
              <div className="setup-finding">
                <ShieldCheck size={19} />
                <div>
                  <h3>No executed setup evidence</h3>
                  <p>
                    No command, environment, or run ID exists for this sample. Real email delivery
                    and setup verification remain unavailable.
                  </p>
                  <Badge>Unverified · not executed</Badge>
                </div>
              </div>
            </div>
          </section>
          <section className="panel setup-instructions">
            <PanelHeading icon={BookOpen} title="Proposed setup instructions" />
            <div className="panel-body stack-16">
              <Badge>Documentation suggestion</Badge>
              <h3>Local verification workflow</h3>
              <ol>
                <li>Use the project’s supported Node runtime.</li>
                <li>Copy the updated sample environment file.</li>
                <li>Choose the local fake provider and a synthetic sender.</li>
                <li>
                  Run the actual repository’s reviewed setup and test recipes in an isolated
                  environment.
                </li>
              </ol>
              <div className="info-callout">
                These are proposed instructions. The frontend has not run or verified them.
              </div>
              <Button
                icon={setupChecked ? Check : BookOpen}
                onClick={() => setSetupChecked((x) => !x)}
              >
                {setupChecked ? 'Suggestion reviewed locally' : 'Mark suggestion reviewed'}
              </Button>
              <small className="muted">
                A review records your activity. It does not verify the setup.
              </small>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ImpactPanel({
  onRelearn,
  reviewCount,
  testOnly = false,
}: {
  onRelearn: () => void;
  reviewCount: number;
  testOnly?: boolean;
}) {
  const go = useNavigate();
  return (
    <aside className="stack-20">
      <section className="panel impact-panel">
        <PanelHeading icon={Layers3} title="What this change touches" />
        <div className="panel-body stack-16">
          <div>
            <span className="tiny-label">DIRECT SOURCE CHANGES</span>
            {testOnly ? (
              <div className="impact-item">
                <Code2 size={16} />
                <span>Password rule test</span>
                <Badge>Proposed</Badge>
              </div>
            ) : (
              <>
                <div className="impact-item">
                  <Layers3 size={16} />
                  <span>User service</span>
                  <Badge tone="violet">Updated</Badge>
                </div>
                <div className="impact-item">
                  <Mail size={16} />
                  <span>Verification service</span>
                  <Badge tone="green">New</Badge>
                </div>
                <div className="impact-item">
                  <Terminal size={16} />
                  <span>Environment template</span>
                  <Badge tone="violet">Updated</Badge>
                </div>
              </>
            )}
          </div>
          <div className="subsection-divider" />
          <div>
            <span className="tiny-label">POSSIBLE DOWNSTREAM IMPACT</span>
            <p className="muted">
              {testOnly
                ? 'A future runtime change is needed to satisfy this proposed check.'
                : 'Clients may need to handle pending accounts. Email delivery failure could affect signup responses.'}
            </p>
            <Badge tone="amber">Inference · not an observed regression</Badge>
          </div>
        </div>
      </section>
      {!testOnly && (
        <section className="relearn-card">
          <div className="row gap-8">
            <Sparkles size={18} />
            <span className="tiny-label">A SMALL UPDATE TO YOUR MENTAL MODEL</span>
          </div>
          <h3>Correct password. One more condition.</h3>
          <p>
            Login now requires a verified email. Revisit the deciding condition and check your
            understanding.
          </p>
          {reviewCount > 0 && (
            <Badge tone="amber">{reviewCount} studied concepts need review</Badge>
          )}
          <Button variant="primary" icon={BookOpen} onClick={onRelearn}>
            Start the relearning journey
            <ArrowRight size={14} />
          </Button>
          <button className="text-link" onClick={() => go('/learn')}>
            View learning path
            <ChevronRight size={13} />
          </button>
        </section>
      )}
      <section className="panel impact-evidence">
        <ShieldCheck size={18} className="green-text" />
        <h3>Evidence, with its limits.</h3>
        <p>
          Direct changes come from the prepared source diff. Possible effects are labelled
          separately. No merge-safety verdict or runtime verification is claimed.
        </p>
        {!testOnly && (
          <SourceLink
            source={{ path: 'src/services/user.service.ts', start: 7, end: 22 }}
            navigate
          />
        )}
      </section>
    </aside>
  );
}

import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  GitBranch,
  Inbox,
  MessageSquareText,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { Badge, Button, DemoNote, PageHeading, PanelHeading, SourceLink } from '../components/UI';
import { useWorkspace } from '../state/WorkspaceContext';
import { versions } from '../data/fixtures';

const labels = {
  open: 'Open question',
  draft: 'Draft',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  published: 'Published',
  needs_review: 'Needs review',
  superseded: 'Superseded',
} as const;
export default function Knowledge() {
  const { state, patch, decisionAction, notify } = useWorkspace();
  const [selected, setSelected] = useState('gap');
  const [filter, setFilter] = useState('all');
  const status = state.decision;
  const editable = ['open', 'draft', 'needs_review'].includes(status);
  const visible =
    filter === 'all' ||
    (filter === 'questions' && !['published', 'superseded'].includes(status)) ||
    (filter === 'published' && status === 'published');
  return (
    <>
      <PageHeading
        eyebrow="TEAM KNOWLEDGE"
        title="The code tells you what. People explain why."
        description="Capture source-linked rationale, review it explicitly, and keep it current as the code changes."
        actions={<Badge tone="amber">Local maintainer workflow</Badge>}
      />
      <div className="knowledge-banner">
        <span className="knowledge-banner-icon">
          <MessageSquareText size={24} />
        </span>
        <div>
          <h2>Turn a good question into shared understanding.</h2>
          <p>Code facts and human rationale have different origins. This space keeps both clear.</p>
        </div>
        <span className="knowledge-provenance">
          <UserRound size={15} />
          Human-reviewed knowledge
        </span>
      </div>
      <div className="list-toolbar">
        <div className="filter-tabs">
          {[
            ['all', 'All knowledge'],
            ['questions', 'Review inbox'],
            ['published', 'Published decisions'],
          ].map(([id, text]) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {text}
            </button>
          ))}
        </div>
        <DemoNote>No external messages are sent</DemoNote>
      </div>
      <div className="knowledge-layout">
        <aside className="knowledge-inbox">
          <div className="inbox-label">
            <Inbox size={14} />
            <span>YOUR TEAM’S CONTEXT</span>
          </div>
          {visible && (
            <button
              className={`knowledge-card ${selected === 'gap' ? 'selected' : ''}`}
              onClick={() => setSelected('gap')}
            >
              <div className="row between">
                <Badge
                  tone={
                    status === 'published' || status === 'approved'
                      ? 'green'
                      : status === 'needs_review'
                        ? 'amber'
                        : 'violet'
                  }
                >
                  {labels[status]}
                </Badge>
                <ChevronRight size={13} />
              </div>
              <h3>Why separate the user service from the repository?</h3>
              <p>Behavior is visible. The rationale is not documented.</p>
              <small>
                <GitBranch size={12} />
                user.service.ts · 7e2a9c1
              </small>
            </button>
          )}
          {filter !== 'questions' && (
            <button
              className={`knowledge-card ${selected === 'guide' ? 'selected' : ''}`}
              onClick={() => setSelected('guide')}
            >
              <Badge>Reading guide</Badge>
              <h3>What counts as approved knowledge?</h3>
              <p>
                Understand the difference between a code fact, interpretation, and a published
                explanation.
              </p>
              <small>
                <ShieldCheck size={12} />
                Evidence and provenance
              </small>
            </button>
          )}
          {!visible && filter === 'published' && (
            <div className="empty-state compact">
              <BookOpen size={24} />
              <strong>No published decisions yet</strong>
              <p>Draft, review, approve, then publish an explanation.</p>
              <Button variant="ghost" onClick={() => setFilter('all')}>
                Open the question
              </Button>
            </div>
          )}
        </aside>
        <section className="panel knowledge-detail">
          {selected === 'guide' ? (
            <>
              <PanelHeading icon={ShieldCheck} title="Keep the origin of knowledge visible" />
              <div className="panel-body stack-20">
                <h2>A source link cannot prove intent.</h2>
                <p>
                  Code shows current behavior at a version. A maintainer can explain present
                  guidance or their own recollection. These are related forms of evidence with
                  distinct limits.
                </p>
                {[
                  ['Code fact', 'Supported by a specific sample source location and version.'],
                  [
                    'Interpretation',
                    'A proposed explanation, explicitly labelled as an inference.',
                  ],
                  [
                    'Approved rationale',
                    'A human-submitted explanation that passed explicit review and approval.',
                  ],
                  [
                    'Needs review',
                    'A previously approved record whose linked source or assumptions changed.',
                  ],
                ].map(([title, description]) => (
                  <div className="knowledge-rule" key={title}>
                    <ShieldCheck size={18} />
                    <div>
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </div>
                  </div>
                ))}
                <Button
                  icon={ArrowRight}
                  onClick={() => {
                    setSelected('gap');
                    setFilter('all');
                  }}
                >
                  Return to the source-linked question
                </Button>
              </div>
            </>
          ) : (
            <>
              <PanelHeading icon={MessageSquareText} title="A question worth preserving">
                <Badge
                  tone={
                    status === 'published'
                      ? 'green'
                      : status === 'needs_review'
                        ? 'amber'
                        : 'violet'
                  }
                >
                  {labels[status]}
                </Badge>
              </PanelHeading>
              <div className="panel-body stack-20">
                <div>
                  <span className="tiny-label">KNOWLEDGE GAP · KQ-001</span>
                  <h2>Why separate the user service from the repository?</h2>
                  <p>
                    The service delegates persistence through <code>users.findByEmail()</code> and{' '}
                    <code>users.create()</code>. The source supports this separation, but does not
                    establish the original design intent.
                  </p>
                </div>
                <div className="knowledge-source">
                  <SourceLink
                    source={{ path: 'src/services/user.service.ts', start: 9, end: 20 }}
                    snapshot={state.decisionSnapshot}
                    navigate
                  />
                  <SourceLink
                    source={{ path: 'src/repositories/user.repository.ts', start: 3, end: 10 }}
                    snapshot={state.decisionSnapshot}
                    navigate
                  />
                  <span>
                    Explanation source context · {versions[state.decisionSnapshot].commit}
                  </span>
                </div>
                {status === 'needs_review' && (
                  <div className="warning-callout">
                    <CircleAlert size={18} />
                    <div>
                      <strong>The linked behavior changed in PR #42.</strong>
                      <p>
                        The previous explanation is preserved, but is no longer presented as current
                        approved knowledge. Review it against email verification before publishing a
                        replacement.
                      </p>
                    </div>
                  </div>
                )}
                <div className="observed-fact">
                  <span className="tiny-label">OBSERVED IN THE SAMPLE SOURCE</span>
                  <p>
                    HTTP response handling is in the controller. Account rules are in the service.
                    Database access is in the repository.
                  </p>
                  <Badge>Code fixture · not historical rationale</Badge>
                </div>
                <div className="maintainer-response">
                  <div className="row between">
                    <h3>
                      {status === 'published' ? 'Published explanation' : 'Maintainer explanation'}
                    </h3>
                    <span className="author-provenance">
                      <span className="mini-avatar">JD</span>Local demo maintainer
                    </span>
                  </div>
                  {editable ? (
                    <>
                      <label className="field-label">
                        What is the rationale, and what alternatives matter?
                        <textarea
                          value={state.rationale}
                          onChange={(e) => patch({ rationale: e.target.value })}
                          placeholder="Describe the reason in your own words. Separate present guidance from historical intent."
                          rows={6}
                        />
                      </label>
                      <button
                        className="text-link"
                        onClick={() =>
                          patch({
                            rationale:
                              'Present guidance for this demo: keep account rules in the service and persistence details in the repository. This makes each responsibility easier to review and lets tests substitute the persistence boundary. It is an interpretation of the sample design, not an account of upstream historical intent.',
                          })
                        }
                      >
                        Use the prepared demo explanation
                        <FilePenLine size={13} />
                      </button>
                    </>
                  ) : (
                    <div className="rationale-text">{state.rationale}</div>
                  )}
                  <div className="rationale-provenance">
                    <UserRound size={13} />
                    Present guidance / interpretation · local demo author · source revision{' '}
                    {versions[state.decisionSnapshot].commit}
                  </div>
                </div>
                <div className="decision-state-track">
                  {['draft', 'awaiting_review', 'approved', 'published'].map((x, i) => (
                    <span
                      className={
                        ['draft', 'awaiting_review', 'approved', 'published'].indexOf(status) >= i
                          ? 'reached'
                          : ''
                      }
                      key={x}
                    >
                      <span>{i + 1}</span>
                      {labels[x as keyof typeof labels]}
                      {i < 3 && <ChevronRight size={12} />}
                    </span>
                  ))}
                </div>
                <div className="knowledge-actions">
                  {status === 'open' || status === 'needs_review' ? (
                    <Button
                      variant="primary"
                      icon={FilePenLine}
                      disabled={!state.rationale.trim()}
                      onClick={() => decisionAction('draft')}
                    >
                      Save draft
                    </Button>
                  ) : status === 'draft' ? (
                    <Button
                      variant="primary"
                      icon={Send}
                      disabled={!state.rationale.trim()}
                      onClick={() => decisionAction('review')}
                    >
                      Submit for local review
                    </Button>
                  ) : status === 'awaiting_review' ? (
                    <>
                      <Button icon={FilePenLine} onClick={() => decisionAction('draft')}>
                        Return to draft
                      </Button>
                      <Button
                        variant="primary"
                        icon={ShieldCheck}
                        onClick={() => decisionAction('approve')}
                      >
                        Approve as demo maintainer
                      </Button>
                    </>
                  ) : status === 'approved' ? (
                    <Button
                      variant="primary"
                      icon={BookOpen}
                      onClick={() => {
                        decisionAction('publish');
                        notify(
                          'Approved sample explanation published to the local mentor context.',
                        );
                      }}
                    >
                      Publish approved explanation
                    </Button>
                  ) : status === 'published' ? (
                    <>
                      <span className="green-text row gap-8">
                        <CheckCircle2 size={17} />
                        Visible in the mentor panel
                      </span>
                      <Button onClick={() => decisionAction('supersede')}>
                        Archive as superseded
                      </Button>
                    </>
                  ) : (
                    <Badge>Archived · superseded</Badge>
                  )}
                </div>
                <div className="info-callout">
                  This prototype simulates maintainer identity and approval locally. Production
                  publication requires authenticated human provenance. Drafts are never shown as
                  approved knowledge.
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </>
  );
}

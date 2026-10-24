import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Archive,
  BookOpenCheck,
  Check,
  CircleAlert,
  FileClock,
  FilePlus2,
  GitBranch,
  History,
  Lightbulb,
  MessageSquareText,
  Mic,
  MicOff,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import { Badge, Button, PageHeading } from '../components/UI';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { analysisApi } from '../services/analysisApi';
import '../styles/decision-memory.css';

type RecordType = 'decision' | 'failure_lesson';
type RecordStatus =
  'draft' | 'awaiting_review' | 'approved' | 'needs_review' | 'superseded' | 'withdrawn';
type Evidence = {
  kind:
    | 'source_code'
    | 'test'
    | 'documentation'
    | 'pull_request'
    | 'incident'
    | 'observed_run'
    | 'maintainer_explanation'
    | 'other';
  snapshotId?: string;
  referenceId?: string;
  description?: string;
  externalRef?: string;
};
type MemoryRecord = {
  id: string;
  repository: string;
  type: RecordType;
  status: RecordStatus;
  currentRevision: number;
  supersedesId: string | null;
  supersededBy: string | null;
  withdrawnReason: string | null;
  createdAt: string;
  updatedAt: string;
  authoritative: boolean;
  revision: {
    number: number;
    content: Record<string, unknown>;
    evidence: Evidence[];
    submittedBy: string | null;
    createdAt: string;
    approvedBy: string | null;
    approvedAt: string | null;
  };
};
type MaintainerQuestion = {
  id: string;
  repository: string;
  status: string;
  question: string;
  evidence: Evidence[];
  origin?: string;
  response: string | null;
  responseEvidence?: Evidence[];
  respondedBy?: string | null;
  respondedAt?: string | null;
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    uploadedBy: string | null;
    createdAt: string;
  }[];
  closeReason: string | null;
  occurrenceCount: number;
  resolvedRecordId: string | null;
  updatedAt: string;
};
type ResponseSuggestion = {
  response: string;
  mode: 'ai' | 'facts';
  notice: string;
  citations: {
    id: string;
    file: string;
    startLine: number;
    endLine: number;
    url: string;
  }[];
  source: {
    componentId: string;
    snapshotId: string;
    referenceId: string;
  };
};
type SourceComponent = {
  id: string;
  name: string;
  role: string;
  referenceId: string;
  snapshotId: string;
  file: string;
  startLine: number;
  endLine: number;
  url: string;
};
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = { results: ArrayLike<SpeechResult> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
type History = {
  recordId: string;
  revisions: MemoryRecord['revision'][];
  events: {
    action: string;
    revision: number | null;
    actorId: string | null;
    details: Record<string, unknown>;
    createdAt: string;
  }[];
};
type FormValues = {
  type: RecordType;
  title: string;
  summary: string;
  context: string;
  decision: string;
  rationale: string;
  constraints: string;
  alternatives: string;
  consequences: string;
  observedFailure: string;
  environment: string;
  suspectedCause: string;
  causeStatus: 'unknown' | 'suspected' | 'confirmed';
  resolution: string;
  resolutionVerified: boolean;
  preventiveRule: string;
  sourceReferenceId: string;
  evidenceKind: 'source_code' | 'test' | 'observed_run';
};

const emptyForm: FormValues = {
  type: 'decision',
  title: '',
  summary: '',
  context: '',
  decision: '',
  rationale: '',
  constraints: '',
  alternatives: '',
  consequences: '',
  observedFailure: '',
  environment: '',
  suspectedCause: '',
  causeStatus: 'unknown',
  resolution: '',
  resolutionVerified: false,
  preventiveRule: '',
  sourceReferenceId: '',
  evidenceKind: 'source_code',
};
const statusLabels: Record<RecordStatus, string> = {
  draft: 'Draft',
  awaiting_review: 'Awaiting review',
  approved: 'Approved',
  needs_review: 'Needs review',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

function recordContent(form: FormValues) {
  const lines = (value: string) =>
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  if (form.type === 'decision') {
    return {
      title: form.title,
      summary: form.summary,
      context: form.context || undefined,
      decision: form.decision || undefined,
      rationale: form.rationale || undefined,
      constraints: lines(form.constraints),
      alternatives: lines(form.alternatives).map((line) => {
        const [option, ...reasons] = line.split(' — ');
        return {
          option: option.trim(),
          reasonRejected: reasons.join(' — ').trim() || undefined,
        };
      }),
      consequences: lines(form.consequences),
      openQuestions: [],
    };
  }
  return {
    title: form.title,
    summary: form.summary,
    observedFailure: form.observedFailure,
    environment: form.environment || undefined,
    suspectedCause: form.suspectedCause || undefined,
    causeStatus: form.causeStatus,
    resolution: form.resolution || undefined,
    resolutionVerified: form.resolutionVerified,
    preventiveRule: form.preventiveRule || undefined,
  };
}

function formFromRecord(record: MemoryRecord): FormValues {
  const content = record.revision.content;
  return {
    ...emptyForm,
    type: record.type,
    title: String(content.title || ''),
    summary: String(content.summary || ''),
    context: String(content.context || ''),
    decision: String(content.decision || ''),
    rationale: String(content.rationale || ''),
    constraints: Array.isArray(content.constraints) ? content.constraints.join('\n') : '',
    alternatives: Array.isArray(content.alternatives)
      ? content.alternatives
          .map((item) =>
            typeof item === 'object' && item && 'option' in item
              ? `${String(item.option)}${'reasonRejected' in item && item.reasonRejected ? ` — ${String(item.reasonRejected)}` : ''}`
              : '',
          )
          .filter(Boolean)
          .join('\n')
      : '',
    consequences: Array.isArray(content.consequences) ? content.consequences.join('\n') : '',
    observedFailure: String(content.observedFailure || ''),
    environment: String(content.environment || ''),
    suspectedCause: String(content.suspectedCause || ''),
    causeStatus:
      content.causeStatus === 'suspected' || content.causeStatus === 'confirmed'
        ? content.causeStatus
        : 'unknown',
    resolution: String(content.resolution || ''),
    resolutionVerified: content.resolutionVerified === true,
    preventiveRule: String(content.preventiveRule || ''),
    sourceReferenceId: record.revision.evidence[0]?.referenceId || '',
    evidenceKind:
      record.revision.evidence[0]?.kind === 'test' ||
      record.revision.evidence[0]?.kind === 'observed_run'
        ? record.revision.evidence[0].kind
        : 'source_code',
  };
}

export default function DecisionMemory() {
  const { snapshot, repositoryUrl } = useRepositoryAnalysis();
  const repository = snapshot?.repository || repositoryUrl;
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [questions, setQuestions] = useState<MaintainerQuestion[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [dashboard, setDashboard] = useState<'learner' | 'maintainer'>('learner');
  const [activeTab, setActiveTab] = useState<'records' | 'questions'>('records');
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [questionComponentId, setQuestionComponentId] = useState('');
  const [questionError, setQuestionError] = useState('');
  const [memoryMatches, setMemoryMatches] = useState<MemoryRecord[]>([]);
  const [memoryChecked, setMemoryChecked] = useState(false);
  const [memoryChecking, setMemoryChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<History | null>(null);
  const [replacementId, setReplacementId] = useState('');

  const selected = records.find((record) => record.id === selectedId) || null;
  const sourceReferences = snapshot?.references || [];
  const sourceComponents = useMemo<SourceComponent[]>(
    () =>
      (snapshot?.components || [])
        .flatMap((component) => {
          const reference = sourceReferences.find((item) => item.id === component.referenceId);
          return reference
            ? [
                {
                  id: component.id,
                  name: component.name,
                  role: component.role,
                  referenceId: reference.id,
                  snapshotId: reference.snapshotId,
                  file: reference.file,
                  startLine: reference.startLine,
                  endLine: reference.endLine,
                  url: reference.url,
                },
              ]
            : [];
        })
        .sort(
          (left, right) =>
            left.file.localeCompare(right.file) ||
            left.startLine - right.startLine ||
            left.name.localeCompare(right.name),
        ),
    [snapshot?.components, sourceReferences],
  );
  const visibleRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      JSON.stringify(record.revision.content).toLocaleLowerCase().includes(query),
    );
  }, [records, search]);
  const inboxQuestions = useMemo(
    () =>
      [...questions].sort((left, right) => {
        const leftUnanswered = left.status === 'open' && !left.response?.trim();
        const rightUnanswered = right.status === 'open' && !right.response?.trim();
        if (leftUnanswered !== rightUnanswered) return leftUnanswered ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      }),
    [questions],
  );
  const approvedRecords = records.filter(
    (record) =>
      record.status === 'approved' && record.id !== selectedId && record.type === selected?.type,
  );

  const refresh = useCallback(async () => {
    if (!repository) {
      setRecords([]);
      setQuestions([]);
      setSelectedId('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ repository, limit: '100' });
      if (dashboard === 'maintainer') {
        query.set('includeDrafts', 'true');
        query.set('includeHistory', 'true');
      }
      const result = await analysisApi<{ items: MemoryRecord[] }>(
        `/api/decision-memory/records?${query}`,
      );
      setRecords(result.items);
      setSelectedId((current) =>
        result.items.some((record) => record.id === current) ? current : result.items[0]?.id || '',
      );
      const questionResult = await analysisApi<{ questions: MaintainerQuestion[] }>(
        `/api/decision-memory/questions?repository=${encodeURIComponent(repository)}&status=all`,
      );
      setQuestions(questionResult.questions);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }, [dashboard, repository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setHistory(null);
    setReplacementId('');
  }, [selectedId]);

  async function mutate(url: string, body: unknown, success: string) {
    if (!selected) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await analysisApi(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNotice(success);
      await refresh();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }

  function openCreate(type: RecordType) {
    setEditingId('');
    setForm({ ...emptyForm, type });
    setFormOpen(true);
    setNotice('');
    setError('');
  }

  function openEdit(record: MemoryRecord) {
    setEditingId(record.id);
    setForm(formFromRecord(record));
    setFormOpen(true);
    setNotice('');
    setError('');
  }

  async function saveRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository) return;
    const reference = sourceReferences.find((item) => item.id === form.sourceReferenceId);
    const editingRecord = editingId ? records.find((record) => record.id === editingId) : null;
    const evidence: Evidence[] = reference
      ? [
          {
            kind: form.evidenceKind,
            snapshotId: reference.snapshotId,
            referenceId: reference.id,
          },
        ]
      : editingRecord?.revision.evidence || [];
    const content = recordContent(form);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const item = editingId ? records.find((record) => record.id === editingId) : null;
      const url = editingId
        ? `/api/decision-memory/records/${editingId}/revisions`
        : '/api/decision-memory/records';
      const body = editingId
        ? {
            expectedRevision: item?.currentRevision,
            content,
            evidence,
          }
        : { repository, type: form.type, content, evidence };
      const result = await analysisApi<MemoryRecord>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setFormOpen(false);
      setNotice(editingId ? 'A new draft revision was saved.' : 'Draft saved to F07 memory.');
      await refresh();
      setSelectedId(result.id);
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }

  async function createQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repository || !questionText.trim()) return;
    if (!memoryChecked) {
      setQuestionError('Check existing team memory before sending this question.');
      return;
    }
    setSaving(true);
    setQuestionError('');
    setNotice('');
    try {
      await analysisApi('/api/decision-memory/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repository,
          question: questionText,
          origin: 'why_question',
          ...(sourceComponents.some((item) => item.id === questionComponentId)
            ? {
                evidence: [
                  {
                    kind: 'source_code',
                    snapshotId: snapshot?.snapshotId,
                    referenceId: sourceComponents.find((item) => item.id === questionComponentId)
                      ?.referenceId,
                  },
                ],
              }
            : {}),
        }),
      });
      setQuestionText('');
      setQuestionComponentId('');
      setMemoryMatches([]);
      setMemoryChecked(false);
      setNotice('Question saved to the maintainer inbox.');
      await refresh();
    } catch (caught) {
      setQuestionError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }

  async function checkExistingMemory() {
    if (!repository || !questionText.trim()) {
      setQuestionError('Enter a question to search existing team memory.');
      return;
    }
    const stopWords = new Set([
      'about',
      'after',
      'again',
      'been',
      'does',
      'from',
      'have',
      'into',
      'that',
      'their',
      'there',
      'these',
      'they',
      'this',
      'what',
      'when',
      'where',
      'which',
      'with',
      'would',
      'your',
    ]);
    const terms = [
      ...new Set(
        (questionText.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter(
          (term) => !stopWords.has(term),
        ),
      ),
    ].slice(0, 8);
    const searchTerms = terms.length ? terms : [questionText.trim().toLocaleLowerCase()];
    setMemoryChecking(true);
    setQuestionError('');
    try {
      const results = await Promise.all(
        searchTerms.map((term) => {
          const query = new URLSearchParams({ repository, q: term, limit: '100' });
          return analysisApi<{ items: MemoryRecord[] }>(`/api/decision-memory/records?${query}`);
        }),
      );
      const matched = new Map<string, { record: MemoryRecord; score: number }>();
      for (const result of results) {
        for (const record of result.items) {
          if (!['approved', 'needs_review'].includes(record.status)) continue;
          const text = JSON.stringify(record.revision.content).toLocaleLowerCase();
          const score = terms.filter((term) => text.includes(term)).length;
          const current = matched.get(record.id);
          if (!current || score > current.score) matched.set(record.id, { record, score });
        }
      }
      setMemoryMatches(
        [...matched.values()]
          .sort((left, right) => right.score - left.score)
          .map(({ record }) => record),
      );
      setMemoryChecked(true);
    } catch (caught) {
      setQuestionError(messageFrom(caught));
    } finally {
      setMemoryChecking(false);
    }
  }

  async function respondToQuestion(
    question: MaintainerQuestion,
    response: string,
    referenceId: string,
    files: File[],
    resolve: boolean,
    recordId?: string,
  ) {
    if (!repository) return;
    setSaving(true);
    setError('');
    try {
      const attachedFiles = [...question.attachments];
      for (const file of files) {
        const attachment = await analysisApi<MaintainerQuestion['attachments'][number]>(
          `/api/decision-memory/questions/${question.id}/attachments`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-File-Name': encodeURIComponent(file.name),
              'X-File-Type': file.type || 'application/octet-stream',
            },
            body: file,
          },
        );
        attachedFiles.push(attachment);
      }
      const reference = sourceReferences.find((item) => item.id === referenceId);
      const responseEvidence: Evidence[] = [
        ...(reference
          ? [
              {
                kind: 'source_code' as const,
                snapshotId: reference.snapshotId,
                referenceId: reference.id,
              },
            ]
          : []),
        ...attachedFiles.slice(-19).map((attachment) => ({
          kind: 'other' as const,
          description: `Uploaded attachment: ${attachment.filename}`,
          externalRef: `/api/decision-memory/questions/${question.id}/attachments/${attachment.id}`,
        })),
      ];
      if (resolve) {
        await analysisApi(`/api/decision-memory/questions/${question.id}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response,
            responseEvidence,
            ...(recordId ? { recordId } : {}),
          }),
        });
      } else {
        await analysisApi(`/api/decision-memory/questions/${question.id}/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ response, evidence: responseEvidence }),
        });
      }
      setNotice(resolve ? 'Answer saved and question closed.' : 'Maintainer answer saved.');
      await refresh();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setSaving(false);
    }
  }

  async function loadHistory() {
    if (!selected || !repository) return;
    setError('');
    try {
      setHistory(
        await analysisApi<History>(
          `/api/decision-memory/records/${selected.id}/history?repository=${encodeURIComponent(repository)}`,
        ),
      );
    } catch (caught) {
      setError(messageFrom(caught));
    }
  }

  const disabledReason = !repository ? 'Analyze a repository first to use decision memory.' : '';

  return (
    <div className="decision-memory-page">
      <PageHeading
        eyebrow="TEAM MEMORY"
        title="Living decision & failure memory"
        description="Keep engineering rationale and reviewed failure lessons connected to the code, with a visible history of what is known and what remains uncertain."
        actions={
          <Button icon={RefreshCw} onClick={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <section className="dm-banner">
        <span className="dm-banner-icon">
          <Lightbulb size={22} />
        </span>
        <div>
          <strong>{dashboard === 'learner' ? 'Learner dashboard' : 'Maintainer dashboard'}</strong>
          <p>
            {dashboard === 'learner'
              ? 'Browse approved team memory, ask questions, and revisit saved answers.'
              : 'Draft, submit, approve and review records, and respond to learner questions.'}{' '}
            This shared demo identity is not production authentication.
          </p>
        </div>
        <Badge tone="amber">Demo mode · not access control</Badge>
      </section>

      {disabledReason && (
        <section className="dm-empty panel">
          <CircleAlert size={22} />
          <div>
            <h2>Repository analysis required</h2>
            <p>{disabledReason}</p>
          </div>
        </section>
      )}
      {error && (
        <div className="dm-alert dm-alert-error" role="alert">
          <TriangleAlert size={16} />
          {error}
        </div>
      )}
      {notice && (
        <div className="dm-alert dm-alert-success" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}

      <div className="dm-dashboard-switch" role="tablist" aria-label="Choose dashboard view">
        <button
          type="button"
          role="tab"
          className={dashboard === 'learner' ? 'active' : ''}
          aria-selected={dashboard === 'learner'}
          onClick={() => {
            setDashboard('learner');
            setActiveTab('records');
          }}
        >
          <UserRound size={15} /> Learner dashboard
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={dashboard === 'maintainer'}
          className={dashboard === 'maintainer' ? 'active' : ''}
          onClick={() => {
            setDashboard('maintainer');
            setActiveTab('questions');
          }}
        >
          <ShieldCheck size={15} /> Maintainer dashboard
        </button>
      </div>

      {!(dashboard === 'maintainer' && activeTab === 'questions') && (
        <div className="dm-toolbar">
          <div className="dm-tabs" role="tablist" aria-label="Decision memory sections">
            <button
              role="tab"
              aria-selected={activeTab === 'records'}
              className={activeTab === 'records' ? 'active' : ''}
              onClick={() => setActiveTab('records')}
            >
              <BookOpenCheck size={15} /> Records <span>{records.length}</span>
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'questions'}
              className={activeTab === 'questions' ? 'active' : ''}
              onClick={() => setActiveTab('questions')}
            >
              <MessageSquareText size={15} />{' '}
              {dashboard === 'maintainer' ? 'Question inbox' : 'Ask a question'}{' '}
              {dashboard === 'maintainer' && <span>{questions.length}</span>}
            </button>
          </div>
          {activeTab === 'records' && dashboard === 'maintainer' ? (
            <div className="dm-actions">
              <Button
                icon={FilePlus2}
                onClick={() => openCreate('decision')}
                disabled={!repository}
              >
                New decision
              </Button>
              <Button
                icon={TriangleAlert}
                onClick={() => openCreate('failure_lesson')}
                disabled={!repository}
              >
                New failure lesson
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {formOpen && dashboard === 'maintainer' && (
        <section className="dm-form-card panel">
          <div className="dm-section-heading">
            <div>
              <span className="tiny-label">{editingId ? 'NEW REVISION' : 'NEW DRAFT'}</span>
              <h2>
                {editingId
                  ? 'Revise record'
                  : `Create ${form.type === 'decision' ? 'decision' : 'failure lesson'}`}
              </h2>
            </div>
            <button
              className="dm-icon-button"
              aria-label="Close editor"
              onClick={() => setFormOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <form className="dm-form" onSubmit={saveRecord}>
            <label>
              Title
              <input
                required
                maxLength={240}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </label>
            <label>
              Summary
              <textarea
                required
                maxLength={2000}
                rows={2}
                value={form.summary}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
              />
            </label>
            {form.type === 'decision' ? (
              <>
                <label>
                  Context
                  <textarea
                    maxLength={5000}
                    rows={3}
                    value={form.context}
                    onChange={(event) => setForm({ ...form, context: event.target.value })}
                    placeholder="What problem or constraint prompted this decision?"
                  />
                </label>
                <label>
                  Decision
                  <textarea
                    maxLength={5000}
                    rows={3}
                    value={form.decision}
                    onChange={(event) => setForm({ ...form, decision: event.target.value })}
                    placeholder="What was decided? Leave unknown details blank."
                  />
                </label>
                <label>
                  Rationale
                  <textarea
                    maxLength={5000}
                    rows={3}
                    value={form.rationale}
                    onChange={(event) => setForm({ ...form, rationale: event.target.value })}
                    placeholder="Explain the reason; don't infer historical intent from code alone."
                  />
                </label>
                <label>
                  Constraints / invariants
                  <textarea
                    rows={3}
                    value={form.constraints}
                    onChange={(event) => setForm({ ...form, constraints: event.target.value })}
                    placeholder="One constraint per line"
                  />
                </label>
                <label>
                  Alternatives considered
                  <textarea
                    rows={3}
                    value={form.alternatives}
                    onChange={(event) => setForm({ ...form, alternatives: event.target.value })}
                    placeholder="One per line; optionally use “Option — reason rejected”"
                  />
                </label>
                <label>
                  Consequences / trade-offs
                  <textarea
                    rows={3}
                    value={form.consequences}
                    onChange={(event) => setForm({ ...form, consequences: event.target.value })}
                    placeholder="One consequence per line"
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Observed failure
                  <textarea
                    required
                    maxLength={5000}
                    rows={3}
                    value={form.observedFailure}
                    onChange={(event) => setForm({ ...form, observedFailure: event.target.value })}
                    placeholder="Describe what actually failed, without assuming a cause."
                  />
                </label>
                <label>
                  Environment / version
                  <textarea
                    maxLength={3000}
                    rows={2}
                    value={form.environment}
                    onChange={(event) => setForm({ ...form, environment: event.target.value })}
                  />
                </label>
                <div className="dm-form-pair">
                  <label>
                    Cause status
                    <select
                      value={form.causeStatus}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          causeStatus: event.target.value as FormValues['causeStatus'],
                        })
                      }
                    >
                      <option value="unknown">Unknown</option>
                      <option value="suspected">Suspected</option>
                      <option value="confirmed">Confirmed</option>
                    </select>
                  </label>
                  <label>
                    Suspected / confirmed cause
                    <textarea
                      maxLength={5000}
                      rows={2}
                      value={form.suspectedCause}
                      onChange={(event) => setForm({ ...form, suspectedCause: event.target.value })}
                    />
                  </label>
                </div>
                <label>
                  Resolution
                  <textarea
                    maxLength={5000}
                    rows={2}
                    value={form.resolution}
                    onChange={(event) => setForm({ ...form, resolution: event.target.value })}
                  />
                </label>
                <label className="dm-check">
                  <input
                    type="checkbox"
                    checked={form.resolutionVerified}
                    onChange={(event) =>
                      setForm({ ...form, resolutionVerified: event.target.checked })
                    }
                  />{' '}
                  Resolution verified with linked test or observed-run evidence
                </label>
                <label>
                  Preventive rule
                  <textarea
                    maxLength={3000}
                    rows={2}
                    value={form.preventiveRule}
                    onChange={(event) => setForm({ ...form, preventiveRule: event.target.value })}
                  />
                </label>
              </>
            )}
            <div className="dm-form-pair">
              <label>
                Supporting source{' '}
                {form.type === 'failure_lesson' && form.resolutionVerified
                  ? '(required for verified resolution)'
                  : '(optional)'}
                <select
                  value={form.sourceReferenceId}
                  onChange={(event) => setForm({ ...form, sourceReferenceId: event.target.value })}
                >
                  <option value="">No source selected</option>
                  {sourceReferences.map((reference) => (
                    <option value={reference.id} key={reference.id}>
                      {reference.file}:{reference.startLine}-{reference.endLine}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Evidence type
                <select
                  value={form.evidenceKind}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      evidenceKind: event.target.value as FormValues['evidenceKind'],
                    })
                  }
                >
                  <option value="source_code">Source code</option>
                  <option value="test">Test</option>
                  <option value="observed_run">Observed run</option>
                </select>
              </label>
            </div>
            <div className="dm-form-footer">
              <span>
                Source evidence is pinned to{' '}
                {snapshot?.commit.slice(0, 10) || 'the analyzed snapshot'}.
              </span>
              <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
            </div>
          </form>
        </section>
      )}
      {dashboard === 'maintainer' && activeTab === 'questions' && (
        <div className="dm-maintainer-record-switch">
          <Button type="button" icon={BookOpenCheck} onClick={() => setActiveTab('records')}>
            Records and team memory
          </Button>
        </div>
      )}

      {activeTab === 'records' ? (
        <section className="dm-record-layout">
          <aside className="dm-record-list panel">
            <div className="dm-list-heading">
              <div>
                <span className="tiny-label">REPOSITORY MEMORY</span>
                <strong>{records.length} records</strong>
              </div>
              <Badge tone="violet">All statuses</Badge>
            </div>
            <label className="dm-search">
              <Search size={15} />
              <input
                aria-label="Search records"
                placeholder="Search memory…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="dm-record-items">
              {loading ? <p className="dm-muted">Loading records…</p> : null}
              {!loading && visibleRecords.length === 0 && (
                <div className="dm-list-empty">
                  <FileClock size={19} />
                  <strong>No saved records yet</strong>
                  <span>
                    {dashboard === 'maintainer'
                      ? 'Create a decision or a failure lesson, then submit and approve it.'
                      : 'No approved records are available yet. Switch to the maintainer demo dashboard to create them.'}
                  </span>
                </div>
              )}
              {visibleRecords.map((record) => (
                <button
                  className={`dm-record-item ${record.id === selectedId ? 'selected' : ''}`}
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                >
                  <span className={`dm-type-icon ${record.type}`}>
                    {record.type === 'decision' ? (
                      <Lightbulb size={16} />
                    ) : (
                      <TriangleAlert size={16} />
                    )}
                  </span>
                  <span className="dm-record-copy">
                    <strong>{String(record.revision.content.title || 'Untitled record')}</strong>
                    <span>{String(record.revision.content.summary || '')}</span>
                    <small>
                      <Badge
                        tone={
                          record.status === 'approved'
                            ? 'green'
                            : record.status === 'needs_review'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {statusLabels[record.status]}
                      </Badge>
                      <span>Rev {record.currentRevision}</span>
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <article className="dm-detail panel">
            {!selected ? (
              <div className="dm-detail-empty">
                <Lightbulb size={27} />
                <h2>Knowledge that stays connected</h2>
                <p>
                  {dashboard === 'maintainer'
                    ? 'Choose a record, or create a decision or failure lesson with the buttons above.'
                    : 'Choose a record when team memory is available. A maintainer can create the first record from the Maintainer dashboard.'}
                </p>
              </div>
            ) : (
              <>
                <div className="dm-detail-header">
                  <div>
                    <div className="dm-record-meta">
                      <Badge tone={selected.type === 'decision' ? 'violet' : 'amber'}>
                        {selected.type === 'decision' ? 'Decision' : 'Failure lesson'}
                      </Badge>
                      <Badge
                        tone={
                          selected.status === 'approved'
                            ? 'green'
                            : selected.status === 'needs_review'
                              ? 'amber'
                              : 'neutral'
                        }
                      >
                        {statusLabels[selected.status]}
                      </Badge>
                      <span>Revision {selected.currentRevision}</span>
                    </div>
                    <h2>{String(selected.revision.content.title || '')}</h2>
                    <p>{String(selected.revision.content.summary || '')}</p>
                  </div>
                  <span className="dm-version">
                    <GitBranch size={14} />
                    {snapshot?.commit.slice(0, 10) || 'Version-linked'}
                  </span>
                </div>
                {selected.status === 'needs_review' && (
                  <div className="dm-review-warning">
                    <CircleAlert size={17} />
                    <p>
                      This record is preserved, but its applicability needs maintainer review. It is
                      not evidence of a regression.
                    </p>
                  </div>
                )}
                <div className="dm-content-grid">
                  {Object.entries(selected.revision.content)
                    .filter(
                      ([key, value]) =>
                        ![
                          'title',
                          'summary',
                          'constraints',
                          'alternatives',
                          'consequences',
                          'openQuestions',
                        ].includes(key) &&
                        value !== undefined &&
                        value !== '' &&
                        value !== false &&
                        value !== 'unknown',
                    )
                    .map(([key, value]) => (
                      <section className="dm-content-block" key={key}>
                        <span>
                          {key
                            .replace(/[A-Z]/g, (letter) => ` ${letter}`)
                            .replace(/^./, (letter) => letter.toUpperCase())}
                        </span>
                        <p>
                          {Array.isArray(value)
                            ? value
                                .map((item) =>
                                  typeof item === 'string' ? item : JSON.stringify(item),
                                )
                                .join(' · ')
                            : String(value)}
                        </p>
                      </section>
                    ))}
                  {selected.revision.content.causeStatus === 'unknown' && (
                    <section className="dm-content-block">
                      <span>Cause status</span>
                      <p>
                        Unknown — this records the observed failure without asserting a root cause.
                      </p>
                    </section>
                  )}
                </div>
                <section className="dm-evidence">
                  <h3>
                    <ShieldCheck size={15} />
                    Evidence and provenance
                  </h3>
                  {selected.revision.evidence.length ? (
                    selected.revision.evidence.map((item, index) => {
                      const reference = sourceReferences.find(
                        (entry) => entry.id === item.referenceId,
                      );
                      return (
                        <div
                          className="dm-evidence-item"
                          key={`${item.referenceId || item.externalRef || index}`}
                        >
                          <span>{item.kind.replaceAll('_', ' ')}</span>
                          {reference ? (
                            <a href={reference.url} target="_blank" rel="noreferrer">
                              {reference.file}:{reference.startLine}-{reference.endLine}
                              <ArrowIcon />
                            </a>
                          ) : (
                            <span>
                              {item.description ||
                                item.externalRef ||
                                'Evidence reference retained'}
                            </span>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p>
                      No evidence attached. Unverified statements should remain clearly identified.
                    </p>
                  )}
                  {selected.revision.approvedAt && (
                    <p className="dm-provenance">
                      Approved by {selected.revision.approvedBy} ·{' '}
                      {new Date(selected.revision.approvedAt).toLocaleString()}
                    </p>
                  )}
                  {selected.supersededBy && (
                    <p className="dm-provenance">Superseded by record {selected.supersededBy}</p>
                  )}
                  {selected.withdrawnReason && (
                    <p className="dm-provenance">Withdrawal reason: {selected.withdrawnReason}</p>
                  )}
                </section>
                {dashboard === 'maintainer' && (
                  <div className="dm-record-actions">
                    {['draft', 'awaiting_review', 'approved', 'needs_review'].includes(
                      selected.status,
                    ) && (
                      <Button icon={FilePlus2} onClick={() => openEdit(selected)} disabled={saving}>
                        Create revision
                      </Button>
                    )}
                    {selected.status === 'draft' && (
                      <Button
                        icon={Send}
                        onClick={() =>
                          void mutate(
                            `/api/decision-memory/records/${selected.id}/submit`,
                            { expectedRevision: selected.currentRevision },
                            'Submitted for review.',
                          )
                        }
                        disabled={saving}
                      >
                        Submit for review
                      </Button>
                    )}
                    {selected.status === 'awaiting_review' && (
                      <Button
                        icon={ShieldCheck}
                        variant="primary"
                        onClick={() =>
                          void mutate(
                            `/api/decision-memory/records/${selected.id}/approve`,
                            { expectedRevision: selected.currentRevision },
                            'Revision approved in demo mode.',
                          )
                        }
                        disabled={saving}
                      >
                        Approve as demo maintainer
                      </Button>
                    )}
                    {selected.status === 'approved' && (
                      <Button
                        icon={CircleAlert}
                        onClick={() =>
                          void mutate(
                            `/api/decision-memory/records/${selected.id}/needs-review`,
                            {
                              expectedRevision: selected.currentRevision,
                              reason: 'Marked for maintainer review from the F07 workspace.',
                            },
                            'Record marked for review.',
                          )
                        }
                        disabled={saving}
                      >
                        Mark for review
                      </Button>
                    )}
                    {selected.status === 'approved' && (
                      <Button
                        icon={Archive}
                        variant="danger"
                        onClick={() => {
                          const reason = window.prompt('Why is this record being withdrawn?');
                          if (reason?.trim())
                            void mutate(
                              `/api/decision-memory/records/${selected.id}/withdraw`,
                              { expectedRevision: selected.currentRevision, reason },
                              'Record withdrawn.',
                            );
                        }}
                        disabled={saving}
                      >
                        Withdraw
                      </Button>
                    )}
                    {selected.status === 'needs_review' && (
                      <>
                        <Button
                          icon={Check}
                          variant="primary"
                          onClick={() =>
                            void mutate(
                              `/api/decision-memory/records/${selected.id}/review`,
                              {
                                expectedRevision: selected.currentRevision,
                                outcome: 'still_applicable',
                                reason: 'Reviewed against available evidence; remains applicable.',
                              },
                              'Review resolved; record remains applicable.',
                            )
                          }
                          disabled={saving}
                        >
                          Still applicable
                        </Button>
                        <Button
                          icon={Archive}
                          variant="danger"
                          onClick={() =>
                            void mutate(
                              `/api/decision-memory/records/${selected.id}/review`,
                              {
                                expectedRevision: selected.currentRevision,
                                outcome: 'withdraw',
                                reason: 'Withdrawn after maintainer review.',
                              },
                              'Record withdrawn after review.',
                            )
                          }
                          disabled={saving}
                        >
                          Withdraw
                        </Button>
                      </>
                    )}
                    {['approved', 'needs_review'].includes(selected.status) &&
                      approvedRecords.length > 0 && (
                        <div className="dm-supersede">
                          <select
                            aria-label="Replacement record"
                            value={replacementId}
                            onChange={(event) => setReplacementId(event.target.value)}
                          >
                            <option value="">Choose approved replacement</option>
                            {approvedRecords.map((record) => (
                              <option key={record.id} value={record.id}>
                                {String(record.revision.content.title || record.id)}
                              </option>
                            ))}
                          </select>
                          <Button
                            icon={Archive}
                            onClick={() =>
                              void mutate(
                                `/api/decision-memory/records/${selected.id}/supersede`,
                                { expectedRevision: selected.currentRevision, replacementId },
                                'Record superseded.',
                              )
                            }
                            disabled={saving || !replacementId}
                          >
                            Supersede
                          </Button>
                        </div>
                      )}
                    {selected.status !== 'withdrawn' &&
                      selected.status !== 'superseded' &&
                      selected.status !== 'approved' &&
                      selected.status !== 'needs_review' && (
                        <span className="dm-draft-note">
                          Drafts are not visible to regular retrieval.
                        </span>
                      )}
                    <Button icon={History} onClick={() => void loadHistory()} disabled={saving}>
                      Revision history
                    </Button>
                  </div>
                )}
                {dashboard === 'maintainer' && history && (
                  <div className="dm-history">
                    <h3>
                      <History size={15} />
                      Revision and audit history
                    </h3>
                    {history.revisions.map((revision) => (
                      <div key={revision.number}>
                        <strong>Revision {revision.number}</strong>
                        <span>{new Date(revision.createdAt).toLocaleString()}</span>
                        {revision.approvedAt && <Badge tone="green">Approved</Badge>}
                      </div>
                    ))}
                    {history.events.map((event, index) => (
                      <div key={`${event.action}-${index}`}>
                        <strong>{event.action.replaceAll('.', ' ')}</strong>
                        <span>{new Date(event.createdAt).toLocaleString()}</span>
                        <small>{event.actorId || 'Demo / unassigned actor'}</small>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        </section>
      ) : (
        <section
          className={`dm-question-layout ${dashboard === 'learner' ? 'learner' : 'maintainer'}`}
        >
          {dashboard === 'learner' ? (
            <form className="dm-question-create panel" onSubmit={createQuestion}>
              <span className="tiny-label">CAPTURE A KNOWLEDGE GAP</span>
              <h2>Ask a maintainer</h2>
              <p>
                First search current team memory for related explanations. If nothing answers your
                question, send it to the maintainer inbox.
              </p>
              <label className="dm-question-input">
                Question
                <textarea
                  required
                  maxLength={2000}
                  rows={4}
                  placeholder="Why does this behavior exist? What failure context is missing?"
                  value={questionText}
                  onChange={(event) => {
                    setQuestionText(event.target.value);
                    setMemoryChecked(false);
                    setMemoryMatches([]);
                  }}
                />
              </label>
              <label className="dm-question-input">
                Related module or function (optional)
                <select
                  value={questionComponentId}
                  onChange={(event) => {
                    setQuestionComponentId(event.target.value);
                    setMemoryChecked(false);
                    setMemoryMatches([]);
                  }}
                >
                  <option value="">No module or function selected</option>
                  {sourceComponents.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.role.replaceAll('_', ' ')} · {component.name} · {component.file}:
                      {component.startLine}
                    </option>
                  ))}
                </select>
              </label>
              {memoryChecked && (
                <div className="dm-memory-check" role="status">
                  <strong>
                    {memoryMatches.length
                      ? `${memoryMatches.length} related record${memoryMatches.length === 1 ? '' : 's'} found`
                      : 'No related current records found'}
                  </strong>
                  {memoryMatches.length ? (
                    <div className="dm-memory-match-list">
                      {memoryMatches.slice(0, 5).map((record) => (
                        <article key={record.id}>
                          <div>
                            <strong>
                              {String(record.revision.content.title || 'Untitled record')}
                            </strong>
                            <Badge tone={record.status === 'approved' ? 'green' : 'amber'}>
                              {statusLabels[record.status]}
                            </Badge>
                          </div>
                          <p>{String(record.revision.content.summary || '')}</p>
                          <Button
                            type="button"
                            onClick={() => {
                              setSelectedId(record.id);
                              setActiveTab('records');
                            }}
                          >
                            Review this record
                          </Button>
                        </article>
                      ))}
                    </div>
                  ) : records.length ? (
                    <p>
                      Keyword search found no related current record. You can still ask a
                      maintainer.
                    </p>
                  ) : (
                    <p>
                      No records exist yet. A maintainer can create decision or failure records from
                      the Records tab.
                    </p>
                  )}
                </div>
              )}
              {questionError && (
                <div className="dm-alert dm-alert-error" role="alert">
                  {questionError}
                </div>
              )}
              {!memoryChecked ? (
                <Button
                  type="button"
                  icon={Search}
                  variant="primary"
                  onClick={() => void checkExistingMemory()}
                  disabled={memoryChecking || !repository || !questionText.trim()}
                >
                  {memoryChecking ? 'Searching memory…' : 'Check existing memory'}
                </Button>
              ) : (
                <Button
                  type="submit"
                  icon={Send}
                  variant="primary"
                  disabled={saving || !repository}
                >
                  {saving ? 'Saving…' : 'Send question to maintainer'}
                </Button>
              )}
              <small>Question and answer history is saved in this repository’s memory.</small>
            </form>
          ) : null}
          <div className="dm-question-list panel">
            <div className="dm-list-heading">
              <div>
                <span className="tiny-label">
                  {dashboard === 'maintainer'
                    ? 'PERSISTENT QUESTION INBOX'
                    : 'SAVED QUESTION HISTORY'}
                </span>
                <strong>
                  {questions.filter((question) => question.status === 'open').length} open ·{' '}
                  {questions.length} total
                </strong>
              </div>
              {dashboard === 'maintainer' && (
                <div className="dm-inbox-heading-copy">
                  <h2>Review learner questions</h2>
                  <p>
                    Choose an analyzed module or function to draft a focused, source-grounded
                    response. Review it before saving.
                  </p>
                </div>
              )}
              <Badge tone="violet">
                {dashboard === 'maintainer' ? 'Repository inbox' : 'Saved conversations'}
              </Badge>
            </div>
            {!questions.length ? (
              <div className="dm-list-empty">
                <MessageSquareText size={20} />
                <strong>No questions yet</strong>
                <span>Questions and maintainer responses remain available after refresh.</span>
              </div>
            ) : (
              inboxQuestions.map((question) => (
                <QuestionInboxItem
                  key={question.id}
                  question={question}
                  sourceComponents={sourceComponents}
                  sourceReferences={sourceReferences}
                  records={records}
                  saving={saving}
                  interactive={dashboard === 'maintainer'}
                  onRespond={(response, referenceId, files) =>
                    respondToQuestion(question, response, referenceId, files, false)
                  }
                  onResolve={(response, referenceId, files, recordId) =>
                    respondToQuestion(question, response, referenceId, files, true, recordId)
                  }
                />
              ))
            )}
          </div>
        </section>
      )}
      {dashboard === 'maintainer' && activeTab === 'questions' && (
        <div className="dm-maintainer-record-switch">
          <Button type="button" icon={BookOpenCheck} onClick={() => setActiveTab('records')}>
            Records and team memory
          </Button>
        </div>
      )}
    </div>
  );
}

function ArrowIcon() {
  return <GitBranch size={12} aria-hidden="true" />;
}

function QuestionInboxItem({
  question,
  sourceComponents,
  sourceReferences,
  records,
  saving,
  interactive,
  onRespond,
  onResolve,
}: {
  question: MaintainerQuestion;
  sourceComponents: SourceComponent[];
  sourceReferences: {
    id: string;
    snapshotId: string;
    file: string;
    startLine: number;
    endLine: number;
    url: string;
  }[];
  records: MemoryRecord[];
  saving: boolean;
  interactive: boolean;
  onRespond: (response: string, referenceId: string, files: File[]) => Promise<void>;
  onResolve: (
    response: string,
    referenceId: string,
    files: File[],
    recordId?: string,
  ) => Promise<void>;
}) {
  const [response, setResponse] = useState(question.response || '');
  const [componentId, setComponentId] = useState(
    sourceComponents.find(
      (component) =>
        component.referenceId ===
        question.responseEvidence?.find((item) => item.referenceId)?.referenceId,
    )?.id ||
      sourceComponents.find(
        (component) =>
          component.referenceId === question.evidence.find((item) => item.referenceId)?.referenceId,
      )?.id ||
      '',
  );
  const [files, setFiles] = useState<File[]>([]);
  const [recordId, setRecordId] = useState(question.resolvedRecordId || '');
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [itemError, setItemError] = useState('');
  const [suggestion, setSuggestion] = useState<ResponseSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const isOpen = question.status === 'open';
  const linkedRecord = records.find((record) => record.id === question.resolvedRecordId);
  const responseEvidence = question.responseEvidence || [];
  const selectedComponent = sourceComponents.find((item) => item.id === componentId);

  useEffect(() => {
    setResponse(question.response || '');
    setComponentId(
      sourceComponents.find(
        (component) =>
          component.referenceId ===
          question.responseEvidence?.find((item) => item.referenceId)?.referenceId,
      )?.id ||
        sourceComponents.find(
          (component) =>
            component.referenceId ===
            question.evidence.find((item) => item.referenceId)?.referenceId,
        )?.id ||
        '',
    );
    setRecordId(question.resolvedRecordId || '');
  }, [
    question.id,
    question.response,
    question.responseEvidence,
    question.evidence,
    question.resolvedRecordId,
    sourceComponents,
  ]);

  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  async function generateSuggestion() {
    setItemError('');
    setSuggestionLoading(true);
    try {
      if (!selectedComponent) {
        setItemError('Select an analyzed module or function first.');
        return;
      }
      const result = await analysisApi<ResponseSuggestion>(
        `/api/decision-memory/questions/${question.id}/suggestion`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            selectedComponent
              ? {
                  componentId: selectedComponent.id,
                  snapshotId: selectedComponent.snapshotId,
                }
              : {},
          ),
        },
      );
      setSuggestion(result);
      setResponse(result.response);
      setComponentId(result.source.componentId);
    } catch (caught) {
      setItemError(messageFrom(caught));
    } finally {
      setSuggestionLoading(false);
    }
  }

  function startVoiceInput() {
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceError(
        'Voice dictation is not available in this browser. You can type the answer instead.',
      );
      return;
    }
    setVoiceError('');
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .filter(Boolean)
        .join(' ');
      if (transcript) setResponse((current) => `${current}${current ? ' ' : ''}${transcript}`);
    };
    recognition.onerror = (event) => {
      setVoiceError(`Voice input stopped: ${event.error}. You can continue by typing.`);
      setVoiceListening(false);
    };
    recognition.onend = () => setVoiceListening(false);
    recognitionRef.current = recognition;
    setVoiceListening(true);
    try {
      recognition.start();
    } catch (error) {
      setVoiceListening(false);
      setVoiceError(
        `Could not start voice dictation: ${messageFrom(error)} You can type the answer instead.`,
      );
    }
  }

  async function submit(resolve: boolean) {
    if (!response.trim()) {
      setItemError('Write or dictate an answer before saving or resolving this question.');
      return;
    }
    setItemError('');
    const referenceId = selectedComponent?.referenceId || '';
    if (resolve) await onResolve(response, referenceId, files, recordId || undefined);
    else await onRespond(response, referenceId, files);
    setFiles([]);
  }

  const attachmentUrl = (id: string) =>
    `/api/decision-memory/questions/${question.id}/attachments/${id}`;

  return (
    <article className="dm-question-item">
      <div className="dm-question-meta">
        <Badge tone={isOpen ? 'amber' : question.status === 'resolved' ? 'green' : 'neutral'}>
          {question.status === 'open' ? 'Open' : question.status}
          {' · '}
          {question.occurrenceCount} occurrence{question.occurrenceCount === 1 ? '' : 's'}
        </Badge>
        <small>{new Date(question.updatedAt).toLocaleString()}</small>
      </div>
      <h3>{question.question}</h3>
      {question.evidence.length > 0 && (
        <div className="dm-question-evidence">
          {question.evidence.map((item, index) => {
            const ref = sourceReferences.find((source) => source.id === item.referenceId);
            return ref ? (
              <a href={ref.url} target="_blank" rel="noreferrer" key={`${ref.id}-${index}`}>
                {ref.file}:{ref.startLine}-{ref.endLine}
              </a>
            ) : (
              <span key={`${item.externalRef || item.description}-${index}`}>
                {item.description || item.externalRef}
              </span>
            );
          })}
        </div>
      )}
      {question.response ? (
        <section className="dm-saved-response">
          <div>
            <ShieldCheck size={14} />
            <strong>Maintainer answer</strong>
          </div>
          <p>{question.response}</p>
          {question.respondedAt && (
            <small>
              {question.respondedBy || 'Demo maintainer'} ·{' '}
              {new Date(question.respondedAt).toLocaleString()}
            </small>
          )}
          {responseEvidence.map((item, index) => {
            const ref = sourceReferences.find((source) => source.id === item.referenceId);
            return ref ? (
              <a href={ref.url} target="_blank" rel="noreferrer" key={`answer-ref-${index}`}>
                <GitBranch size={12} /> {ref.file}:{ref.startLine}-{ref.endLine}
              </a>
            ) : item.externalRef?.includes('/attachments/') ? (
              <a
                href={item.externalRef}
                target="_blank"
                rel="noreferrer"
                key={`answer-attachment-${index}`}
              >
                <Paperclip size={12} /> {item.description || 'Download evidence attachment'}
              </a>
            ) : null;
          })}
        </section>
      ) : question.closeReason ? (
        <section className="dm-saved-response">
          <strong>Closed without an answer</strong>
          <p>{question.closeReason}</p>
        </section>
      ) : null}
      {question.attachments.length > 0 && (
        <div className="dm-attachment-list">
          {question.attachments.map((attachment) => (
            <a
              href={attachmentUrl(attachment.id)}
              key={attachment.id}
              target="_blank"
              rel="noreferrer"
            >
              <Paperclip size={13} /> {attachment.filename} ·{' '}
              {Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB
            </a>
          ))}
        </div>
      )}
      {question.resolvedRecordId && linkedRecord && (
        <p className="dm-linked-record">
          Linked record: {String(linkedRecord.revision.content.title || linkedRecord.id)}
        </p>
      )}
      {isOpen && interactive && (
        <div className="dm-answer-editor">
          <label>
            Maintainer response
            <textarea
              rows={4}
              maxLength={5000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              placeholder="Answer using what is known. State uncertainty rather than guessing historical intent."
            />
          </label>
          <div className="dm-answer-tools">
            <label>
              <span>Analyzed module or function</span>
              <select
                value={componentId}
                onChange={(event) => {
                  setComponentId(event.target.value);
                  setSuggestion(null);
                }}
              >
                <option value="">Select a module or function</option>
                {sourceComponents.map((component) => (
                  <option key={component.id} value={component.id}>
                    {component.role.replaceAll('_', ' ')} · {component.name} · {component.file}:
                    {component.startLine}
                  </option>
                ))}
              </select>
            </label>
            <div className="dm-voice-tools">
              <Button
                type="button"
                icon={voiceListening ? MicOff : Mic}
                onClick={() => {
                  if (voiceListening) recognitionRef.current?.stop();
                  else startVoiceInput();
                }}
                disabled={saving}
              >
                {voiceListening ? 'Stop dictation' : 'Dictate answer'}
              </Button>
              {voiceError && <small role="status">{voiceError}</small>}
            </div>
            <label className="dm-file-picker">
              <Paperclip size={14} /> Attach files (up to 5 MB each)
              <input
                type="file"
                multiple
                onChange={(event) => {
                  const nextFiles = Array.from(event.target.files || []);
                  const tooLarge = nextFiles.find((file) => file.size > 5 * 1024 * 1024);
                  if (tooLarge) setItemError(`${tooLarge.name} exceeds the 5 MB file limit.`);
                  else {
                    setItemError('');
                    setFiles((current) => [...current, ...nextFiles]);
                  }
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <div className="dm-suggestion-tools">
            <Button
              type="button"
              icon={Lightbulb}
              onClick={() => void generateSuggestion()}
              disabled={saving || suggestionLoading || !selectedComponent}
            >
              {suggestionLoading ? 'Generating draft…' : 'Generate response draft'}
            </Button>
            <small>
              Uses the related analyzed source. Review and edit the draft; it is not saved until you
              choose a save action.
            </small>
          </div>
          {suggestion && (
            <div className="dm-suggestion-preview" role="status">
              <div>
                <Badge tone={suggestion.mode === 'ai' ? 'violet' : 'amber'}>
                  {suggestion.mode === 'ai' ? 'AI draft' : 'Source-facts draft'}
                </Badge>
                <span>{suggestion.notice}</span>
              </div>
              {suggestion.citations.map((citation) => {
                const reference = sourceReferences.find((source) => source.id === citation.id);
                return reference ? (
                  <a key={citation.id} href={reference.url} target="_blank" rel="noreferrer">
                    <GitBranch size={12} />
                    {citation.file}:{citation.startLine}-{citation.endLine}
                  </a>
                ) : null;
              })}
              <small>The draft has been placed in the editable response field for review.</small>
            </div>
          )}
          {files.length > 0 && (
            <div className="dm-pending-files">
              {files.map((file, index) => (
                <button
                  type="button"
                  key={`${file.name}-${file.lastModified}-${index}`}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                >
                  <Paperclip size={12} /> {file.name} <X size={12} />
                </button>
              ))}
            </div>
          )}
          <div className="dm-question-actions">
            {records.some((record) => record.status === 'approved') && (
              <select
                aria-label="Link approved decision memory record"
                value={recordId}
                onChange={(event) => setRecordId(event.target.value)}
              >
                <option value="">Optionally link an approved record</option>
                {records
                  .filter((record) => record.status === 'approved')
                  .map((record) => (
                    <option key={record.id} value={record.id}>
                      {String(record.revision.content.title || record.id)}
                    </option>
                  ))}
              </select>
            )}
            <Button
              type="button"
              onClick={() => void submit(false)}
              disabled={saving || !response.trim()}
            >
              Save answer
            </Button>
            <Button
              type="button"
              variant="primary"
              icon={Check}
              onClick={() => void submit(true)}
              disabled={saving || !response.trim()}
            >
              Save answer & resolve
            </Button>
          </div>
          {itemError && (
            <div className="dm-alert dm-alert-error" role="alert">
              {itemError}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

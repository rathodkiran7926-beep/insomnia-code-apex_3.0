import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, Copy, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, PageHeading, PanelHeading } from '../components/UI';
import { RelearningCard } from '../components/RelearningCard';
import { useRepositoryAnalysis } from '../state/RepositoryAnalysisContext';
import { analysisApi } from '../services/analysisApi';
import '../styles/demo-flow.css';

type BridgeContext = {
  identity: { repository: string; snapshotId: string; commit: string };
  evidenceStatus: string;
  freshness: string;
  evidence: { referenceId: string; referenceIds?: string[] }[];
  tokenEstimate: number;
  truncated: boolean;
  promptSlice: string;
  [key: string]: unknown;
};

export default function AgentContext() {
  const { snapshot } = useRepositoryAnalysis();
  const go = useNavigate();
  const [task, setTask] = useState('Understand the request flow and the files to change');
  const [format, setFormat] = useState<'json' | 'prompt' | 'mcp'>('json');
  const [context, setContext] = useState<BridgeContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyError, setCopyError] = useState(false);
  const generation = useRef(0);
  const [retrievedTask, setRetrievedTask] = useState('');
  useEffect(() => {
    generation.current++;
    setContext(null);
    setLoading(false);
    setError('');
    return () => {
      generation.current++;
    };
  }, [snapshot?.snapshotId]);
  const mcpRequest = useMemo(
    () =>
      context
        ? [
            'Use the codebase_mentor MCP server to call get_task_context for this analyzed snapshot.',
            `snapshotId: ${context.identity.snapshotId}`,
            `task: ${JSON.stringify(retrievedTask)}`,
            'This is an instruction for your coding agent; copying it does not invoke the MCP tool by itself.',
            'Use the returned source citations as architecture context. Before editing, inspect the cited files in my current checkout and report any mismatch with the analyzed snapshot.',
          ].join('\n')
        : '',
    [context, retrievedTask],
  );
  const output = useMemo(
    () =>
      context
        ? format === 'json'
          ? JSON.stringify(context, null, 2)
          : format === 'mcp'
            ? mcpRequest
            : context.promptSlice
        : '',
    [context, format, mcpRequest],
  );

  async function retrieve() {
    if (!snapshot) return;
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setContext(null);
    try {
      const next = await analysisApi<BridgeContext>(
        `/api/snapshots/${encodeURIComponent(snapshot.snapshotId)}/agent-context`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task, targetTokens: 1800, maxTokens: 2400 }),
        },
      );
      if (version === generation.current) {
        setContext(next);
        setRetrievedTask(task);
      }
    } catch (e) {
      if (version === generation.current) setError((e as Error).message);
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([output], { type: format === 'json' ? 'application/json' : 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `mentor-agent-context-${context?.identity.commit || 'snapshot'}.${format === 'json' ? 'json' : 'md'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <PageHeading
        className="agent-context-page-heading"
        eyebrow="FEATURE 12 / AGENT CONTEXT BRIDGE"
        title="Give your coding agent the source."
        description="Retrieve compact, revision-bound architecture context from the analyzed repository graph."
      />
      <div className="agent-context-layout">
        <section className="panel">
          <PanelHeading icon={Bot} title="Agent Context Snapshot">
            <Badge tone={context?.evidenceStatus === 'evidence_found' ? 'green' : 'violet'}>
              {context?.evidenceStatus || 'Ready to retrieve'}
            </Badge>
          </PanelHeading>
          <div className="panel-body stack-16">
            {!snapshot ? (
              <div className="stack-12">
                <p>Analyze a public repository to use its saved knowledge graph here.</p>
                <Button variant="primary" onClick={() => go('/repository')}>
                  Analyze repository <ArrowRight size={14} />
                </Button>
              </div>
            ) : (
              <>
                <div className="context-controls">
                  <label>
                    Task context
                    <textarea
                      aria-label="Task context"
                      rows={3}
                      maxLength={2000}
                      value={task}
                      onChange={(event) => setTask(event.target.value)}
                    />
                  </label>
                </div>
                <div className="row gap-8">
                  <Badge tone="violet">{snapshot.commit.slice(0, 12)}</Badge>
                  <Badge>{snapshot.repository.replace('https://github.com/', '')}</Badge>
                </div>
                <div className="row gap-8">
                  <Button
                    variant="primary"
                    disabled={loading || !task.trim()}
                    onClick={() => void retrieve()}
                  >
                    {loading ? 'Retrieving…' : 'Retrieve relevant context'}
                  </Button>
                </div>
                {context && (
                  <>
                    <div className="row gap-8">
                      <Badge>
                        {context.evidence.reduce(
                          (count, item) => count + (item.referenceIds?.length || 1),
                          0,
                        )}{' '}
                        source citations
                      </Badge>
                      <Badge>{context.tokenEstimate} estimated tokens</Badge>
                      <Badge>{context.freshness}</Badge>
                    </div>
                    {context.truncated && (
                      <p role="status">Context was truncated to fit the configured budget.</p>
                    )}
                    {context.evidenceStatus === 'insufficient_evidence' && (
                      <p role="status">No supporting graph evidence matched this task.</p>
                    )}
                    <div className="workspace-tabs" role="group" aria-label="Export format">
                      <button
                        aria-pressed={format === 'json'}
                        className={format === 'json' ? 'active' : ''}
                        onClick={() => setFormat('json')}
                      >
                        JSON snapshot
                      </button>
                      <button
                        aria-pressed={format === 'prompt'}
                        className={format === 'prompt' ? 'active' : ''}
                        onClick={() => setFormat('prompt')}
                      >
                        Prompt slice
                      </button>
                      <button
                        aria-pressed={format === 'mcp'}
                        className={format === 'mcp' ? 'active' : ''}
                        onClick={() => setFormat('mcp')}
                      >
                        MCP request
                      </button>
                    </div>
                    <textarea
                      className="context-output"
                      aria-label="Agent context export"
                      readOnly
                      value={output}
                      spellCheck={false}
                    />
                    <div className="row gap-8 context-actions">
                      <Button
                        icon={Copy}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(output);
                            setCopyError(false);
                          } catch {
                            setCopyError(true);
                          }
                        }}
                      >
                        Copy{' '}
                        {format === 'json'
                          ? 'JSON'
                          : format === 'mcp'
                            ? 'MCP request'
                            : 'prompt slice'}
                      </Button>
                      <Button variant="primary" icon={Download} onClick={download}>
                        Download{' '}
                        {format === 'json'
                          ? 'JSON'
                          : format === 'mcp'
                            ? 'MCP request'
                            : 'prompt slice'}
                      </Button>
                    </div>
                    {copyError && (
                      <p role="alert">
                        Clipboard unavailable. Select the text above or use Download.
                      </p>
                    )}
                    <p className="muted">
                      Freshness is checked against the immutable analyzed snapshot. Live working
                      tree changes are not available to this bridge.
                    </p>
                  </>
                )}
              </>
            )}
            {error && <p role="alert">{error}</p>}
          </div>
        </section>
        <aside className="stack-20">
          <section className="panel panel-body stack-12">
            <h2>Send this context to your coding agent.</h2>
            <p>
              Your agent can retrieve this snapshot directly over MCP. Select MCP request above,
              copy it, and paste it into Codex, Claude Code, OpenCode, Cursor, or another MCP
              client. Without MCP connected, copy the Prompt slice instead.
            </p>
            <Button icon={ArrowRight} onClick={() => go('/repository')}>
              Review repository analysis
            </Button>
            <Button onClick={() => go('/agent-context-demo')}>Open prepared context demo</Button>
          </section>
          <RelearningCard />
          <Button onClick={() => go('/progress')}>
            View learning summary <ArrowRight size={14} />
          </Button>
        </aside>
      </div>
    </>
  );
}

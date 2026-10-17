import { useState } from 'react';
import { ArrowRight, Bot, Copy, Download } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, PageHeading, PanelHeading } from '../components/UI';
import { RelearningCard } from '../components/RelearningCard';
import { buildAgentContext, formatAgentPrompt } from '../domain/agentContext';
import type { Snapshot } from '../data/types';
import { useWorkspace } from '../state/WorkspaceContext';
import '../styles/demo-flow.css';

export default function AgentContext() {
  const { state, setSnapshot, notify } = useWorkspace();
  const go = useNavigate();
  const [journey, setJourney] = useState<'signup' | 'login'>('signup');
  const [format, setFormat] = useState<'json' | 'prompt'>('json');
  const [copyError, setCopyError] = useState(false);
  const context = buildAgentContext(state.snapshot, journey);
  const output = format === 'json' ? JSON.stringify(context, null, 2) : formatAgentPrompt(context);

  function download() {
    const url = URL.createObjectURL(
      new Blob([output], { type: format === 'json' ? 'application/json' : 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `mentor-agent-context-${context.revision.commit}.${format === 'json' ? 'json' : 'md'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Agent context snapshot exported for the selected revision.');
  }

  return (
    <>
      <PageHeading
        eyebrow="FEATURE 12 / AGENT CONTEXT BRIDGE"
        title="Give your coding agent the source."
        description="Export compact, revision-bound architecture and setup context for Cursor, Claude Code, or another coding agent."
      />
      <div className="agent-context-layout">
        <section className="panel">
          <PanelHeading icon={Bot} title="Agent Context Snapshot">
            <Badge tone="green">Source ranges checked</Badge>
          </PanelHeading>
          <div className="panel-body stack-16">
            <div className="context-controls">
              <label>
                Snapshot
                <select
                  aria-label="Context snapshot"
                  value={state.snapshot}
                  onChange={(e) => setSnapshot(e.target.value as Snapshot)}
                >
                  <option value="base">main · before PR #402</option>
                  <option value="head">PR #402 · email verification</option>
                </select>
              </label>
              <label>
                Task context
                <select
                  aria-label="Task context"
                  value={journey}
                  onChange={(e) => setJourney(e.target.value as 'signup' | 'login')}
                >
                  <option value="signup">User Signup</option>
                  <option value="login">User Login</option>
                </select>
              </label>
            </div>
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
            </div>
            <div className="row gap-8">
              <Badge tone="violet">{context.revision.commit}</Badge>
              <Badge>{context.evidence.length} source citations</Badge>
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
                    notify('Agent context copied. Paste it into your coding agent.');
                  } catch {
                    setCopyError(true);
                  }
                }}
              >
                Copy {format === 'json' ? 'JSON' : 'prompt'}
              </Button>
              <Button variant="primary" icon={Download} onClick={download}>
                Download {format === 'json' ? 'JSON' : 'prompt'}
              </Button>
            </div>
            {copyError && (
              <p role="alert">
                Clipboard unavailable. Select the export text above or use Download.
              </p>
            )}
            <p className="muted">
              Paste the prompt into your external agent manually. This prototype uses synthetic
              repository snapshots; setup and runtime behavior remain unverified. Check the revision
              before applying code.
            </p>
          </div>
        </section>
        <aside className="stack-20">
          <section className="panel panel-body stack-12">
            <h2>Keep the handoff current.</h2>
            <p>
              The export includes source snippets, branch identity, constraints, and environment
              variable names. It excludes environment values and learning history.
            </p>
            <Button icon={ArrowRight} onClick={() => go('/changes')}>
              Review PR impact
            </Button>
          </section>
          <RelearningCard />
          <Button onClick={() => go('/progress')}>
            View learning summary
            <ArrowRight size={14} />
          </Button>
        </aside>
      </div>
    </>
  );
}

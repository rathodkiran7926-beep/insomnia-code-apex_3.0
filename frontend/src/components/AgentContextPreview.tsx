import { useEffect, useId, useRef, useState } from 'react';
import gsap from 'gsap';
import { ArrowRight, Bot, Check, Code2, Database, Play, RotateCcw, Search } from 'lucide-react';
import '../styles/agent-context-preview.css';

const sample = {
  request: 'Add coupon validation to checkout.',
  call: 'get_task_context({ task: "Add coupon validation", repoId: "demo-shop" })',
  files: ['checkout.controller.ts', 'coupon.service.ts'],
  architecture: ['Checkout controller', 'Coupon service', 'Repository'],
  convention: 'Validate coupon eligibility before applying a discount',
  test: 'coupon.service.test.ts',
  version: 'demo snapshot',
  lines: [
    'if (!coupon.isEligible(cart)) {',
    '  throw new Error("Coupon is not eligible");',
    '}',
    'return applyDiscount(cart, coupon);',
  ],
};
const tabs = ['Task context', 'Architecture', 'Code evidence'] as const;
const stages = ['Ready to preview', 'Requesting context', 'Finding relevant code', 'Context ready'];

export function AgentContextPreview() {
  const id = useId();
  const [stage, setStage] = useState(0);
  const [tab, setTab] = useState(0);
  const running = useRef(false);
  const timeline = useRef<gsap.core.Timeline | null>(null);
  const result = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const busy = stage === 1 || stage === 2;

  useEffect(
    () => () => {
      timeline.current?.kill();
      running.current = false;
    },
    [],
  );
  useEffect(() => {
    if (stage !== 3 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        result.current,
        { opacity: 0, y: 5 },
        { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out' },
      );
    });
    return () => context.revert();
  }, [stage, tab]);

  function run() {
    if (running.current) return;
    running.current = true;
    timeline.current?.kill();
    setStage(1);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : 0.95;
    timeline.current = gsap
      .timeline()
      .to({}, { duration })
      .call(() => setStage(2))
      .to({}, { duration })
      .call(() => {
        setStage(3);
        running.current = false;
      });
  }

  return (
    <section className="home-section agent-context-section" aria-labelledby={`${id}-heading`}>
      <div className="agent-context-copy">
        <span className="eyebrow">AI AGENT INTEGRATION</span>
        <h2 id={`${id}-heading`}>Give your coding agent the context it needs.</h2>
        <p>
          Bring repository architecture, relevant code, and project conventions into your AI coding
          workflow through MCP.
        </p>
        <div className="agent-client-chips" aria-label="Example clients">
          <span>Codex</span>
          <span>Claude Code</span>
          <span>MCP-compatible agents</span>
        </div>
        <small>Example clients · Local demonstration</small>
      </div>
      <div className="agent-preview-card">
        <div className="agent-preview-top">
          <span className="agent-preview-badge">Interactive preview · Sample data</span>
          <Code2 size={16} aria-hidden="true" />
        </div>
        <div className="agent-preview-request">
          <p>“{sample.request}”</p>
          <button className="agent-run-button" onClick={run} disabled={busy}>
            {stage === 3 ? <RotateCcw size={13} /> : <Play size={13} />}
            {busy ? 'Running…' : stage === 3 ? 'Replay' : 'Run demo'}
          </button>
        </div>
        <div
          className="agent-preview-flow"
          aria-label="Coding agent to Codebase Mentor to Repository knowledge"
        >
          <span className={stage >= 1 ? 'is-active' : ''}>
            <Bot size={19} aria-hidden="true" />
            Coding agent
          </span>
          <ArrowRight className={stage >= 1 ? 'is-active' : ''} size={17} aria-hidden="true" />
          <span className={stage >= 1 ? 'is-active' : ''}>
            <Code2 size={19} aria-hidden="true" />
            Codebase Mentor
          </span>
          <ArrowRight className={stage >= 2 ? 'is-active' : ''} size={17} aria-hidden="true" />
          <span className={stage >= 2 ? 'is-active' : ''}>
            <Search size={19} aria-hidden="true" />
            Repository knowledge
          </span>
        </div>
        <div className="agent-preview-status" role="status">
          <span>
            {stage === 3 ? (
              <Check size={13} />
            ) : (
              <span className={busy ? 'agent-stage-dot active' : 'agent-stage-dot'} />
            )}
            {stages[stage]}
          </span>
          <small>Simulated MCP workflow</small>
        </div>
        <div className="agent-tool-call">
          <code>{stage ? sample.call : '// Run the demo to request sample context'}</code>
        </div>
        <div className="agent-preview-tabs" role="tablist" aria-label="Sample context views">
          {tabs.map((label, index) => (
            <button
              key={label}
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={tab === index}
              aria-controls={`${id}-panel`}
              tabIndex={tab === index ? 0 : -1}
              ref={(el) => {
                tabButtons.current[index] = el;
              }}
              onClick={() => setTab(index)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
                else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = tabs.length - 1;
                else return;
                event.preventDefault();
                setTab(next);
                tabButtons.current[next]?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="agent-preview-result"
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tab}`}
          aria-busy={busy}
          tabIndex={0}
        >
          {stage !== 3 ? (
            <div className="agent-result-placeholder">
              <Database size={23} aria-hidden="true" />
              <span>
                {busy
                  ? 'Preparing fictional repository context…'
                  : 'Run the demo to explore the sample context.'}
              </span>
            </div>
          ) : (
            <div ref={result}>
              {tab === 0 && (
                <dl className="agent-context-facts">
                  <div>
                    <dt>Relevant files</dt>
                    <dd>
                      {sample.files.map((file) => (
                        <code key={file}>{file}</code>
                      ))}
                    </dd>
                  </div>
                  <div>
                    <dt>Convention</dt>
                    <dd>{sample.convention}</dd>
                  </div>
                  <div>
                    <dt>Related test</dt>
                    <dd>
                      <code>{sample.test}</code>
                    </dd>
                  </div>
                </dl>
              )}
              {tab === 1 && (
                <div className="agent-architecture-result">
                  <span>Sample checkout architecture</span>
                  <div>
                    {sample.architecture.map((label, index) => (
                      <div key={label}>
                        {index > 0 && <ArrowRight size={15} aria-hidden="true" />}
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                  <p>{sample.convention}.</p>
                </div>
              )}
              {tab === 2 && (
                <div className="agent-evidence-result">
                  <div>
                    <code>{sample.files[1]}</code>
                    <span>Fictional code · sample lines 12–15</span>
                  </div>
                  <pre>
                    {sample.lines.map((line, index) => (
                      <span className="agent-evidence-line" key={line}>
                        <span aria-label={`Sample line ${12 + index}`}>{12 + index}</span>
                        <code>{line}</code>
                      </span>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="agent-preview-footer">
          <span>Source version: {sample.version}</span>
          <span>No live agent connection</span>
        </div>
      </div>
    </section>
  );
}

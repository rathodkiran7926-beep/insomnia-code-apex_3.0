import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CornerDownLeft, Volume2, X, ArrowUpRight } from 'lucide-react';
import { Button } from './UI';
import { HandoffAccountGate } from './HandoffAccount';
import { handoffApi } from '../services/handoffApi';
import type { JourneyEvent, JourneyLevel, JourneyTrace } from '../domain/codeJourney';
import { InteractiveBrandMentor } from './InteractiveBrandMentor';
import { useJourneyExplanation } from '../state/useJourneyExplanation';
export type JourneyAnswer = {
  answer: string;
  provider: string;
  traceId: string;
  eventId: string;
  snapshotId: string;
  sourceRefId: string;
  generated?: boolean;
  expression?: 'explaining' | 'thinking' | 'questioning' | 'encouraging';
  notice?: string;
  sections?: {
    purpose: string;
    inputsOutputs: string;
    conditions: string;
    sideEffects: string;
    nextConnections: string;
  };
};
export function JourneyQuestion({
  event,
  trace,
  level,
  onClose,
  onResume,
  open = true,
  children,
  onAsk,
}: {
  event: JourneyEvent;
  trace: JourneyTrace;
  level: JourneyLevel;
  onClose: () => void;
  onResume: () => void;
  open?: boolean;
  children?: ReactNode;
  onAsk?: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<JourneyAnswer | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const locked = useRef(false),
    panel = useRef<HTMLElement>(null);
  const request = useRef<AbortController | null>(null);
  const brief = useJourneyExplanation(trace, event, level, open);
  async function askQuestion(prompt: string) {
    if (locked.current || !prompt.trim()) return;
    locked.current = true;
    onAsk?.();
    setBusy(true);
    setError('');
    setAnswer(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await handoffApi<JourneyAnswer>(
        `/api/traces/${encodeURIComponent(trace.id)}/questions`,
        { eventId: event.id, snapshotId: trace.snapshotId, question: prompt, level },
        'POST',
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (
        response.eventId !== event.id ||
        response.traceId !== trace.id ||
        response.snapshotId !== trace.snapshotId ||
        response.sourceRefId !== event.sourceRefId
      )
        throw new Error('Question evidence mismatch.');
      setAnswer(response);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        locked.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!open) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      return;
    }
    const frame = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !(event.target instanceof Element && event.target.closest('[role="dialog"]'))
      )
        onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    [],
  );
  useEffect(() => {
    if (!answer || !open) return;
    const scroll = panel.current?.querySelector<HTMLElement>('.journey-chat-scroll');
    const reply = panel.current?.querySelector<HTMLElement>('.journey-anchored-answer');
    if (scroll && reply)
      scroll.scrollTop +=
        reply.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12;
  }, [answer, open]);
  return (
    <section
      ref={panel}
      id="shishimaru-mentor-panel"
      hidden={!open}
      tabIndex={-1}
      className="journey-question-panel"
      aria-label="Shishimaru event question sidebar"
      data-event-id={event.id}
    >
      <div className="journey-chat-heading">
        <div>
          <InteractiveBrandMentor
            compact
            mode={error ? 'debugging' : busy || brief.loading ? 'thinking' : 'reading'}
          />
          <span>
            <strong>What would you like to understand?</strong>
            <small>Explore this component and its connections.</small>
          </span>
        </div>
        <button
          className="journey-close-mentor"
          aria-label="Close question"
          title="Close mentor"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="journey-chat-scroll" key={event.id}>
        <div className="journey-chat-event">
          <span className="eyebrow">● CURRENT COMPONENT</span>
          <h2>{event.title}</h2>
          <span className="journey-event-source">
            {event.source.file}:{event.source.startLine}&ndash;{event.source.endLine}
          </span>
        </div>
        <div
          className="journey-auto-explanation"
          aria-live="polite"
          aria-busy={brief.loading}
          data-source-ref={event.sourceRefId}
        >
          <h3>How it works</h3>
          {brief.loading ? (
            <div
              className="journey-summary-skeleton"
              role="status"
              aria-label="Preparing component explanation"
            >
              <span />
              <span />
              <span />
            </div>
          ) : brief.value ? (
            <>
              <ol className="journey-explanation-steps">
                {brief.value.steps.map((step, index) => (
                  <li key={index}>
                    <div>
                      <h4>{step.title}</h4>
                      <p>{step.explanation}</p>
                      <a
                        className="journey-step-citation"
                        href={`/api/journey-snapshots/${trace.snapshotId}/source?referenceId=${encodeURIComponent(step.sourceRefId)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {brief.value!.sourceReferences.find(
                          (reference) => reference.sourceRefId === step.sourceRefId,
                        )?.title || 'Source evidence'}{' '}
                        <ArrowUpRight size={12} />
                      </a>
                    </div>
                  </li>
                ))}
              </ol>
              {brief.value.notice && (
                <small className="journey-summary-notice">{brief.value.notice}</small>
              )}
            </>
          ) : (
            <p role="status">{brief.error}</p>
          )}
        </div>
        <section className="journey-code-explanation" aria-label="Code explanation">
          <h3>In this code</h3>
          <dl>
            <dt>Inputs</dt>
            <dd>{event.inputs || 'Not established by the available source.'}</dd>
            <dt>Returns</dt>
            <dd>{event.outputs || 'Not established by the available source.'}</dd>
            {event.condition?.startsWith('Source conditions') && (
              <>
                <dt>Checks</dt>
                <dd>{event.condition}</dd>
              </>
            )}
          </dl>
        </section>
        <a
          className="journey-view-source"
          href={`/api/journey-snapshots/${trace.snapshotId}/source?referenceId=${encodeURIComponent(event.sourceRefId)}`}
          target="_blank"
          rel="noreferrer"
        >
          View source <ArrowUpRight size={17} />
        </a>
        <details className="journey-component-details">
          <summary>About this component</summary>
          {children}
          <p className="journey-context-note">
            Questions pause the replay cursor, never a running production process. This panel
            follows the active journey component.
          </p>
          <Button
            icon={CornerDownLeft}
            onClick={() => {
              if ('speechSynthesis' in window) window.speechSynthesis.cancel();
              onResume();
            }}
          >
            Return & resume this cursor
          </Button>
        </details>
        {error && (
          <p role="alert" className="journey-alert">
            {error}
          </p>
        )}
        {answer && (
          <div className="journey-anchored-answer">
            <small>{answer.generated ? 'Source-linked answer' : 'From the selected code'}</small>
            {!answer.generated && (
              <p className="journey-reply-notice" role="status">
                A generated reply is unavailable. These are extracted source facts.
              </p>
            )}
            <div className="journey-answer-body">
              {answer.answer
                .split(/\n\s*\n/)
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>
            {answer.sections && (
              <details className="journey-explanation-sections">
                <summary>More detail</summary>
                {(
                  [
                    ['purpose', 'What this component does'],
                    ['inputsOutputs', 'Inputs & returns'],
                    ['conditions', 'Conditions & branches'],
                    ['sideEffects', 'Side effects'],
                    ['nextConnections', 'Connected code'],
                  ] as const
                ).map(([key, title]) => (
                  <section key={key}>
                    <h3>{title}</h3>
                    <p>{answer.sections![key]}</p>
                  </section>
                ))}
              </details>
            )}
            <div className="journey-answer-actions">
              <a
                href={`/api/journey-snapshots/${trace.snapshotId}/source?referenceId=${encodeURIComponent(answer.sourceRefId)}`}
                target="_blank"
                rel="noreferrer"
              >
                Event source evidence
              </a>
              <Button
                icon={Volume2}
                onClick={() => {
                  if (!('speechSynthesis' in window)) return;
                  window.speechSynthesis.cancel();
                  window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer.answer));
                }}
              >
                Read answer
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="journey-chat-composer">
        <HandoffAccountGate>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void askQuestion(question);
            }}
          >
            <label>
              Ask about this component
              <textarea
                aria-label="Question about playback event"
                required
                maxLength={1500}
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="What should I check before changing this component?"
              />
            </label>
            <Button variant="primary" disabled={busy || !question.trim()}>
              {busy ? 'Reading the evidence...' : 'Ask mentor'}
            </Button>
          </form>
        </HandoffAccountGate>
      </div>
    </section>
  );
}

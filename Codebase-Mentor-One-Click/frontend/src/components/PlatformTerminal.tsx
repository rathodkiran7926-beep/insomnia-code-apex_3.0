import { useEffect, useState } from 'react';
import { ArrowUpRight, Pause, Play } from 'lucide-react';
import '../styles/platform-terminal.css';

const explanations = [
  'Understand a codebase through connected architecture, guided journeys, and contribution practice.',
  'Explore the Architecture Atlas. Select a component and jump to the source behind it.',
  'Follow a request through the code. Predict the next branch and inspect the deciding lines.',
  'Try a guided starter task with progressive hints and clearly labelled demo check outcomes.',
  'Compare a pull request, see what changed, and revisit the concepts that need a fresh look.',
  'Capture maintainer explanations so the reasoning behind the code stays with your team.',
];

type Frame = {
  index: number;
  length: number;
  phase: 'typing' | 'holding' | 'deleting' | 'waiting';
};

export function PlatformTerminal({ onExplore }: { onExplore: () => void }) {
  const [frame, setFrame] = useState<Frame>({ index: 0, length: 0, phase: 'typing' });
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const delay = { typing: 32, holding: 2600, deleting: 15, waiting: 450 }[frame.phase];
    const timer = window.setTimeout(() => {
      setFrame((current) => {
        if (current.phase === 'holding') return { ...current, phase: 'deleting' };
        if (current.phase === 'waiting') {
          return { index: (current.index + 1) % explanations.length, length: 0, phase: 'typing' };
        }
        const length = current.length + (current.phase === 'typing' ? 1 : -1);
        return {
          ...current,
          length,
          phase:
            length === 0
              ? 'waiting'
              : length === explanations[current.index].length
                ? 'holding'
                : current.phase,
        };
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [frame, paused, reducedMotion]);

  return (
    <section className="platform-terminal" aria-label="About Codebase Mentor">
      <div className="platform-terminal__titlebar">
        <div className="platform-terminal__lights" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span className="platform-terminal__title">Codebase Mentor — overview</span>
        <span className="platform-terminal__shell" aria-hidden="true">
          zsh
        </span>
      </div>
      <div className="platform-terminal__body">
        <div className="platform-terminal__command" aria-hidden="true">
          <span className="platform-terminal__prompt">
            visitor<span>@</span>codebase-mentor
          </span>
          <span className="platform-terminal__directory">~ %</span>
          <span>mentor --tour</span>
        </div>
        <div className="platform-terminal__output" aria-hidden="true">
          <span className="platform-terminal__chevron">›</span>
          <div className="platform-terminal__text">
            {reducedMotion
              ? explanations[frame.index]
              : explanations[frame.index].slice(0, frame.length)}
            <span
              className={`platform-terminal__cursor${paused || reducedMotion ? ' is-still' : ''}`}
            />
          </div>
        </div>
        <div className="sr-only">
          <p>Codebase Mentor helps developers understand unfamiliar codebases.</p>
          <ul>
            {explanations.map((explanation) => (
              <li key={explanation}>{explanation}</li>
            ))}
          </ul>
        </div>
        <div className="platform-terminal__journey" aria-hidden="true">
          <span>Learn</span>
          <span>→</span>
          <span>Predict</span>
          <span>→</span>
          <span>Contribute</span>
          <span>→</span>
          <span>Relearn</span>
        </div>
      </div>
      <div className="platform-terminal__footer">
        {reducedMotion ? (
          <button
            className="platform-terminal__playback"
            onClick={() =>
              setFrame((current) => ({
                ...current,
                index: (current.index + 1) % explanations.length,
              }))
            }
          >
            Next explanation <span aria-hidden="true">→</span>
          </button>
        ) : (
          <button
            className="platform-terminal__playback"
            onClick={() => setPaused((value) => !value)}
            aria-pressed={paused}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Resume' : 'Pause'}
            <span className="sr-only"> animation</span>
          </button>
        )}
        <button className="platform-terminal__explore" onClick={onExplore}>
          Explore the workspace <ArrowUpRight size={15} />
        </button>
      </div>
    </section>
  );
}

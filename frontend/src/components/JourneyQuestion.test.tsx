import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { JourneyQuestion } from './JourneyQuestion';
import type { JourneyEvent, JourneyTrace } from '../domain/codeJourney';

vi.mock('./HandoffAccount', () => ({ HandoffAccountGate: () => <p>Sign in to collaborate</p> }));
vi.mock('./InteractiveBrandMentor', () => ({ InteractiveBrandMentor: () => null }));
vi.mock('../state/useJourneyExplanation', () => ({
  useJourneyExplanation: () => ({ loading: false, value: null, error: '' }),
}));

const event = {
  id: 'event', title: 'Validate input', source: { file: 'signup.ts', startLine: 1, endLine: 4 },
  sourceRefId: 'source', condition: '', inputs: 'email', outputs: 'valid',
} as JourneyEvent;

it.each(['explained_path', 'observed_replay'] as const)('uses the appropriate question access for %s', (mode) => {
  const trace = { id: 'trace', snapshotId: 'snapshot', mode, events: [event] } as JourneyTrace;
  const html = renderToStaticMarkup(
    <JourneyQuestion event={event} trace={trace} level="beginner" onClose={() => {}} onResume={() => {}} />,
  );
  if (mode === 'explained_path') {
    expect(html).toContain('Ask about this component');
    expect(html).not.toContain('Sign in to collaborate');
  } else {
    expect(html).toContain('Sign in to collaborate');
  }
});

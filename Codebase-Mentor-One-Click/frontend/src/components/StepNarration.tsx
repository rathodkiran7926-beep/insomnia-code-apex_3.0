import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { Button } from './UI';
import '../styles/demo-flow.css';

export function StepNarration({
  text,
  identity,
  onStart,
}: {
  text: string;
  identity: string;
  onStart: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'starting' | 'speaking' | 'paused' | 'error'>(
    'idle',
  );
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const generation = useRef(0);
  const supported = typeof speechSynthesis !== 'undefined';

  function cancel() {
    generation.current++;
    if (utterance.current && supported) speechSynthesis.cancel();
    utterance.current = null;
    setStatus('idle');
  }

  useEffect(() => {
    cancel();
    return () => {
      generation.current++;
      if (utterance.current && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      utterance.current = null;
    };
  }, [text, identity]);

  function speak() {
    if (!supported) return;
    cancel();
    onStart();
    const request = generation.current;
    const speech = new SpeechSynthesisUtterance(text);
    const voice = speechSynthesis
      .getVoices()
      .find((item) => item.lang.startsWith('en') && item.localService);
    if (voice) speech.voice = voice;
    speech.lang = 'en-US';
    speech.rate = 1;
    speech.onstart = () => {
      if (request === generation.current) setStatus('speaking');
    };
    speech.onend = () => {
      if (request === generation.current) {
        utterance.current = null;
        setStatus('idle');
      }
    };
    speech.onerror = (event) => {
      if (
        request === generation.current &&
        event.error !== 'canceled' &&
        event.error !== 'interrupted'
      ) {
        utterance.current = null;
        setStatus('error');
      }
    };
    utterance.current = speech;
    setStatus('starting');
    speechSynthesis.resume();
    speechSynthesis.speak(speech);
  }

  const active = ['starting', 'speaking', 'paused'].includes(status);
  return (
    <div className="journey-narration">
      <Button
        icon={active ? Square : Volume2}
        disabled={!supported}
        onClick={active ? cancel : speak}
      >
        {active ? 'Stop narration' : 'Read this step'}
      </Button>
      {(status === 'speaking' || status === 'paused') && (
        <Button
          icon={status === 'paused' ? Play : Pause}
          onClick={() => {
            if (status === 'paused') {
              speechSynthesis.resume();
              setStatus('speaking');
            } else {
              speechSynthesis.pause();
              setStatus('paused');
            }
          }}
        >
          {status === 'paused' ? 'Resume narration' : 'Pause narration'}
        </Button>
      )}
      <span role="status">
        {!supported
          ? 'Voice unavailable; use the step transcript.'
          : status === 'error'
            ? 'Voice unavailable. The step transcript is still available.'
            : status === 'starting'
              ? 'Starting browser voice…'
              : status === 'speaking'
                ? 'Speaking · browser voice'
                : status === 'paused'
                  ? 'Narration paused'
                  : 'Browser voice · current source-linked step'}
      </span>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Volume2,
  Play,
  Send,
  MessagesSquare,
  FilePenLine,
  Save,
  RefreshCw,
  LoaderCircle,
  Maximize2,
} from 'lucide-react';
import { Modal } from './UI';
import type { RepositorySnapshot } from '../domain/analysisTypes';
import { analysisApi } from '../services/analysisApi';
import { voiceActivity } from '../domain/voiceActivity';
import '../styles/component-discussion.css';

type Citation = { id: string; file: string; startLine: number; endLine: number; url: string };
type Alternative = { name: string; pros: string[]; cons: string[]; assumptions: string[] };
type Answer = {
  spokenText: string;
  displayText: string;
  claims: { text: string; evidenceIds: string[] }[];
  alternatives: Alternative[];
  followUpQuestion: string | null;
  uncertainties: string[];
  citations: Citation[];
};
type Message = { id: string; role: 'user' | 'assistant'; text?: string; answer?: Answer };
type Draft = { id: string; content: string; citations: Citation[] };
type Session = {
  id: string;
  snapshotId: string;
  componentId: string;
  componentName: string;
  repository: string;
  commit: string;
  messages: Message[];
  draft: Draft | null;
  savedDecisions: { id: string; content: string }[];
};
type Voice = {
  id: string;
  name: string;
  description: string;
  labels: Record<string, string>;
  category: string;
};
type Status = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'error';
const suggestions = [
  'Explain this implementation.',
  'What are its trade-offs?',
  'What assumptions does it make?',
  'What alternatives fit my requirements?',
  'How could I verify this decision?',
];

export function ComponentDiscussion({
  snapshot,
  componentId,
  centered = false,
  onCenteredChange,
}: {
  snapshot: RepositorySnapshot;
  componentId: string;
  centered?: boolean;
  onCenteredChange?: (centered: boolean) => void;
}) {
  const selected = snapshot.components.find((c) => c.id === componentId);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [config, setConfig] = useState<{
    textConfigured: boolean;
    voiceConfigured: boolean;
  } | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [voiceNote, setVoiceNote] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [choice, setChoice] = useState('');
  const [saved, setSaved] = useState('');
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const [live, setLive] = useState(false);
  const liveActive = useRef(false);
  const stopMonitor = useRef<(() => void) | null>(null);
  const recordLatest = useRef<() => Promise<void>>(async () => {});
  const generation = useRef(0),
    operation = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const sound = useRef<{ url: string; messageId: string; voiceId: string } | null>(null);
  const recording = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const listeningStarted = useRef(0);
  const microphonePending = useRef(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const mismatch =
    !!session &&
    (session.componentId !== componentId || session.snapshotId !== snapshot.snapshotId);
  const busy = status === 'thinking' || status === 'transcribing';
  function stopPlayback() {
    audio.current?.pause();
    audio.current = null;
    setStatus((old) => (old === 'speaking' ? 'idle' : old));
  }
  function cancelWork() {
    liveActive.current = false;
    setLive(false);
    stopMonitor.current?.();
    stopMonitor.current = null;
    generation.current++;
    operation.current?.abort();
    operation.current = null;
    stopPlayback();
    const current = recording.current;
    recording.current = null;
    if (current) {
      clearTimeout(current.timer);
      if (current.recorder.state !== 'inactive') current.recorder.stop();
      current.stream.getTracks().forEach((t) => t.stop());
    }
  }
  useEffect(() => {
    cancelWork();
    setStatus('idle');
    setError('');
    setQuestion('');
    return () => {
      cancelWork();
      if (sound.current) {
        URL.revokeObjectURL(sound.current.url);
        sound.current = null;
      }
    };
  }, [snapshot.snapshotId, componentId]);
  useEffect(() => {
    const controller = new AbortController();
    const version = generation.current;
    let previous = '';
    try {
      previous = sessionStorage.getItem('mentor-last-discussion') || '';
    } catch {}
    if (previous)
      analysisApi<Session>(`/api/discussions/${encodeURIComponent(previous)}`, {
        signal: controller.signal,
      })
        .then((value) => {
          if (controller.signal.aborted || version !== generation.current) return;
          setSession(value);
          setDraft(value.draft);
        })
        .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setVoiceError('');
    analysisApi<{ textConfigured: boolean; voiceConfigured: boolean }>('/api/discussions/config', {
      signal: controller.signal,
    })
      .then(async (value) => {
        setConfig(value);
        if (!value.voiceConfigured) {
          setVoiceError(
            'Add ELEVENLABS_API_KEY to backend/.env for transcription and spoken replies. Text discussion is available.',
          );
          return;
        }
        const list = await analysisApi<{ voices: Voice[]; limited: boolean }>(
          '/api/discussions/voices',
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setVoices(list.voices);
        let preferred = '';
        try {
          preferred = localStorage.getItem('mentor-discussion-voice') || '';
        } catch {}
        setVoiceId(
          list.voices.some((v) => v.id === preferred) ? preferred : list.voices[0]?.id || '',
        );
        if (preferred && !list.voices.some((v) => v.id === preferred))
          setVoiceNote('Your saved voice is unavailable. Choose another voice.');
        else if (list.limited) setVoiceNote('Showing the first 300 account voices.');
        if (!list.voices.length)
          setVoiceError(
            'No usable voices were returned by your ElevenLabs account. Text discussion still works.',
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setVoiceError((e as Error).message);
      });
    return () => controller.abort();
  }, [voiceRefresh]);
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [session?.messages.length]);
  function beginRequest() {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setError('');
    return { signal: controller.signal, version: generation.current };
  }
  function showError(e: unknown, version: number) {
    if (version !== generation.current) return;
    liveActive.current = false;
    setLive(false);
    setError((e as Error).message);
    setStatus('error');
  }
  async function start() {
    cancelWork();
    const request = beginRequest();
    setStatus('thinking');
    try {
      const value = await analysisApi<Session>('/api/discussions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: snapshot.snapshotId, componentId }),
        signal: request.signal,
      });
      if (request.version !== generation.current) return;
      setSession(value);
      setDraft(null);
      setQuestion('');
      setChoice('');
      setSaved('');
      setStatus('idle');
      try {
        sessionStorage.setItem('mentor-last-discussion', value.id);
      } catch {}
      return true;
    } catch (e) {
      showError(e, request.version);
      return false;
    }
  }
  async function responseBlob(path: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const value = await response.json().catch(() => ({ error: 'Speech unavailable.' }));
      throw new Error(value.error || 'Speech unavailable.');
    }
    return response.blob();
  }
  async function speak(messageId: string, preview = false) {
    if (!session || !voiceId || busy || mismatch) return;
    stopPlayback();
    const request = beginRequest();
    setStatus('speaking');
    try {
      if (
        !sound.current ||
        sound.current.messageId !== (preview ? 'preview' : messageId) ||
        sound.current.voiceId !== voiceId
      ) {
        const blob = await responseBlob(
          `/api/discussions/${session.id}/speech`,
          { voiceId, ...(preview ? { preview: true } : { messageId }) },
          request.signal,
        );
        if (request.version !== generation.current) return;
        if (sound.current) URL.revokeObjectURL(sound.current.url);
        sound.current = {
          url: URL.createObjectURL(blob),
          messageId: preview ? 'preview' : messageId,
          voiceId,
        };
      }
      if (request.version !== generation.current || request.signal.aborted) return;
      const player = new Audio(sound.current.url);
      audio.current = player;
      player.onended = () => {
        if (request.version === generation.current) setStatus('idle');
      };
      player.onerror = () =>
        showError(
          new Error('Audio playback failed. Your text answer is still available.'),
          request.version,
        );
      await player.play();
    } catch (e) {
      if (!request.signal.aborted) showError(e, request.version);
    }
  }
  async function send(text = question, automatic = false) {
    if (!session || mismatch || (!automatic && (busy || status === 'listening')) || !text.trim())
      return;
    stopPlayback();
    const request = beginRequest();
    setStatus('thinking');
    try {
      const result = await analysisApi<{
        id: string;
        answer: Answer;
        snapshotId: string;
        componentId: string;
      }>(`/api/discussions/${session.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text.trim() }),
        signal: request.signal,
      });
      if (request.version !== generation.current) return;
      if (result.snapshotId !== session.snapshotId || result.componentId !== session.componentId)
        throw new Error('The response belongs to another code selection.');
      setSession((old) =>
        old
          ? {
              ...old,
              messages: [
                ...old.messages,
                { id: crypto.randomUUID(), role: 'user', text: text.trim() },
                { id: result.id, role: 'assistant', answer: result.answer },
              ],
            }
          : old,
      );
      setQuestion('');
      if (voiceId && config?.voiceConfigured) {
        setStatus('speaking');
        // Use an explicit request independent of React's pending state update.
        const blob = await responseBlob(
          `/api/discussions/${session.id}/speech`,
          { voiceId, messageId: result.id },
          request.signal,
        );
        if (request.version !== generation.current || request.signal.aborted) return;
        if (sound.current) URL.revokeObjectURL(sound.current.url);
        sound.current = { url: URL.createObjectURL(blob), messageId: result.id, voiceId };
        const player = new Audio(sound.current.url);
        audio.current = player;
        setStatus('speaking');
        player.onended = () => {
          if (request.version === generation.current) setStatus('idle');
        };
        player.onerror = () =>
          showError(new Error('Playback failed. Read the answer or replay it.'), request.version);
        await player.play();
      } else setStatus('idle');
    } catch (e) {
      if (!request.signal.aborted) showError(e, request.version);
    }
  }
  async function record() {
    if (!session || mismatch || busy) return;
    if (microphonePending.current) return;
    if (recording.current) {
      recording.current.recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(
        'Microphone recording is not supported here. Use a current browser or type your question.',
      );
      setStatus('error');
      return;
    }
    stopPlayback();
    const request = beginRequest();
    setStatus('listening');
    let stream: MediaStream | null = null;
    microphonePending.current = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      microphonePending.current = false;
      if (request.version !== generation.current || request.signal.aborted) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const mime = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime)
        throw new Error(
          'This browser has no supported recording format. Please use text or another browser.',
        );
      const recorder = new MediaRecorder(stream, { mimeType: mime }),
        chunks: Blob[] = [];
      let size = 0,
        tooLarge = false;
      let heardSpeech = false;
      let cleanupMonitor: (() => void) | null = null;
      listeningStarted.current = Date.now();
      recorder.ondataavailable = (e) => {
        if (e.data.size) {
          size += e.data.size;
          chunks.push(e.data);
          if (size > 5000000) {
            tooLarge = true;
            if (recorder.state !== 'inactive') recorder.stop();
          }
        }
      };
      recorder.onerror = () => {
        cancelWork();
        setError('Microphone recording failed. Type your question instead.');
        setStatus('error');
      };
      recorder.onstop = async () => {
        cleanupMonitor?.();
        if (stopMonitor.current === cleanupMonitor) stopMonitor.current = null;
        const current = recording.current;
        if (current?.recorder === recorder) {
          clearTimeout(current.timer);
          recording.current = null;
        }
        stream?.getTracks().forEach((t) => t.stop());
        if (request.version !== generation.current || request.signal.aborted) return;
        if (liveActive.current && !heardSpeech) {
          setStatus('idle');
          return;
        }
        if (tooLarge) {
          showError(new Error('Recording exceeded 5 MB. Try a shorter question.'), request.version);
          return;
        }
        setStatus('transcribing');
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const response = await fetch(`/api/discussions/${session.id}/transcription`, {
            method: 'POST',
            headers: {
              'Content-Type': recorder.mimeType,
              'X-Recording-Duration': String(
                Math.min(60, (Date.now() - listeningStarted.current) / 1000),
              ),
            },
            body: blob,
            signal: request.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Transcription failed.');
          if (request.version !== generation.current) return;
          setQuestion(result.text);
          if (liveActive.current) await send(result.text, true);
          else setStatus('idle');
        } catch (e) {
          if (!request.signal.aborted) showError(e, request.version);
        }
      };
      const timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 59000);
      recording.current = { recorder, stream, timer };
      recorder.start(500);
      if (liveActive.current) {
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const detect = voiceActivity();
        const monitor = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(
            samples.reduce((sum, value) => sum + value * value, 0) / samples.length,
          );
          const activity = detect(rms, performance.now());
          heardSpeech = activity.heardSpeech;
          if (activity.finished && recorder.state !== 'inactive') recorder.stop();
        }, 80);
        cleanupMonitor = () => {
          clearInterval(monitor);
          source.disconnect();
          void context.close().catch(() => {});
        };
        stopMonitor.current = cleanupMonitor;
        await context.resume();
      }
    } catch (e) {
      microphonePending.current = false;
      stopMonitor.current?.();
      stopMonitor.current = null;
      const current = recording.current;
      recording.current = null;
      if (current) {
        clearTimeout(current.timer);
        current.recorder.onstop = null;
        if (current.recorder.state !== 'inactive') current.recorder.stop();
      }
      stream?.getTracks().forEach((t) => t.stop());
      showError(
        new Error(
          (e as Error).name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow microphone access or type your question.'
            : (e as Error).message,
        ),
        request.version,
      );
    }
  }
  recordLatest.current = record;
  useEffect(() => {
    if (!live || status !== 'idle' || !session || mismatch) return;
    const timer = setTimeout(() => {
      if (liveActive.current) void recordLatest.current();
    }, 200);
    return () => clearTimeout(timer);
  }, [live, status, session?.id, mismatch]);
  async function startLive() {
    if (!config?.voiceConfigured || !config.textConfigured || !voiceId) return;
    if ((!session || mismatch) && !(await start())) return;
    liveActive.current = true;
    setLive(true);
    setStatus('idle');
  }
  async function makeDraft() {
    if (!session || mismatch || busy) return;
    stopPlayback();
    const request = beginRequest();
    setStatus('thinking');
    setSaved('');
    try {
      const value = await analysisApi<Draft>(`/api/discussions/${session.id}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choice.trim() ? { chosenOption: choice.trim() } : {}),
        signal: request.signal,
      });
      if (request.version !== generation.current) return;
      setDraft(value);
      setStatus('idle');
    } catch (e) {
      showError(e, request.version);
    }
  }
  async function save() {
    if (!session || !draft || busy || mismatch) return;
    const request = beginRequest();
    setStatus('thinking');
    try {
      const result = await analysisApi<{ id: string }>(`/api/discussions/${session.id}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, content: draft.content }),
        signal: request.signal,
      });
      if (request.version !== generation.current) return;
      setSaved('Decision saved for ' + session.commit.slice(0, 12));
      setSession((old) =>
        old
          ? {
              ...old,
              savedDecisions: [
                ...old.savedDecisions.filter((d) => d.id !== result.id),
                { id: result.id, content: draft.content },
              ],
            }
          : old,
      );
      setStatus('idle');
    } catch (e) {
      showError(e, request.version);
    }
  }
  const latest = session?.messages.filter((m) => m.role === 'assistant').at(-1);
  const content = (
    <section className="component-discussion" aria-label="Discuss this component">
      <header>
        <MessagesSquare size={17} />
        <div>
          <h2>Discuss this component</h2>
          <p>
            {session?.componentName || selected?.name} ·{' '}
            {(session?.commit || snapshot.commit).slice(0, 12)}
          </p>
        </div>
        <span className={'discussion-state ' + status} role="status">
          {status === 'idle'
            ? 'Ready'
            : status === 'listening'
              ? live
                ? 'Listening'
                : 'Listening · max 60s'
              : status === 'transcribing'
                ? 'Transcribing…'
                : status === 'thinking'
                  ? 'Thinking…'
                  : status === 'speaking'
                    ? 'Speaking…'
                    : 'Error'}
        </span>
        {!centered && onCenteredChange && (
          <button
            type="button"
            aria-label="Open centered conversation"
            title="Open a larger conversation view"
            onClick={() => onCenteredChange(true)}
          >
            <Maximize2 size={16} />
          </button>
        )}
      </header>
      {(!session || mismatch) && (
        <div className="discussion-start">
          <p>
            {mismatch
              ? `You selected ${selected?.name} at ${snapshot.commit.slice(0, 12)}. This conversation remains attached to ${session?.componentName} at ${session?.commit.slice(0, 12)}.`
              : 'Ask about this implementation, compare options, and record your engineering decision.'}
          </p>
          <button disabled={busy} onClick={() => void start()}>
            <RefreshCw size={14} />
            {mismatch ? 'Start discussion for this selection' : 'Start discussion'}
          </button>
        </div>
      )}
      {config && !config.textConfigured && (
        <p className="discussion-warning">
          Set LLM_API_KEY and LLM_MODEL in backend/.env to enable Gemini discussion.
        </p>
      )}
      <div className={`discussion-microphone ${status === 'listening' ? 'is-listening' : ''}`}>
        <span className="discussion-mic-icon" aria-hidden="true">
          <Mic size={24} />
        </span>
        <div>
          <strong>
            {live
              ? status === 'speaking'
                ? 'Your mentor is speaking'
                : status === 'thinking' || status === 'transcribing'
                  ? 'Preparing your answer…'
                  : 'Listening to you…'
              : 'Talk naturally with your mentor'}
          </strong>
          <p>
            {!config
              ? 'Checking microphone availability…'
              : !config.voiceConfigured
                ? 'Voice needs ELEVENLABS_API_KEY in backend/.env. You can still type below.'
                : live
                  ? 'Conversation stays open. Pause after your question; I’ll answer and listen again.'
                  : 'Start once. Speak, pause, and hear a reply. No Record or Send needed.'}
          </p>
        </div>
        <button
          type="button"
          className="discussion-record-button"
          disabled={
            !live &&
            (busy ||
              status === 'listening' ||
              !config?.voiceConfigured ||
              !config.textConfigured ||
              !voiceId)
          }
          onClick={() => {
            if (live) {
              cancelWork();
              setStatus('idle');
            } else void startLive();
          }}
        >
          {live ? <Square size={17} /> : <Mic size={17} />}
          {live ? 'End conversation' : 'Start live voice'}
        </button>
        {live && (status === 'speaking' || status === 'thinking' || status === 'transcribing') && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              operation.current?.abort();
              stopPlayback();
              setStatus('idle');
            }}
          >
            Interrupt & speak
          </button>
        )}
      </div>
      <details className="discussion-voice">
        <summary>
          <Volume2 size={14} />
          Voice settings <small>ElevenLabs</small>
        </summary>
        {voiceError && <p className="discussion-warning">{voiceError}</p>}
        <label>
          Reply voice
          <select
            aria-label="Discussion reply voice"
            value={voiceId}
            disabled={live || !voices.length || busy || status === 'listening'}
            onChange={(e) => {
              operation.current?.abort();
              stopPlayback();
              setVoiceId(e.target.value);
              setVoiceNote('');
            }}
          >
            <option value="">Choose an available voice</option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.labels.accent ? ' · ' + v.labels.accent : ''}
                {v.labels.language ? ' · ' + v.labels.language : ''}
              </option>
            ))}
          </select>
        </label>
        {voices.find((v) => v.id === voiceId)?.description && (
          <p>{voices.find((v) => v.id === voiceId)?.description}</p>
        )}
        <div className="discussion-inline">
          <button
            disabled={live || !session || !voiceId || busy || mismatch}
            onClick={() => void speak('', true)}
          >
            <Play size={12} />
            Preview
          </button>
          <button
            disabled={!voiceId}
            onClick={() => {
              try {
                localStorage.setItem('mentor-discussion-voice', voiceId);
                setVoiceNote('Preferred voice saved.');
              } catch {
                setVoiceNote('Browser storage is unavailable.');
              }
            }}
          >
            <Save size={12} />
            Save voice
          </button>
          <button disabled={live || busy} onClick={() => setVoiceRefresh((n) => n + 1)}>
            Refresh voices
          </button>
        </div>
        {voiceNote && <small role="status">{voiceNote}</small>}
      </details>
      <div className="discussion-transcript" aria-live="polite">
        {session?.messages.map((m) => (
          <article key={m.id} className={'discussion-message ' + m.role}>
            <small>{m.role === 'user' ? 'You' : 'Codebase Mentor'}</small>
            {m.role === 'user' ? (
              <p>{m.text}</p>
            ) : (
              m.answer && (
                <>
                  <p>{m.answer.spokenText}</p>
                  {m.answer.followUpQuestion && (
                    <p className="discussion-followup">{m.answer.followUpQuestion}</p>
                  )}
                  <details>
                    <summary>Detailed explanation & evidence</summary>
                    <p>{m.answer.displayText}</p>
                    {m.answer.claims.map((c, i) => (
                      <p key={i}>{c.text}</p>
                    ))}
                    {m.answer.uncertainties.length > 0 && (
                      <p>Uncertain: {m.answer.uncertainties.join(' ')}</p>
                    )}
                    <div className="discussion-citations">
                      {m.answer.citations.map((c) => (
                        <a key={c.id} href={c.url} target="_blank" rel="noreferrer">
                          {c.file.split('/').pop()}:{c.startLine}–{c.endLine}
                        </a>
                      ))}
                    </div>
                    {m.answer.alternatives.length > 0 && (
                      <div className="discussion-options">
                        <table>
                          <thead>
                            <tr>
                              <th>Option</th>
                              <th>Benefits</th>
                              <th>Costs / assumptions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {m.answer.alternatives.map((a) => (
                              <tr key={a.name}>
                                <td>{a.name}</td>
                                <td>{a.pros.join('; ')}</td>
                                <td>{[...a.cons, ...a.assumptions].join('; ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                </>
              )
            )}
          </article>
        ))}
        <div ref={transcriptEnd} />
      </div>
      {error && (
        <p className="discussion-warning" role="alert">
          {error}
        </p>
      )}
      <div className="discussion-suggestions">
        {suggestions.map((q) => (
          <button
            key={q}
            disabled={live || !session || mismatch || busy || status === 'listening'}
            onClick={() => void send(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="discussion-question">Question or editable transcription</label>
        <textarea
          id="discussion-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={2000}
          placeholder="Ask why this works, or tell me your requirements…"
          disabled={live || !session || mismatch || busy}
        />
        <div className="discussion-inline">
          {!live && (
            <button
              type="button"
              disabled={!session || mismatch || busy || !config?.voiceConfigured}
              onClick={() => void record()}
            >
              {status === 'listening' ? <Square size={14} /> : <Mic size={14} />}
              {status === 'listening' ? 'Stop recording' : 'Record'}
            </button>
          )}
          <button
            disabled={
              live || !question.trim() || !session || mismatch || busy || status === 'listening'
            }
          >
            <Send size={14} />
            Send
          </button>
          {busy && <LoaderCircle size={15} className="discussion-spinner" />}
        </div>
        <small>
          {live
            ? 'Voice conversation is active. Your questions send automatically after a pause.'
            : 'Type a question, or use Record to review a transcription before sending.'}{' '}
          Answers use analyzed source, not local drafts.
        </small>
      </form>
      <div className="discussion-inline discussion-playback">
        <button
          disabled={live || !latest || !voiceId || busy || mismatch || status === 'listening'}
          onClick={() => latest && void speak(latest.id)}
        >
          <Volume2 size={13} />
          Replay latest answer
        </button>
        <button
          disabled={status !== 'speaking'}
          onClick={() => {
            operation.current?.abort();
            stopPlayback();
          }}
        >
          <Square size={13} />
          Stop playback
        </button>
      </div>
      {session && (
        <details className="discussion-decision">
          <summary>
            <FilePenLine size={14} />
            Decision record
          </summary>
          <label>
            Your chosen option (optional)
            <input
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              maxLength={300}
              placeholder="Leave empty for Decision pending"
            />
          </label>
          <button
            disabled={live || !session.messages.length || busy || mismatch}
            onClick={() => void makeDraft()}
          >
            Draft decision
          </button>
          {draft && (
            <>
              <label>
                Editable preview
                <textarea
                  aria-label="Decision draft"
                  value={draft.content}
                  onChange={(e) => {
                    setDraft({ ...draft, content: e.target.value });
                    setSaved('');
                  }}
                  maxLength={20000}
                />
              </label>
              <button
                disabled={live || busy || mismatch || !draft.content.trim() || !!saved}
                onClick={() => void save()}
              >
                <Save size={13} />
                Save decision
              </button>
              <small>Saved only when you click Save. No application code is changed.</small>
            </>
          )}
          {saved && <p role="status">{saved}</p>}
          {session.savedDecisions.map((d) => (
            <details key={d.id}>
              <summary>Saved decision</summary>
              <pre>{d.content}</pre>
            </details>
          ))}
        </details>
      )}
      <footer>
        Gemini reasons about the code; ElevenLabs transcribes and speaks. Citations identify
        evidence to review, not proof of semantic correctness.
      </footer>
    </section>
  );
  return centered ? (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCenteredChange?.(false);
      }}
      title="Talk with your mentor"
      description="Speak naturally or type a question about the selected code. Closing this view returns the conversation to the side panel."
      className="mentor-voice-dialog"
    >
      {content}
    </Modal>
  ) : (
    content
  );
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import {
  ArrowRight,
  Bot,
  Key,
  Layers3,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Route,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from 'lucide-react';
import { Badge, Button } from './UI';
import { useWorkspace } from '../state/WorkspaceContext';

export type VoiceAgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface ElevenLabsVoice {
  id: string;
  name: string;
  gender: string;
  accent: string;
  description: string;
}

export const ELEVENLABS_VOICES: ElevenLabsVoice[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel',
    gender: 'Female',
    accent: 'American',
    description: 'Calm, articulate, natural studio voice',
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    name: 'Adam',
    gender: 'Male',
    accent: 'American',
    description: 'Deep, engaging, narrative architect voice',
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    name: 'Antoni',
    gender: 'Male',
    accent: 'American',
    description: 'Crisp, explanatory tech specialist',
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Bella',
    gender: 'Female',
    accent: 'American',
    description: 'Warm, expressive, high-clarity voice',
  },
];

interface VoiceTopic {
  id: string;
  title: string;
  tag: string;
  icon: React.ElementType;
  summary: string;
  script: string;
  sourceContext: string;
}

const voiceTopics: VoiceTopic[] = [
  {
    id: 'platform',
    title: 'Explain This Platform',
    tag: 'Overview',
    icon: Bot,
    summary: 'How Codebase Mentor bridges high-level architecture with runtime lines of code.',
    script:
      "Welcome! I'm your Codebase Mentor AI voice guide. This platform solves a huge engineering challenge: the disconnect between high-level architectural documentation and actual source code. We let you visually navigate backend components, trace real HTTP requests through validation and services, and safely test code modifications in an in-browser sandbox with zero setup.",
    sourceContext: 'Application Core · Architecture Atlas & Guided Tours',
  },
  {
    id: 'features',
    title: 'Explore Features',
    tag: 'Core Pillars',
    icon: Layers3,
    summary: 'The 4 connected pillars: Atlas, Guided Journeys, Practice Sandbox, and Team Knowledge.',
    script:
      'Codebase Mentor is organized into four interconnected pillars. First, the Interactive Atlas maps all routes, middlewares, services, and repositories visually. Second, Guided Journeys trace real requests step-by-step with checkpoint prediction quizzes. Third, the Practice Sandbox lets you modify real Zod validation rules and verify patches instantly. And fourth, Team Knowledge records the architectural rationale behind design separations.',
    sourceContext: 'Atlas · Journeys · Sandbox Practice · Decision Records',
  },
  {
    id: 'architecture',
    title: 'Understand Architecture',
    tag: 'Deep Dive',
    icon: Route,
    summary: '3-tier backend separation: Express routes, Zod validation, services, and Prisma storage.',
    script:
      'The architecture follows clean layered boundaries. Incoming HTTP requests hit Express routers, which immediately execute Zod schema validation middlewares before any business logic runs. The User and Auth services encapsulate domain rules and password hashing, strictly decoupled from database details. Finally, repositories manage PostgreSQL persistence via Prisma ORM, keeping your domain layer modular and fully testable.',
    sourceContext: 'Clean Architecture · Express + Zod + Prisma ORM',
  },
  {
    id: 'workflow',
    title: 'How It Works',
    tag: 'Request Flow',
    icon: Workflow,
    summary: 'Tracing a signup request chronologically from ingestion to token issuance.',
    script:
      'Here is how a real user journey executes. When a client submits an account signup request, the request passes through route registration, triggers schema validation in validate.ts, verifies email uniqueness in user.service.ts, executes an atomic insert in user.repository.ts, and generates a signed JWT session token. Along the way, checkpoint quizzes verify your understanding of runtime execution.',
    sourceContext: 'POST /auth/signup · Chronological Stepping Pipeline',
  },
];

export const VoiceAgentDemo: React.FC = () => {
  const go = useNavigate();
  const { startJourney } = useWorkspace();

  const [agentState, setAgentState] = useState<VoiceAgentState>('idle');
  const [activeTopic, setActiveTopic] = useState<VoiceTopic>(voiceTopics[0]);
  const [selectedVoice, setSelectedVoice] = useState<ElevenLabsVoice>(ELEVENLABS_VOICES[0]);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [displayedText, setDisplayedText] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);

  // ElevenLabs API key state
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('elevenlabs_api_key') || '';
    }
    return '';
  });
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const orbRef = useRef<HTMLDivElement>(null);
  const ringsRef = useRef<HTMLDivElement>(null);
  const waveBarsRef = useRef<(HTMLDivElement | null)[]>([]);
  const typewriterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Web Audio & HTML5 Audio references for real frequency visualization
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Check speech synthesis support on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setSpeechSupported(false);
    }
  }, []);

  // Floating animation for AI orb
  useEffect(() => {
    if (!orbRef.current) return;
    const ctx = gsap.context(() => {
      gsap.to(orbRef.current, {
        y: -10,
        rotation: 3,
        duration: 3,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    });
    return () => ctx.revert();
  }, []);

  // Waveform visualization animation
  useEffect(() => {
    let animFrame: number;

    const renderWave = () => {
      if (agentState === 'speaking' && !isPaused) {
        if (analyserRef.current && dataArrayRef.current) {
          // Read real audio frequencies from ElevenLabs stream
          (analyserRef.current as any).getByteFrequencyData(dataArrayRef.current);
          const bufferLength = dataArrayRef.current.length;
          const step = Math.floor(bufferLength / waveBarsRef.current.length) || 1;

          waveBarsRef.current.forEach((bar, i) => {
            if (!bar) return;
            const val = dataArrayRef.current![i * step] || 30;
            const norm = Math.min(1, Math.max(0.18, val / 190));
            bar.style.transform = `scaleY(${norm.toFixed(3)})`;
          });
        } else {
          // Fallback smooth parametric harmonic wave
          waveBarsRef.current.forEach((bar, i) => {
            if (!bar) return;
            const time = Date.now() * 0.007;
            const scale =
              0.22 +
              Math.abs(Math.sin(time + i * 0.42)) * 0.5 +
              Math.cos(time * 0.5 + i * 0.3) * 0.25;
            bar.style.transform = `scaleY(${Math.min(1, Math.max(0.2, scale)).toFixed(3)})`;
          });
        }
        animFrame = requestAnimationFrame(renderWave);
      } else {
        waveBarsRef.current.forEach((bar, i) => {
          if (!bar) return;
          const restingScale = 0.22 + 0.12 * Math.sin(i * 0.5);
          bar.style.transform = `scaleY(${restingScale.toFixed(3)})`;
        });
      }
    };

    renderWave();

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
    };
  }, [agentState, isPaused]);

  // Clean up speech on unmount
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // Show transient notification badge
  const showNotice = (msg: string) => {
    setVoiceNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setVoiceNotice(null), 4500);
  };

  // Animate typewriter text reveal
  const startTypewriter = useCallback((fullText: string) => {
    if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
    setDisplayedText('');
    let idx = 0;
    const speed = 25; // ms per character

    typewriterTimerRef.current = setInterval(() => {
      idx += 2;
      if (idx <= fullText.length) {
        setDisplayedText(fullText.slice(0, idx));
      } else {
        setDisplayedText(fullText);
        if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
      }
    }, speed);
  }, []);

  // Setup Web Audio Analyser for HTML5 Audio
  const connectAudioAnalyser = (audioEl: HTMLAudioElement) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      if (!analyserRef.current) {
        const analyser = audioContextRef.current.createAnalyser();
        analyser.fftSize = 64;
        analyserRef.current = analyser;
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      }

      // Connect source once
      if (!audioSourceRef.current) {
        const src = audioContextRef.current.createMediaElementSource(audioEl);
        audioSourceRef.current = src;
        src.connect(analyserRef.current);
        analyserRef.current.connect(audioContextRef.current.destination);
      }
    } catch {
      // Cross-origin audio or browser restriction fallback
    }
  };

  // Stop any active voice playback
  const stopVoice = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (typewriterTimerRef.current) clearInterval(typewriterTimerRef.current);
    if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
    setAgentState('idle');
    setIsPaused(false);
  }, []);

  // ElevenLabs Voice Playback Engine
  const speakTopic = useCallback(
    async (topic: VoiceTopic) => {
      setActiveTopic(topic);
      setIsPaused(false);
      stopVoice();

      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);

      // 1. If ElevenLabs API Key is configured, fetch ultra-realistic vocal audio
      if (apiKey && apiKey.trim().length > 10 && !isMuted) {
        try {
          setAgentState('thinking');
          setDisplayedText('Connecting to ElevenLabs neural voice generator...');

          const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${selectedVoice.id}?optimize_streaming_latency=3`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey.trim(),
              },
              body: JSON.stringify({
                text: topic.script,
                model_id: 'eleven_turbo_v2_5',
                voice_settings: {
                  stability: 0.5,
                  similarity_boost: 0.8,
                  style: 0.05,
                  use_speaker_boost: true,
                },
              }),
            }
          );

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.detail?.message || `HTTP ${response.status}`);
          }

          const audioBlob = await response.blob();
          const audioUrl = URL.createObjectURL(audioBlob);
          const audio = new Audio(audioUrl);
          currentAudioRef.current = audio;

          audio.oncanplay = () => {
            connectAudioAnalyser(audio);
          };

          audio.onplay = () => {
            setAgentState('speaking');
            startTypewriter(topic.script);
          };

          audio.onended = () => {
            setAgentState('idle');
            currentAudioRef.current = null;
            URL.revokeObjectURL(audioUrl);
          };

          audio.onerror = () => {
            setAgentState('idle');
            currentAudioRef.current = null;
            fallbackSpeech(topic);
          };

          await audio.play();
          return;
        } catch (err: any) {
          console.warn('ElevenLabs API request returned error, falling back to natural speech:', err);
          showNotice(`ElevenLabs error: ${err.message || 'Key invalid'}. Using fallback.`);
        }
      }

      // 2. High-grade natural speech synthesis fallback
      fallbackSpeech(topic);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiKey, selectedVoice, isMuted, stopVoice, startTypewriter]
  );

  // Natural browser speech fallback
  const fallbackSpeech = (topic: VoiceTopic) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setAgentState('speaking');
      startTypewriter(topic.script);
      setTimeout(() => setAgentState('idle'), 6000);
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(topic.script);
    utterance.rate = 1.0;
    utterance.pitch = selectedVoice.gender === 'Female' ? 1.08 : 0.94;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find((v) => {
      const n = v.name.toLowerCase();
      if (selectedVoice.gender === 'Female') {
        return (
          (n.includes('natural') || n.includes('samantha') || n.includes('victoria') || n.includes('zira') || n.includes('google')) &&
          v.lang.startsWith('en')
        );
      } else {
        return (
          (n.includes('natural') || n.includes('daniel') || n.includes('david') || n.includes('george') || n.includes('google')) &&
          v.lang.startsWith('en')
        );
      }
    });

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => {
      setAgentState('speaking');
      startTypewriter(topic.script);
    };

    utterance.onend = () => {
      setAgentState('idle');
    };

    utterance.onerror = () => {
      setAgentState('idle');
    };

    if (!isMuted) {
      window.speechSynthesis.speak(utterance);
    } else {
      setAgentState('speaking');
      startTypewriter(topic.script);
      setTimeout(() => setAgentState('idle'), 6000);
    }
  };

  // Simulated "Talk to AI" Demo Mode
  const handleSimulatedListen = () => {
    if (agentState === 'listening') {
      if (listenTimerRef.current) clearTimeout(listenTimerRef.current);
      setAgentState('idle');
      return;
    }

    stopVoice();
    setAgentState('listening');
    setDisplayedText('Listening to your query in demo mode...');

    listenTimerRef.current = setTimeout(() => {
      setAgentState('thinking');
      setDisplayedText('Analyzing codebase architecture & preparing answer...');

      listenTimerRef.current = setTimeout(() => {
        speakTopic(voiceTopics[0]);
      }, 1500);
    }, 2400);
  };

  // Pause / Resume
  const togglePause = () => {
    if (currentAudioRef.current) {
      if (isPaused) {
        currentAudioRef.current.play();
        setIsPaused(false);
      } else {
        currentAudioRef.current.pause();
        setIsPaused(true);
      }
      return;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    } else {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  // Toggle Mute
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      stopVoice();
    }
  };

  // Save ElevenLabs API Key
  const handleSaveApiKey = () => {
    const trimmed = tempApiKey.trim();
    setApiKey(trimmed);
    if (typeof window !== 'undefined') {
      if (trimmed) {
        localStorage.setItem('elevenlabs_api_key', trimmed);
        showNotice('ElevenLabs API Key configured successfully!');
      } else {
        localStorage.removeItem('elevenlabs_api_key');
        showNotice('ElevenLabs API Key removed.');
      }
    }
    setShowKeyModal(false);
  };

  function handleLaunchWorkspace() {
    startJourney('signup');
    go('/demo-workspace');
  }

  return (
    <div className="voice-agent-section">
      <div className="voice-agent-header">
        <div className="voice-agent-badge">
          <span className="voice-badge-dot" />
          <span>Interactive Homepage Demo · ElevenLabs AI Voice Agent</span>
        </div>
        <h2 className="voice-agent-title">
          <span>Explore with AI Voice</span>
        </h2>
        <p className="voice-agent-subtitle">
          Experience ultra-realistic voice walkthroughs powered by ElevenLabs AI. Listen as natural voices explain
          Codebase Mentor’s architecture, connected pillars, and request workflows in real time.
        </p>
      </div>

      <div className="voice-agent-card">
        {/* Left Column: AI Voice Orb & Waveform Display */}
        <div className="voice-orb-stage">
          <div className="voice-status-pill">
            <span className={`voice-state-dot ${agentState}`} />
            <span className="voice-state-text">
              {agentState === 'idle' && `AI Voice Idle · ${selectedVoice.name} (${selectedVoice.gender})`}
              {agentState === 'listening' && 'Listening (Demo Mode)...'}
              {agentState === 'thinking' && 'Synthesizing Architecture...'}
              {agentState === 'speaking' &&
                (isPaused
                  ? 'Speech Paused'
                  : `Speaking · ElevenLabs ${selectedVoice.name}`)}
            </span>
          </div>

          {/* Glowing Animated AI Voice Orb */}
          <div className="voice-orb-wrapper">
            <div
              ref={ringsRef}
              className={`voice-orb-rings ${agentState === 'speaking' ? 'active' : ''}`}
            >
              <div className="voice-ring ring-1" />
              <div className="voice-ring ring-2" />
              <div className="voice-ring ring-3" />
            </div>

            <div
              ref={orbRef}
              className={`voice-orb ${agentState}`}
              onClick={() => speakTopic(activeTopic)}
              role="button"
              tabIndex={0}
              aria-label="Click to replay voice explanation"
            >
              <div className="voice-orb-core">
                <Sparkles size={28} className="voice-orb-icon" />
              </div>
            </div>
          </div>

          {/* Voice Model Selector Pill Bar */}
          <div className="voice-model-selector-bar">
            <span className="voice-model-label">Choose a voice</span>
            <div className="voice-model-chips" role="group" aria-label="Choose a voice">
              {ELEVENLABS_VOICES.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={selectedVoice.id === v.id}
                  aria-label={`${v.name}, ${v.gender}`}
                  className={`voice-model-chip ${selectedVoice.id === v.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedVoice(v);
                    if (agentState === 'speaking') {
                      stopVoice();
                    }
                  }}
                  title={`${v.name} · ${v.description}`}
                >
                  <span className="chip-name">{v.name}</span>
                  <span className="chip-gender">{v.gender[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Animated Waveform Visualizer */}
          <div className="voice-waveform" aria-label="Audio Waveform Visualizer">
            {Array.from({ length: 24 }).map((_, idx) => (
              <div
                key={idx}
                ref={(el) => {
                  waveBarsRef.current[idx] = el;
                }}
                className={`voice-wave-bar ${agentState === 'speaking' ? 'speaking' : ''}`}
              />
            ))}
          </div>

          {/* Primary Action Controls */}
          <div className="voice-primary-actions">
            <Button
              variant={agentState === 'listening' ? 'secondary' : 'primary'}
              magnetic
              icon={agentState === 'listening' ? MicOff : Mic}
              onClick={handleSimulatedListen}
              className="voice-talk-btn"
            >
              {agentState === 'listening' ? 'Cancel Listening' : 'Talk to AI (Demo)'}
            </Button>

            <Button
              variant="secondary"
              magnetic
              icon={agentState === 'speaking' && !isPaused ? Pause : Play}
              onClick={() => {
                if (agentState === 'speaking') {
                  togglePause();
                } else {
                  speakTopic(activeTopic);
                }
              }}
              className="voice-try-btn"
            >
              {agentState === 'speaking' && !isPaused ? 'Pause Voice' : 'Play Voice Demo'}
            </Button>
          </div>

          {/* Voice Playback Toolbar Controls */}
          <div className="voice-controls-toolbar">
            <button
              className="voice-tool-btn"
              onClick={() => speakTopic(activeTopic)}
              title="Replay Current Explanation"
              aria-label="Replay current explanation"
            >
              <RotateCcw size={15} />
              <span>Replay</span>
            </button>

            {agentState === 'speaking' && (
              <button
                className="voice-tool-btn stop-btn"
                onClick={stopVoice}
                title="Stop Voice"
                aria-label="Stop voice playback"
              >
                <Square size={14} />
                <span>Stop</span>
              </button>
            )}

            <button
              className={`voice-tool-btn ${isMuted ? 'muted' : ''}`}
              onClick={toggleMute}
              title={isMuted ? 'Unmute Voice' : 'Mute Voice'}
              aria-label={isMuted ? 'Unmute voice' : 'Mute voice'}
            >
              {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>

            <button
              className={`voice-tool-btn key-btn ${apiKey ? 'has-key' : ''}`}
              onClick={() => {
                setTempApiKey(apiKey);
                setShowKeyModal(true);
              }}
              title="Configure ElevenLabs API Key"
              aria-label="Configure ElevenLabs API Key"
            >
              <Key size={14} />
              <span>{apiKey ? 'API Key Active' : 'Set Key'}</span>
            </button>
          </div>

          {/* Transient notice feedback */}
          {voiceNotice && (
            <div className="voice-notice-banner">
              <span>{voiceNotice}</span>
            </div>
          )}

          {!speechSupported && (
            <div className="voice-unsupported-note">
              <Radio size={13} />
              <span>Speech synthesis not supported in this browser. Showing transcript demo.</span>
            </div>
          )}
        </div>

        {/* Right Column: 4 Topic Suggestion Buttons & Live Transcript Panel */}
        <div className="voice-content-stage">
          <div className="voice-topics-header">
            <span className="tiny-label">CHOOSE ARCHITECTURAL TOPIC</span>
            <div className="voice-engine-tag">
              <span className="engine-dot" />
              <span>ElevenLabs Engine</span>
            </div>
          </div>

          {/* 4 Clickable Suggestion Buttons */}
          <div className="voice-topics-grid">
            {voiceTopics.map((topic) => {
              const Icon = topic.icon;
              const isSelected = activeTopic.id === topic.id;
              return (
                <button
                  key={topic.id}
                  className={`voice-topic-card ${isSelected ? 'active' : ''}`}
                  onClick={() => speakTopic(topic)}
                >
                  <div className="voice-topic-top">
                    <span className="voice-topic-icon">
                      <Icon size={16} />
                    </span>
                    <Badge tone={isSelected ? 'violet' : 'neutral'}>{topic.tag}</Badge>
                  </div>
                  <strong className="voice-topic-title">{topic.title}</strong>
                  <p className="voice-topic-desc">{topic.summary}</p>
                </button>
              );
            })}
          </div>

          {/* Compact Conversation Transcript Panel */}
          <div className="voice-transcript-panel">
            <div className="voice-transcript-header">
              <div className="voice-transcript-speaker">
                <span className="speaker-avatar">
                  <Bot size={14} />
                </span>
                <span className="speaker-name">Codebase Mentor AI Guide</span>
                <span className="speaker-sep">·</span>
                <span className="speaker-topic">{activeTopic.title}</span>
                <span className="speaker-voice-pill">{selectedVoice.name}</span>
              </div>
              <Badge tone="violet">{activeTopic.tag}</Badge>
            </div>

            <div className="voice-transcript-body">
              <p className="voice-transcript-text">
                {displayedText || activeTopic.script}
                {agentState === 'speaking' && <span className="voice-cursor" />}
              </p>
            </div>

            <div className="voice-transcript-footer">
              <span className="voice-source-ref">
                <Route size={13} className="green-text" />
                <code>{activeTopic.sourceContext}</code>
              </span>

              <button className="voice-cta-link" onClick={handleLaunchWorkspace}>
                Explore in Interactive Atlas
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ElevenLabs API Key Modal Drawer */}
      {showKeyModal && (
        <div className="elevenlabs-modal-backdrop" onClick={() => setShowKeyModal(false)}>
          <div className="elevenlabs-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="elevenlabs-modal-header">
              <div className="modal-title-cluster">
                <span className="modal-icon-wrap">
                  <Key size={18} />
                </span>
                <div>
                  <h3 className="modal-title">ElevenLabs API Integration</h3>
                  <span className="modal-subtitle">Connect your ElevenLabs API Key for studio-grade voice synthesis</span>
                </div>
              </div>
              <button className="modal-close-btn" onClick={() => setShowKeyModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="elevenlabs-modal-body">
              <p className="modal-description">
                Enter your <strong>ElevenLabs API key</strong> (`xi-api-key`). The AI Voice Agent will stream real,
                lifelike human audio in the voice of <strong>{selectedVoice.name}</strong> ({selectedVoice.description}).
                Keys are stored strictly in your local browser storage.
              </p>

              <div className="modal-input-group">
                <label htmlFor="elevenlabs-key-input" className="modal-input-label">
                  ElevenLabs API Key
                </label>
                <input
                  id="elevenlabs-key-input"
                  type="password"
                  className="modal-key-input"
                  placeholder="e.g. sk_1234567890abcdef..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                />
              </div>

              <div className="modal-helper-row">
                <span>Don't have an API key? You can get one at elevenlabs.io</span>
                {apiKey && (
                  <button
                    className="modal-clear-link"
                    onClick={() => {
                      setTempApiKey('');
                      setApiKey('');
                      localStorage.removeItem('elevenlabs_api_key');
                      showNotice('ElevenLabs API Key cleared.');
                      setShowKeyModal(false);
                    }}
                  >
                    Clear Saved Key
                  </button>
                )}
              </div>
            </div>

            <div className="elevenlabs-modal-footer">
              <Button variant="secondary" onClick={() => setShowKeyModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveApiKey} icon={Sparkles}>
                Save & Enable Voice
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

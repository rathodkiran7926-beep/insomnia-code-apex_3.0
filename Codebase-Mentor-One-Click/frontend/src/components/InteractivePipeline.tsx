import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import {
  ArrowRight,
  Code2,
  Compass,
  FileCode2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Badge, Button, TiltCard } from './UI';
import { useWorkspace } from '../state/WorkspaceContext';

interface PipelineStage {
  id: string;
  step: string;
  tag: string;
  name: string;
  component: string;
  file: string;
  lines: string;
  description: string;
  detail: string;
  codeSnippet: string;
  x: number;
  y: number;
}

const stages: PipelineStage[] = [
  {
    id: 'client',
    step: '01',
    tag: 'Entry Point',
    name: 'HTTP Request Ingestion',
    component: 'Client Gateway',
    file: 'POST /auth/signup',
    lines: 'Headers & JSON payload',
    description:
      'The client dispatches an HTTP POST request containing registration details: email, password, and developer name.',
    detail:
      'The incoming request arrives at the API gateway with Content-Type: application/json. Zero database or internal service resources are consumed yet.',
    codeSnippet: `POST /api/v1/auth/signup HTTP/1.1\nContent-Type: application/json\n\n{\n  "email": "alex@relay.example",\n  "password": "Password123!",\n  "name": "Alex Mercer"\n}`,
    x: 60,
    y: 180,
  },
  {
    id: 'router',
    step: '02',
    tag: 'Route Dispatch',
    name: 'Auth Route Controller',
    component: 'AuthRouter',
    file: 'src/routes/auth.routes.ts',
    lines: 'L12–L18',
    description:
      'Express routing directs the incoming URL to authentication route handlers and chains the validation middleware.',
    detail:
      'authRouter.post("/signup", validate(signupSchema), authController.signup). The route establishes an explicit separation between HTTP protocol and business logic.',
    codeSnippet: `// src/routes/auth.routes.ts\nauthRouter.post(\n  '/signup',\n  validate(signupSchema),\n  async (req, res, next) => {\n    const user = await userService.signup(req.body);\n    res.status(201).json(user);\n  }\n);`,
    x: 210,
    y: 110,
  },
  {
    id: 'validation',
    step: '03',
    tag: 'Boundary Gate',
    name: 'Input Schema Validation',
    component: 'Validation Middleware',
    file: 'src/middleware/validate.ts',
    lines: 'L4–L12',
    description:
      'Zod schema checks string constraints, email formats, and minimum password lengths before business logic runs.',
    detail:
      'If validation fails, a 400 Bad Request error is returned immediately, shielding services and database storage from invalid input.',
    codeSnippet: `// src/middleware/validate.ts\nexport const signupSchema = z.object({\n  email: z.string().email(),\n  name: z.string().min(2),\n  password: z.string().min(8).regex(/\\d/, 'Needs digit')\n});`,
    x: 370,
    y: 200,
  },
  {
    id: 'service',
    step: '04',
    tag: 'Core Domain',
    name: 'User Service & Business Rules',
    component: 'UserService',
    file: 'src/services/user.service.ts',
    lines: 'L16–L25',
    description:
      'Verifies email uniqueness, hashes the raw password, and prepares the user record for persistence.',
    detail:
      'The service enforces business constraints: if users.findByEmail() returns an existing record, a ConflictError(409) is thrown.',
    codeSnippet: `// src/services/user.service.ts\nconst existing = await userRepository.findByEmail(dto.email);\nif (existing) throw new ConflictError('Email already taken');\nconst passwordHash = await hashPassword(dto.password);\nconst user = await userRepository.create({ ...dto, passwordHash });`,
    x: 520,
    y: 130,
  },
  {
    id: 'repository',
    step: '05',
    tag: 'Data Persistence',
    name: 'Database Storage Boundary',
    component: 'UserRepository',
    file: 'src/repositories/user.repository.ts',
    lines: 'L5–L14',
    description:
      'Executes an atomic insert query against the persistent database boundary via Prisma ORM.',
    detail:
      'By decoupling repository operations from UserService, database adapters can be substituted or mocked during unit testing without spinning up PostgreSQL.',
    codeSnippet: `// src/repositories/user.repository.ts\nexport async function create(data: CreateUserRecord): Promise<User> {\n  return prisma.user.create({\n    data: {\n      ...data,\n      emailVerified: false,\n      createdAt: new Date()\n    }\n  });\n}`,
    x: 670,
    y: 210,
  },
  {
    id: 'token',
    step: '06',
    tag: 'Output Dispatch',
    name: 'Token Issuance & Response',
    component: 'AuthService',
    file: 'src/services/auth.service.ts',
    lines: 'L28–L34',
    description:
      'Signs JWT session token with user claims and responds with HTTP 201 Created.',
    detail:
      'Sensitive fields like passwordHash are omitted from the returned payload, concluding the request lifecycle cleanly.',
    codeSnippet: `// src/services/auth.service.ts\nconst token = jwt.sign(\n  { sub: user.id, email: user.email },\n  config.jwtSecret,\n  { expiresIn: '24h' }\n);\nreturn { user: sanitize(user), token };`,
    x: 810,
    y: 150,
  },
];

export const InteractivePipeline: React.FC = () => {
  const go = useNavigate();
  const { startJourney } = useWorkspace();
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const packetRef = useRef<SVGGElement>(null);
  const stage = stages[currentStageIndex];

  // Auto-advance timer when playing
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentStageIndex((prev) => (prev + 1) % stages.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Animate the packet to the current stage position
  useEffect(() => {
    if (!packetRef.current) return;
    const target = stages[currentStageIndex];

    gsap.to(packetRef.current, {
      x: target.x,
      y: target.y,
      duration: 0.8,
      ease: 'power3.inOut',
    });
  }, [currentStageIndex]);

  function handleStageSelect(index: number) {
    setCurrentStageIndex(index);
    setIsPlaying(false);
  }

  function handleLaunchWorkspace() {
    startJourney('signup');
    go('/demo-workspace');
  }

  return (
    <div className="pipeline-wrapper">
      <div className="pipeline-header">
        <div className="pipeline-header-left">
          <span className="eyebrow">INTERACTIVE ARCHITECTURAL PIPELINE</span>
          <h2 className="pipeline-title">
            Watch a request travel from client to database.
          </h2>
          <p className="pipeline-subtitle">
            Just like Symboolic’s interactive factory, Codebase Mentor traces how code actually runs
            across routes, validation, services, and persistence.
          </p>
        </div>

        <div className="pipeline-playback-controls">
          <button
            className={`pipeline-play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            <span>{isPlaying ? 'Pause auto-flow' : 'Play auto-flow'}</span>
          </button>
          <button
            className="pipeline-reset-btn"
            onClick={() => {
              setCurrentStageIndex(0);
              setIsPlaying(true);
            }}
            title="Reset to stage 1"
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      <div className="pipeline-stage-selector">
        {stages.map((st, i) => (
          <button
            key={st.id}
            className={`pipeline-tab-item ${i === currentStageIndex ? 'active' : ''}`}
            onClick={() => handleStageSelect(i)}
          >
            <span className="pipeline-tab-num">{st.step}</span>
            <span className="pipeline-tab-name">{st.component}</span>
            {i === currentStageIndex && <span className="pipeline-tab-indicator" />}
          </button>
        ))}
      </div>

      <div className="pipeline-grid">
        {/* Left Side: Isometric / Perspective Architectural Canvas */}
        <TiltCard className="pipeline-canvas-card" maxTilt={3}>
          <div className="pipeline-canvas-topbar">
            <div className="row gap-8">
              <span className="status-dot-pulse" />
              <strong>Relay API Flow Simulator</strong>
              <span className="pipeline-divider">·</span>
              <span className="pipeline-method">POST</span>
              <code>/auth/signup</code>
            </div>
            <Badge tone="violet">Interactive Trace</Badge>
          </div>

          <div className="pipeline-svg-container">
            <svg
              ref={svgRef}
              viewBox="0 0 880 340"
              className="pipeline-svg"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                {/* Circuit Track Gradient */}
                <linearGradient id="pipeTrackGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#5855d9" stopOpacity="0.2" />
                  <stop offset="50%" stopColor="#5855d9" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#16866a" stopOpacity="0.7" />
                </linearGradient>

                {/* Packet Glow Filter */}
                <filter id="packetGlow" x="-30%" y="-30%" width="160%" height="160%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              {/* Grid Background Lines (Blueprint Accent) */}
              <g opacity="0.12" stroke="#5855d9" strokeWidth="1">
                <line x1="0" y1="60" x2="880" y2="60" strokeDasharray="4 6" />
                <line x1="0" y1="140" x2="880" y2="140" strokeDasharray="4 6" />
                <line x1="0" y1="220" x2="880" y2="220" strokeDasharray="4 6" />
                <line x1="0" y1="300" x2="880" y2="300" strokeDasharray="4 6" />
                <line x1="140" y1="0" x2="140" y2="340" strokeDasharray="4 6" />
                <line x1="300" y1="0" x2="300" y2="340" strokeDasharray="4 6" />
                <line x1="450" y1="0" x2="450" y2="340" strokeDasharray="4 6" />
                <line x1="600" y1="0" x2="600" y2="340" strokeDasharray="4 6" />
                <line x1="750" y1="0" x2="750" y2="340" strokeDasharray="4 6" />
              </g>

              {/* Connecting Architectural Conveyor Path */}
              <path
                d="M 60 180 C 130 180, 150 110, 210 110 C 290 110, 300 200, 370 200 C 440 200, 460 130, 520 130 C 590 130, 610 210, 670 210 C 740 210, 750 150, 810 150"
                stroke="url(#pipeTrackGrad)"
                strokeWidth="5"
                strokeLinecap="round"
                className="pipeline-track"
              />

              {/* Secondary Animated Dashed Flow Line */}
              <path
                d="M 60 180 C 130 180, 150 110, 210 110 C 290 110, 300 200, 370 200 C 440 200, 460 130, 520 130 C 590 130, 610 210, 670 210 C 740 210, 750 150, 810 150"
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 12"
                className="pipeline-dash-flow"
              />

              {/* Station Nodes Along the Path */}
              {stages.map((st, idx) => {
                const isCurrent = idx === currentStageIndex;
                const isPast = idx < currentStageIndex;

                return (
                  <g
                    key={st.id}
                    className={`pipeline-node-group ${isCurrent ? 'current' : ''} ${isPast ? 'past' : ''}`}
                    onClick={() => handleStageSelect(idx)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Outer Pulse Ring when Active */}
                    {isCurrent && (
                      <circle
                        cx={st.x}
                        cy={st.y}
                        r="28"
                        fill="none"
                        stroke="#5855d9"
                        strokeWidth="1.5"
                        opacity="0.6"
                        className="pipeline-pulse-ring"
                      />
                    )}

                    {/* Node Station Platform */}
                    <rect
                      x={st.x - 24}
                      y={st.y - 24}
                      width="48"
                      height="48"
                      rx="14"
                      fill={isCurrent ? '#5855d9' : '#ffffff'}
                      stroke={isCurrent ? '#5855d9' : '#dde2ec'}
                      strokeWidth="2"
                      className="pipeline-station-box"
                      style={{
                        filter: isCurrent ? 'drop-shadow(0 6px 16px rgba(88,85,217,0.35))' : 'none',
                        transition: 'all 0.3s ease',
                      }}
                    />

                    {/* Node Step Number inside */}
                    <text
                      x={st.x}
                      y={st.y + 5}
                      textAnchor="middle"
                      fill={isCurrent ? '#ffffff' : '#687386'}
                      fontSize="13"
                      fontWeight="700"
                      fontFamily="var(--font-mono)"
                    >
                      {st.step}
                    </text>

                    {/* Station Name Label */}
                    <text
                      x={st.x}
                      y={st.y + 44}
                      textAnchor="middle"
                      fill={isCurrent ? '#5855d9' : '#202a3c'}
                      fontSize="11.5"
                      fontWeight={isCurrent ? '700' : '500'}
                    >
                      {st.component}
                    </text>
                  </g>
                );
              })}

              {/* Animated Floating Request Packet */}
              <g
                ref={packetRef}
                filter="url(#packetGlow)"
                className="pipeline-moving-packet"
                transform={`translate(${stages[0].x}, ${stages[0].y})`}
              >
                <circle r="12" fill="#5855d9" />
                <circle r="6" fill="#ffffff" />
                <circle r="18" fill="none" stroke="#5855d9" strokeWidth="1.5" opacity="0.4" />
              </g>
            </svg>
          </div>

          <div className="pipeline-canvas-footer">
            <span>
              <Sparkles size={14} className="text-primary" />
              Click any station or use auto-play to trace request progress
            </span>
            <span className="pipeline-status-badge">
              Active Stage: {stage.step} of 06 · {stage.component}
            </span>
          </div>
        </TiltCard>

        {/* Right Side: Editorial Explanation Card (Matching Symboolic Stage Card) */}
        <TiltCard className="pipeline-detail-card" maxTilt={3}>
          <div className="pipeline-card-badge-row">
            <span className="pipeline-stage-number">{stage.step}</span>
            <Badge tone="violet">{stage.tag}</Badge>
            <span className="pipeline-step-of">Stage {stage.step} / 06</span>
          </div>

          <h3 className="pipeline-stage-title">{stage.name}</h3>
          <p className="pipeline-stage-desc">{stage.description}</p>

          <div className="pipeline-source-ref">
            <span className="pipeline-source-file">
              <FileCode2 size={13} />
              <code>{stage.file}</code>
            </span>
            <Badge tone="blue">{stage.lines}</Badge>
          </div>

          {/* Interactive Code Preview Drawer */}
          <div className="pipeline-code-preview">
            <div className="pipeline-code-header">
              <span>Prepared implementation snippet</span>
              <Code2 size={13} />
            </div>
            <pre className="pipeline-code-block">
              <code>{stage.codeSnippet}</code>
            </pre>
          </div>

          <div className="pipeline-card-actions">
            <Button
              variant="primary"
              magnetic
              icon={Compass}
              className="pipeline-cta-btn"
              onClick={handleLaunchWorkspace}
            >
              Trace in Mentor Workspace
              <ArrowRight size={14} />
            </Button>
            <button
              className="pipeline-next-step-btn"
              onClick={() => handleStageSelect((currentStageIndex + 1) % stages.length)}
            >
              Next stage ({stages[(currentStageIndex + 1) % stages.length].step}) →
            </button>
          </div>
        </TiltCard>
      </div>
    </div>
  );
};

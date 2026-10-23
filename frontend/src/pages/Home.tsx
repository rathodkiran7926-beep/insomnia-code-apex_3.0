import { useState, useEffect } from 'react';
import '../styles/home-hero.css';
import '../styles/home-layout.css';
import '../styles/home-details.css';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Compass,
  FlaskConical,
  Layers3,
  MessageSquareText,
  Sparkles,
} from 'lucide-react';
import { useHeroAnimation, useScrollReveal } from '../animations/gsapHooks';
import { BlueprintPattern } from '../components/BlueprintPattern';
import { PixelDeco } from '../components/PixelDeco';
import { NumbersPixelBorder } from '../components/NumbersPixelBorder';
import { FeatureArtwork } from '../components/FeatureArtwork';
import { VoiceAgentDemo } from '../components/VoiceAgentDemo';
import { PlatformTerminal } from '../components/PlatformTerminal';
import { AgentContextPreview } from '../components/AgentContextPreview';
import { Badge, Button, TiltCard } from '../components/UI';

const faqs = [
  {
    question: 'What is Codebase Mentor?',
    answer:
      'Codebase Mentor is an interactive digital workspace that turns complex backend codebases into connected, navigable systems. It bridges high-level architectural diagrams with actual source code and guided request journeys.',
  },
  {
    question: 'How does it trace a request from route to database?',
    answer:
      'Code journeys connect the incoming HTTP endpoint, middleware validation, service logic, and database persistence in step-by-step chronological sequence, pointing directly to the exact file and line numbers.',
  },
  {
    question: 'Does my code or data leave the browser?',
    answer:
      'No. Codebase Mentor operates 100% locally in your browser. All code inspection, checkpoint predictions, and simulated contributions remain on your machine with zero external tracking.',
  },
  {
    question: 'How can I practice making a contribution safely?',
    answer:
      'The Practice sandbox provides guided starter exercises—like adding password complexity validation—complete with acceptance criteria, hints, and instant simulated check results without needing a running server.',
  },
  {
    question: 'What happens when a pull request changes the codebase?',
    answer:
      'The Changes view compares snapshots side-by-side, highlights impacted journey steps, and alerts you to studied concepts that need review so your mental model stays in sync with evolving code.',
  },
];

export default function Home() {
  const go = useNavigate();
  const heroRef = useHeroAnimation<HTMLDivElement>();
  const showcaseRef = useScrollReveal<HTMLDivElement>({ stagger: 0.12 });
  const metricsRef = useScrollReveal<HTMLDivElement>({
    selector: '.sym-numbers-container',
    stagger: 0.1,
  });
  const faqRef = useScrollReveal<HTMLDivElement>({ stagger: 0.08 });

  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [isHeaderCompact, setIsHeaderCompact] = useState(() => window.scrollY > 64);

  useEffect(() => {
    const updateHeader = () => setIsHeaderCompact(window.scrollY > 64);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
    return () => window.removeEventListener('scroll', updateHeader);
  }, []);

  function handleLaunchWorkspace() {
    go('/workspace');
  }

  function scrollToSection(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  return (
    <div className="home-screen">
      {/* Symboolic Editorial Header */}
      <header className={`sym-header${isHeaderCompact ? ' is-compact' : ''}`} role="banner">
        <div className="sym-header-inner">
          <div
            className="sym-brand"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <img className="home-full-logo" src="/codebase_mentor_full_logo.svg" alt="Codebase Mentor" width={200} height={80} />
          </div>

          <nav className="sym-nav-menu">
            <a
              href="#about"
              onClick={(event) => scrollToSection(event, 'about')}
              className="sym-nav-item sym-nav-dropdown"
            >
              <span>Platform</span>
              <ChevronDown size={14} className="sym-dropdown-arrow" />
            </a>
            <a
              href="#voice"
              onClick={(event) => scrollToSection(event, 'voice')}
              className="sym-nav-item"
            >
              AI Voice
            </a>
            <a
              href="#features"
              onClick={(event) => scrollToSection(event, 'features')}
              className="sym-nav-item"
            >
              Atlas & Journeys
            </a>
            <a
              href="#numbers"
              onClick={(event) => scrollToSection(event, 'numbers')}
              className="sym-nav-item"
            >
              Metrics
            </a>
          </nav>

          <div className="sym-header-actions">
            <button className="sym-client-area-btn" onClick={() => go('/workspace')}>
              Open Workspace
            </button>
          </div>
        </div>
      </header>

      {/* Symboolic Billboard Hero Section */}
      <section className="home-billboard" ref={heroRef}>
        <PixelDeco />

        <div className="home-billboard-inner">
          <h1 className="home-hero-title hero-title">
            <span>We are the first AI-Native</span> <span>codebase mentor platform</span>
          </h1>

          <p className="home-hero-subtitle hero-desc">
            Explore backend systems through connected architecture, guided code journeys, and
            interactive inquiries. In a few seconds you will trace any runtime flow from route to
            database.
          </p>

          <PlatformTerminal onExplore={handleLaunchWorkspace} />
        </div>
      </section>

      {/* Sleek Infinite Architecture Marquee Strip */}
      <div className="home-marquee-wrap" aria-label="Architecture Standards">
        <div className="home-marquee-track">
          {[
            'TypeScript 5.x',
            'Express REST API',
            'Zod Schema Validation',
            'Prisma ORM Boundary',
            'PostgreSQL Layer',
            'ReactFlow Atlas',
            'Prism.js Syntax Engine',
            'Git Branch Diffs',
            'TypeScript 5.x',
            'Express REST API',
            'Zod Schema Validation',
            'Prisma ORM Boundary',
            'PostgreSQL Layer',
            'ReactFlow Atlas',
            'Prism.js Syntax Engine',
            'Git Branch Diffs',
          ].map((tech, i) => (
            <span key={i} className="home-marquee-pill">
              <span className="tech-dot" />
              <span>{tech}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Interactive AI Voice Agent Demo ("Explore with AI Voice") */}
      <section id="voice" className="home-section voice-home-wrap">
        <VoiceAgentDemo />
      </section>

      {/* 4 Feature Cards Grid ("From Request to Understanding") */}
      <section id="features" className="home-section" ref={showcaseRef}>
        <div id="about" className="home-section-header">
          <span className="eyebrow">FOUR CONNECTED PILLARS</span>
          <h2 className="home-section-title">The big picture. The deciding code. In one place.</h2>
          <p className="home-section-desc">
            Traditional tools force you to jump between high-level documentation and raw files.
            Codebase Mentor keeps them perpetually synchronized.
          </p>
        </div>

        <div className="home-feature-grid">
          <TiltCard className="home-feature-card feature-card--atlas" maxTilt={5}>
            <span className="feature-card-number" aria-hidden="true">
              01
            </span>
            <FeatureArtwork kind="atlas" />
            <div className="home-card-icon-wrap violet">
              <Layers3 size={24} />
            </div>
            <span className="home-card-tag">Architecture</span>
            <h3>Interactive Atlas</h3>
            <p>
              Navigate the entire system visually. Inspect routes, validation layers, services, and
              persistence boundaries with live component relationships.
            </p>
            <button className="home-card-cta" onClick={() => go('/workspace')}>
              Explore Atlas <ArrowRight size={13} />
            </button>
          </TiltCard>

          <TiltCard className="home-feature-card feature-card--journey" maxTilt={5}>
            <span className="feature-card-number" aria-hidden="true">
              02
            </span>
            <FeatureArtwork kind="journey" />
            <div className="home-card-icon-wrap blue">
              <Compass size={24} />
            </div>
            <span className="home-card-tag">Walkthroughs</span>
            <h3>Guided Code Journeys</h3>
            <p>
              Follow a single request from the HTTP entry point all the way to token issuance. Pause
              at checkpoints to predict runtime decisions.
            </p>
            <button className="home-card-cta" onClick={() => go('/journeys')}>
              Browse Journeys <ArrowRight size={13} />
            </button>
          </TiltCard>

          <TiltCard className="home-feature-card feature-card--practice" maxTilt={5}>
            <span className="feature-card-number" aria-hidden="true">
              03
            </span>
            <FeatureArtwork kind="practice" />
            <div className="home-card-icon-wrap green">
              <FlaskConical size={24} />
            </div>
            <span className="home-card-tag">Hands-on</span>
            <h3>Contribution Practice</h3>
            <p>
              Apply what you learn in an in-browser sandbox. Modify real Zod validation rules and
              verify your patch against acceptance criteria with zero setup.
            </p>
            <button className="home-card-cta" onClick={() => go('/practice')}>
              Try Starter Exercise <ArrowRight size={13} />
            </button>
          </TiltCard>

          <TiltCard className="home-feature-card feature-card--knowledge" maxTilt={5}>
            <span className="feature-card-number" aria-hidden="true">
              04
            </span>
            <FeatureArtwork kind="knowledge" />
            <div className="home-card-icon-wrap amber">
              <MessageSquareText size={24} />
            </div>
            <span className="home-card-tag">Decisions</span>
            <h3>Team Knowledge</h3>
            <p>
              Capture the human rationale behind architectural separations. Distinguish observed
              code facts from reviewed design intent.
            </p>
            <button className="home-card-cta" onClick={() => go('/knowledge')}>
              Review Decisions <ArrowRight size={13} />
            </button>
          </TiltCard>
        </div>
      </section>

      <AgentContextPreview />

      {/* Symboolic in numbers section with pixel mosaic top & bottom borders */}
      <section id="numbers" className="sym-numbers-section" ref={metricsRef}>
        <NumbersPixelBorder edge="top" />

        <div className="sym-numbers-container">
          <div className="sym-numbers-header">
            <h2 className="sym-numbers-title">
              Codebase Mentor
              <br />
              in numbers
            </h2>
            <p className="sym-numbers-desc">
              If your team is still wrestling with complex onboarding and untracked architectural
              drift, you are in good company. We measure what engineers can understand, predict, and
              ship safely.
            </p>
          </div>

          <div className="sym-numbers-grid">
            <div className="sym-number-card">
              <span className="sym-number-val">
                200<span className="sym-number-suffix">+</span>
              </span>
              <p className="sym-number-label">
                Parsed architecture endpoints and domain service boundaries across synthetic
                prototypes.
              </p>
            </div>

            <div className="sym-number-card">
              <span className="sym-number-val">
                50<span className="sym-number-suffix">+</span>
              </span>
              <p className="sym-number-label">
                Guided code checkpoints and validation rules mastered by engineers in browser
                sandboxes.
              </p>
            </div>

            <div className="sym-number-card">
              <span className="sym-number-val">
                10<span className="sym-number-suffix">s</span>
              </span>
              <p className="sym-number-label">
                To trace any incoming HTTP route to its database persistence row with zero server
                setup.
              </p>
            </div>
          </div>
        </div>

        <NumbersPixelBorder edge="bottom" />
      </section>

      {/* FAQ Accordion Section inspired by Symboolic */}
      <section id="faq" className="home-section faq-section" ref={faqRef}>
        <div className="home-section-header">
          <span className="eyebrow">COMMON QUESTIONS</span>
          <h2 className="home-section-title">Everything you need to know</h2>
          <p className="home-section-desc">
            How Codebase Mentor works, where the code comes from, and what makes it different.
          </p>
        </div>

        <div className="home-faq-accordion">
          {faqs.map((faq, index) => {
            const isOpen = activeFaq === index;
            return (
              <div key={faq.question} className={`home-faq-item ${isOpen ? 'open' : ''}`}>
                <button
                  className="home-faq-trigger"
                  onClick={() => setActiveFaq(isOpen ? null : index)}
                  aria-expanded={isOpen}
                >
                  <span>{faq.question}</span>
                  <span className={`faq-arrow ${isOpen ? 'rotated' : ''}`}>
                    <ChevronDown size={18} />
                  </span>
                </button>
                {isOpen && (
                  <div className="home-faq-content">
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Pre-Footer Split Billboard (Inspired by Symboolic Pre-Footer) */}
      <section className="home-prefooter">
        <BlueprintPattern position="both" opacity={0.07} />
        <div className="home-prefooter-content">
          <span className="tiny-label">START EXPLORING TODAY</span>
          <h2 className="home-prefooter-title">
            Stop getting lost in disconnected files.
            <br />
            Start following the story.
          </h2>
          <p className="home-prefooter-subtitle">
            Walk through real code, understand deciding branches, and make your first contribution
            with confidence.
          </p>
          <div className="home-prefooter-actions">
            <Button
              variant="primary"
              magnetic
              icon={Sparkles}
              className="home-btn-large"
              onClick={handleLaunchWorkspace}
            >
              Open Mentor Workspace
              <ArrowRight size={16} />
            </Button>
            <Button
              variant="secondary"
              className="home-btn-large"
              icon={Compass}
              onClick={() => go('/journeys')}
            >
              Browse Code Journeys
            </Button>
          </div>
        </div>
      </section>

      {/* Editorial Footer */}
      <footer className="home-footer" role="contentinfo">
        <NumbersPixelBorder edge="top" />
        <div className="footer-content">
          <div className="home-footer-inner">
            <div className="home-footer-left">
              <div className="footer-brand-meta">
                <Badge tone="violet">v0.1</Badge>
              </div>
              <img className="footer-full-logo" src="/codebase_mentor_full_logo.svg" alt="Codebase Mentor" width={440} height={176} />
            </div>
            <div className="footer-intro">
              <p className="home-footer-tagline">
                Understand a codebase through connected architecture, guided code journeys, and
                contribution practice.
              </p>
              <button className="footer-workspace-link" onClick={handleLaunchWorkspace}>
                Open Mentor Workspace{' '}
                <span>
                  <ArrowUpRight size={28} />
                </span>
              </button>
            </div>
          </div>
          <div className="footer-navigation">
            <button
              className="footer-back-top"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                    ? 'auto'
                    : 'smooth',
                })
              }
            >
              Back to top <ArrowUpRight size={18} />
            </button>
            <div className="home-footer-links">
              <div className="footer-col">
                <strong>Workspace</strong>
                <button onClick={() => go('/workspace')}>Architecture Atlas</button>
                <button onClick={() => go('/journeys')}>Code Journeys</button>
                <button onClick={() => go('/learn')}>Learning Path</button>
                <button onClick={() => go('/practice')}>Practice Sandbox</button>
              </div>
              <div className="footer-col">
                <strong>Evolution</strong>
                <button onClick={() => go('/changes')}>Pull Requests</button>
                <button onClick={() => go('/knowledge')}>Team Decisions</button>
                <button onClick={() => go('/progress')}>Progress Record</button>
                <button onClick={() => go('/repository')}>Repository Context</button>
              </div>
            </div>
          </div>

          <div className="home-footer-bottom">
            <span>
              <span className="status-dot" /> All work stays in your browser · No external code
              transmission
            </span>
            <span>Codebase Mentor · Sample API Prototype</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

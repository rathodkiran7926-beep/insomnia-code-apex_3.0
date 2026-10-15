import {
  ArrowRight,
  ChevronDown,
  Compass,
  GitBranch,
  GitCommitHorizontal,
  Layers3,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScrollReveal } from '../animations/gsapHooks';
import { Atlas } from '../components/Atlas';
import { CodeViewer } from '../components/CodeViewer';
import { JourneyPlayer } from '../components/JourneyPlayer';
import { MentorPanel } from '../components/MentorPanel';
import { Badge, Button, DemoNote, IconButton, PageHeading } from '../components/UI';
import { versions } from '../data/fixtures';
import type { Snapshot } from '../data/types';
import { useWorkspace } from '../state/WorkspaceContext';

export default function Workspace() {
  const { state, startJourney, setSnapshot, patch } = useWorkspace();
  const [mentorVisible, setMentorVisible] = useState(true);
  const go = useNavigate();
  const gridRef = useScrollReveal<HTMLDivElement>({ delay: 0.1 });

  return (
    <div className={`workspace-page ${state.journeyId ? 'journey-mode' : ''}`}>
      <PageHeading
        eyebrow={state.journeyId ? 'ACTIVE JOURNEY · FOLLOW THE REQUEST' : 'YOUR CODEBASE, CONNECTED'}
        title={
          state.journeyId
            ? 'Follow the request. Find the deciding code.'
            : 'The big picture. The details. Connected.'
        }
        description={
          state.journeyId
            ? 'Step through the request path, inspect source lines, and verify branch predictions in real time.'
            : 'Explore the architecture, follow the code, and build understanding that lasts.'
        }
        actions={
          <>
            <Button icon={Compass} onClick={() => go('/journeys')}>
              Browse journeys
            </Button>
            <Button
              variant="primary"
              icon={Sparkles}
              magnetic
              onClick={() => startJourney('signup')}
            >
              {state.journeyId ? 'Restart signup' : 'Follow a request'}
              <ArrowRight size={15} />
            </Button>
          </>
        }
      />
      <div className="context-bar">
        <div className="row gap-12">
          <span className="repo-context-icon">
            <Network size={16} />
          </span>
          <strong>
            acme <span>/</span> relay-api
          </strong>
          <span className="context-separator" />
          <label className="version-select">
            <GitBranch size={13} />
            <select
              aria-label="Repository version"
              value={state.snapshot}
              onChange={(e) => setSnapshot(e.target.value as Snapshot)}
            >
              <option value="base">main</option>
              <option value="head">feat/email-verification</option>
            </select>
            <ChevronDown size={11} />
          </label>
          <span className="commit-tag">
            <GitCommitHorizontal size={13} />
            {versions[state.snapshot].commit}
          </span>
        </div>
        <div className="row gap-10">
          <span className="context-indexed">
            <span className="status-dot" />
            Demo snapshot ready
          </span>
          <IconButton
            icon={mentorVisible ? PanelRightClose : PanelRightOpen}
            label={mentorVisible ? 'Hide mentor panel' : 'Show mentor panel'}
            onClick={() => setMentorVisible((x) => !x)}
          />
        </div>
      </div>
      <div className="workspace-tabbar">
        <div className="workspace-tabs">
          <button
            className={!state.journeyId ? 'active' : ''}
            onClick={() => patch({ journeyId: null, playing: false })}
          >
            <Layers3 size={15} />
            Architecture atlas
          </button>
          <button
            className={state.journeyId ? 'active' : ''}
            onClick={() => {
              if (!state.journeyId) startJourney('signup');
            }}
          >
            <Compass size={15} />
            Code journey<Badge tone="violet">Interactive</Badge>
          </button>
        </div>
        <DemoNote>Prepared sample · no live analysis</DemoNote>
      </div>
      {state.journeyId && <JourneyPlayer mode={mentorVisible ? 'controls' : 'full'} />}
      <div
        ref={gridRef}
        className={`workspace-grid ${!mentorVisible ? 'mentor-hidden' : 'mentor-shown'}`}
      >
        <div className="workspace-primary">
          <Atlas />
          <CodeViewer />
        </div>
        {mentorVisible && <MentorPanel />}
      </div>
      <div className="workspace-bottom">
        <span>
          <span className="status-dot" />
          One workspace. Every connection has context.
        </span>
        <button onClick={() => go('/learn')}>
          Find your learning path <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  GitBranch,
  LockKeyhole,
  Play,
  Route,
  Search,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, DemoNote, PageHeading } from '../components/UI';
import { journeys } from '../data/fixtures';
import { useWorkspace } from '../state/WorkspaceContext';

export default function Journeys() {
  const { state, startJourney } = useWorkspace();
  const go = useNavigate();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const visible = journeys.filter(
    (j) =>
      `${j.title} ${j.tags.join(' ')}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'complete' && state.completed.includes(j.id)) ||
        (filter === 'new' && !state.completed.includes(j.id))),
  );
  function launch(
    id: 'signup' | 'login',
    scenario: 'success' | 'duplicate' | 'invalid' = 'success',
  ) {
    startJourney(id, scenario);
    go('/workspace');
  }
  return (
    <>
      <PageHeading
        eyebrow="CODE JOURNEYS"
        title="Don’t just read the code. Follow it."
        description="Walk through a feature, find the deciding conditions, and connect every step to its source."
        actions={
          <Button variant="primary" icon={Compass} onClick={() => launch('signup')}>
            Start a journey
            <ArrowRight size={15} />
          </Button>
        }
      />
      <div className="journey-library-intro">
        <div className="journey-intro-icon">
          <Route size={29} strokeWidth={1.3} />
        </div>
        <div>
          <span className="tiny-label">FROM REQUEST TO UNDERSTANDING</span>
          <h2>One request. A whole system of connections.</h2>
          <p>
            Each journey keeps the architecture, source, and explanation in sync. You set the pace.
          </p>
        </div>
        <Badge tone="violet">Source-linked walkthroughs</Badge>
      </div>
      <div className="list-toolbar">
        <div className="filter-tabs">
          {[
            ['all', 'All journeys'],
            ['new', 'Not completed'],
            ['complete', 'Completed'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? 'active' : ''}
              onClick={() => setFilter(id)}
            >
              {label}
              {id === 'all' && <span>2</span>}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="Find a journey"
            placeholder="Find a journey..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <div className="journey-card-grid">
        {visible.map((journey) => (
          <article className="panel journey-card" key={journey.id}>
            <div className={`journey-card-map map-${journey.id}`}>
              <div className="mini-map-line" />
              <span className="mini-node">
                <Route size={18} />
                <small>Route</small>
              </span>
              <span className="mini-node mini-node-active">
                {journey.id === 'signup' ? <UserPlus size={19} /> : <LockKeyhole size={19} />}
                <small>{journey.id === 'signup' ? 'Create account' : 'Check credentials'}</small>
              </span>
              <span className="mini-node">
                <ShieldCheck size={19} />
                <small>{journey.id === 'signup' ? 'Persist' : 'Sign token'}</small>
              </span>
              <div className="map-label">
                <GitBranch size={12} />
                Explained path
              </div>
            </div>
            <div className="journey-card-content">
              <div className="row between">
                <Badge tone="violet">Authentication</Badge>
                {state.completed.includes(journey.id) ? (
                  <span className="completed-label">
                    <CheckCircle2 size={13} />
                    Completed
                  </span>
                ) : (
                  <span className="journey-duration">
                    <Clock3 size={13} />
                    {journey.duration}
                  </span>
                )}
              </div>
              <h2>{journey.title}</h2>
              <p>{journey.description}</p>
              <div className="journey-card-facts">
                <span>{journey.steps.length} steps</span>
                <span>
                  {journey.steps.filter((s) => s.check).length} prediction{' '}
                  {journey.steps.filter((s) => s.check).length === 1 ? 'checkpoint' : 'checkpoints'}
                </span>
                <span>2 scenarios{journey.id === 'signup' ? ' + invalid input' : ''}</span>
              </div>
              <div className="journey-card-actions">
                <Button variant="primary" icon={Play} onClick={() => launch(journey.id)}>
                  {state.completed.includes(journey.id) ? 'Revisit journey' : 'Start journey'}
                  <ArrowRight size={14} />
                </Button>
                <button
                  className="text-link"
                  onClick={() =>
                    launch(journey.id, journey.id === 'signup' ? 'duplicate' : 'invalid')
                  }
                >
                  Explore a failure path
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!visible.length && (
        <div className="panel empty-state">
          <Compass size={29} />
          <strong>
            {filter === 'complete'
              ? 'Your first completed journey is ahead.'
              : 'No journeys match this view.'}
          </strong>
          <p>
            {filter === 'complete'
              ? 'Finish a guided path to see it here.'
              : 'Try another search or view all journeys.'}
          </p>
          <Button
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            View all journeys
          </Button>
        </div>
      )}
      <div className="journey-library-footer">
        <div className="row gap-10">
          <ShieldCheck size={18} className="green-text" />
          <div>
            <strong>Know what the path means.</strong>
            <p>
              An explained path describes possible source behavior. Recorded scenarios require
              actual execution evidence and are unavailable in this prototype.
            </p>
          </div>
        </div>
        <DemoNote>Prepared source, never a fabricated runtime trace</DemoNote>
      </div>
    </>
  );
}

import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { InteractiveBrandMentor } from './InteractiveBrandMentor';
import '../styles/codejourney.css';
export function JourneyConceptLinks({ practice = false }: { practice?: boolean }) {
  return (
    <section className="journey-context-links" aria-label="Related CodeJourney concepts">
      <InteractiveBrandMentor
        compact
        mode={practice ? 'practice' : 'reading'}
        onClick={() => {
          location.hash = '/journeys';
        }}
        message="Explore source-linked journeys"
      />
      <span>
        {practice
          ? 'Review the source behind your changes'
          : 'Follow your repository code step by step'}
      </span>
      <Link to="/journeys">
        Repository journeys
        <ArrowRight size={13} />
      </Link>
    </section>
  );
}

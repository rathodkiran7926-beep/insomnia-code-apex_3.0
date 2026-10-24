import { ArrowRight, BookOpen, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { conceptsNeedingReview, relearningTarget } from '../domain/model';
import { useWorkspace } from '../state/WorkspaceContext';
import { Badge, Button } from './UI';

export function RelearningCard() {
  const { state, setSnapshot, startJourney } = useWorkspace();
  const go = useNavigate();
  const target = relearningTarget(state.studied);
  const affected = conceptsNeedingReview(state.studied, ['signup', 'login'], 'head');
  return (
    <section className="relearn-card" aria-label="Targeted Relearning Card">
      <div className="row gap-8">
        <Sparkles size={18} />
        <span className="tiny-label">TARGETED RELEARNING CARD</span>
      </div>
      <h3>
        {target === 'signup'
          ? 'Account creation has a new verification step.'
          : 'Correct password. One more condition.'}
      </h3>
      <p>
        {target === 'signup'
          ? 'PR #402 creates an unverified account and requests a verification email. Revisit the signup flow you studied and inspect the new source.'
          : 'PR #402 requires a verified email before token signing. Revisit the login guard you studied.'}
      </p>
      <Badge tone={affected.length ? 'amber' : 'violet'}>
        {affected.length
          ? `${affected.length} studied ${affected.length === 1 ? 'concept needs' : 'concepts need'} review`
          : 'Explore the verification update'}
      </Badge>
      <Button
        variant="primary"
        icon={BookOpen}
        onClick={() => {
          setSnapshot('head');
          startJourney(target);
          go('/demo-workspace');
        }}
      >
        Relearn {target}
        <ArrowRight size={14} />
      </Button>
      <small>Based on your locally recorded study revisions.</small>
    </section>
  );
}

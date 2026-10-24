import {
  BookOpen,
  Bug,
  CheckCheck,
  CircleHelp,
  Database,
  Network,
  PencilLine,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
export type MentorMode =
  | 'reading'
  | 'writing'
  | 'thinking'
  | 'debugging'
  | 'review'
  | 'practice'
  | 'database'
  | 'network'
  | 'welcome'
  | 'complete'
  | 'encouraging';
const poses = {
  welcome: {
    src: '/mentor/shishimaru-welcoming.png',
    label: 'Your code companion',
    alt: 'Purple and white mentor waving hello',
  },
  thinking: {
    src: '/mentor/shishimaru-thinking.png',
    label: 'Thinking it through',
    alt: 'Mentor thoughtfully resting a paw on its chin',
  },
  encouraging: {
    src: '/mentor/shishimaru-encouraging.png',
    label: 'Keep exploring',
    alt: 'Mentor raising a paw in encouragement',
  },
  explaining: {
    src: '/mentor/shishimaru-explaining.png',
    label: 'Follow the highlighted source',
    alt: 'Mentor pointing toward the source code',
  },
  questioning: {
    src: '/mentor/shishimaru-curious.png',
    label: 'Let’s take a closer look',
    alt: 'Mentor looking curious and considering a question',
  },
  celebrating: {
    src: '/mentor/shishimaru-celebrating.png',
    label: 'You explored this path',
    alt: 'Mentor celebrating with both paws raised',
  },
};
export function mentorPose(mode: MentorMode) {
  return mode === 'welcome' || mode === 'network'
    ? poses.welcome
    : mode === 'thinking' || mode === 'practice'
      ? poses.thinking
      : mode === 'debugging'
        ? poses.questioning
        : mode === 'review' || mode === 'encouraging'
          ? poses.encouraging
          : mode === 'complete'
            ? poses.celebrating
            : poses.explaining;
}
const icons: Record<MentorMode, LucideIcon> = {
  reading: BookOpen,
  writing: PencilLine,
  thinking: CircleHelp,
  debugging: Bug,
  review: CheckCheck,
  practice: Sparkles,
  database: Database,
  network: Network,
  welcome: Sparkles,
  complete: CheckCheck,
  encouraging: Sparkles,
};
export function InteractiveBrandMentor({
  mode,
  onClick,
  compact = false,
  message,
}: {
  mode: MentorMode;
  onClick?: () => void;
  compact?: boolean;
  message?: string;
}) {
  const Icon = icons[mode],
    pose = mentorPose(mode);
  const content = (
    <>
      <span className="journey-mentor-halo" />
      <img
        key={pose.src}
        src={pose.src}
        alt={pose.alt}
        width="128"
        height="128"
        decoding="async"
        loading={compact ? 'lazy' : 'eager'}
        onError={(e) => {
          if (!e.currentTarget.src.endsWith('/codebase_mentor_logo_transparent.svg'))
            e.currentTarget.src = '/codebase_mentor_logo_transparent.svg';
        }}
      />
      <span className="journey-mentor-mode">
        <Icon size={compact ? 12 : 16} />
      </span>
      {mode === 'thinking' && <span className="journey-mentor-thoughts">•••</span>}
    </>
  );
  const className = `journey-brand-mentor mentor-${mode} ${compact ? 'mentor-compact' : ''}`;
  return onClick ? (
    <button
      type="button"
      className={className}
      aria-label={`${pose.label}. ${message || 'Ask about this event'}`}
      title={message || pose.label}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className} title={message || pose.label}>
      {content}
    </span>
  );
}
export function CodeJourneyMark() {
  return (
    <svg viewBox="0 0 48 48" width="28" height="28" fill="none" aria-hidden="true">
      <path
        d="M8 24h17q5 0 8-7l6-9M25 24q5 0 8 7l6 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="24" r="5" fill="currentColor" />
      <circle cx="25" cy="24" r="5" fill="var(--surface)" stroke="currentColor" strokeWidth="3" />
      <circle cx="39" cy="8" r="4" fill="currentColor" />
      <circle cx="39" cy="40" r="4" fill="currentColor" opacity=".4" />
    </svg>
  );
}

import { Check, FileText, FolderOpen, GitBranch, LoaderCircle, Network } from 'lucide-react';

const stages = [
  {
    title: 'Connect repository',
    description: 'Find the repository and lock in its exact version.',
    active: 'Connecting to your repository',
    detail: 'We’re checking the public repository and resolving your selected revision.',
    start: 0,
    icon: GitBranch,
  },
  {
    title: 'Read source files',
    description: 'Download eligible code without running it.',
    active: 'Reading your source files',
    detail:
      'We’re loading the code and leaving out dependencies, generated files and sensitive paths.',
    start: 15,
    icon: FolderOpen,
  },
  {
    title: 'Map the architecture',
    description: 'Identify routes, components and their connections.',
    active: 'Connecting the pieces',
    detail: 'We’re following imports and function calls to build a source-backed map of your code.',
    start: 60,
    icon: Network,
  },
  {
    title: 'Prepare documentation',
    description: 'Turn extracted evidence into source-linked explanations.',
    active: 'Preparing your documentation',
    detail:
      'We’re organizing component details and checking citations. AI explanations are added when available.',
    start: 85,
    icon: FileText,
  },
];

export function AnalysisProgress({ progress, message }: { progress: number; message: string }) {
  const value = Math.max(0, Math.min(100, progress));
  const index = stages.reduce((current, stage, i) => (value >= stage.start ? i : current), 0);
  const current = stages[index];
  return (
    <section
      className="analysis-progress"
      aria-label="Repository analysis progress"
      aria-busy="true"
    >
      <div className="analysis-progress-top">
        <div className="analysis-scan" aria-hidden="true">
          <span className="analysis-scan-orbit" />
          <div className="analysis-scan-file">
            <Network size={25} />
            <i />
            <i />
            <i />
            <span />
          </div>
          <span className="analysis-scan-dot one" />
          <span className="analysis-scan-dot two" />
          <span className="analysis-scan-dot three" />
        </div>
        <div className="analysis-progress-copy" role="status" aria-live="polite">
          <span className="analysis-kicker">
            <span className="analysis-live-dot" /> ANALYSIS IN PROGRESS
          </span>
          <h2>
            {current.active}
            <span className="analysis-loading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </h2>
          <p>{current.detail}</p>
        </div>
        <div className="analysis-progress-percent">
          <strong>
            {value}
            <span>%</span>
          </strong>
          <small>Step {index + 1} of 4</small>
        </div>
      </div>
      <div
        className="analysis-progress-track"
        role="progressbar"
        aria-label="Analysis completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <span style={{ width: `${value}%` }} />
      </div>
      <ol className="analysis-progress-stages">
        {stages.map((stage, i) => {
          const state = i < index ? 'complete' : i === index ? 'active' : 'pending';
          const Icon = state === 'complete' ? Check : stage.icon;
          return (
            <li
              key={stage.title}
              className={state}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="analysis-stage-icon">
                <Icon size={18} />
                {state === 'active' && (
                  <LoaderCircle className="analysis-stage-spinner" size={30} />
                )}
              </span>
              <div>
                <strong>{stage.title}</strong>
                <p>{stage.description}</p>
                <small>
                  {state === 'complete'
                    ? 'Complete'
                    : state === 'active'
                      ? 'In progress'
                      : 'Up next'}
                </small>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="analysis-progress-footer">
        <span>Your repository code is never executed.</span>
        <details>
          <summary>Technical details</summary>
          <p>{message || 'Waiting for the analysis worker.'}</p>
        </details>
      </div>
    </section>
  );
}

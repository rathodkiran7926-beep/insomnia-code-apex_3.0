import { journeyCompleted, type CodeJourney, type JourneyCheckpoint } from './codeJourney';
const aliases: Record<string, string> = {
  node: 'Node.js',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  express: 'Express',
  expressjs: 'Express',
  'express.js': 'Express',
  react: 'React',
  reactjs: 'React',
  'react.js': 'React',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  http: 'HTTP',
  'http routes': 'HTTP',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  vue: 'Vue',
  vuejs: 'Vue',
  angular: 'Angular',
  api: 'API',
  apis: 'API',
};
export function normalizeSkills(values: string[]): string[] {
  return [
    ...new Map(
      values
        .map((v) => v.trim().replace(/\s+/g, ' '))
        .filter(Boolean)
        .map((v) => {
          const label = aliases[v.toLowerCase()] || v;
          return [label.toLowerCase(), label];
        }),
    ).values(),
  ].slice(0, 30);
}
export function journeySkills(journey: CodeJourney): string[] {
  const labels = [journey.topic, ...(journey.learningSkills || journey.tags)];
  for (const event of journey.events) {
    if (/\.[cm]?tsx?$/i.test(event.source.file)) labels.push('TypeScript');
    else if (/\.[cm]?jsx?$/i.test(event.source.file)) labels.push('JavaScript');
  }
  return normalizeSkills(labels);
}
export function recommendJourneys(
  journeys: CodeJourney[],
  skills: string[],
  progress: Record<string, JourneyCheckpoint>,
  snapshotId: string,
  repository: string,
  goal?: string,
) {
  const selected = normalizeSkills(skills);
  if (!selected.length) return [];
  const covered = new Set<string>();
  return journeys
    .filter((j) => j.snapshotId === snapshotId && j.repository === repository)
    .flatMap((journey) => {
      const metadata = journeySkills(journey);
      const matches = selected.filter((skill) =>
        metadata.some((label) => label.toLowerCase() === skill.toLowerCase()),
      );
      const checkpoint = progress[journey.id];
      const current = checkpoint?.snapshotId === snapshotId ? checkpoint : undefined;
      const completed = journeyCompleted(journey, current);
      const started = !!current && current.visited.length > 0 && !completed;
      // Reviewed learning bridges suggest a next topic without claiming it is a skill the user has.
      const pathLength = Math.max(0, ...journey.scenarios.map((s) => s.path.length));
      const relatedFrom =
        !matches.length && metadata.includes('HTTP') && pathLength > 1
          ? selected.filter((skill) => ['React', 'Vue', 'Angular', 'Next.js'].includes(skill))
          : [];
      if (!matches.length && !relatedFrom.length) return [];
      const relation = matches.length ? 'direct' : 'related';
      const goalMatch =
        goal === 'testing' && metadata.some((t) => /^(testing|tests|test coverage)$/i.test(t));
      const reason = relatedFrom.length
        ? 'Next step from ' +
          relatedFrom.join(', ') +
          ': explore how an HTTP API handles a request. This journey follows repository HTTP code.'
        : started
          ? 'Recommended because you know ' + matches.join(', ') + '. Continue where you left off.'
          : 'Recommended because you know ' + matches.join(', ') + '.';
      return [
        {
          journey,
          matches,
          relatedFrom,
          relation,
          inProgress: started,
          relevantTags: matches.length ? matches : ['HTTP'],
          reason,
          score:
            (started ? 1000 : 0) +
            (matches.length ? 2000 + matches.length * 100 : 40) +
            Math.min(pathLength, 10) * 2 +
            (goalMatch ? 10 : 0) -
            (completed ? 200 : 0),
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.journey.title.localeCompare(b.journey.title))
    .filter((result) => {
      const keys = result.journey.events
        .map((event) => event.key)
        .filter((key) => typeof key === 'string');
      if (!result.inProgress && keys.length && keys.every((key) => covered.has(key))) return false;
      keys.forEach((key) => covered.add(key));
      return true;
    })
    .slice(0, 12);
}

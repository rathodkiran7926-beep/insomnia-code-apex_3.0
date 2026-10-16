import { files, repository, versions } from '../data/fixtures';
import type { Snapshot, SourceRef } from '../data/types';
import { getJourneySteps, resolveSource } from './model';

function environmentNames(snapshot: Snapshot) {
  return files[snapshot]['.env.example'].split('\n').map((line) => line.split('=')[0]);
}

export function setupDelta() {
  const before = new Set(environmentNames('base'));
  return environmentNames('head').filter((name) => !before.has(name));
}

export function buildAgentContext(snapshot: Snapshot, journey: 'signup' | 'login') {
  const steps = getJourneySteps(journey, 'success', snapshot);
  const refs: SourceRef[] = [
    ...steps.map((step) => step.source),
    {
      path: 'src/services/user.service.ts',
      start: journey === 'signup' ? 7 : snapshot === 'head' ? 26 : 25,
      end: journey === 'signup' ? (snapshot === 'head' ? 24 : 23) : snapshot === 'head' ? 35 : 31,
    },
  ];
  const evidence = [
    ...new Map(
      refs.map((source) => [`${source.path}:${source.start}:${source.end}`, source]),
    ).values(),
  ].map((source) => {
    const resolved = resolveSource(snapshot, source);
    if (!resolved) throw new Error(`Unresolvable context citation: ${source.path}`);
    return { source, code: resolved.selected, kind: 'bundled-source' as const };
  });
  return {
    schemaVersion: 1,
    repository: `${repository.owner}/${repository.name}`,
    revision: { snapshot, ...versions[snapshot] },
    task:
      journey === 'signup'
        ? 'Update signup validation while preserving the account lifecycle.'
        : 'Update login while preserving authentication guards.',
    journey,
    steps: steps.map((step) => ({
      title: step.title,
      source: step.source,
      explanation: step.explanation,
    })),
    evidence,
    setup: {
      variables: environmentNames(snapshot),
      addedVariables: snapshot === 'head' ? setupDelta() : [],
      verified: false,
    },
    constraints: [
      'Validate input before the controller and service.',
      'Duplicate email throws before password hashing or account insertion.',
      'Signup returns account information; login signs the session token.',
      ...(snapshot === 'head'
        ? ['Accounts start unverified. Login must check emailVerified before token signing.']
        : []),
      'Recheck the repository revision and source citations before applying a patch.',
    ],
    limitations: [
      'Synthetic bundled repository; revision labels are demo identifiers, not verified upstream commits.',
      'Source ranges are checked against the selected bundled snapshot. API execution, local setup, database writes, and email delivery are not verified.',
      'Manual export for external agents; no live Cursor or Claude Code connection and no guarantee against hallucinations.',
    ],
  };
}

export function formatAgentPrompt(context: ReturnType<typeof buildAgentContext>) {
  return [
    '# Mentor Agent Context Snapshot',
    `Repository: ${context.repository} (synthetic sample)`,
    `Revision: ${context.revision.commit} / ${context.revision.branch}`,
    `Task: ${context.task}`,
    '',
    '## Constraints',
    ...context.constraints.map((item) => `- ${item}`),
    '',
    `Environment variable names: ${context.setup.variables.join(', ')}`,
    `New in this revision: ${context.setup.addedVariables.join(', ') || 'none'}`,
    'Setup has not been executed or verified. No environment values are exported.',
    '',
    '## Source evidence',
    ...context.evidence.map(
      ({ source, code }) =>
        `${source.path}:${source.start}-${source.end}\n\`\`\`ts\n${code}\n\`\`\``,
    ),
    '',
    '## Limits',
    ...context.limitations.map((item) => `- ${item}`),
  ].join('\n');
}

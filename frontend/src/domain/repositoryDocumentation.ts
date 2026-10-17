export type DocumentationScope = 'all' | 'frontend' | 'backend';
export type DocumentationComponent = {
  id: string;
  name: string;
  role: string;
  inferred: boolean;
  evidence: string[];
  referenceId: string;
  inputs?: string[];
  output?: string;
  validation: string;
  fullPaths?: string[];
};
export type DocumentationSnapshot = {
  snapshotId: string;
  repository: string;
  commit: string;
  readmeClaim?: string;
  components: DocumentationComponent[];
  references: {
    id: string;
    snapshotId: string;
    file: string;
    startLine: number;
    endLine: number;
    url: string;
    excerpt: string;
  }[];
  relationships: {
    id: string;
    source: string;
    target: string;
    type: string;
    referenceId: string;
  }[];
  report: {
    languages: string[];
    frameworks: string[];
    limitations: string[];
    unresolved: { kind: string; text: string; reason: string; referenceId: string }[];
  };
  documentation: {
    snapshotId: string;
    ai: {
      message: string;
      explanations: { componentId: string; explanation: string; referenceIds: string[] }[];
    };
  };
};
const backendRoles = new Set([
  'application',
  'router',
  'route',
  'handler',
  'middleware',
  'database_client',
  'database_operation',
]);
export function classifyDocumentation(
  component: DocumentationComponent,
  file: string,
): { scope: Exclude<DocumentationScope, 'all'> | 'unassigned'; evidence: string } {
  if (backendRoles.has(component.role))
    return {
      scope: 'backend',
      evidence: `Source analysis identified a ${component.role.replaceAll('_', ' ')}.`,
    };
  const segments = file.toLowerCase().split('/').slice(0, -1);
  const frontend =
    segments.some((s) => /(?:^|[-_])(frontend|front-end|client|web|ui)(?:$|[-_])/.test(s)) ||
    /\.[jt]sx$/i.test(file);
  const backend = segments.some((s) => /(?:^|[-_])(backend|back-end|server|api)(?:$|[-_])/.test(s));
  if (frontend && !backend)
    return {
      scope: 'frontend',
      evidence:
        'Inferred from a frontend folder name or JSX/TSX file extension; browser behavior has not been verified.',
    };
  if (backend && !frontend)
    return {
      scope: 'backend',
      evidence: 'Inferred from a backend folder name; server behavior has not been verified.',
    };
  return {
    scope: 'unassigned',
    evidence:
      'The available evidence does not determine whether this code belongs to the frontend, backend, or shared utilities.',
  };
}
export function documentationModel(snapshot: DocumentationSnapshot, scope: DocumentationScope) {
  const refs = new Map(
    snapshot.references.filter((r) => r.snapshotId === snapshot.snapshotId).map((r) => [r.id, r]),
  );
  const classified = snapshot.components
    .filter((c) => refs.has(c.referenceId))
    .map((c) => ({
      ...c,
      source: refs.get(c.referenceId),
      classification: classifyDocumentation(c, refs.get(c.referenceId)?.file || ''),
    }));
  const components = classified.filter(
    (c) => c.source && (scope === 'all' || c.classification.scope === scope),
  );
  const ids = new Set(components.map((c) => c.id));
  const relationships = snapshot.relationships.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && refs.has(e.referenceId),
  );
  const files = new Set(components.map((c) => c.source!.file));
  const modules = [
    ...new Set(components.map((c) => c.source!.file.split('/').slice(0, -1).join('/') || '(root)')),
  ].map((folder) => ({
    folder,
    components: components.filter(
      (c) => (c.source!.file.split('/').slice(0, -1).join('/') || '(root)') === folder,
    ),
  }));
  return {
    components,
    relationships,
    refs,
    files,
    modules,
    unresolved: snapshot.report.unresolved.filter(
      (u) => scope === 'all' || files.has(refs.get(u.referenceId)?.file || ''),
    ),
    counts: {
      frontend: classified.filter(
        (c) => c.role !== 'module' && c.classification.scope === 'frontend',
      ).length,
      backend: classified.filter((c) => c.role !== 'module' && c.classification.scope === 'backend')
        .length,
      unassigned: classified.filter(
        (c) => c.role !== 'module' && c.classification.scope === 'unassigned',
      ).length,
    },
  };
}
export const documentationRoleNames: Record<string, string> = {
  module: 'Source file',
  function: 'Function',
  class: 'Class',
  application: 'Express application',
  router: 'Router',
  route: 'HTTP route',
  handler: 'Request handler',
  middleware: 'Middleware',
  service: 'Likely service',
  database_client: 'Database client',
  database_operation: 'Database operation',
};
export function scopedDocumentationMarkdown(
  snapshot: DocumentationSnapshot,
  scope: DocumentationScope,
) {
  const model = documentationModel(snapshot, scope);
  const clean = (text: string) => text.replace(/[\r\n`<>]/g, ' ');
  const ref = (id: string) => {
    const r = model.refs.get(id);
    return r ? `[${r.file}:${r.startLine}-${r.endLine}](${r.url})` : 'Source unavailable';
  };
  const lines = [
    `# ${scope === 'all' ? 'Full repository' : scope === 'frontend' ? 'Frontend' : 'Backend'} guide`,
    '',
    `Repository: ${snapshot.repository}`,
    `Commit: ${snapshot.commit}`,
    `Snapshot: ${snapshot.snapshotId}`,
    '',
    '## Overview',
    `${model.files.size} analyzed source files, ${model.components.filter((c) => c.role !== 'module').length} declarations, ${model.relationships.length} internal source relationships.`,
    'Frontend/backend grouping uses source roles and inferred folder/extension hints; it does not establish runtime behavior. Unassigned/shared code is available in the full repository guide.',
    '',
    '## Architecture',
    '```mermaid',
    'flowchart LR',
  ];
  for (const c of model.components)
    lines.push(`  ${c.id}["${clean(c.name).replace(/["\[\]{}|&]/g, ' ')}"]`);
  for (const e of model.relationships) lines.push(`  ${e.source} -->|${e.type}| ${e.target}`);
  lines.push('```', '', '## Components');
  for (const c of model.components.filter((c) => c.role !== 'module')) {
    lines.push(
      '',
      `### ${clean(c.name)}`,
      `${documentationRoleNames[c.role] || c.role}${c.inferred ? ' (inferred)' : ''}. ${ref(c.referenceId)}`,
      c.classification.evidence,
      c.evidence.join('. ') ||
        'A declaration extracted from the source; its business purpose is not established.',
      `Inputs: ${clean(c.inputs?.join(', ') || 'Not determined')}`,
      `Output: ${clean(c.output || 'Not determined')}`,
      c.validation,
    );
    for (const e of model.relationships.filter((e) => e.source === c.id || e.target === c.id))
      lines.push(
        `- ${clean(snapshot.components.find((x) => x.id === e.source)?.name || e.source)} → ${e.type} → ${clean(snapshot.components.find((x) => x.id === e.target)?.name || e.target)} ${ref(e.referenceId)}`,
      );
    const ai =
      snapshot.documentation.snapshotId === snapshot.snapshotId
        ? snapshot.documentation.ai.explanations.find((e) => e.componentId === c.id)
        : undefined;
    if (ai && ai.referenceIds.every((id) => model.refs.has(id)))
      lines.push(
        `Inferred AI explanation (not correctness-verified): ${ai.explanation}`,
        ...ai.referenceIds.map(ref),
      );
  }
  lines.push(
    '',
    '## Limitations',
    ...snapshot.report.limitations.map((p) => `- ${p}`),
    '',
    '## Unresolved items',
    ...model.unresolved.map((u) => `- ${clean(u.text)}: ${u.reason}. ${ref(u.referenceId)}`),
    '',
    snapshot.documentation.ai.message,
  );
  return lines.join('\n');
}

import { describe, expect, it } from 'vitest';
import {
  classifyDocumentation,
  documentationModel,
  scopedDocumentationMarkdown,
} from './repositoryDocumentation';
import type { DocumentationSnapshot } from './repositoryDocumentation';

const component = (id: string, role: string, name: string) => ({
  id,
  role,
  name,
  referenceId: `ref-${id}`,
  inferred: false,
  evidence: [],
  validation: 'No error-handling syntax identified.',
});
const snapshot: DocumentationSnapshot = {
  snapshotId: 'snapshot-1',
  repository: 'https://github.com/example/project',
  commit: 'a'.repeat(40),
  components: [
    component('ui', 'function', 'Dashboard'),
    component('api', 'handler', 'listOrders'),
    component('shared', 'function', 'formatDate'),
  ],
  references: [
    ['ui', 'client/src/Dashboard.tsx'],
    ['api', 'server/routes.ts'],
    ['shared', 'shared/date.ts'],
  ].map(([id, file]) => ({
    id: `ref-${id}`,
    snapshotId: 'snapshot-1',
    file,
    startLine: 3,
    endLine: 8,
    url: `https://github.com/example/project/blob/${'a'.repeat(40)}/${file}#L3-L8`,
    excerpt: '',
  })),
  relationships: [
    { id: 'edge1', source: 'ui', target: 'shared', type: 'calls', referenceId: 'ref-ui' },
  ],
  report: {
    languages: ['TypeScript'],
    frameworks: ['Express'],
    limitations: ['Static source analysis.'],
    unresolved: [
      { kind: 'call', text: 'dynamicCall', referenceId: 'ref-ui', reason: 'Unresolved' },
    ],
  },
  documentation: {
    snapshotId: 'snapshot-1',
    ai: { message: 'AI explanations unavailable.', explanations: [] },
  },
};
describe('source-grounded documentation focus', () => {
  it('groups frontend/backend using explicit evidence and leaves shared code unassigned', () => {
    expect(documentationModel(snapshot, 'frontend').components.map((c) => c.name)).toEqual([
      'Dashboard',
    ]);
    expect(documentationModel(snapshot, 'backend').components.map((c) => c.name)).toEqual([
      'listOrders',
    ]);
    expect(documentationModel(snapshot, 'all').counts.unassigned).toBe(1);
    expect(
      classifyDocumentation(snapshot.components[0], 'Khanaval_client/src/Dashboard.tsx').scope,
    ).toBe('frontend');
    expect(classifyDocumentation(snapshot.components[2], 'client/server/ambiguous.ts').scope).toBe(
      'unassigned',
    );
  });
  it('does not include cross-scope edges or unresolved calls as internal facts', () => {
    expect(documentationModel(snapshot, 'frontend').relationships).toHaveLength(0);
    expect(documentationModel(snapshot, 'backend').unresolved).toHaveLength(0);
    expect(documentationModel(snapshot, 'all').relationships).toHaveLength(1);
  });
  it('exports only the selected components with exact commit citations and matching Mermaid', () => {
    const md = scopedDocumentationMarkdown(snapshot, 'backend');
    expect(md).toContain('listOrders');
    expect(md).not.toContain('Dashboard');
    expect(md).not.toContain('formatDate');
    expect(md).toContain(snapshot.commit);
    expect(md).toContain(snapshot.snapshotId);
    expect(md).toContain(snapshot.references[1].url);
    expect(md).toContain('```mermaid');
    expect(md).not.toContain('edge1');
  });
  it('does not render components with cross-snapshot source references', () => {
    const other = {
      ...snapshot,
      references: snapshot.references.map((r) => ({ ...r, snapshotId: 'other' })),
    };
    expect(documentationModel(other, 'all').components).toHaveLength(0);
    expect(scopedDocumentationMarkdown(other, 'all')).not.toContain('### Dashboard');
  });
  it('does not include AI commentary from a different snapshot', () => {
    const other = {
      ...snapshot,
      documentation: {
        ...snapshot.documentation,
        snapshotId: 'other',
        ai: {
          ...snapshot.documentation.ai,
          explanations: [
            { componentId: 'ui', explanation: 'Unrelated explanation', referenceIds: ['ref-ui'] },
          ],
        },
      },
    };
    expect(scopedDocumentationMarkdown(other, 'frontend')).not.toContain('Unrelated explanation');
  });
});

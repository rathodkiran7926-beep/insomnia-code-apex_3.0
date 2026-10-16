import { describe, expect, it } from 'vitest';
import { buildAgentContext, formatAgentPrompt, setupDelta } from './agentContext';
import { files, versions } from '../data/fixtures';
import { resolveSource } from './model';

describe('revision-bound agent context', () => {
  it('exports exact source slices from the selected snapshot', () => {
    for (const snapshot of ['base', 'head'] as const) {
      const context = buildAgentContext(snapshot, 'signup');
      expect(context.revision.commit).toBe(versions[snapshot].commit);
      for (const item of context.evidence)
        expect(item.code).toBe(resolveSource(snapshot, item.source)?.selected);
    }
  });
  it('keeps verification and new environment variables out of base exports', () => {
    const base = buildAgentContext('base', 'signup');
    const head = buildAgentContext('head', 'signup');
    expect(base.evidence.some((item) => item.code.includes('verification.send'))).toBe(false);
    expect(head.evidence.some((item) => item.code.includes('verification.send'))).toBe(true);
    expect(base.setup.variables).not.toContain('MAIL_PROVIDER');
    expect(head.setup.variables).toContain('MAIL_PROVIDER');
    expect(setupDelta()).toEqual(['MAIL_PROVIDER', 'MAIL_FROM']);
  });
  it('exports environment names, never template values or learner data', () => {
    const context = buildAgentContext('head', 'login');
    const json = JSON.stringify(context);
    expect(json).not.toContain('local-demo-secret');
    expect(json).not.toContain('predictions');
    expect(json).not.toContain(files.head['.env.example']);
    expect(context.limitations.join(' ')).toMatch(/synthetic/i);
    expect(formatAgentPrompt(context)).toContain(versions.head.commit);
    expect(formatAgentPrompt(context)).toContain('MAIL_FROM');
  });
});

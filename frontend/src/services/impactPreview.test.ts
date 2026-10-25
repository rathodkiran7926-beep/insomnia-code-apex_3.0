import { beforeEach, expect, it, vi } from 'vitest';
import { analysisApi } from './analysisApi';
import { analyzeImpactCodeChange } from './impactPreview';

vi.mock('./analysisApi', () => ({ analysisApi: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

it('sends a scenario with unchanged code and preserves the abort signal', async () => {
  const result = {
    snapshotId: 'snapshot',
    selectedComponentId: 'component',
    scenario: 'behavior-change',
  };
  vi.mocked(analysisApi).mockResolvedValue(result);
  const controller = new AbortController();
  await expect(
    analyzeImpactCodeChange(
      'snapshot',
      'component',
      'behavior-change',
      'return true;',
      controller.signal,
      'What if the caller times out?',
    ),
  ).resolves.toEqual(result);
  const options = vi.mocked(analysisApi).mock.calls[0][1]!;
  expect(JSON.parse(options.body as string)).toEqual({
    scenario: 'behavior-change',
    proposedCode: 'return true;',
    question: 'What if the caller times out?',
  });
  expect(options.signal).toBe(controller.signal);
});

it('rejects a scenario response for another snapshot', async () => {
  vi.mocked(analysisApi).mockResolvedValue({
    snapshotId: 'other',
    selectedComponentId: 'component',
    scenario: 'behavior-change',
  });
  await expect(
    analyzeImpactCodeChange(
      'snapshot',
      'component',
      'behavior-change',
      'return true;',
      new AbortController().signal,
    ),
  ).rejects.toThrow('snapshot, component, or scenario mismatch');
});

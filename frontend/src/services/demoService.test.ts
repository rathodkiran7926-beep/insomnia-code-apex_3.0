import { describe, expect, it } from 'vitest';
import { initialPractice, solutionPractice } from '../data/fixtures';
import { demoService } from './demoService';

describe('practice verifies behavior', () => {
  it('accepts an equivalent digit rule with a different message', async () => {
    const alternative = solutionPractice
      .replace('/[0-9]/', '/\\d/')
      .replace('Include a number', 'Add a digit');
    expect(await demoService.checkPractice(alternative)).toBe('solution');
  });
  it('fails a digit rule that accidentally removes the length requirement', async () => {
    expect(await demoService.checkPractice(solutionPractice.replace('.min(8)', ''))).toBe(
      'baseline',
    );
  });
  it('runs the original failing baseline and the guided passing schema', async () => {
    expect(await demoService.checkPractice(initialPractice)).toBe('baseline');
    expect(await demoService.checkPractice(solutionPractice)).toBe('solution');
  });
  it('rejects arbitrary executable code instead of evaluating it', async () => {
    expect(
      await demoService.checkPractice(`${solutionPractice}\nfetch('https://example.com')`),
    ).toBe('unsupported');
  });
});

import { initialPractice, solutionPractice } from '../data/fixtures';

export interface MentorService {
  connectRepository(name: string): Promise<{ repository: string }>;
  checkPractice(code: string): Promise<'baseline' | 'solution' | 'unsupported'>;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value: string) => value.replace(/\/\/[^\n]*/g, '').replace(/\s/g, '');

// All responses are prepared fixtures. Replace this adapter with authenticated API calls.
export const demoService: MentorService = {
  async connectRepository(name) {
    await wait(850);
    if (
      !['acme/relay-api', 'https://github.com/acme/relay-api'].includes(
        name.trim().replace(/\/$/, ''),
      )
    )
      throw new Error(
        'Only acme/relay-api is included in this demo. Select the sample repository to continue.',
      );
    return { repository: 'acme/relay-api' };
  },
  async checkPractice(code) {
    await wait(900);
    if (normalize(code) === normalize(solutionPractice)) return 'solution';
    if (normalize(code) === normalize(initialPractice)) return 'baseline';
    return 'unsupported';
  },
};

import { runPracticeChecks } from '../domain/practice';

export interface MentorService {
  connectRepository(name: string): Promise<{ repository: string }>;
  checkPractice(code: string): Promise<'baseline' | 'solution' | 'unsupported'>;
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Repository connection is simulated. Practice runs local schema assertions.
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
    return runPracticeChecks(code).status;
  },
};

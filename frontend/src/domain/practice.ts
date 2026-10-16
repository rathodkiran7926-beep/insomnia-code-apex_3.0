import { z } from 'zod';

export interface PracticeCheck {
  title: string;
  detail: string;
  passed: boolean;
}

// Parse the exercise's small schema language; never evaluate editor JavaScript.
// Each supported rule constructs a real Zod validator used by the assertions below.
function passwordSchema(code: string) {
  if (code.length > 6000) return null;
  const source = code.replace(/\/\/[^\n]*/g, '').trim();
  const schema = source.match(
    /^const\s+signupSchema\s*=\s*z\.object\s*\(\s*\{\s*email\s*:\s*z\.string\s*\(\s*\)\s*\.email\s*\(\s*\)\s*,\s*name\s*:\s*z\.string\s*\(\s*\)\s*\.min\s*\(\s*1\s*\)\s*,\s*password\s*:\s*z\.string\s*\(\s*\)([\s\S]*?)\s*,?\s*\}\s*\)\s*;?$/,
  );
  if (!schema) return null;
  let rest = schema[1].trim();
  let password = z.string();
  let rules = 0;
  while (rest && rules++ < 8) {
    const minimum = rest.match(/^\.min\s*\(\s*(\d{1,3})\s*(?:,\s*(?:'[^'\n]*'|"[^"\n]*"))?\s*\)/);
    if (minimum) {
      password = password.min(Number(minimum[1]));
      rest = rest.slice(minimum[0].length).trim();
      continue;
    }
    const digit = rest.match(
      /^\.regex\s*\(\s*\/(\[0-9\]|\\d)\/\s*(?:,\s*(?:'[^'\n]*'|"[^"\n]*"))?\s*\)/,
    );
    if (!digit) return null;
    password = password.regex(new RegExp(digit[1]));
    rest = rest.slice(digit[0].length).trim();
  }
  return rest ? null : password;
}

export function runPracticeChecks(code: string): {
  status: 'baseline' | 'solution' | 'unsupported';
  checks: PracticeCheck[];
} {
  const password = passwordSchema(code);
  if (!password) return { status: 'unsupported', checks: [] };
  const accepts = (value: string) => password.safeParse(value).success;
  const checks = [
    {
      title: 'Reject a letters-only password',
      detail: 'abcdefgh and a longer letters-only password must be rejected',
      passed: ['abcdefgh', 'abcdefghijklmnop'].every((value) => !accepts(value)),
    },
    {
      title: 'Accept a mixed password',
      detail: 'abcdefg1, 1abcdefg, and abc1defg must all be accepted',
      passed: ['abcdefg1', '1abcdefg', 'abc1defg', 'longerPassword123'].every(accepts),
    },
    {
      title: 'Keep the eight-character boundary',
      detail: 'abc1 and abcdef1 must be rejected; abcdefg1 must pass',
      passed: ['abc1', 'abcdef1', ''].every((value) => !accepts(value)) && accepts('abcdefg1'),
    },
  ];
  return { status: checks.every((check) => check.passed) ? 'solution' : 'baseline', checks };
}

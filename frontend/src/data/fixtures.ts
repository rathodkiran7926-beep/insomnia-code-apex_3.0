import type { GraphNode, GraphRelation, Journey, PullRequest, Snapshot } from './types';

export const repository = {
  name: 'relay-api',
  owner: 'acme',
  description: 'A small API. A clear path to understanding.',
  language: 'TypeScript',
  framework: 'Express',
  license: 'MIT · sample fixture',
};
export const versions = {
  base: { branch: 'main', commit: '7e2a9c1', label: 'Before email verification' },
  head: {
    branch: 'feat/email-verification',
    commit: 'b84f3d2',
    label: 'Email verification preview',
  },
} satisfies Record<Snapshot, { branch: string; commit: string; label: string }>;

const serviceBase = `import { hash, compare } from '../lib/password';
import { users } from '../repositories/user.repository';
import { tokens } from './token.service';
import { ConflictError, UnauthorizedError } from '../errors';

export const userService = {
  async signup(input: SignupInput) {
    // Check before creating a new account.
    const existing = await users.findByEmail(input.email);

    if (existing) {
      throw new ConflictError('Email already in use');
    }

    const passwordHash = await hash(input.password);
    const user = await users.create({
      email: input.email,
      name: input.name,
      passwordHash,
    });

    return { id: user.id, email: user.email };
  },

  async login(input: LoginInput) {
    const user = await users.findByEmail(input.email);
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid credentials');
    }
    return tokens.sign({ sub: user.id });
  },
};

type SignupInput = { email: string; name: string; password: string };
type LoginInput = { email: string; password: string };`;
const serviceHead = `import { hash, compare } from '../lib/password';
import { users } from '../repositories/user.repository';
import { tokens } from './token.service';
import { ConflictError, UnauthorizedError } from '../errors';
import { verification } from './verification.service';

export const userService = {
  async signup(input: SignupInput) {
    const existing = await users.findByEmail(input.email);

    if (existing) {
      throw new ConflictError('Email already in use');
    }

    const passwordHash = await hash(input.password);
    const user = await users.create({
      email: input.email,
      name: input.name,
      passwordHash,
      emailVerified: false,
    });
    await verification.send(user);
    return { id: user.id, email: user.email, status: 'pending' };
  },

  async login(input: LoginInput) {
    const user = await users.findByEmail(input.email);
    if (!user || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!user.emailVerified) {
      throw new UnauthorizedError('Verify your email first');
    }
    return tokens.sign({ sub: user.id });
  },
};

type SignupInput = { email: string; name: string; password: string };
type LoginInput = { email: string; password: string };`;

const sharedFiles: Record<string, string> = {
  'src/routes/auth.routes.ts': `import { Router } from 'express';
import { validateSignup, validateLogin } from '../middleware/validate';
import { authController } from '../controllers/auth.controller';

export const authRouter = Router();

// Middleware order is part of the request contract.
authRouter.post('/signup', validateSignup, authController.signup);
authRouter.post('/login', validateLogin, authController.login);

// Mounted at /api/auth in the application entry point.
export default authRouter;`,
  'src/middleware/validate.ts': `import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});

export function validateSignup(req: Request, res: Response, next: NextFunction) {
  const result = signupSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid signup data' });
  }
  req.body = result.data;
  next();
}

export function validateLogin(req: Request, res: Response, next: NextFunction) {
  const result = signupSchema.pick({ email: true, password: true }).safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: 'Invalid credentials' });
  req.body = result.data;
  next();
}`,
  'src/controllers/auth.controller.ts': `import { userService } from '../services/user.service';
import type { Request, Response, NextFunction } from 'express';

export const authController = {
  async signup(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userService.signup(req.body);
      return res.status(201).json(user);
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const token = await userService.login(req.body);
      return res.status(200).json({ token });
    } catch (error) {
      next(error);
    }
  },
};`,
  'src/repositories/user.repository.ts': `import { db } from '../lib/database';

export const users = {
  findByEmail(email: string) {
    return db.user.findUnique({ where: { email } });
  },

  create(data: CreateUserInput) {
    return db.user.create({ data });
  },
};

type CreateUserInput = {
  email: string;
  name: string;
  passwordHash: string;
  emailVerified?: boolean;
};`,
  'src/lib/database.ts': `import { PrismaClient } from '@prisma/client';

// Shared database access for the sample API.
export const db = new PrismaClient();

// External boundary: a connection is configured here.
// This frontend demo does not connect to PostgreSQL.`,
  'src/services/token.service.ts': `import jwt from 'jsonwebtoken';
import { config } from '../config';

export const tokens = {
  sign(payload: { sub: string }) {
    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: '24h',
    });
  },
};`,
  'tests/auth.test.ts': `describe('signup', () => {
  it('creates an account for valid input', async () => {
    const response = await request.post('/api/auth/signup').send(validUser);
    expect(response.status).toBe(201);
  });

  it('rejects an existing email', async () => {
    await seedUser(validUser);
    const response = await request.post('/api/auth/signup').send(validUser);
    expect(response.status).toBe(409);
    expect(await countUsers()).toBe(1);
  });

  it('rejects passwords shorter than eight characters', async () => {
    const response = await request.post('/api/auth/signup').send({ ...validUser, password: 'short' });
    expect(response.status).toBe(400);
  });
});`,
};

export const files: Record<Snapshot, Record<string, string>> = {
  base: {
    ...sharedFiles,
    'src/services/user.service.ts': serviceBase,
    '.env.example': 'DATABASE_URL=postgresql://localhost:5432/relay\nJWT_SECRET=local-demo-secret',
    'package.json':
      '{\n  "name": "relay-api",\n  "engines": { "node": ">=22" },\n  "scripts": { "dev": "tsx watch src/index.ts", "test": "vitest" }\n}',
  },
  head: {
    ...sharedFiles,
    'src/services/user.service.ts': serviceHead,
    '.env.example':
      'DATABASE_URL=postgresql://localhost:5432/relay\nJWT_SECRET=local-demo-secret\nMAIL_PROVIDER=local\nMAIL_FROM=hello@relay.example',
    'src/services/verification.service.ts': `import { mailer } from '../lib/mailer';
import { config } from '../config';

export const verification = {
  async send(user: { id: string; email: string }) {
    const link = createVerificationLink(user.id);
    await mailer.send({
      from: config.mailFrom,
      to: user.email,
      subject: 'Verify your email',
      text: link,
    });
  },
};

// Provider delivery is outside the reviewed source path.
declare function createVerificationLink(id: string): string;`,
    'package.json':
      '{\n  "name": "relay-api",\n  "engines": { "node": ">=22" },\n  "scripts": { "dev": "tsx watch src/index.ts", "test": "vitest" }\n}',
  },
};

export const graphNodes: GraphNode[] = [
  {
    id: 'client',
    label: 'Web client',
    subtitle: 'HTTP requests',
    category: 'interface',
    icon: 'globe',
    position: { x: 0, y: 0 },
    description:
      'The caller sends a request to the authentication API. The client is a conceptual external boundary.',
    technical:
      'Conceptual client. No client source or browser execution is included in this fixture.',
  },
  {
    id: 'router',
    label: 'Auth router',
    subtitle: 'auth.routes.ts',
    category: 'interface',
    icon: 'route',
    position: { x: 280, y: 0 },
    source: { path: 'src/routes/auth.routes.ts', start: 5, end: 9 },
    description:
      'The front door for signup and login. Each route runs validation before handing the request to its controller.',
    technical:
      'Express registers POST /signup and POST /login. Middleware order is explicit in authRouter.post(). The /api/auth mount is described by a fixture comment.',
  },
  {
    id: 'validation',
    label: 'Input validation',
    subtitle: 'validate.ts',
    category: 'interface',
    icon: 'shield',
    position: { x: 560, y: 0 },
    source: { path: 'src/middleware/validate.ts', start: 4, end: 16 },
    description:
      'Checks incoming data before it reaches the service. An invalid email or short password returns a 400 response.',
    technical:
      'signupSchema.safeParse() checks the request body. The unsuccessful branch returns before next(), stopping this route chain.',
  },
  {
    id: 'tokens',
    label: 'Token service',
    subtitle: 'token.service.ts',
    category: 'service',
    icon: 'key',
    position: { x: 0, y: 120 },
    source: { path: 'src/services/token.service.ts', start: 4, end: 9 },
    description: 'Creates a signed token after the login service accepts the credentials.',
    technical:
      'tokens.sign() delegates signing to jsonwebtoken. Cryptographic execution and secret configuration are outside this frontend demo.',
  },
  {
    id: 'user-service',
    label: 'User service',
    subtitle: 'user.service.ts',
    category: 'service',
    icon: 'layers',
    position: { x: 280, y: 120 },
    source: { path: 'src/services/user.service.ts', start: 7, end: 22 },
    description:
      'The heart of authentication. It checks for an existing account, protects the password, and asks the repository to create a user.',
    technical:
      'userService.signup() awaits users.findByEmail(), throws ConflictError on a duplicate, awaits hash(), and delegates the insert to users.create(). This is source-defined behavior, not a recorded execution.',
  },
  {
    id: 'email',
    label: 'Email provider',
    subtitle: 'External boundary',
    category: 'external',
    icon: 'mail',
    position: { x: 560, y: 120 },
    description:
      'Email delivery is introduced by the prepared verification PR. Delivery behavior is not verified in this frontend.',
    technical:
      'The base version has no email call. In the head version verification.send() delegates to a mailer boundary; actual delivery remains unresolved.',
  },
  {
    id: 'repository',
    label: 'User repository',
    subtitle: 'user.repository.ts',
    category: 'storage',
    icon: 'box',
    position: { x: 280, y: 240 },
    source: { path: 'src/repositories/user.repository.ts', start: 3, end: 10 },
    description:
      'Keeps database queries in one place. The service uses this module to look up and create accounts.',
    technical:
      'findByEmail() calls db.user.findUnique(); create() calls db.user.create(). A unique database constraint would be needed for concurrent requests; that schema is outside the fixture.',
  },
  {
    id: 'database',
    label: 'PostgreSQL',
    subtitle: 'Prisma · external store',
    category: 'storage',
    icon: 'database',
    position: { x: 560, y: 240 },
    source: { path: 'src/lib/database.ts', start: 1, end: 7 },
    description:
      'The configured data store behind Prisma. This diagram shows the access boundary; no database is running in the demo.',
    technical:
      'PrismaClient is instantiated in the fixture. Query execution, schema constraints and live connection status are not established here.',
  },
];

export const graphRelations: GraphRelation[] = [
  {
    id: 'client-router',
    from: 'client',
    to: 'router',
    label: 'HTTP',
    kind: 'Conceptual request',
    status: 'inferred',
  },
  {
    id: 'router-validation',
    from: 'router',
    to: 'validation',
    label: 'validates',
    kind: 'Route registration',
    status: 'supported',
    source: { path: 'src/routes/auth.routes.ts', start: 8, end: 9 },
  },
  {
    id: 'validation-service',
    from: 'validation',
    to: 'user-service',
    label: 'via controller',
    kind: 'Controller delegation',
    status: 'supported',
    source: { path: 'src/controllers/auth.controller.ts', start: 5, end: 8 },
  },
  {
    id: 'service-token',
    from: 'user-service',
    to: 'tokens',
    label: 'signs token',
    kind: 'Resolved call',
    status: 'supported',
    source: { path: 'src/services/user.service.ts', start: 25, end: 30 },
  },
  {
    id: 'service-repo',
    from: 'user-service',
    to: 'repository',
    label: 'finds / creates',
    kind: 'Resolved calls',
    status: 'supported',
    source: { path: 'src/services/user.service.ts', start: 9, end: 20 },
  },
  {
    id: 'repo-db',
    from: 'repository',
    to: 'database',
    label: 'queries',
    kind: 'Data access',
    status: 'supported',
    source: { path: 'src/repositories/user.repository.ts', start: 3, end: 10 },
  },
  {
    id: 'service-email',
    from: 'user-service',
    to: 'email',
    label: 'delivery unresolved',
    kind: 'External integration',
    status: 'unresolved',
    headOnly: true,
    source: { path: 'src/services/verification.service.ts', start: 5, end: 12 },
  },
];

const duplicateCheck = {
  question: 'If the email already exists, will this request create a user?',
  options: [
    { id: 'continue', text: 'Yes, the insert still happens' },
    { id: 'stop', text: 'No, the error stops this path' },
  ],
  correct: 'stop',
  explanation:
    'The existing-email condition throws before users.create(). The lookup reaches the database, but the insert does not. A database query and an insert are different effects.',
};

export const journeys: Journey[] = [
  {
    id: 'signup',
    title: 'What happens when a user signs up?',
    description:
      'Follow a request from its first route to a new account. Understand the decisions along the way.',
    duration: '8 min',
    tags: ['Authentication', '6 steps', '1 prediction'],
    steps: [
      {
        id: 'route',
        nodeId: 'router',
        title: 'A request finds its route',
        short: 'Receive request',
        explanation:
          'A POST request to the signup endpoint enters the auth router. Validation is registered before the controller, so incoming data is checked first.',
        technical:
          'authRouter.post() registers validateSignup followed by authController.signup. These are ordered route handlers, not an observed trace.',
        source: { path: 'src/routes/auth.routes.ts', start: 5, end: 9 },
      },
      {
        id: 'validate',
        nodeId: 'validation',
        title: 'Only valid input moves forward',
        short: 'Validate input',
        explanation:
          'The schema checks email, name, and password. Invalid input returns a 400 response before next() can move to the controller.',
        technical:
          'safeParse() returns a discriminated result. On failure validateSignup returns res.status(400). The successful result replaces req.body before next().',
        source: { path: 'src/middleware/validate.ts', start: 10, end: 16 },
        check: {
          question: 'Can an invalid email reach the signup service on this route?',
          options: [
            { id: 'yes', text: 'Yes, validation only adds a warning' },
            { id: 'no', text: 'No, the handler returns before next()' },
          ],
          correct: 'no',
          explanation:
            'The failed safeParse branch returns the 400 response. It never calls next(), so this request does not reach the controller or service.',
        },
      },
      {
        id: 'controller',
        nodeId: 'user-service',
        title: 'The controller hands off responsibility',
        short: 'Call the service',
        explanation:
          'The controller sends the validated body to userService.signup(). It handles HTTP responses while the service handles account rules.',
        technical:
          'The controller awaits userService.signup(req.body), returns 201 on success, and forwards exceptions to Express through next(error).',
        source: { path: 'src/controllers/auth.controller.ts', start: 5, end: 10 },
      },
      {
        id: 'duplicate',
        nodeId: 'user-service',
        title: 'Does this account already exist?',
        short: 'Check existing email',
        explanation:
          'Before creating an account, the service looks up the email. An existing account throws a conflict error and stops this signup path.',
        technical:
          'users.findByEmail(input.email) is awaited. if (existing) throws ConflictError before hash() or users.create(). This sequential order is visible in the source.',
        source: { path: 'src/services/user.service.ts', start: 7, end: 13 },
        check: duplicateCheck,
      },
      {
        id: 'password',
        nodeId: 'user-service',
        title: 'Protect the password',
        short: 'Hash the password',
        explanation:
          'For a new email, the service hashes the password before storing anything. The plain password is not passed to users.create().',
        technical:
          'await hash(input.password) returns passwordHash, which is passed to users.create(). The hashing implementation is outside this sample source boundary.',
        source: { path: 'src/services/user.service.ts', start: 15, end: 20 },
      },
      {
        id: 'persist',
        nodeId: 'repository',
        title: 'Create the account',
        short: 'Save the account',
        explanation:
          'The repository asks Prisma to create the user. The service returns a public account shape. No password hash is included in that response.',
        technical:
          'users.create(data) returns db.user.create({ data }). In the base snapshot signup projects id and email. Database effects are source-described, not executed in this demo.',
        source: { path: 'src/repositories/user.repository.ts', start: 3, end: 10 },
      },
    ],
  },
  {
    id: 'login',
    title: 'How does a login become a session?',
    description: 'Trace credential checks and find the exact condition that protects access.',
    duration: '6 min',
    tags: ['Authentication', '4 steps', '1 prediction'],
    steps: [
      {
        id: 'login-route',
        nodeId: 'router',
        title: 'Find the login route',
        short: 'Receive credentials',
        explanation: 'Login enters its own route, with validateLogin before the controller.',
        technical:
          'authRouter.post("/login", validateLogin, authController.login) declares the route chain.',
        source: { path: 'src/routes/auth.routes.ts', start: 5, end: 9 },
      },
      {
        id: 'login-validate',
        nodeId: 'validation',
        title: 'Validate credential shape',
        short: 'Validate input',
        explanation:
          'The login schema needs a valid email and a password with at least eight characters.',
        technical:
          'signupSchema.pick() reuses the email and password validation. An unsuccessful parse returns 400 before next().',
        source: { path: 'src/middleware/validate.ts', start: 19, end: 24 },
      },
      {
        id: 'login-check',
        nodeId: 'user-service',
        title: 'Check the account and password',
        short: 'Check credentials',
        explanation:
          'The service looks up the account and compares the supplied password. Invalid credentials throw before token creation.',
        technical:
          'A missing user short-circuits the OR condition; otherwise compare() is awaited. Both failure paths throw UnauthorizedError.',
        source: { path: 'src/services/user.service.ts', start: 25, end: 30 },
        check: {
          question: 'Does a missing account reach token signing?',
          options: [
            { id: 'yes', text: 'Yes, with an anonymous token' },
            { id: 'no', text: 'No, the service throws first' },
          ],
          correct: 'no',
          explanation:
            'The missing user satisfies !user, triggering UnauthorizedError before tokens.sign(). No anonymous token is created.',
        },
      },
      {
        id: 'login-token',
        nodeId: 'tokens',
        title: 'Sign a session token',
        short: 'Create token',
        explanation:
          'Accepted credentials allow the service to sign a token containing the account identity.',
        technical:
          'tokens.sign({ sub: user.id }) signs a JWT with a 24-hour expiry. In the prepared PR, email verification becomes an additional prerequisite.',
        source: { path: 'src/services/token.service.ts', start: 4, end: 9 },
      },
    ],
  },
];

export const pullRequests: PullRequest[] = [
  {
    id: 'verification',
    number: 42,
    title: 'Require email verification for new accounts',
    branch: 'feat/email-verification',
    description:
      'Accounts start pending, a verification message is requested, and login checks the verified state.',
    concepts: ['signup', 'login', 'setup'],
    files: [
      { path: 'src/services/user.service.ts', additions: 8, deletions: 2 },
      { path: 'src/services/verification.service.ts', additions: 17, deletions: 0 },
      { path: '.env.example', additions: 2, deletions: 0 },
    ],
  },
  {
    id: 'validation',
    number: 39,
    title: 'Add focused authentication regression tests',
    branch: 'test/auth-contract',
    description:
      'A prepared test-only proposal covering duplicate emails, invalid passwords, and account creation. It does not change runtime behavior.',
    concepts: ['testing'],
    files: [{ path: 'tests/auth.test.ts', additions: 18, deletions: 0 }],
  },
];

export const initialPractice = `// Extend the existing signup schema.
// Passwords must contain at least one number.
const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
});`;
export const solutionPractice = `// Extend the existing signup schema.
// Passwords must contain at least one number.
const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8).regex(/[0-9]/, 'Include a number'),
});`;

export const hints = [
  {
    title: 'Find the right layer',
    text: 'This is an input-shape rule. Put it in signupSchema in src/middleware/validate.ts, so invalid data stops before the service.',
  },
  {
    title: 'Keep the existing requirement',
    text: 'Keep min(8). Add a regular-expression check that requires at least one digit, for example [0-9] or \\d.',
  },
  {
    title: 'A small example',
    text: "Chain .regex(/[0-9]/, 'Include a number') after .min(8). Test both letters-only and mixed passwords.",
  },
];

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { repositoryJourney } from "./repositoryJourneys.js";

const signupSource = readFileSync(
  new URL("../journey-runner/signup.ts", import.meta.url),
  "utf8",
);
const step = (key, title, kind, beginner, technical, extra = {}) => ({
  key,
  title,
  kind,
  explanations: {
    beginner,
    intermediate: technical,
    advanced: `${technical} Source evidence establishes this operation, not complete runtime coverage or business intent.`,
  },
  ...extra,
});
const check = (question, yes, no, correct = "yes") => ({
  question,
  options: [
    { id: "yes", text: yes },
    { id: "no", text: no },
  ],
  correct,
});
function make(
  id,
  title,
  description,
  topic,
  source,
  steps,
  scenarios,
  related,
  visualization = "flow",
) {
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const lines = source.split("\n"),
    markers = [...source.matchAll(/\/\/ @event ([\w-]+)/g)].map((m) => ({
      key: m[1],
      line: source.slice(0, m.index).split("\n").length,
    }));
  const snapshotId = `lesson-${sourceHash.slice(0, 24)}`;
  const events = steps.map((s) => {
    const marker = markers.find((m) => m.key === s.key);
    if (!marker) throw new Error(`Missing source marker ${id}:${s.key}`);
    const next = markers.find((m) => m.line > marker.line);
    const startLine = marker.line + 1,
      endLine = Math.max(
        startLine,
        Math.min((next?.line || lines.length + 1) - 1, startLine + 6),
      );
    return {
      ...s,
      id: `${id}:${s.key}`,
      sourceRefId: `${id}:${s.key}`,
      snapshotId,
      observedFields: null,
      observationCoverage: "source-only",
      source: {
        file:
          id === "signup"
            ? "signup.ts"
            : `${id}.tsx`.replace(".tsx", id === "react" ? ".tsx" : ".ts"),
        startLine,
        endLine,
      },
      condition: s.condition || "No branch condition recorded at this event.",
      inputs: "unknown",
      outputs: "unknown",
      stateChange: "unknown",
      sideEffects: ["database_read", "database_write"].includes(s.kind)
        ? "Source includes a database operation; execution is not verified in explained mode."
        : "unknown",
    };
  });
  for (const s of scenarios)
    for (const key of s.path)
      if (!events.some((e) => e.key === key))
        throw new Error(`Invalid scenario event ${key}`);
  return {
    id,
    title,
    description,
    topic,
    difficulty: ["async", "database", "queue", "search"].includes(id)
      ? "intermediate"
      : "beginner",
    minutes: Math.max(4, Math.ceil(events.length / 2)),
    tags: [
      topic,
      "TypeScript",
      ...(id === "signup" || id === "login"
        ? ["Express", "Authentication"]
        : []),
    ],
    source,
    sourceHash,
    snapshotId,
    events,
    scenarios,
    related,
    visualization,
    provenance:
      "Reviewed learning recipe. This is controlled teaching source, not the selected GitHub repository.",
    coverage: [
      "Only explicitly instrumented events are captured by approved runs.",
      "No complete framework trace, event-loop scheduling, async ancestry, network internals or production execution is claimed.",
    ],
  };
}
const signupSteps = [
  step(
    "receive",
    "Receive request",
    "http_request",
    "A request arrives like a visitor at the front desk.",
    "Express invokes the registered POST /signup handler.",
  ),
  step(
    "validate",
    "Validate the email",
    "validation",
    "The front desk checks whether the request has an email address.",
    "The handler computes valid from the type and content of req.body.email.",
    {
      condition:
        "typeof req.body.email === 'string' && req.body.email.includes('@')",
      prediction: check(
        "With no email field, can this request reach the database?",
        "No. It returns a 400 response first.",
        "Yes. Validation only adds a warning.",
      ),
    },
  ),
  step(
    "invalid",
    "Reject invalid input",
    "error",
    "The visitor is asked to fix their form before continuing.",
    "The early return sends HTTP 400. No lookup or write is on this path.",
  ),
  step(
    "lookup",
    "Look up an account",
    "database_read",
    "Check the account register before creating a new entry.",
    "A parameterized SELECT reads the in-memory SQLite users table.",
  ),
  step(
    "duplicate-check",
    "Check for an existing account",
    "branch",
    "An existing account takes the “already registered” exit.",
    "Boolean(existing) controls the conflict branch.",
    {
      condition: "if (existing)",
      prediction: check(
        "When an account already exists, does this code insert another?",
        "No. The handler returns HTTP 409.",
        "Yes. It updates the original account.",
      ),
    },
  ),
  step(
    "duplicate",
    "Return a conflict",
    "error",
    "The register already contains this account.",
    "An early HTTP 409 return prevents insertion.",
  ),
  step(
    "prepare",
    "Prepare the account",
    "function_call",
    "The request has passed the checks and is ready to save.",
    "The explicit prepare event marks the insertion boundary; it does not hash passwords or create a session.",
  ),
  step(
    "write",
    "Insert the account",
    "database_write",
    "Add one entry to the account register.",
    "SQLite INSERT runs synchronously inside try/catch. Captured runs record its changes count.",
  ),
  step(
    "response",
    "Return a created response",
    "response",
    "Send the caller a creation receipt.",
    "The handler returns HTTP 201 with created: true.",
  ),
  step(
    "database-error",
    "Handle a storage failure",
    "error",
    "A failed save gets a failure receipt instead of a success message.",
    "The catch branch returns HTTP 500. The source supports this possible path; it is not instrumented as an approved scenario here.",
  ),
];
const success = {
  id: "success",
  label: "Successful signup",
  assumption:
    "The fixture request has a valid email and the isolated database starts empty.",
  path: [
    "receive",
    "validate",
    "lookup",
    "duplicate-check",
    "prepare",
    "write",
    "response",
  ],
  outcome: "Source supports HTTP 201.",
  runRecipe: "signup-success",
};
const recipes = [
  make(
    "signup",
    "What happens when a user signs up?",
    "Follow validation, uniqueness checks, a real SQLite write and the response boundary.",
    "Backend",
    signupSource,
    signupSteps,
    [
      success,
      {
        id: "invalid",
        label: "Missing / invalid email",
        assumption: "Choose the early-return branch for invalid input.",
        path: ["receive", "validate", "invalid"],
        outcome: "Source supports HTTP 400.",
        failure: true,
        runRecipe: "signup-invalid",
      },
      {
        id: "duplicate",
        label: "Duplicate account",
        assumption:
          "Assume the SELECT finds an existing row; not an observed value.",
        path: ["receive", "validate", "lookup", "duplicate-check", "duplicate"],
        outcome: "Source supports HTTP 409.",
        failure: true,
      },
      {
        id: "database-error",
        label: "Database failure",
        assumption: "Assume INSERT throws; not an observed failure.",
        path: [
          "receive",
          "validate",
          "lookup",
          "duplicate-check",
          "prepare",
          "write",
          "database-error",
        ],
        outcome: "Source supports HTTP 500.",
        failure: true,
      },
    ],
    ["login", "middleware", "database"],
  ),
];

const loginSource = `// Reviewed illustrative adapter contract; not connected to a real identity provider.
export async function login(input, users, passwords, sessions) {
  // @event receive
  const { email, password } = input;
  // @event validate
  if (!email || !password) {
    // @event invalid
    return { status: 400 };
  }
  // @event lookup
  const user = await users.findByEmail(email);
  // @event account-check
  if (!user) {
    // @event unknown-user
    return { status: 401 };
  }
  // @event password
  const matches = await passwords.verify(password, user.passwordHash);
  // @event credentials-check
  if (!matches) {
    // @event wrong-password
    return { status: 401 };
  }
  // @event session
  const session = await sessions.create(user.id);
  // @event response
  return { status: 200, sessionId: session.id };
}`;
recipes.push(
  make(
    "login",
    "How does a login become a session?",
    "Read validation, account lookup, password verification and a server-side session boundary.",
    "Backend",
    loginSource,
    [
      step(
        "receive",
        "Receive credentials",
        "http_request",
        "Start with a sign-in form.",
        "Read email and password from input; values remain unknown.",
      ),
      step(
        "validate",
        "Require both fields",
        "validation",
        "An incomplete form cannot continue.",
        "The guard checks email and password before lookup.",
        { condition: "if (!email || !password)" },
      ),
      step(
        "invalid",
        "Return missing-input error",
        "error",
        "Ask the caller to complete the form.",
        "The illustrative handler returns status 400.",
      ),
      step(
        "lookup",
        "Find the account",
        "database_read",
        "Look for the named account.",
        "Await the users adapter. Its storage implementation is outside this source.",
      ),
      step(
        "account-check",
        "Require an account",
        "branch",
        "An unknown account cannot sign in.",
        "A nullish user takes the 401 branch.",
        { condition: "if (!user)" },
      ),
      step(
        "unknown-user",
        "Reject an unknown account",
        "error",
        "No matching account was assumed on this selected path.",
        "The source returns status 401 without calling password verification.",
      ),
      step(
        "password",
        "Verify the password",
        "async",
        "Ask the password checker and wait for its answer.",
        "Await passwords.verify; algorithm, timing and result are unknown.",
      ),
      step(
        "credentials-check",
        "Choose the credential branch",
        "branch",
        "Only a matching password reaches session creation.",
        "The matches boolean controls the early return.",
        {
          condition: "if (!matches)",
          prediction: check(
            "Can a mismatch reach sessions.create?",
            "No. The early return stops this path.",
            "Yes. A session is created anyway.",
          ),
        },
      ),
      step(
        "wrong-password",
        "Reject the mismatch",
        "error",
        "Send the same sign-in failure status.",
        "The source returns 401. No session creation appears on this branch.",
      ),
      step(
        "session",
        "Create a server-side session",
        "function_call",
        "Create a sign-in record through the session service.",
        "Await sessions.create(user.id). This adapter is not a JWT signer; persistence and cookie transport are unspecified.",
      ),
      step(
        "response",
        "Return the session identifier",
        "response",
        "Return the sign-in result.",
        "The source returns status 200 and the adapter’s session identifier; its actual value is unknown.",
      ),
    ],
    [
      {
        id: "success",
        label: "Matching credentials",
        assumption: "Assume a user exists and verification returns true.",
        path: [
          "receive",
          "validate",
          "lookup",
          "account-check",
          "password",
          "credentials-check",
          "session",
          "response",
        ],
        outcome: "Source supports status 200; session value unknown.",
      },
      {
        id: "invalid",
        label: "Missing input",
        assumption: "Assume email or password is missing.",
        path: ["receive", "validate", "invalid"],
        outcome: "Source supports status 400.",
        failure: true,
      },
      {
        id: "unknown",
        label: "Unknown account",
        assumption: "Assume lookup returns no user.",
        path: [
          "receive",
          "validate",
          "lookup",
          "account-check",
          "unknown-user",
        ],
        outcome: "Source supports status 401.",
        failure: true,
      },
      {
        id: "mismatch",
        label: "Incorrect password",
        assumption: "Assume the password adapter returns false.",
        path: [
          "receive",
          "validate",
          "lookup",
          "account-check",
          "password",
          "credentials-check",
          "wrong-password",
        ],
        outcome: "Source supports status 401.",
        failure: true,
      },
    ],
    ["signup", "async", "middleware"],
  ),
);

// Small complete lessons, with explicit source and finite reviewed alternatives.
const small = [
  [
    "middleware",
    "Why can middleware stop a request?",
    "Backend",
    "function validate(req, res, next) {",
    [
      [
        "receive",
        "Read the request",
        "http_request",
        "const email = req.body.email;",
      ],
      ["validate", "Check the form", "validation", "if (!email) {"],
      ["reject", "Return early", "error", "return res.status(400).end();\n}"],
      ["continue", "Call the next handler", "function_call", "next();"],
      ["finish", "Leave the middleware", "response", "}"],
    ],
    ["receive", "validate", "continue", "finish"],
    ["receive", "validate", "reject"],
    "flow",
  ],
  [
    "async",
    "What does await actually wait for?",
    "JavaScript",
    "async function load(fetchValue) {\ntry {",
    [
      [
        "call",
        "Create the promise",
        "function_call",
        "const pending = fetchValue();",
      ],
      ["wait", "Await settlement", "async", "const result = await pending;"],
      ["return", "Return the result", "response", "return result;"],
      [
        "catch",
        "Handle rejection",
        "error",
        "} catch (error) { return { error }; }\n}",
      ],
    ],
    ["call", "wait", "return"],
    ["call", "wait", "catch"],
    "async",
  ],
  [
    "react",
    "How does React respond to a state change?",
    "React",
    "function Counter({initialCount = 0}) {",
    [
      [
        "state",
        "Declare component state",
        "function_call",
        "const [count, setCount] = useState(initialCount);",
      ],
      [
        "render",
        "Check the state boundary",
        "branch",
        "const label = `Count: ${count}`;\nif (count < 0) {",
      ],
      [
        "error",
        "Throw at the render boundary",
        "error",
        'throw new Error("Negative count");\n}',
      ],
      [
        "event",
        "Define a future click update",
        "function_call",
        "function onClick() { setCount(n => n + 1); }",
      ],
      [
        "commit",
        "Return the element description",
        "response",
        "return <button onClick={onClick}>{label}</button>;\n}",
      ],
    ],
    ["state", "render", "event", "commit"],
    ["state", "render", "error"],
    "tree",
  ],
  [
    "database",
    "Where does a transaction commit or roll back?",
    "Databases",
    'async function transfer(db, command) {\nawait db.query("BEGIN");\ntry {',
    [
      [
        "query",
        "Submit the parameterized write",
        "database_write",
        'await db.query("UPDATE accounts SET balance=balance+$1 WHERE id=$2", command);',
      ],
      [
        "commit",
        "Commit the transaction",
        "database_write",
        'await db.query("COMMIT");',
      ],
      ["result", "Return success", "response", "return { committed: true };"],
      [
        "rollback",
        "Roll back after failure",
        "error",
        '} catch (error) { await db.query("ROLLBACK"); throw error; }\n}',
      ],
    ],
    ["query", "commit", "result"],
    ["query", "rollback"],
    "database",
  ],
  [
    "cache",
    "What happens on a cache miss?",
    "System Design",
    "async function load(key, cache, store) {",
    [
      [
        "read",
        "Look in the cache",
        "cache",
        "const cached = await cache.get(key);",
      ],
      ["check", "Choose hit or miss", "branch", "if (cached !== undefined) {"],
      ["hit", "Return the cached value", "response", "return cached;\n}"],
      [
        "fetch",
        "Read the backing store",
        "database_read",
        "const value = await store.get(key);",
      ],
      ["fill", "Populate the cache", "cache", "await cache.set(key, value);"],
      ["result", "Return the fetched value", "response", "return value;\n}"],
    ],
    ["read", "check", "hit"],
    ["read", "check", "fetch", "fill", "result"],
    "cache",
  ],
  [
    "queue",
    "How does a worker acknowledge a job?",
    "System Design",
    "async function consume(queue, work) {",
    [
      [
        "take",
        "Receive a queued job",
        "queue",
        "const job = await queue.take();\ntry {",
      ],
      ["work", "Await the worker", "async", "await work(job);"],
      ["ack", "Acknowledge success", "queue", "await queue.ack(job);"],
      [
        "retry",
        "Request a retry after failure",
        "error",
        "} catch { await queue.retry(job); }\n}",
      ],
    ],
    ["take", "work", "ack"],
    ["take", "work", "retry"],
    "queue",
  ],
  [
    "search",
    "How does binary search narrow its range?",
    "Algorithms",
    "function search(values, target) {\nlet low = 0, high = values.length - 1;\nwhile (low <= high) {",
    [
      [
        "middle",
        "Inspect the middle index",
        "function_call",
        "const middle = Math.floor((low + high) / 2);",
      ],
      [
        "check",
        "Compare with the target",
        "branch",
        "if (values[middle] === target) {",
      ],
      ["found", "Return the matching index", "response", "return middle;\n}"],
      [
        "narrow",
        "Discard one half",
        "branch",
        "if (values[middle] < target) low = middle + 1; else high = middle - 1;",
      ],
      ["miss", "Return no match after exhaustion", "error", "}\nreturn -1;\n}"],
    ],
    ["middle", "check", "found"],
    ["middle", "check", "narrow", "miss"],
    "array",
  ],
];
for (const [
  id,
  title,
  topic,
  opening,
  definitions,
  path,
  alternate,
  visualization,
] of small) {
  const source =
    opening +
    "\n" +
    definitions
      .map(([key, , , code]) => `// @event ${key}\n${code}`)
      .join("\n");
  const steps = definitions.map(([key, name, kind, code]) =>
    step(
      key,
      name,
      kind,
      `${name}. Follow the highlighted operation before moving on.`,
      `The source operation is: ${code.replace(/\n/g, " ")}. Values, timing and side effects not explicitly shown remain unknown.`,
      {
        condition: ["branch", "validation"].includes(kind)
          ? code.split("\n")[0]
          : undefined,
      },
    ),
  );
  // Cache miss is an alternate path, not a failed execution. Binary search is a bounded reading example, not a complete iteration trace.
  recipes.push(
    make(
      id,
      title,
      "A reviewed source walkthrough with explicit assumptions, alternate paths and linked code.",
      topic,
      source,
      steps,
      [
        {
          id: "success",
          label: id === "cache" ? "Cache hit" : "Main path",
          assumption:
            id === "search"
              ? "Assume the first comparison matches the target in an already sorted array."
              : "Choose the main source-supported path; runtime values are unknown.",
          path,
          outcome: "Read the selected source outcome; no execution is claimed.",
        },
        {
          id: "failure",
          label: id === "cache" ? "Cache miss" : "Alternate / failure path",
          assumption:
            id === "search"
              ? "Assume a one-element search interval, one narrowing step and loop exhaustion. This is not a full iteration trace."
              : id === "react"
                ? "Assume initialCount is negative. The source throws; an error boundary is outside this snippet."
                : "Choose the reviewed alternate assumption; this is not an observed outcome.",
          path: alternate,
          outcome: "Read the alternate source outcome.",
          failure: id !== "cache",
        },
      ],
      id === "async" ? ["queue", "login"] : ["signup", "async"],
      visualization,
    ),
  );
}
export const journeyCatalog = recipes;
export function journeyById(id) {
  return id.startsWith("repo-")
    ? repositoryJourney(id)
    : recipes.find((r) => r.id === id);
}
export function pathEvents(journey, scenarioId) {
  const scenario = journey.scenarios.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error("Scenario not found");
  return scenario.path.map((key) => journey.events.find((e) => e.key === key));
}

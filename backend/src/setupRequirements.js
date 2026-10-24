import ts from "typescript";
import path from "node:path";
const posix = path.posix;
export function isSetupPath(value) {
  return (
    !/(^|\/)(node_modules|dist|build|vendor|\.git)(\/|$)/i.test(value) &&
    /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|\.nvmrc|\.node-version|\.env\.(example|sample|template)|schema\.prisma|(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml)$/i.test(
      value,
    )
  );
}
const serviceRules = {
  "@aws-sdk/client-codebuild": {
    name: "AWS CodeBuild",
    kind: "cloud build service",
    setup: [
      "Make the CodeBuild project referenced by this source available in your AWS account and region. Review the linked project/client configuration; no project name is guessed.",
      "Provide AWS SDK credentials through a development profile, environment credentials, or an attached runtime IAM role. SDK-standard credential configuration is separate from application variables detected below.",
      "For local credentials, AWS_PROFILE or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (plus AWS_SESSION_TOKEN for temporary credentials) are SDK conventions, not source-detected required variables. Do not place these credentials in the frontend.",
      "Configure the build service role and registry/source permissions for this project following the service documentation. The source may start remote builds; local Docker is not assumed necessary.",
    ],
    url: "https://docs.aws.amazon.com/codebuild/latest/userguide/setting-up.html",
  },
  pg: {
    name: "PostgreSQL",
    kind: "database",
    setup: [
      "Make a PostgreSQL development server available.",
      "Create a development database and account, then provide the connection settings referenced below.",
    ],
    url: "https://www.postgresql.org/docs/current/tutorial-install.html",
  },
  mongodb: {
    name: "MongoDB",
    kind: "database",
    setup: [
      "Make a MongoDB development instance available.",
      "Create a database user if authentication is enabled and supply the referenced connection settings.",
    ],
    url: "https://www.mongodb.com/docs/manual/installation/",
  },
  mongoose: {
    name: "MongoDB",
    kind: "database",
    setup: [
      "Make a MongoDB development instance available.",
      "Provide the connection settings used by the recorded mongoose.connect call.",
    ],
    url: "https://www.mongodb.com/docs/manual/installation/",
  },
  redis: {
    name: "Redis",
    kind: "cache",
    setup: [
      "Make a Redis development instance available.",
      "Configure its host, URL and authentication using the settings referenced by this project.",
    ],
    url: "https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/",
  },
  ioredis: {
    name: "Redis",
    kind: "cache",
    setup: [
      "Make a Redis development instance available.",
      "Configure its connection using the settings referenced by this project.",
    ],
    url: "https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/",
  },
  dockerode: {
    name: "Docker daemon",
    kind: "container engine",
    setup: [
      "Install and start Docker Engine or Docker Desktop on the machine that runs this service.",
      "Make the Docker daemon accessible to this process. Use the source connection configuration; no socket path or credentials are assumed.",
      "Check daemon connectivity with docker info before starting the application.",
    ],
    url: "https://docs.docker.com/engine/install/",
  },
  "@prisma/client": {
    name: "Prisma database",
    kind: "database",
    setup: [
      "Inspect the project’s Prisma schema to identify its database provider.",
      "Make that database available and configure the source-referenced environment settings. Run only the project’s declared generate/migration recipes; none are invented here.",
    ],
    url: "https://www.prisma.io/docs/orm/prisma-schema/overview",
  },
  "@aws-sdk/client-s3": {
    name: "S3-compatible storage",
    kind: "external service",
    setup: [
      "Prepare a development storage account or compatible endpoint.",
      "Configure credentials, region and bucket only as required by the referenced source.",
    ],
    url: "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started-nodejs.html",
  },
};
const constructors = {
  "@aws-sdk/client-codebuild": ["CodeBuildClient"],
  pg: ["Pool", "Client"],
  mongodb: ["MongoClient"],
  ioredis: ["default", "Redis"],
  dockerode: ["default", "Docker"],
  "@prisma/client": ["PrismaClient"],
  "@aws-sdk/client-s3": ["S3Client"],
};
const calls = {
  mongoose: ["connect"],
  redis: ["createClient", "createCluster"],
};
const envContainer = (n) =>
  n &&
  (n.getText() === "process.env" ||
    n.getText() === "import.meta.env" ||
    n.getText() === "Bun.env");
function envName(node) {
  if (ts.isPropertyAccessExpression(node) && envContainer(node.expression))
    return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    envContainer(node.expression) &&
    node.argumentExpression &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return node.argumentExpression.text;
  return null;
}
const directThrow = (statement) =>
  statement &&
  (ts.isThrowStatement(statement) ||
    (ts.isBlock(statement) && statement.statements.some(ts.isThrowStatement)));
const builtinVite = new Set(["DEV", "PROD", "MODE", "BASE_URL", "SSR"]);
const safeRecord = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).filter(
      ([key, v]) => /^[\w:@./-]+$/.test(key) && typeof v === "string",
    ),
  );

export function deriveSetupPlan({
  graph,
  files,
  metadata = { paths: [], limited: true },
}) {
  const allPaths = new Set([...Object.keys(files), ...(metadata.paths || [])]);
  const warnings = [];
  const manifests = Object.keys(files)
    .filter((p) => /(^|\/)package\.json$/i.test(p))
    .map((p) => {
      try {
        const raw = JSON.parse(files[p]);
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error();
        return { path: p, directory: posix.dirname(p), raw };
      } catch {
        warnings.push(
          `Could not read ${p}; its setup requirements are unknown.`,
        );
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.directory.length - a.directory.length);
  const projectFor = (file) =>
    manifests.find(
      (m) => m.directory === "." || file.startsWith(m.directory + "/"),
    );
  function evidence(file, node, sf) {
    const line = sf
      ? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
      : 1;
    return {
      path: file,
      line,
      url: `${graph.repository}/blob/${graph.commit}/${file.split("/").map(encodeURIComponent).join("/")}#L${line}`,
    };
  }
  const environment = new Map(),
    services = new Map(),
    ports = [],
    loaders = new Set(),
    loaderFiles = new Map();
  const noteLoader = (directory, location) => {
    loaders.add(directory);
    loaderFiles.set(
      directory,
      !loaderFiles.has(directory) || loaderFiles.get(directory) === location
        ? location
        : null,
    );
  };
  for (const [file, source] of Object.entries(files)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const project = projectFor(file),
      directory = project?.directory || ".",
      imports = new Map(),
      aliases = new Map(),
      values = new Map();
    const keyFor = (name) => directory + "\0" + name;
    const record = (name, node) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return;
      const vite = node.getText(sf).startsWith("import.meta.env");
      if (vite && builtinVite.has(name)) return;
      const key = keyFor(name),
        entry = environment.get(key) || {
          name,
          directory,
          clientExposed:
            vite || name.startsWith("VITE_") || name.startsWith("NEXT_PUBLIC_"),
          status: "referenced",
          evidence: [],
        };
      if (entry.evidence.length < 8)
        entry.evidence.push(evidence(file, node, sf));
      if (
        ts.isBinaryExpression(node.parent) &&
        node.parent.left === node &&
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(node.parent.operatorToken.kind)
      )
        entry.status = entry.status === "checked" ? "checked" : "fallback";
      environment.set(key, entry);
      let parent = node.parent;
      for (
        let depth = 0;
        depth < 3 &&
        parent &&
        ts.isBinaryExpression(parent) &&
        [
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
        ].includes(parent.operatorToken.kind);
        depth++, parent = parent.parent
      ) {
        const fallback = safeLocalDefault(parent.right, values);
        if (fallback && !(typeof fallback === "number" && name !== "PORT"))
          entry.localDefault = fallback;
      }
    };
    const pre = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const module = node.moduleSpecifier.text,
          c = node.importClause;
        if (module === "dotenv/config") noteLoader(directory, ".env");
        if (c?.name) imports.set(c.name.text, { module, name: "default" });
        if (c?.namedBindings && ts.isNamespaceImport(c.namedBindings))
          imports.set(c.namedBindings.name.text, { module, name: "*" });
        if (c?.namedBindings && ts.isNamedImports(c.namedBindings))
          for (const item of c.namedBindings.elements)
            imports.set(item.name.text, {
              module,
              name: item.propertyName?.text || item.name.text,
            });
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = node.initializer;
        if (ts.isIdentifier(node.name))
          values.set(node.name.text, values.has(node.name.text) ? null : init);
        const name = envName(init);
        if (ts.isIdentifier(node.name) && name)
          aliases.set(node.name.text, name);
        if (ts.isObjectBindingPattern(node.name) && envContainer(init))
          for (const item of node.name.elements) {
            const n = item.propertyName?.getText(sf) || item.name.getText(sf);
            record(n, item);
            if (ts.isIdentifier(item.name)) aliases.set(item.name.text, n);
          }
        if (
          ts.isCallExpression(init) &&
          init.expression.getText(sf) === "require" &&
          ts.isStringLiteral(init.arguments[0])
        ) {
          const module = init.arguments[0].text;
          if (module === "dotenv/config") noteLoader(directory, ".env");
          if (ts.isIdentifier(node.name))
            imports.set(node.name.text, { module, name: "default" });
          if (ts.isObjectBindingPattern(node.name))
            for (const item of node.name.elements)
              if (ts.isIdentifier(item.name))
                imports.set(item.name.text, {
                  module,
                  name: item.propertyName?.getText(sf) || item.name.text,
                });
        }
      }
      ts.forEachChild(node, pre);
    };
    pre(sf);
    const visit = (node) => {
      const name = envName(node);
      if (name) record(name, node);
      if (
        ts.isIfStatement(node) &&
        directThrow(node.thenStatement) &&
        ts.isPrefixUnaryExpression(node.expression) &&
        node.expression.operator === ts.SyntaxKind.ExclamationToken
      ) {
        const condition = node.expression.operand,
          n =
            envName(condition) ||
            (ts.isIdentifier(condition) ? aliases.get(condition.text) : null);
        if (n) {
          record(n, condition);
          const entry = environment.get(keyFor(n));
          if (entry) entry.status = "checked";
        }
      }
      if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
        let owner = node.expression,
          member = null;
        if (ts.isPropertyAccessExpression(owner)) {
          member = owner.name.text;
          owner = owner.expression;
        }
        const imported = ts.isIdentifier(owner)
          ? imports.get(owner.text)
          : null;
        if (imported) {
          const symbol = member || imported.name,
            rules = ts.isNewExpression(node) ? constructors : calls;
          if (
            ts.isCallExpression(node) &&
            imported.module === "dotenv" &&
            symbol === "config"
          ) {
            let location = ".env";
            const options = node.arguments[0];
            if (options) {
              location = null;
              if (ts.isObjectLiteralExpression(options)) {
                const option = options.properties.find(
                  (p) =>
                    ts.isPropertyAssignment(p) &&
                    p.name.getText(sf).replace(/['"]/g, "") === "path",
                );
                if (!option) location = ".env";
                else if (
                  ts.isStringLiteral(option.initializer) &&
                  safeRelative(option.initializer.text)
                )
                  location = option.initializer.text;
              }
            }
            noteLoader(directory, location);
          }
          if (rules[imported.module]?.includes(symbol)) {
            const rule = serviceRules[imported.module],
              key = directory + "\0" + rule.name;
            const service = services.get(key) || {
              ...rule,
              directory,
              evidence: [],
            };
            if (service.evidence.length < 6)
              service.evidence.push(evidence(file, node, sf));
            services.set(key, service);
          }
        }
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "listen"
        ) {
          const configured = portValue(node.arguments[0], values);
          if (configured?.port > 0 && configured.port < 65536)
            ports.push({
              ...configured,
              directory,
              evidence: evidence(file, node, sf),
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  const requirements = [...environment.values()].map((e) => ({
    ...e,
    instruction: e.clientExposed
      ? "Public browser configuration: supply only values safe to expose to users. Never put server secrets in this variable."
      : /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i.test(e.name)
        ? "Obtain your own development credential from the integration used by this source. Supply it in the process environment; secret values are not inferred."
        : "Set this variable for this version using the linked source to determine the expected format.",
  }));
  const projects = manifests.map((m) => {
    const scripts = safeRecord(m.raw.scripts),
      engines = safeRecord(m.raw.engines),
      deps = {
        ...safeRecord(m.raw.dependencies),
        ...safeRecord(m.raw.devDependencies),
      };
    const at = (name) =>
      m.directory === "." ? name : m.directory + "/" + name;
    const evidenceFor = (name) => ({
      path: name,
      line: 1,
      url: `${graph.repository}/blob/${graph.commit}/${name.split("/").map(encodeURIComponent).join("/")}#L1`,
    });
    const declared =
      typeof m.raw.packageManager === "string"
        ? /^(npm|pnpm|yarn|bun)@([\w.+-]+)$/.exec(m.raw.packageManager)
        : null;
    const lockNames = [
      ["npm", "package-lock.json"],
      ["npm", "npm-shrinkwrap.json"],
      ["pnpm", "pnpm-lock.yaml"],
      ["yarn", "yarn.lock"],
      ["bun", "bun.lock"],
      ["bun", "bun.lockb"],
    ];
    const locks = lockNames.filter(([, file]) => allPaths.has(at(file)));
    const managers = new Set(locks.map(([manager]) => manager));
    const manager =
      declared?.[1] || (managers.size === 1 ? [...managers][0] : null);
    const lock = locks.find(([name]) => name === manager)?.[1] || null;
    const loader =
      loaders.has(m.directory) ||
      Object.values(scripts).some((script) =>
        /--env-file(?:-if-exists)?[=\s]/.test(script),
      );
    const vite =
      !!deps.vite || Object.values(scripts).some((s) => /\bvite\b/.test(s));
    const env = requirements.filter((e) => e.directory === m.directory);
    const template =
      [...allPaths].find(
        (p) =>
          posix.dirname(p) === m.directory &&
          /\.env\.(example|sample|template)$/.test(p),
      ) || null;
    const scriptEnvs = Object.values(scripts)
      .flatMap((s) =>
        [...s.matchAll(/--env-file(?:-if-exists)?(?:=|\s+)([\w./-]+)/g)].map(
          (m) => m[1],
        ),
      )
      .filter(safeRelative);
    const envLocation = loaderFiles.has(m.directory)
      ? loaderFiles.get(m.directory)
      : scriptEnvs.length === 1
        ? scriptEnvs[0]
        : !loader && vite
          ? ".env.local"
          : null;
    const environmentFile = env.length && envLocation ? at(envLocation) : null;
    const install =
      manager === "npm"
        ? lock
          ? "npm ci"
          : "npm install"
        : manager === "pnpm"
          ? lock
            ? "pnpm install --frozen-lockfile"
            : "pnpm install"
          : manager === "yarn"
            ? "yarn install"
            : manager === "bun"
              ? lock
                ? "bun install --frozen-lockfile"
                : "bun install"
              : null;
    const run = (name) =>
      manager && /^[\w:-]+$/.test(name) ? `${manager} run ${name}` : null;
    const recommended = ["dev", "start", "serve"].find((name) => scripts[name]);
    const commands = [];
    if (
      /^[\w./ @-]+$/.test(m.directory) &&
      !m.directory.split("/").includes("..")
    )
      commands.push({
        title: "Open this app folder from the repository root",
        command: `cd "${m.directory}"`,
      });
    commands.push({ title: "Check Node.js", command: "node --version" });
    if (install)
      commands.push({
        title: "Install this version’s dependencies",
        command: install,
      });
    if (recommended && run(recommended))
      commands.push({
        title: `Start this app using its declared ${recommended} script`,
        command: run(recommended),
      });
    const startNeedsBuild =
      recommended === "start" &&
      /\bnode\s+(?:[^\s]*\/)?(?:dist|build)\//.test(scripts.start || "");
    if (startNeedsBuild && scripts.build && run("build"))
      commands.splice(commands.length - 1, 0, {
        title: "Build the compiled startup output",
        command: run("build"),
      });
    return {
      path: m.path,
      directory: m.directory,
      node: engines.node || null,
      runtimeFiles: [...allPaths]
        .filter(
          (p) =>
            posix.dirname(p) === m.directory &&
            /\.(nvmrc|node-version)$/.test(posix.basename(p)),
        )
        .map(evidenceFor),
      manager,
      managerVersion: declared?.[2] || null,
      managerBasis: declared
        ? "packageManager field"
        : lock
          ? "lockfile"
          : null,
      lockfile: lock ? at(lock) : null,
      managerConflict: managers.size > 1,
      scripts,
      recommendedScript: recommended || null,
      commands,
      environmentFile,
      environmentLoader: loader || vite,
      environmentTemplate: template,
      environment: env,
      services: [...services.values()].filter(
        (s) => s.directory === m.directory,
      ),
      ports: ports.filter((p) => p.directory === m.directory),
      evidence: evidenceFor(m.path),
      readmes: [...allPaths]
        .filter(
          (p) =>
            posix.dirname(p) === m.directory &&
            /^README\.md$/i.test(posix.basename(p)),
        )
        .map(evidenceFor),
    };
  });
  return {
    schemaVersion: 1,
    snapshotId: graph.snapshotId,
    commit: graph.commit,
    repository: graph.repository,
    projects,
    environment: requirements,
    services: [...services.values()],
    warnings: [
      ...warnings,
      ...(metadata.limited
        ? [
            "Configuration/lockfile path coverage may be incomplete. Missing findings do not prove setup is unnecessary.",
          ]
        : []),
      "Source-derived requirements and instructions have not been installed, started or execution-verified. Services may be used only on particular code paths. Dynamic environment names, custom configuration wrappers and deployment-specific values may be missing.",
    ],
  };
}
function portValue(node, values, depth = 0) {
  if (!node || depth > 4) return null;
  if (
    ts.isNumericLiteral(node) ||
    (ts.isStringLiteral(node) && /^\d+$/.test(node.text))
  )
    return { port: Number(node.text), environment: null };
  if (ts.isIdentifier(node))
    return portValue(values.get(node.text), values, depth + 1);
  if (
    ts.isCallExpression(node) &&
    ["Number", "parseInt"].includes(node.expression.getText())
  )
    return portValue(node.arguments[0], values, depth + 1);
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
      node.operatorToken.kind,
    )
  ) {
    const fallback = portValue(node.right, values, depth + 1);
    if (fallback)
      return {
        ...fallback,
        environment: envName(node.left) || fallback.environment,
      };
  }
  return null;
}
function safeRelative(value) {
  return (
    /^[\w./-]+$/.test(value) &&
    !value.startsWith("/") &&
    !value.split("/").some((p) => p === ".." || !p)
  );
}
function safeLocalDefault(node, values, depth = 0) {
  if (!node || depth > 3) return null;
  if (ts.isIdentifier(node))
    return safeLocalDefault(values.get(node.text), values, depth + 1);
  if (
    ts.isStringLiteral(node) &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[\w./-]*)?$/.test(
      node.text,
    )
  )
    return node.text;
  if (
    ts.isNumericLiteral(node) &&
    Number(node.text) > 0 &&
    Number(node.text) < 65536
  )
    return Number(node.text);
  return null;
}

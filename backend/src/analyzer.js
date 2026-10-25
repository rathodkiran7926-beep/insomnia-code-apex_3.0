import ts from "typescript";
import { functionLabel } from "./functionNames.js";
import path from "node:path";
import { createHash } from "node:crypto";
// Snapshot IDs stay stable; compatibility is tracked separately from identity.
export const ANALYZER_VERSION = "1";

export function analyze(input) {
  const { files, commit, repository } = input;
  const snapshotId = createHash("sha256")
    .update(repository + commit)
    .digest("hex")
    .slice(0, 24);
  const components = [],
    relationships = [],
    references = [],
    unresolved = [];
  const byNode = new Map(),
    modules = new Map();
  const canonical = (p) =>
    path.posix.normalize(p.replaceAll("\\", "/")).replace(/^\//, "");
  const configs = Object.keys(files).filter((p) =>
    /(^|\/)tsconfig\.json$/.test(p),
  );
  let configOptions = {};
  if (configs.length) {
    const config = ts.parseConfigFileTextToJson(configs[0], files[configs[0]]);
    if (config.config)
      configOptions = ts.convertCompilerOptionsFromJson(
        config.config.compilerOptions || {},
        "/" + path.posix.dirname(configs[0]),
      ).options;
  }
  const options = {
    ...configOptions,
    allowJs: true,
    checkJs: true,
    noLib: true,
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (p) => Object.hasOwn(files, canonical(p));
  host.readFile = (p) => files[canonical(p)];
  host.getCurrentDirectory = () => "/";
  host.directoryExists = (p) =>
    !canonical(p) ||
    canonical(p) === "." ||
    Object.keys(files).some((f) =>
      f.startsWith(canonical(p).replace(/\/$/, "") + "/"),
    );
  host.getDirectories = () => [];
  host.getSourceFile = (p, languageVersion) =>
    host.fileExists(p)
      ? ts.createSourceFile(
          "/" + canonical(p),
          host.readFile(p),
          languageVersion,
          true,
        )
      : undefined;
  host.resolveModuleNames = (names, containing) =>
    names.map((name) => {
      const result = ts.resolveModuleName(
        name,
        containing,
        {
          ...options,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          module: ts.ModuleKind.ESNext,
        },
        host,
      ).resolvedModule;
      return result;
    });
  const program = ts.createProgram(
    Object.keys(files)
      .filter((p) => /\.[cm]?[jt]sx?$/.test(p))
      .map((p) => "/" + p),
    options,
    host,
  );
  const checker = program.getTypeChecker();
  const sources = program.getSourceFiles();
  function reference(node) {
    const sf = node.getSourceFile(),
      file = canonical(sf.fileName);
    const startLine =
      sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const id = `ref${references.length}`;
    references.push({
      id,
      snapshotId,
      file,
      startLine,
      endLine,
      startOffset: node.getStart(sf),
      endOffset: node.getEnd(),
      url: `${repository}/blob/${commit}/${file.split("/").map(encodeURIComponent).join("/")}#L${startLine}-L${endLine}`,
      excerpt: node.getText(sf).slice(0, 1800),
    });
    return id;
  }
  function add(node, name, role, extra = {}) {
    const component = {
      id: `c${components.length}`,
      name,
      role,
      inferred: false,
      evidence: [],
      referenceId: reference(node),
      ...extra,
    };
    components.push(component);
    byNode.set(node, component);
    return component;
  }
  const edge = (source, target, type, node, extra = {}) => {
    const relation = {
      id: `e${relationships.length}`,
      source: source.id,
      target: target.id,
      type,
      certainty: "static",
      referenceId: reference(node),
      ...extra,
    };
    relationships.push(relation);
    return relation;
  };
  function symbol(node) {
    let s = checker.getSymbolAtLocation(node);
    const seen = new Set();
    while (s && s.flags & ts.SymbolFlags.Alias && !seen.has(s)) {
      seen.add(s);
      s = checker.getAliasedSymbol(s);
    }
    return s;
  }
  function resolve(node, seen = new Set()) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (byNode.has(node)) return byNode.get(node);
    const s = symbol(ts.isPropertyAccessExpression(node) ? node.name : node);
    for (const d of s?.declarations || []) {
      if (byNode.has(d)) return byNode.get(d);
      if (d.initializer && byNode.has(d.initializer))
        return byNode.get(d.initializer);
      if (ts.isExportAssignment(d)) return resolve(d.expression, seen);
      if (d.initializer && ts.isIdentifier(d.initializer))
        return resolve(d.initializer, seen);
      if (
        d.initializer &&
        ts.isCallExpression(d.initializer) &&
        d.initializer.expression.getText() === "require" &&
        d.initializer.arguments[0] &&
        ts.isStringLiteralLike(d.initializer.arguments[0])
      ) {
        const resolved = ts.resolveModuleName(
          d.initializer.arguments[0].text,
          d.getSourceFile().fileName,
          {
            ...options,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            module: ts.ModuleKind.ESNext,
          },
          host,
        ).resolvedModule;
        const module =
          resolved && program.getSourceFile(resolved.resolvedFileName);
        // Explicit CommonJS default export rule, scoped to the compiler-resolved module.
        const assignments =
          module?.statements
            .filter(ts.isExpressionStatement)
            .map((s) => s.expression)
            .filter(
              (e) =>
                ts.isBinaryExpression(e) &&
                e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                e.left.getText() === "module.exports",
            ) || [];
        if (assignments.length === 1)
          return resolve(assignments[0].right, seen);
      }
    }
  }
  const visit = (node, fn) => {
    fn(node);
    ts.forEachChild(node, (n) => visit(n, fn));
  };
  for (const sf of sources) {
    modules.set(sf, add(sf, canonical(sf.fileName), "module"));
    visit(sf, (node) => {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node)
      ) {
        const { name, nameKind } = functionLabel(node, sf);
        const c = add(
          node,
          name,
          ts.isClassDeclaration(node) ? "class" : "function",
          {
            nameKind,
            inputs: node.parameters?.map((p) => p.getText(sf)) || [],
            output: node.type?.getText(sf) || "Not statically determined",
            exported: Boolean(
              node.modifiers?.some(
                (m) => m.kind === ts.SyntaxKind.ExportKeyword,
              ),
            ),
          },
        );
        if (ts.isVariableDeclaration(node.parent)) byNode.set(node.parent, c);
      }
    });
  }
  function importedFrom(node, pkg) {
    const s = checker.getSymbolAtLocation(node);
    return s?.declarations?.some((d) => {
      let p = d;
      while (p && !ts.isImportDeclaration(p)) p = p.parent;
      return p && p.moduleSpecifier.text === pkg;
    });
  }
  function expressFactory(expr) {
    if (ts.isIdentifier(expr) && importedFrom(expr, "express")) {
      const declarations =
        checker.getSymbolAtLocation(expr)?.declarations || [];
      if (
        declarations.some(
          (d) =>
            ts.isImportSpecifier(d) &&
            (d.propertyName || d.name).text === "Router",
        )
      )
        return "router";
      return declarations.some(
        (d) => ts.isImportClause(d) || ts.isNamespaceImport(d),
      )
        ? "express"
        : undefined;
    }
    if (
      ts.isPropertyAccessExpression(expr) &&
      expr.name.text === "Router" &&
      importedFrom(expr.expression, "express")
    )
      return "router";
    if (ts.isIdentifier(expr)) {
      const s = checker.getSymbolAtLocation(expr);
      for (const d of s?.declarations || []) {
        if (
          ts.isImportSpecifier(d) &&
          (d.propertyName || d.name).text === "Router" &&
          importedFrom(expr, "express")
        )
          return "router";
        if (
          d.initializer &&
          ts.isCallExpression(d.initializer) &&
          d.initializer.expression.getText() === "require" &&
          d.initializer.arguments[0]?.text === "express"
        )
          return "express";
      }
    }
    if (
      ts.isPropertyAccessExpression(expr) &&
      expr.name.text === "Router" &&
      expressFactory(expr.expression) === "express"
    )
      return "router";
  }
  let expressEvidence = false;
  for (const sf of sources)
    visit(sf, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        ts.isCallExpression(node.initializer)
      ) {
        const kind = expressFactory(node.initializer.expression);
        if (kind) {
          expressEvidence = true;
          add(
            node,
            node.name.getText(sf),
            kind === "router" ? "router" : "application",
            {
              evidence: [
                "Constructed from a source-linked Express import/require",
              ],
            },
          );
        }
      }
    });
  for (const sf of sources)
    visit(sf, (node) => {
      if (
        !ts.isVariableDeclaration(node) ||
        !node.initializer ||
        !ts.isNewExpression(node.initializer)
      )
        return;
      const ctor = node.initializer.expression;
      const declarations = ts.isIdentifier(ctor)
        ? checker.getSymbolAtLocation(ctor)?.declarations || []
        : [];
      if (
        importedFrom(ctor, "pg") &&
        declarations.some(
          (d) =>
            ts.isImportSpecifier(d) &&
            ["Pool", "Client"].includes((d.propertyName || d.name).text),
        )
      ) {
        add(node, node.name.getText(sf), "database_client", {
          evidence: [
            "Constructed with a named Pool/Client import from pg; connection is not executed",
          ],
        });
      }
    });
  const owner = (node) => {
    let p = node.parent;
    while (p) {
      if (byNode.has(p)) return byNode.get(p);
      p = p.parent;
    }
    return modules.get(node.getSourceFile());
  };
  for (const sf of sources)
    visit(sf, (node) => {
      if (
        ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)
      ) {
        const spec = node.moduleSpecifier;
        const target = program.getSourceFile(
          ts.resolveModuleName(
            spec.text,
            sf.fileName,
            {
              ...options,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
              module: ts.ModuleKind.ESNext,
            },
            host,
          ).resolvedModule?.resolvedFileName || "",
        );
        if (target) edge(modules.get(sf), modules.get(target), "imports", node);
        else
          unresolved.push({
            kind: "import",
            text: spec.text,
            referenceId: reference(node),
            reason: "External dependency or unresolved module",
          });
      }
      if (!ts.isCallExpression(node)) return;
      const expr = node.expression;
      if (
        ts.isIdentifier(expr) &&
        expr.text === "require" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const spec = node.arguments[0];
        const target = program.getSourceFile(
          ts.resolveModuleName(
            spec.text,
            sf.fileName,
            {
              ...options,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
              module: ts.ModuleKind.ESNext,
            },
            host,
          ).resolvedModule?.resolvedFileName || "",
        );
        if (target) edge(modules.get(sf), modules.get(target), "imports", node);
        else
          unresolved.push({
            kind: "import",
            text: spec.text,
            referenceId: reference(node),
            reason: "External dependency or unresolved CommonJS module",
          });
        return;
      }
      if (ts.isPropertyAccessExpression(expr)) {
        const receiver = resolve(expr.expression),
          method = expr.name.text.toLowerCase();
        if (receiver?.role === "database_client" && method === "query") {
          const sql =
            node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
              ? node.arguments[0].text
              : "";
          const operation = add(
            node,
            `PostgreSQL query${sql ? ` (${sql.trim().split(/\s+/)[0].toUpperCase().slice(0, 20)})` : " (dynamic SQL)"}`,
            "database_operation",
            {
              evidence: [
                "query() on a source-confirmed pg Pool/Client instance; SQL execution and effects are not observed",
              ],
              inputs: node.arguments.map((a) => a.getText(sf).slice(0, 200)),
              output:
                "pg query return value; external dependency types unavailable",
            },
          );
          edge(owner(node), operation, "calls", node);
          edge(operation, receiver, "queries_database", node);
          return;
        }
        if (
          receiver &&
          ["application", "router"].includes(receiver.role) &&
          [
            "get",
            "post",
            "put",
            "patch",
            "delete",
            "head",
            "options",
            "all",
            "use",
          ].includes(method)
        ) {
          const literal =
            node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]);
          const routePath = literal
            ? node.arguments[0].text
            : method === "use"
              ? "/"
              : null;
          const handlers = [...node.arguments].slice(literal ? 1 : 0);
          if (method !== "use" && !handlers.length) return; // app.get(setting) is not a route registration.
          if (
            method === "use" &&
            !literal &&
            handlers.length > 1 &&
            ts.isIdentifier(handlers[0]) &&
            !resolve(handlers[0])
          ) {
            unresolved.push({
              kind: "mount",
              text: node.getText().slice(0, 200),
              referenceId: reference(node),
              reason: "Possible dynamic mount path; no mount edge asserted",
            });
            return;
          }
          if (!routePath) {
            unresolved.push({
              kind: "route",
              text: node.getText().slice(0, 200),
              referenceId: reference(node),
              reason: "Dynamic route path",
            });
            return;
          }
          if (method === "use") {
            for (const h of handlers) {
              const target = resolve(h);
              if (target?.role === "router")
                edge(receiver, target, "mounts_router", node, {
                  mountPath: routePath,
                });
              else if (target) {
                target.role = "middleware";
                if (
                  target.nameKind === "callback_context" &&
                  (ts.isArrowFunction(h) || ts.isFunctionExpression(h))
                )
                  target.name =
                    receiver.name +
                    ".use(" +
                    JSON.stringify(routePath) +
                    ") middleware";
                target.evidence.push("Registered in Express use()");
                edge(receiver, target, "uses_middleware", node, {
                  mountPath: routePath,
                });
              } else
                unresolved.push({
                  kind: "middleware",
                  text: h.getText().slice(0, 200),
                  referenceId: reference(h),
                  reason:
                    "Middleware factory, array, external middleware, or unresolved router",
                });
            }
          } else {
            const route = add(
              node,
              `${method.toUpperCase()} ${routePath}`,
              "route",
              {
                method: method.toUpperCase(),
                routePath,
                routerId: receiver.id,
              },
            );
            edge(receiver, route, "registers_route", node);
            handlers.forEach((h, index) => {
              const target = resolve(h);
              if (target) {
                target.role =
                  index === handlers.length - 1 ? "handler" : "middleware";
                if (
                  target.nameKind === "callback_context" &&
                  (ts.isArrowFunction(h) || ts.isFunctionExpression(h))
                )
                  target.name =
                    route.name +
                    (target.role === "handler"
                      ? " handler"
                      : " middleware " + (index + 1));
                target.evidence.push(
                  `Registered as ${target.role} for ${route.name}`,
                );
                edge(route, target, "handles_route", h);
              } else
                unresolved.push({
                  kind: "handler",
                  text: h.getText().slice(0, 200),
                  referenceId: reference(h),
                  reason: "Handler not statically resolved",
                });
            });
          }
          return;
        }
      }
      const target = resolve(expr),
        source = owner(node);
      if (target && !["application", "router", "module"].includes(target.role))
        edge(source, target, "calls", node);
      else
        unresolved.push({
          kind: "call",
          text: expr.getText().slice(0, 160),
          referenceId: reference(node),
          reason:
            "Dynamic dispatch, external call, built-in, or declaration unavailable; no call edge asserted",
        });
    });
  for (const c of components) {
    if (
      c.role === "function" &&
      relationships.some(
        (e) =>
          e.type === "calls" &&
          e.target === c.id &&
          components.find((x) => x.id === e.source)?.role === "handler",
      )
    ) {
      c.role = "service";
      c.inferred = true;
      c.evidence.push(
        "Called by a registered HTTP handler; service responsibility is an inference",
      );
    }
    if (c.role === "route") {
      const paths = (id, seen = new Set()) => {
        if (seen.has(id)) return [];
        const next = new Set(seen).add(id);
        const parent = relationships.filter(
          (e) => e.type === "mounts_router" && e.target === id,
        );
        return components.find((x) => x.id === id)?.role === "application"
          ? [""]
          : parent.flatMap((e) =>
              paths(e.source, next).map((p) =>
                `${p}/${e.mountPath}`.replace(/\/+/g, "/").replace(/\/$/, ""),
              ),
            );
      };
      c.fullPaths = paths(c.routerId).map((p) =>
        `${p}/${c.routePath}`.replace(/\/+/g, "/"),
      );
      if (!c.fullPaths.length)
        unresolved.push({
          kind: "mount",
          text: c.name,
          referenceId: c.referenceId,
          reason:
            "Router has no statically resolved path to an Express application",
        });
    }
    const declaration = [...byNode.entries()].find(
      ([, component]) => component === c,
    )?.[0];
    const handling = new Set();
    if (declaration && c.role !== "module")
      visit(declaration, (node) => {
        if (ts.isThrowStatement(node)) handling.add("throw");
        if (ts.isTryStatement(node)) handling.add("try");
        if (ts.isCatchClause(node)) handling.add("catch");
      });
    c.validation = handling.size
      ? `Contains ${[...handling].join("/")} syntax; behavior requires source inspection.`
      : "No throw/try/catch syntax detected in this declaration; validation is not inferred.";
  }
  for (const sf of sources) {
    const module = modules.get(sf);
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    module.exports = (
      moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []
    ).map((s) => {
      const original = s;
      if (s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
      const target = s.declarations
        ?.map(
          (d) => byNode.get(d) || (d.initializer && byNode.get(d.initializer)),
        )
        .find(Boolean);
      if (target) target.exported = true;
      return {
        name: original.name,
        componentId: target?.id || null,
        referenceId: original.declarations?.[0]
          ? reference(original.declarations[0])
          : module.referenceId,
      };
    });
  }
  for (const diagnostic of program.getSyntacticDiagnostics()) {
    if (diagnostic.file)
      unresolved.push({
        kind: "syntax",
        text: canonical(diagnostic.file.fileName),
        referenceId: reference(diagnostic.file),
        reason: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      });
  }
  return {
    snapshotId,
    repository,
    commit,
    branch: input.branch || null,
    revision: input.revision || null,
    components,
    relationships,
    references,
    report: {
      supported: expressEvidence,
      languages: [
        ...new Set(
          sources.map((s) =>
            /\.[cm]?tsx?$/.test(s.fileName) ? "TypeScript" : "JavaScript",
          ),
        ),
      ],
      frameworks: expressEvidence
        ? ["Express (source-confirmed construction)"]
        : [],
      patterns: [
        "Express import/require construction",
        "Literal app/router HTTP registrations",
        "Static use() mounts and middleware",
        "Compiler-resolved imports, aliases, re-exports and calls",
        "PostgreSQL query() on a local instance constructed from named pg Pool/Client imports",
      ],
      limitations: [
        "Static source analysis, not an observed runtime trace",
        "Computed paths, route() chains, handler arrays, framework wrappers and dynamic dispatch are unresolved",
        "Database support is limited to named pg Pool/Client imports and direct instance query(); no SQL execution or other ORM inference",
        "Dependencies are never installed; missing external types can limit resolution",
        "Only first tsconfig compiler options are used; project references and config extends are not expanded",
        "Service roles are inferred from handler calls; no microservice/deployment claim",
        "Runtime mutation, conditional registration, middleware order and virtual dispatch are not modeled",
      ],
      exclusions: input.exclusions || [],
      unresolved,
    },
    readmeClaim: (files["README.md"] || "").slice(0, 1500),
  };
}

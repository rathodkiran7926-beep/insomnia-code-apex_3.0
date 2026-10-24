import ts from "typescript";
import path from "node:path";
import { builtinModules } from "node:module";
import { db } from "./storage.js";
const builtins = new Set(
  builtinModules.map((value) => value.replace(/^node:/, "")),
);
const framework = (name) =>
  name === "react" || name.startsWith("react/") || name === "react-router-dom"
    ? "React"
    : name === "express"
      ? "Express"
      : name === "vue"
        ? "Vue"
        : name.startsWith("@angular/")
          ? "Angular"
          : name === "next" || name.startsWith("next/")
            ? "Next.js"
            : name.startsWith("node:") || builtins.has(name)
              ? "Node.js"
              : null;
export function sourceJourneySkills(file, content, excerpt, manifest) {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const component = ts.createSourceFile(
    file,
    excerpt,
    ts.ScriptTarget.Latest,
    true,
  );
  const identifiers = new Set();
  let jsx = false;
  function visit(node) {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    )
      jsx = true;
    ts.forEachChild(node, visit);
  }
  visit(component);
  const skills = new Set([
    /\.[cm]?tsx?$/i.test(file) ? "TypeScript" : "JavaScript",
  ]);
  const evidence = [];
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const label = framework(statement.moduleSpecifier.text);
    if (!label) continue;
    const clause = statement.importClause;
    const bindings = [
      clause?.name?.text,
      ...(clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)
        ? [clause.namedBindings.name.text]
        : clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements
              .filter((e) => !e.isTypeOnly)
              .map((e) => e.name.text)
          : []),
    ].filter(Boolean);
    const used = bindings.some((name) => identifiers.has(name));
    if (
      !used &&
      !(
        jsx &&
        label === "React" &&
        statement.moduleSpecifier.text === "react" &&
        bindings.length
      )
    )
      continue;
    skills.add(label);
    evidence.push({
      skill: label,
      file,
      startLine:
        source.getLineAndCharacterOfPosition(statement.getStart(source)).line +
        1,
      basis: "source_import",
    });
  }
  if (jsx && !skills.has("React") && manifest) {
    try {
      const pkg = JSON.parse(manifest.content);
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      if (
        dependencies.react &&
        !dependencies.preact &&
        !dependencies.vue &&
        !dependencies["solid-js"]
      ) {
        skills.add("React");
        evidence.push({
          skill: "React",
          file: manifest.file,
          startLine: 1,
          basis: "nearest_manifest_and_component_jsx",
        });
      }
    } catch {
      /* Invalid package metadata does not establish a framework. */
    }
  }
  return { skills: [...skills], evidence };
}
export function journeySkillReader(snapshotId) {
  const cache = new Map();
  const read = (file) => {
    if (!cache.has(file))
      cache.set(
        file,
        db
          .prepare(
            "SELECT content FROM source_files WHERE snapshot_id=? AND path=?",
          )
          .get(snapshotId, file)?.content,
      );
    return cache.get(file);
  };
  return (file, excerpt) => {
    let directory = path.posix.dirname(file),
      manifest;
    while (true) {
      const candidate =
        directory === "." ? "package.json" : directory + "/package.json";
      const content = read(candidate);
      if (content !== undefined) {
        manifest = { file: candidate, content };
        break;
      }
      if (directory === "." || directory === "/") break;
      directory = path.posix.dirname(directory);
    }
    return sourceJourneySkills(file, read(file) || excerpt, excerpt, manifest);
  };
}

import ts from "typescript";
import path from "node:path";
const isFunction = (node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isClassDeclaration(node);
function callName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node))
    return callName(node.expression) + "." + node.name.text;
  if (ts.isCallExpression(node)) return callName(node.expression) + "(...)";
  return "callback";
}
function enclosingName(node, source) {
  let parent = node.parent;
  while (parent) {
    if (isFunction(parent)) {
      if (parent.name) return parent.name.getText(source);
      if (ts.isVariableDeclaration(parent.parent))
        return parent.parent.name.getText(source);
    }
    parent = parent.parent;
  }
  return "";
}
export function functionLabel(node, source = node.getSourceFile()) {
  if (node.name)
    return { name: node.name.getText(source), nameKind: "declared" };
  let wrapped = node;
  while (
    wrapped.parent &&
    (ts.isParenthesizedExpression(wrapped.parent) ||
      ts.isAsExpression(wrapped.parent) ||
      ts.isSatisfiesExpression(wrapped.parent) ||
      ts.isNonNullExpression(wrapped.parent))
  )
    wrapped = wrapped.parent;
  const parent = wrapped.parent;
  if (parent && ts.isVariableDeclaration(parent))
    return { name: parent.name.getText(source), nameKind: "binding" };
  if (
    parent &&
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))
  ) {
    let owner = parent.parent;
    const parts = [parent.name.getText(source)];
    while (
      owner &&
      ts.isObjectLiteralExpression(owner) &&
      ts.isPropertyAssignment(owner.parent)
    ) {
      parts.unshift(owner.parent.name.getText(source));
      owner = owner.parent.parent;
    }
    if (
      owner &&
      ts.isObjectLiteralExpression(owner) &&
      ts.isVariableDeclaration(owner.parent)
    )
      parts.unshift(owner.parent.name.getText(source));
    return { name: parts.join("."), nameKind: "binding" };
  }
  if (
    parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  )
    return { name: parent.left.getText(source), nameKind: "binding" };
  const file = path.posix.basename(source.fileName.replaceAll("\\", "/"));
  if (parent && ts.isExportAssignment(parent))
    return { name: file + " default export", nameKind: "export_context" };
  if (parent && ts.isCallExpression(parent)) {
    let name = callName(parent.expression);
    const argument = parent.arguments[0];
    if (
      ts.isPropertyAccessExpression(parent.expression) &&
      /^(get|post|put|patch|delete|head|options|all|use)$/.test(
        parent.expression.name.text,
      ) &&
      argument &&
      ts.isStringLiteralLike(argument) &&
      argument.text.startsWith("/")
    )
      name += "(" + JSON.stringify(argument.text) + ")";
    const owner = ts.isVariableDeclaration(parent.parent)
      ? parent.parent.name.getText(source)
      : enclosingName(node, source);
    const index = parent.arguments.indexOf(wrapped);
    const count = parent.arguments.filter(
      (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
    ).length;
    return {
      name:
        (owner ? owner + " / " : "") +
        name +
        " callback" +
        (count > 1 ? " " + (index + 1) : ""),
      nameKind: "callback_context",
    };
  }
  const owner = enclosingName(node, source);
  const line =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  return {
    name:
      (owner ? owner + " / " : "") +
      (ts.isClassDeclaration(node) ? "Unnamed class" : "Unnamed function") +
      " (" +
      file +
      ":" +
      line +
      ")",
    nameKind: "source_location",
  };
}
// Build an index once per source file, preserving exact AST offsets for callbacks on the same line.
export function functionLabelIndex(file, content) {
  const source = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const entries = [];
  function visit(node) {
    if (isFunction(node))
      entries.push({
        start: node.getStart(source),
        end: node.end,
        startLine:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
        text: node.getText(source),
        ...functionLabel(node, source),
      });
    ts.forEachChild(node, visit);
  }
  visit(source);
  return entries;
}

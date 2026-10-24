// Best-effort filtering for discussion text and evidence. Never read environment files.
const credentialPatterns = () => [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g,
  /\b(?:[\w.-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|private[_-]?key))\s*[=:]\s*["'`]([^"'`\r\n]{8,})["'`]/gi,
];
export function containsCredential(text) {
  return credentialPatterns().some((pattern) => pattern.test(text));
}
export function redactCredentials(text) {
  for (const pattern of credentialPatterns())
    text = text.replace(
      pattern,
      (match) =>
        "[credential omitted]" + "\n".repeat(match.split("\n").length - 1),
    );
  return text;
}

export type WorkspaceMode = 'code' | 'split' | 'connections';
export function automaticWorkspaceMode(connectionCount: number): WorkspaceMode {
  return connectionCount <= 2 ? 'code' : 'split';
}
export function automaticGraphShare(connectionCount: number): number {
  return connectionCount >= 8 ? 52 : 44;
}
export type WorkspaceFolder = {
  name: string;
  path: string;
  folders: WorkspaceFolder[];
  files: string[];
};
export function workspaceFileTree(paths: string[]): WorkspaceFolder {
  const root: WorkspaceFolder = { name: '', path: '', folders: [], files: [] };
  for (const path of [...new Set(paths)].sort()) {
    let folder = root;
    const parts = path.split('/');
    parts.pop();
    for (const name of parts) {
      let child = folder.folders.find((entry) => entry.name === name);
      if (!child) {
        child = {
          name,
          path: [folder.path, name].filter(Boolean).join('/'),
          folders: [],
          files: [],
        };
        folder.folders.push(child);
      }
      folder = child;
    }
    folder.files.push(path);
  }
  return root;
}

/** Prefer the active function, then the smallest enclosing declaration over whole-file modules. */
export function componentForCitation(
  components: { id: string; referenceId: string }[],
  references: { id: string; file: string; startLine: number; endLine: number }[],
  citation: { file: string; startLine: number },
  currentId: string,
): string | undefined {
  const refs = new Map(references.map((reference) => [reference.id, reference]));
  const candidates = components.filter((component) => {
    const ref = refs.get(component.referenceId);
    return (
      ref?.file === citation.file &&
      ref.startLine <= citation.startLine &&
      ref.endLine >= citation.startLine
    );
  });
  const active = candidates.find((component) => component.id === currentId);
  if (active) return active.id;
  return (
    candidates.sort((a, b) => {
      const left = refs.get(a.referenceId)!;
      const right = refs.get(b.referenceId)!;
      return left.endLine - left.startLine - (right.endLine - right.startLine);
    })[0]?.id ||
    components.find((component) => refs.get(component.referenceId)?.file === citation.file)?.id
  );
}

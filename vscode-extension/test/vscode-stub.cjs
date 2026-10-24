// Only the editor API is substituted; activation, trees, commands, connection
// state and HTTP transport run unchanged against a real local HTTP server.
class EventEmitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
const configuration = new EventEmitter();
const folders = new EventEmitter();
const localEvents = new EventEmitter();
const selections = new EventEmitter();
const providers = new Map();
const handlers = new Map();
const errors = [];
const calls = [];
let baseUrl = '';
const documents = new Map(); const shown = []; const contentProviders = new Map(); const external = [];
const nodePath = require('node:path'); const { fileURLToPath } = require('node:url');
class Uri {
  constructor(value) { const parsed = /^([\w-]+):(?:\/\/([^/]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value); this.scheme = parsed[1]; this.authority = parsed[2] ?? ''; this.path = decodeURIComponent(parsed[3]); this.query = parsed[4] ?? ''; this.value = value; }
  static parse(value) { return new Uri(value); }
  static from(value) { return new Uri(`${value.scheme}:${value.scheme === 'file' || value.authority ? '//' + (value.authority ?? '') : ''}${value.path}${value.query ? '?' + value.query : ''}`); }
  static joinPath(base, ...parts) { return Uri.from({ scheme: base.scheme, authority: base.authority, path: nodePath.posix.join(base.path, ...parts) }); }
  get fsPath() { return this.scheme === 'file' ? fileURLToPath(this.value) : this.path; }
  toString() { return this.value; }
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a,b) : a; this.end = typeof c === 'number' ? new Position(c,d) : b; } }
module.exports = {
  Range, Selection: Range, Position, TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
  ViewColumn: { One: 1, Beside: -2 },
  env: { openExternal: async uri => { external.push(uri.toString()); return true; } },
  Uri, extensions: { getExtension: () => undefined },
  EventEmitter, TreeItem: class { constructor(label) { this.label = label; } },
  ThemeIcon: class { constructor(id) { this.id = id; } }, TreeItemCollapsibleState: { None: 0 },
  workspace: {
    registerTextDocumentContentProvider(scheme, provider) { contentProviders.set(scheme, provider); return { dispose: () => contentProviders.delete(scheme) }; },
    async openTextDocument(uri) {
      if (documents.has(uri.toString())) return documents.get(uri.toString());
      const text = uri.scheme === 'file' ? await require('node:fs/promises').readFile(uri.fsPath, 'utf8') : await contentProviders.get(uri.scheme).provideTextDocumentContent(uri);
      const lines = text.split('\n'); const document = { uri, isDirty: false, version: 1, getText: () => text, lineCount: lines.length, lineAt: index => ({ text: lines[index].replace(/\r$/, '') }) };
      documents.set(uri.toString(), document); return document;
    },
    isTrusted: true,
    getWorkspaceFolder(uri) { return this.workspaceFolders?.filter(folder => uri.scheme === folder.uri.scheme && uri.authority === folder.uri.authority && (uri.path === folder.uri.path || uri.path.startsWith(folder.uri.path + '/'))).sort((a, b) => b.uri.path.length - a.uri.path.length)[0]; },
    name: undefined, workspaceFolders: undefined,
    getConfiguration: () => ({ get: () => baseUrl }),
    onDidChangeConfiguration: configuration.event,
    onDidChangeWorkspaceFolders: folders.event,
    onDidChangeTextDocument: localEvents.event, onDidSaveTextDocument: localEvents.event, onDidGrantWorkspaceTrust: localEvents.event,
  },
  window: {
    createTreeView(id, options) {
      const registration = this.registerTreeDataProvider(id, options.treeDataProvider); const events = new EventEmitter();
      return { visible: false, onDidChangeVisibility: events.event, dispose() { registration.dispose(); events.dispose(); } };
    },
    async showTextDocument(document) { const editor = { document, selection: undefined, revealRange: () => {} }; shown.push(editor); return editor; },
    onDidChangeActiveTextEditor: localEvents.event, onDidChangeTextEditorSelection: selections.event,
    registerTreeDataProvider(id, provider) {
      if (providers.has(id)) throw new Error('Duplicate view registration');
      providers.set(id, provider); return { dispose: () => providers.delete(id) };
    },
    showErrorMessage: async message => { errors.push(message); },
  },
  commands: {
    registerCommand(id, handler) {
      if (handlers.has(id)) throw new Error('Duplicate command registration');
      handlers.set(id, handler); return { dispose: () => handlers.delete(id) };
    },
    executeCommand: async (...args) => { calls.push(args); },
  },
  testState: {
    providers, handlers, errors, calls, configuration, folders, selections, documents, shown, external,
    setBaseUrl: value => { baseUrl = value; },
  },
};

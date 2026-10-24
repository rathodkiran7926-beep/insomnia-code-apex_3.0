/* Presentation-only sidebar UI. All actions are guarded and executed in the extension host. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('focus-root');
  let epoch = 0;
  let current = null;
  const saved = vscode.getState() || {};
  const expanded = { tasks: Boolean(saved.tasks), handoffs: Boolean(saved.handoffs), details: Boolean(saved.details) };
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  };
  const truncate = (value, max = 44) => String(value ?? '').length > max ? `${String(value).slice(0, max - 1)}…` : String(value ?? '');
  const action = (label, name, options = {}) => {
    const button = make('button', ['cm-button', options.primary ? 'primary' : '', options.subtle ? 'subtle' : '', options.small ? 'compact' : ''].filter(Boolean).join(' '));
    button.type = 'button'; button.title = options.title || label; button.disabled = Boolean(options.disabled);
    if (options.icon) { const i = make('span', 'cm-icon', options.icon); i.setAttribute('aria-hidden', 'true'); button.append(i); }
    button.append(make('span', 'button-label', label));
    button.addEventListener('click', () => {
      button.disabled = true;
      vscode.postMessage({ type: 'action', epoch, action: name, ...(options.id ? { id: options.id } : {}) });
      // Host emits new state; re-enable if a command was rejected without a refresh.
      window.setTimeout(() => { if (button.isConnected) button.disabled = Boolean(options.disabled); }, 1400);
    });
    return button;
  };
  const section = (label, name, count) => {
    const details = make('details', 'cm-section'); details.open = expanded[name];
    const summary = make('summary', 'cm-section-label');
    summary.append(make('span', 'cm-chevron', '⌄'), make('span', '', label));
    if (typeof count === 'number' || typeof count === 'string') summary.append(make('span', 'cm-count', count));
    details.append(summary);
    details.addEventListener('toggle', () => { expanded[name] = details.open; vscode.setState(expanded); });
    return details;
  };
  const statusPill = (text, variant) => make('span', `cm-pill ${variant}`, text);
  const shortSha = sha => sha ? String(sha).slice(0, 9) : 'Unknown';
  const shortDate = date => typeof date === 'string' ? date.slice(0, 10) : 'Saved';
  const callout = (message, type = 'info') => make('p', `cm-message ${type}`, message);

  function render(model) {
    current = model;
    const fragment = document.createDocumentFragment();
    const header = make('header', 'cm-header');
    const title = make('div', 'cm-title'); title.append(make('span', 'cm-logo', '◈'), make('span', '', 'Codebase Mentor'));
    header.append(title, action('Refresh', 'check', { icon: '↻', small: true, subtle: true, title: 'Check backend connectivity' }));
    fragment.append(header);
    const repo = model.repository;
    const connected = model.connection.status === 'connected';
    const verified = Boolean(repo?.usable && connected);
    const card = make('section', 'cm-repository cm-card');
    const repoHead = make('div', 'cm-repo-head');
    const repoName = make('div', 'cm-repo-heading');
    const identifier = make('strong', 'cm-ellipsis', repo?.name || model.workspace); identifier.title = repo?.name || model.workspace;
    repoName.append(identifier, make('small', 'cm-ellipsis muted', `Workspace · ${model.workspace}`));
    repoHead.append(repoName, statusPill(!connected ? (model.connection.status === 'connecting' ? 'Connecting' : 'Offline') : verified ? 'Connected' : repo?.snapshot ? 'Unverified' : 'Not linked', verified ? 'good' : connected ? 'warn' : 'bad'));
    card.append(repoHead);
    if (repo?.snapshot) {
      const stats = make('div', 'cm-stats');
      const values = [['Snapshot', shortSha(repo.snapshot)], ['Branch', repo.branch], ['Revision', repo.revision === 'matched' ? 'Matched' : repo.revision === 'different' ? 'Different' : 'Unknown']];
      for (const [label, value] of values) { const item = make('div', 'cm-stat'); item.append(make('small', 'muted', label), make('strong', 'cm-ellipsis', value)); item.title = `${label}: ${value}`; stats.append(item); }
      card.append(stats);
    } else card.append(make('p', 'cm-muted', model.folderCount ? 'Connect an analyzed snapshot to get started.' : 'Open a repository folder to get started.'));
    if (!connected) card.append(callout('Backend unavailable. Check the server and retry.', 'warn'));
    else if (repo?.snapshot && repo?.revision !== 'matched') card.append(callout('Indexed code may differ from your local files. Source navigation remains version-aware.', 'warn'));
    fragment.append(card);

    const titleRow = make('div', 'cm-heading-row'); titleRow.append(make('h2', '', 'Quick actions')); fragment.append(titleRow);
    const primary = make('div', 'cm-actions');
    primary.append(action(repo?.snapshot ? 'Change snapshot' : 'Connect repo', repo?.snapshot ? 'changeSnapshot' : 'connect', { icon: '⌁', disabled: !model.folderCount || !model.trusted }));
    primary.append(action('Explain code', 'explain', { icon: '✦', primary: true, disabled: !verified || !model.selection }));
    primary.append(action('Open Mentor', 'mentor', { icon: '▤', disabled: !verified }));
    primary.append(action('Ask Senior', 'senior', { icon: '↗', disabled: !verified }));
    primary.append(action('Full architecture', 'webArchitecture', { icon: '◇', title: 'Explore the entire indexed repository graph inside VS Code', disabled: !verified }));
    fragment.append(primary);

    const selectionTitle = make('div', 'cm-heading-row'); selectionTitle.append(make('h2', '', 'Current selection')); fragment.append(selectionTitle);
    const selectionBox = make('div', 'cm-selection cm-card');
    if (model.selection) {
      const file = make('strong', 'cm-ellipsis', model.selection.name); file.title = model.selection.file;
      selectionBox.append(file, make('small', 'muted cm-ellipsis', `${model.selection.file} · line ${model.selection.line}${model.selection.dirty ? ' · unsaved edits' : ''}`));
      const row = make('div', 'cm-inline-actions');
      row.append(action('Explain', 'explain', { icon: '✦', small: true, disabled: !verified }), action('Architecture', 'related', { icon: '◇', small: true, disabled: !verified }));
      selectionBox.append(row);
    } else selectionBox.append(make('p', 'cm-muted', 'Open a source file and select a function to explore it.'));
    fragment.append(selectionBox);

    function renderSaved(kind, state, label, empty, newLabel, newCommand, refreshName, openName) {
      const panel = section(label, kind, state.status === 'disabled' ? 'Off' : state.items.length);
      const body = make('div', 'cm-section-body');
      if (state.status === 'disabled') {
        body.append(callout(kind === 'tasks' ? 'Saved Tasks are off. Enable CODEBASE_MENTOR_LOCAL_CHECKPOINTS=1 on the local backend.' : 'Handoffs are off. Enable CODEBASE_MENTOR_LOCAL_HANDOFFS=1 on the local backend.', 'info'));
      } else if (['error', 'cancelled'].includes(state.status)) body.append(callout(state.message, 'warn'));
      if (!state.items.length && state.status !== 'disabled') body.append(make('p', 'cm-muted', state.status === 'loading' ? 'Loading…' : state.status === 'idle' ? 'Refresh to load your saved items.' : empty));
      for (const item of state.items) {
        const row = make('div', 'cm-saved-row');
        const text = make('div', 'cm-saved-info');
        const name = make('strong', 'cm-ellipsis', truncate(item.title, 110)); name.title = item.title;
        text.append(name, make('small', 'muted', shortDate(item.createdAt))); row.append(text);
        const controls = make('div', 'cm-row-actions');
        controls.append(action(kind === 'tasks' ? 'Resume' : 'Open', openName, { small: true, id: item.id, disabled: !verified }));
        const menu = make('details', 'cm-item-menu');
        const menuTrigger = make('summary', 'cm-more', '⋯'); menuTrigger.title = `More actions for ${item.title}`;
        menuTrigger.setAttribute('aria-label', `More actions for ${item.title}`); menu.append(menuTrigger);
        const menuBody = make('div', 'cm-menu-actions');
        if (kind === 'tasks') {
          menuBody.append(action('Details', 'detailsTask', { small: true, id: item.id, disabled: !verified }));
          menuBody.append(action('Ask Senior', 'seniorTask', { small: true, id: item.id, disabled: !verified }));
        }
        menuBody.append(action('Delete', kind === 'tasks' ? 'deleteTask' : 'deleteHandoff', { small: true, id: item.id, disabled: !verified, title: `Delete ${item.title}` }));
        menu.append(menuBody); controls.append(menu);
        row.append(controls); body.append(row);
      }
      const buttons = make('div', 'cm-inline-actions');
      buttons.append(action(newLabel, newCommand, { icon: '+', small: true, disabled: !verified || state.status === 'disabled' }),
        action('Refresh', refreshName, { icon: '↻', small: true, subtle: true, disabled: !verified }));
      if (state.previous) buttons.append(action('Previous', kind === 'tasks' ? 'previousTasks' : 'previousHandoffs', { small: true }));
      if (state.more) buttons.append(action('Next', kind === 'tasks' ? 'nextTasks' : 'nextHandoffs', { small: true }));
      body.append(buttons); panel.append(body); return panel;
    }
    fragment.append(renderSaved('tasks', model.tasks, 'Saved Tasks', 'No saved checkpoints yet.', 'Save task', 'saveTask', 'refreshTasks', 'resumeTask'));
    fragment.append(renderSaved('handoffs', model.handoffs, 'Saved Handoffs', 'No saved handoffs yet.', 'New handoff', 'senior', 'refreshHandoffs', 'openHandoff'));

    const details = section('Repository details & settings', 'details');
    const detail = make('div', 'cm-section-body cm-details');
    const fields = [ ['Backend', model.connection.status], ['Repository', repo?.name || 'Not connected'], ['Snapshot ID', repo?.snapshot || 'None'], ['Indexed commit', repo?.commit || 'Unknown'], ['Local HEAD', repo?.head || 'Unknown'], ['Identity', repo?.identity || 'Unknown'], ['Revision', repo?.revision || 'Unknown'], ['Local changes', repo?.dirty ? 'Present' : 'Not reported'] ];
    for (const [label, value] of fields) { const line = make('div', 'cm-detail'); line.append(make('span', 'muted', label), make('span', 'cm-detail-value', value)); line.lastChild.title = value; detail.append(line); }
    const advanced = make('div', 'cm-inline-actions');
    advanced.append(action('Connect', 'connect', { small: true, disabled: !model.folderCount }), action('Refresh repo', 'refreshRepo', { small: true, disabled: !model.folderCount }), action('Disconnect', 'disconnect', { small: true, disabled: !repo?.snapshot }), action('Settings', 'settings', { small: true }));
    detail.append(advanced);
    if (repo?.message) detail.append(callout(repo.message));
    details.append(detail); fragment.append(details);
    const footer = make('footer', 'cm-footer');
    footer.append(make('span', connected ? 'cm-health good-text' : 'cm-health muted', connected ? '● Backend healthy' : '○ Backend unavailable'));
    footer.append(action('Changes', 'changes', { small: true, subtle: true, icon: '↗' }));
    fragment.append(footer);
    root.replaceChildren(fragment);
  }
  window.addEventListener('message', event => {
    const message = event.data;
    if (!message || message.type !== 'render' || typeof message.epoch !== 'number' || !message.model) return;
    epoch = message.epoch; render(message.model);
  });
  vscode.postMessage({ type: 'ready' });
})();

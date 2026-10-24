(() => {
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    vscode.postMessage({ type: button.dataset.action, draftId: button.dataset.draft, viewId: button.dataset.view, checkpointId: button.dataset.checkpoint, referenceId: button.dataset.reference, componentId: button.dataset.component });
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id !== 'checkpoint-draft') return;
    event.preventDefault();
    if (!form.checkValidity()) return;
    const value = name => form.elements.namedItem(name).value;
    const taskTitle = value('taskTitle');
    const notes = { discovery: value('discovery'), unresolved: value('unresolved'), nextStep: value('nextStep') };
    const sourceReferenceIds = Array.from(form.querySelectorAll('input[name="sourceReferenceIds"]:checked'), input => input.value);
    if (!taskTitle.trim() || taskTitle.length > 200 || Object.values(notes).some(note => note.length > 2000) || sourceReferenceIds.length > 8) {
      const status = document.getElementById('status');
      if (status) {
        status.textContent = 'Enter a task title, keep notes within 2000 characters each and choose at most 8 source references.';
        status.dataset.status = 'error';
      }
      return;
    }
    vscode.postMessage({ type: 'preview', draftId: form.dataset.draft, fields: { taskTitle, notes, sourceReferenceIds } });
  });
  window.addEventListener('message', event => {
    if (event.data?.type === 'status' && typeof event.data.message === 'string' && typeof event.data.status === 'string') {
      const status = document.getElementById('status'); if (status) { status.textContent = event.data.message; status.dataset.status = event.data.status; }
      if (typeof event.data.unavailable === 'boolean') {
        const submit = document.querySelector('button[type="submit"]');
        if (submit) submit.disabled = event.data.unavailable || ['loading', 'saving', 'disabled'].includes(event.data.status);
      }
      return;
    }
    if (event.data?.type !== 'render' || typeof event.data.body !== 'string') return;
    const root = document.getElementById('checkpoint-root');
    const active = document.activeElement;
    const hadFocus = active && root.contains(active);
    const key = element => JSON.stringify([element.id, element.name, element.value, ...['action', 'reference', 'component', 'handoff', 'checkpoint'].map(name => element.dataset[name])]);
    const focusedKey = hadFocus && (active.id || active.name || active.dataset.action) ? key(active) : undefined;
    root.innerHTML = event.data.body;
    if (hadFocus) {
      const replacement = Array.from(root.querySelectorAll('button, input, textarea, summary')).find(element => !element.disabled && key(element) === focusedKey);
      (replacement || root.querySelector('main'))?.focus({ preventScroll: true });
    }
    root.dataset.checkpointReady = 'true';
    document.documentElement.dataset.checkpointReady = 'true';
  });
  vscode.postMessage({ type: 'ready' });
})();

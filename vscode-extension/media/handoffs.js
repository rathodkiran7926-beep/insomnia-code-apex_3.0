(() => {
  const vscode = acquireVsCodeApi();
  const validationError = message => {
    const status = document.getElementById('status');
    if (status) { status.textContent = message; status.dataset.status = 'error'; }
  };
  const identity = element => ({ viewId: element.dataset.view, draftId: element.dataset.draft, handoffId: element.dataset.handoff, referenceId: element.dataset.reference });
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    vscode.postMessage({ type: button.dataset.action, ...identity(button) });
  });
  // Changing review controls invalidates the visible package until explicitly rebuilt.
  document.addEventListener('change', event => {
    if (!event.target.closest('#handoff-selection')) return;
    if (event.target.name === 'referenceIds' && !event.target.checked) {
      const excluded = event.target.value;
      for (const edge of document.querySelectorAll('input[name="relationshipIds"]')) {
        const required = JSON.parse(edge.dataset.referenceIds || '[]');
        if (required.includes(excluded)) edge.checked = false;
      }
      for (const excerpt of document.querySelectorAll('input[name="excerptReferenceIds"]')) if (excerpt.value === excluded) excerpt.checked = false;
    }
    const save = document.querySelector('button[data-action="save"]');
    if (save) save.disabled = true;
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.id !== 'handoff-compose' && form.id !== 'handoff-selection') return;
    event.preventDefault();
    if (!form.checkValidity()) return;
    if (form.id === 'handoff-compose') {
      const value = name => form.elements.namedItem(name).value;
      const fields = { question: value('question'), attemptedSteps: value('attemptedSteps'), additionalContext: value('additionalContext') };
      if (!fields.question.trim() || fields.question.length > 1500 || fields.attemptedSteps.length > 2000 || fields.additionalContext.length > 2000) {
        validationError('Enter a question and keep each field within its character limit.');
        return;
      }
      vscode.postMessage({ type: 'preview', ...identity(form), fields });
      return;
    }
    const selected = name => Array.from(form.querySelectorAll(`input[name="${name}"]:checked`), input => input.value);
    const selection = { referenceIds: selected('referenceIds'), relationshipIds: selected('relationshipIds'), excerptReferenceIds: selected('excerptReferenceIds'), includeDocumentation: form.elements.namedItem('includeDocumentation').checked, includeCheckpointNotes: form.elements.namedItem('includeCheckpointNotes').checked };
    if (selection.referenceIds.length > 16 || selection.relationshipIds.length > 5 || selection.excerptReferenceIds.length > 4) {
      validationError('Choose at most 16 source references, 5 relationships and 4 excerpts, then apply the selection again.');
      return;
    }
    vscode.postMessage({ type: 'refine', ...identity(form), selection });
  });
  window.addEventListener('message', event => {
    if (event.data?.type === 'status' && typeof event.data.message === 'string' && typeof event.data.status === 'string') {
      const status = document.getElementById('status');
      if (status) { status.textContent = event.data.message; status.dataset.status = event.data.status; }
      if (typeof event.data.unavailable === 'boolean') {
        const submit = document.querySelector('button[type="submit"]');
        if (submit) submit.disabled = event.data.unavailable || ['loading', 'saving', 'disabled'].includes(event.data.status);
      }
      return;
    }
    if (event.data?.type !== 'render' || typeof event.data.body !== 'string') return;
    const root = document.getElementById('handoff-root');
    const active = document.activeElement;
    const hadFocus = active && root.contains(active);
    const key = element => JSON.stringify([element.id, element.name, element.value, ...['action', 'reference', 'component', 'handoff', 'checkpoint'].map(name => element.dataset[name])]);
    const focusedKey = hadFocus && (active.id || active.name || active.dataset.action) ? key(active) : undefined;
    root.innerHTML = event.data.body;
    if (hadFocus) {
      const replacement = Array.from(root.querySelectorAll('button, input, textarea, summary')).find(element => !element.disabled && key(element) === focusedKey);
      (replacement || root.querySelector('main'))?.focus({ preventScroll: true });
    }
    root.dataset.handoffReady = 'true';
    document.documentElement.dataset.handoffReady = 'true';
  });
  vscode.postMessage({ type: 'ready' });
})();

(() => {
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    vscode.postMessage({ type: button.dataset.action, answerId: button.dataset.answer, referenceId: button.dataset.reference });
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'follow-up') return;
    event.preventDefault();
    const input = document.getElementById('question');
    if (input.value.trim() && input.value.length <= 1500) vscode.postMessage({ type: 'ask', question: input.value.trim(), answerId: event.target.dataset.answer });
  });
  window.addEventListener('message', event => {
    if (event.data?.type !== 'render' || typeof event.data.body !== 'string') return;
    const root = document.getElementById('mentor-root');
    const active = document.activeElement;
    const hadFocus = active && root.contains(active);
    const key = element => JSON.stringify([element.id, element.name, element.value, ...['action', 'reference', 'component', 'handoff', 'checkpoint'].map(name => element.dataset[name])]);
    const focusedKey = hadFocus && (active.id || active.name || active.dataset.action) ? key(active) : undefined;
    const composer = root.querySelector('#question');
    const draft = composer && document.activeElement === composer ? composer.value : undefined;
    const thread = root.querySelector('.chat-thread');
    const nearEnd = thread && (window.scrollY + window.innerHeight > document.documentElement.scrollHeight - 150);
    root.innerHTML = event.data.body;
    if (draft !== undefined && root.querySelector('#question')) root.querySelector('#question').value = draft;
    if (hadFocus) {
      const replacement = Array.from(root.querySelectorAll('button, input, textarea, summary')).find(element => !element.disabled && key(element) === focusedKey);
      (replacement || root.querySelector('main'))?.focus({ preventScroll: true });
    }
    if (nearEnd && !hadFocus) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
    document.documentElement.dataset.mentorReady = 'true';
  });
  vscode.postMessage({ type: 'ready' });
})();

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
    document.getElementById('mentor-root').innerHTML = event.data.body;
    document.documentElement.dataset.mentorReady = 'true';
  });
  vscode.postMessage({ type: 'ready' });
})();

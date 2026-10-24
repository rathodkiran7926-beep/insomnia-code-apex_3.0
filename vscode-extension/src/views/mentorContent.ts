import type { MentorState, MentorResult } from '../mentorController';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function turn(result: MentorResult, active: boolean): string {
  const e = escapeHtml;
  const citations = result.answer.citations.map(ref => `<li><button class="citation" data-action="citation" data-answer="${e(result.id)}" data-reference="${e(ref.id)}" aria-label="Open indexed source ${e(ref.file)} lines ${ref.startLine} to ${ref.endLine}">${e(ref.file)}:${ref.startLine}–${ref.endLine} ↗</button></li>`).join('');
  const indexed = result.indexedOnly ? `<div class="indexed-warning" role="note">Indexed snapshot only · Local revision or source is different or unverified. No editor buffer uploaded.</div>` : '';
  const mode = result.answer.mode === 'facts' ? 'Facts-only explanation' : 'AI-assisted explanation · Review required';
  const split = result.answer.answer.length > 1400 ? Math.max(900, result.answer.answer.lastIndexOf('\n', 1100)) : result.answer.answer.length;
  const answer = `<div ${active ? 'id="answer"' : ''} class="answer">${e(result.answer.answer.slice(0,split))}</div>${split < result.answer.answer.length ? `<details class="answer-more"><summary>Read more</summary><div class="answer">${e(result.answer.answer.slice(split))}</div></details>` : ''}`;
  return `<article class="conversation-turn${active ? ' active' : ''}" data-turn="${e(result.id)}">
    <div class="chat-line user"><div class="chat-bubble question-bubble"><div class="chat-label">You</div><div>${e(result.question)}</div></div></div>
    <div class="chat-line assistant"><div class="avatar" aria-hidden="true">✧</div><div class="chat-bubble answer-bubble">
      <div class="chat-header"><strong>Codebase Mentor</strong><span class="mode">${mode}</span></div>
      ${indexed}<div class="notice">${e(result.answer.notice)}</div>${answer}
      <details class="evidence" ${active ? 'id="evidence-title"' : ''}><summary>Source evidence${result.answer.citations.length ? ` · ${result.answer.citations.length} references` : ''}</summary>
        <p class="muted">Local source opens only when text and revision are verified. Otherwise, read-only indexed source opens.</p><ul class="citations">${citations || '<li class="muted">No citations available for this answer.</li>'}</ul>
      </details>
      <div class="scope">${e(result.scopeNotice)}</div>
    </div></div></article>`;
}

export function renderMentorBody(state: MentorState): string {
  const e = escapeHtml;
  const result = state.result;
  const loading = state.status === 'loading';
  // Conversation is scoped to a single pinned component, not a global cross-repo chat.
  const entries = result && state.history?.length
    ? state.history.filter(item => item.binding?.backendUrl === result.binding?.backendUrl &&
        item.snapshot.snapshotId === result.snapshot.snapshotId &&
        item.component.id === result.component.id && item.component.referenceId === result.component.referenceId)
    : result ? [result] : [];
  const status = `<div id="status" role="status" aria-live="polite" data-status="${state.status}">${e(state.message)}</div>`;
  const controls = `<nav class="top-actions" aria-label="Mentor history and actions">${loading ? '<button data-action="cancel">Cancel request</button>' : ''}${state.status === 'error' ? '<button data-action="retry">Retry</button>' : ''}<button data-action="previous" ${!state.canPrevious ? 'disabled' : ''}>← Previous</button><button data-action="latest" ${!state.canLatest ? 'disabled' : ''}>Latest →</button></nav>`;
  if (!result) return `<main tabindex="-1" class="mentor-chat"><header class="chat-top"><span class="eyebrow">CODEBASE MENTOR</span><h1>Ask about your code</h1><p class="muted">Select a function in a connected workspace and run <strong>Explain Selection</strong>. The Mentor uses indexed repository evidence.</p></header>${status}${controls}</main>`;
  const context = `<header class="chat-top"><div class="chat-title"><span class="avatar" aria-hidden="true">✧</span><div><span class="eyebrow">CODEBASE MENTOR · INDEXED SOURCE</span><h1>${e(result.component.name)}</h1><p class="muted">${e(result.component.role)} · ${e(result.componentSource?.file ?? 'Indexed component source')}</p></div></div><details class="context"><summary>Repository and source version</summary><p>${e(result.snapshot.repositoryIdentity)}</p><p>Snapshot ${e(result.snapshot.snapshotId)} · Commit <code>${e(result.snapshot.indexedCommit)}</code></p><p>${e(result.scopeNotice)}</p></details></header>`;
  const actionLine = `<nav class="context-actions" aria-label="Context actions"><button data-action="related" data-answer="${e(result.id)}" ${loading?'disabled':''}>◇ Architecture</button><button data-action="handoff" data-answer="${e(result.id)}" ${loading?'disabled':''}>↗ Ask Senior</button></nav>`;
  return `<main tabindex="-1" class="mentor-chat">${context}${status}${controls}<section class="chat-thread" aria-label="Question and answer conversation">${entries.map(item => turn(item, item.id === result.id)).join('')}${loading ? '<p class="typing" role="status">Codebase Mentor is reading indexed evidence…</p>' : ''}</section>${actionLine}
  <section class="composer"><form id="follow-up" data-answer="${e(result.id)}"><label for="question">Ask a follow-up</label><div class="composer-row"><textarea id="question" name="question" rows="2" maxlength="1500" placeholder="Ask about this component…" ${loading?'disabled':''} required></textarea><button type="submit" ${loading?'disabled':''} aria-label="Send follow-up question">Send ↗</button></div></form><p class="muted">Each follow-up is an independent question scoped to this indexed component; up to five answers are kept in this window. No persistent chat memory is claimed.</p></section></main>`;
}

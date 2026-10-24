import type { MentorState } from '../mentorController';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
export function renderMentorBody(state: MentorState): string {
  const result = state.result; const loading = state.status === 'loading';
  const disabled = loading ? 'disabled' : '';
  const status = `<div id="status" role="status" aria-live="polite" data-status="${state.status}">${escapeHtml(state.message)}</div>`;
  const controls = `<nav aria-label="Mentor actions">${loading ? '<button data-action="cancel">Cancel request</button>' : ''}${state.status === 'error' ? '<button data-action="retry">Retry</button>' : ''}<button data-action="previous" ${!state.canPrevious ? 'disabled' : ''}>Previous answer</button><button data-action="latest" ${!state.canLatest ? 'disabled' : ''}>Latest answer</button></nav>`;
  if (!result) return `<main tabindex="-1"><header><p class="eyebrow">CODEBASE MENTOR</p><h1>Understand the indexed code</h1></header>${status}${controls}<p>Select a function in a connected workspace and run <strong>Codebase Mentor: Explain Selection</strong>.</p></main>`;
  const text = result.answer.answer;
  const split = text.length > 1100 ? Math.max(500, text.lastIndexOf('\n', 800)) : text.length;
  const explanation = `<div id="answer" class="answer">${escapeHtml(text.slice(0, split))}</div>${split < text.length ? `<details><summary>More detail</summary><div class="answer">${escapeHtml(text.slice(split))}</div></details>` : ''}`;
  const citations = result.answer.citations.map(reference => `<li><button class="citation" data-action="citation" data-answer="${escapeHtml(result.id)}" data-reference="${escapeHtml(reference.id)}" aria-label="Open indexed source ${escapeHtml(reference.file)} lines ${reference.startLine} to ${reference.endLine}">${escapeHtml(reference.file)}:${reference.startLine}–${reference.endLine}</button></li>`).join('');
  return `<main tabindex="-1"><header><p class="eyebrow">CODEBASE MENTOR · INDEXED SOURCE</p><h1>Explaining indexed component: ${escapeHtml(result.component.name)}</h1><p>${escapeHtml(result.component.role)} · ${escapeHtml(result.componentSource?.file ?? 'Indexed component source')}</p><p class="muted">${escapeHtml(result.snapshot.repositoryIdentity)}<br>Snapshot ${escapeHtml(result.snapshot.snapshotId)}<br>Commit <code>${escapeHtml(result.snapshot.indexedCommit)}</code></p></header>
  ${status}${controls}<button data-action="related" data-answer="${escapeHtml(result.id)}" ${disabled}>Show related code in Map</button><button data-action="handoff" data-answer="${escapeHtml(result.id)}" ${disabled}>Ask Senior About This</button><p class="scope">${escapeHtml(result.scopeNotice)}${result.indexedOnly ? ' Local source is different or unverified; this answer describes the indexed snapshot.' : ''}</p>
  <section aria-labelledby="explanation-title"><h2 id="explanation-title">${result.answer.mode === 'facts' ? 'Facts-only explanation' : 'AI-assisted explanation · Review required'}</h2><p class="muted"><strong>Question:</strong> ${escapeHtml(result.question)}</p><p class="notice">${escapeHtml(result.answer.notice)}</p>${explanation}</section>
  <section aria-labelledby="evidence-title"><h2 id="evidence-title">Source evidence</h2><p class="muted">Local files open only when their text and revision are verified. Otherwise, citations open read-only indexed source.</p><ul class="citations">${citations}</ul></section>
  <section aria-labelledby="follow-up-title"><h2 id="follow-up-title">Ask about ${escapeHtml(result.component.name)}</h2><form id="follow-up" data-answer="${escapeHtml(result.id)}"><label for="question">Follow-up question</label><textarea id="question" name="question" rows="2" maxlength="1500" required ${disabled}></textarea><button type="submit" ${disabled}>Ask follow-up</button></form><p class="muted">Each follow-up is an independent question scoped to this indexed component. Up to five answers are kept in this window; no persistent chat memory is claimed.</p></section></main>`;
}

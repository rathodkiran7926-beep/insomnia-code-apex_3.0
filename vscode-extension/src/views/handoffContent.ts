import type { HandoffCapability, HandoffSelection, HandoffInput, HandoffPage, HandoffPreview, SavedHandoff } from '../api-client/handoffContracts';
import type { RepositoryBinding } from '../repository';
import type { SourceReference } from '../api-client/mentorContracts';
import { escapeHtml as e } from './mentorContent';

export interface HandoffViewState {
  status: string; message: string; viewId: string; binding?: RepositoryBinding;
  preview?: HandoffPreview; detail?: SavedHandoff; page?: HandoffPage; capability?: HandoffCapability;
}
export interface HandoffDraft {
  id: string; binding: RepositoryBinding; input: HandoffInput; preview?: HandoffPreview; mode: 'compose' | 'review'; pendingSelection?:HandoffSelection;
}

function sourceLabel(reference: SourceReference): string {
  return `${e(reference.file)}:${reference.startLine}–${reference.endLine}`;
}

/** Pure renderer: all backend and authored content remains escaped text. */
export function renderHandoffBody(state: HandoffViewState, draft?: HandoffDraft): string {
  const busy = ['loading', 'saving', 'previewing'].includes(state.status);
  const gated = state.capability?.enabled === false;
  const disabled = busy ? ' disabled' : '';
  const action = (type: string, label: string, attributes = '', unavailable = false) => `<button type="button" data-action="${type}"${attributes} data-view="${e(state.viewId)}"${(busy && type !== 'cancel') || unavailable ? ' disabled' : ''}>${label}</button>`;
  const draftAttributes = draft ? ` data-draft="${e(draft.id)}"` : '';
  const notices = (items: string[]) => items.map(item => `<p class="notice">${e(item)}</p>`).join('');
  const capability = state.capability ? `<details${gated ? ' open' : ''}><summary>Local preparation and privacy</summary>${notices([state.capability.notice])}</details>` : '';
  const start = `<main tabindex="-1"><header><p class="eyebrow">CODEBASE MENTOR · HANDOFFS</p><h1>${draft ? draft.mode === 'review' ? 'Review handoff' : 'Prepare handoff' : state.detail ? 'Saved handoff' : 'Your handoffs'}</h1></header><div id="status" role="status" aria-live="polite" data-status="${e(state.status)}">${e(state.message)}</div>${capability}<p class="notice">Local single-user preparation. Manual export only; no delivery or maintainer response is tracked.</p>`;
  const identity = (binding: Pick<RepositoryBinding, 'repositoryIdentity' | 'snapshotId' | 'indexedCommit'>) => `<p class="muted">Repository ${e(binding.repositoryIdentity)}<br>Snapshot ${e(binding.snapshotId)}<br>Indexed commit <code>${e(binding.indexedCommit)}</code></p>`;
  if (draft) {
    const destination = `<p class="notice">Build Preview sends your question, attempted steps, additional context and selected evidence IDs to backend endpoint <code>${e(draft.binding.backendUrl)}</code>. Source excerpts are off unless you explicitly select them in review.</p>${identity(draft.binding)}<p class="scope">Selected indexed component: ${e(draft.input.componentId ?? "source references only")}<br>Origin: ${e(draft.input.origin.type)}. Local edits are outside this indexed context.</p>`;
    const cancel = action('cancel', 'Cancel', draftAttributes);
    const preview = draft.preview;
    if (draft.mode === 'compose' || !preview) {
      const fields = ([['question', 'Question', 1500], ['attemptedSteps', 'What you tried (optional)', 2000], ['additionalContext', 'Additional context (optional)', 2000]] as const).map(([name, label, max]) => `<label for="handoff-${name}">${label} (${max} characters maximum)</label><textarea id="handoff-${name}" name="${name}" rows="${name === 'question' ? 4 : 3}" maxlength="${max}"${name === 'question' ? ' required' : ''}${disabled}>${e(draft.input[name])}</textarea>`).join('');
      return `${start}${destination}<form id="handoff-compose" data-view="${e(state.viewId)}"${draftAttributes}>${fields}<button type="submit"${busy || gated ? ' disabled' : ''}>Build Preview</button></form><nav>${cancel}</nav></main>`;
    }
    const selection = draft.pendingSelection ?? preview.selection;
    const checked = (value: boolean) => value ? ' checked' : '';
    const refs = preview.candidates.references.map(ref => `<label><input type="checkbox" name="referenceIds" value="${e(ref.id)}"${checked(selection.referenceIds.includes(ref.id))}${disabled}> ${sourceLabel(ref)}<br><span class="muted">Reference ${e(ref.id)} · Snapshot ${e(ref.snapshotId)}</span></label>`).join('');
    const edges = preview.candidates.relationships.map(edge => `<label><input type="checkbox" name="relationshipIds" value="${e(edge.id)}" data-reference-ids="${e(JSON.stringify([edge.referenceId, ...preview.candidates.components.filter(c => c.id === edge.source || c.id === edge.target).map(c => c.referenceId)]))}"${checked(selection.relationshipIds.includes(edge.id))}${disabled}> ${e(edge.source)} → ${e(edge.target)} (${e(edge.type)})${edge.inferred ? ' · inferred' : ''}<br><span class="muted">Evidence ${e(edge.referenceId)}</span></label>`).join('');
    const excerpts = preview.candidates.references.map(ref => `<label><input type="checkbox" name="excerptReferenceIds" value="${e(ref.id)}"${checked(selection.excerptReferenceIds.includes(ref.id))}${disabled}> Include excerpt: ${sourceLabel(ref)}</label>`).join('');
    return `${start}${destination}<section><h2>Choose evidence</h2><p class="muted">Apply selection rebuilds the backend preview. References: up to 16; direct relationships: up to 5. Relationships require their evidence reference. Excerpts: up to 4, each at most 20 lines / 3000 characters. Sensitive paths are excluded by the backend.</p><form id="handoff-selection" data-view="${e(state.viewId)}"${draftAttributes}><fieldset><legend>Source references</legend>${refs || '<p>No candidate references.</p>'}</fieldset><fieldset><legend>Direct relationships (optional)</legend>${edges || '<p>No candidate relationships.</p>'}</fieldset><fieldset><legend>Optional context</legend><label><input type="checkbox" name="includeDocumentation"${checked(selection.includeDocumentation)}${busy || !preview.candidates.documentation.length ? ' disabled' : ''}> Include inferred documentation (up to 1200 characters)</label><label><input type="checkbox" name="includeCheckpointNotes"${checked(selection.includeCheckpointNotes)}${busy || !preview.candidates.checkpointNotesAvailable ? ' disabled' : ''}> Include original saved checkpoint notes</label></fieldset><fieldset><legend>Source excerpts (off by default)</legend>${excerpts}</fieldset><button type="submit"${busy || gated ? ' disabled' : ''}>Apply selection</button></form></section><section><h2>Exact canonical Markdown to save</h2><p class="muted">Review this complete backend package before Save. Changes to the controls above must be applied first.</p><pre class="answer">${e(preview.markdown)}</pre>${notices([...preview.context.limitations, ...preview.context.warnings])}</section><nav>${action('save', 'Save handoff', draftAttributes, gated || state.status !== 'ready' || state.preview !== preview)}${action('edit', 'Edit question and attempted steps', draftAttributes)}${cancel}</nav></main>`;
  }
  const controls = `<nav aria-label="Handoff actions">${action('new', 'New handoff', '', gated)}${action('refresh', 'Refresh')}${busy ? action('cancel', 'Cancel') : ''}</nav>`;
  const detail = state.detail;
  if (!detail) {
    const page = state.page;
    return `${start}${controls}<section><h2>Saved handoffs</h2>${page?.items.length ? `<ul class="citations">${page.items.map(item => `<li>${action('open', e(item.question), ` data-handoff="${e(item.id)}"`)}<p class="muted">${e(item.createdAt)} · Snapshot ${e(item.snapshotId)} · Commit <code>${e(item.indexedCommit)}</code></p></li>`).join('')}</ul>` : `<p>${busy ? 'Loading saved handoffs…' : state.status === 'error' || gated ? 'Saved handoffs are unavailable. See the status above; refresh to retry.' : 'No saved handoffs to show.'}</p>`}${page ? `<nav aria-label="Handoff pages">${page.offset > 0 ? action('previous', 'Previous page') : ''}${page.hasMore ? action('next', 'Next page') : ''}</nav>` : ''}</section></main>`;
  }
  const saved = ` data-handoff="${e(detail.id)}"`;
  return `${start}${controls}<section><h2>Saved repository state</h2>${identity(detail.context)}<p class="muted">Saved ${e(detail.createdAt)} · Status ${e(detail.status)}</p></section><section><h2>Source references</h2><ul class="citations">${detail.context.references.map(ref => `<li>${action('source', sourceLabel(ref), `${saved} data-reference="${e(ref.id)}" class="citation"`)}<p class="muted">Snapshot ${e(ref.snapshotId)} · Reference ${e(ref.id)}</p></li>`).join('')}</ul></section><section><h2>Full canonical Markdown</h2><pre class="answer">${e(detail.markdown)}</pre></section><section><h2>Limitations and warnings</h2>${notices([...detail.context.limitations, ...detail.context.warnings])}</section><nav aria-label="Manual export">${action('copy', 'Copy Markdown', saved)}${action('export', 'Export Markdown file', saved)}${action('delete', 'Delete handoff', saved)}</nav></main>`;
}

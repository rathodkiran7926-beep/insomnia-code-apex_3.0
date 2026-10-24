import type { CheckpointState } from '../checkpointController';
import type { CheckpointInput, LocalCheckpointContext } from '../api-client/checkpointContracts';
import type { Component, SourceReference } from '../api-client/mentorContracts';
import type { RepositoryBinding } from '../repository';
import { escapeHtml } from './mentorContent';

export interface CheckpointDraft {
  id: string;
  mode: 'edit' | 'preview';
  binding: RepositoryBinding;
  localContext: LocalCheckpointContext;
  choices: { reference: SourceReference; component?: Component }[];
  notice: string;
  input?: CheckpointInput;
}

const e = escapeHtml;
const noteFields = [['discovery', 'What you discovered'], ['unresolved', 'What remains unresolved'], ['nextStep', 'Next step']] as const;

function repositoryState(binding: Pick<RepositoryBinding, 'repositoryIdentity' | 'snapshotId' | 'indexedCommit'>, context: LocalCheckpointContext): string {
  return `<p class="muted"><strong>Backend-verified indexed metadata</strong><br>Repository ${e(binding.repositoryIdentity)}<br>Snapshot ${e(binding.snapshotId)}<br>Indexed commit <code>${e(binding.indexedCommit)}</code></p>
  <p class="muted"><strong>Extension-reported Git</strong><br>Branch ${e(context.branch ?? 'unknown')}<br>Local HEAD <code>${e(context.headCommit ?? 'unknown')}</code><br>Working tree ${e(context.gitStatus)}</p>`;
}

function authored(input: Pick<CheckpointInput, 'taskTitle' | 'notes'>): string {
  return `<p class="muted">User-authored</p><h3>Task title</h3><div class="answer">${e(input.taskTitle)}</div>${noteFields.map(([key, label]) => `<h3>${label}</h3><div class="answer">${e(input.notes[key])}</div>`).join('')}`;
}

function sourceLabel(reference: SourceReference): string { return `${e(reference.file)}:${reference.startLine}–${reference.endLine}`; }

export function renderCheckpointBody(state: CheckpointState, draft?: CheckpointDraft): string {
  const busy = state.status === 'loading' || state.status === 'saving';
  const gated = state.capability?.enabled === false;
  const disabled = busy ? ' disabled' : '';
  const action = (type: string, label: string, attributes = '') => `<button type="button" data-action="${type}"${attributes} data-view="${e(state.viewId)}"${(busy && type !== 'cancel') || (gated && (type === 'new' || type === 'save')) ? ' disabled' : ''}>${label}</button>`;
  const status = `<div id="status" role="status" aria-live="polite" data-status="${e(state.status)}">${e(state.message)}</div>`;
  const start = `<main tabindex="-1"><header><p class="eyebrow">CODEBASE MENTOR · CHECKPOINTS</p><h1>${draft ? draft.mode === 'preview' ? 'Review your checkpoint' : 'Save your place' : 'Your checkpoints'}</h1></header>${status}`;
  if (draft) {
    const identity = `<p class="muted">Backend endpoint <code>${e(draft.binding.backendUrl)}</code></p>` + repositoryState(draft.binding, draft.localContext);
    const notice = `<p class="notice">${e(draft.notice)}</p><p class="muted">Only the title, your notes, Git metadata and chosen reference IDs are saved. Source contents are not included. Saving requires your explicit confirmation.</p>`;
    if (draft.mode === 'preview' && draft.input) {
      const selected = draft.choices.filter(choice => draft.input!.sourceReferenceIds.includes(choice.reference.id));
      return `${start}${notice}<section><h2>What you will save</h2>${authored(draft.input)}</section><section><h2>Repository state</h2>${identity}</section><section><h2>Chosen source references</h2><ul class="citations">${selected.map(({ reference }) => `<li>${sourceLabel(reference)}<br><span class="muted">Snapshot ${e(reference.snapshotId)} · Reference ${e(reference.id)}</span></li>`).join('')}</ul>${selected.length ? '' : '<p>No source references selected.</p>'}</section><nav aria-label="Checkpoint confirmation">${action('save', 'Save checkpoint', ` data-draft="${e(draft.id)}"`)}${action('edit', 'Edit', ` data-draft="${e(draft.id)}"`)}${action('cancel', 'Cancel', ` data-draft="${e(draft.id)}"`)}</nav></main>`;
    }
    const selectedIds = draft.input?.sourceReferenceIds ?? draft.choices.slice(0, 1).map(choice => choice.reference.id);
    const fields = noteFields.map(([key, label]) => `<label for="checkpoint-${key}">${label} (optional)</label><textarea id="checkpoint-${key}" name="${key}" rows="2" maxlength="2000"${disabled}>${e(draft.input?.notes[key] ?? '')}</textarea>`).join('');
    const choices = draft.choices.map(({ reference }) => `<label><input type="checkbox" name="sourceReferenceIds" value="${e(reference.id)}"${selectedIds.includes(reference.id) ? ' checked' : ''}${disabled}> ${sourceLabel(reference)}<br><span class="muted">Snapshot ${e(reference.snapshotId)} · Reference ${e(reference.id)}</span></label>`).join('');
    return `${start}${notice}<form id="checkpoint-draft" data-draft="${e(draft.id)}"><label for="checkpoint-taskTitle">Task title</label><input id="checkpoint-taskTitle" name="taskTitle" maxlength="200" required value="${e(draft.input?.taskTitle ?? '')}"${disabled}>${fields}<fieldset><legend>Source references (choose up to 8)</legend>${choices || '<p>No source references available. You can save a checkpoint without references.</p>'}</fieldset><button type="submit"${busy || gated ? ' disabled' : ''}>Preview checkpoint</button></form><nav>${action('cancel', 'Cancel', ` data-draft="${e(draft.id)}"`)}</nav><section><h2>Repository state</h2>${identity}</section></main>`;
  }

  const detail = state.resume?.detail ?? state.detail;
  const controls = `<nav aria-label="Checkpoint actions">${action('new', 'New checkpoint')}${action('refresh', 'Refresh')}${busy ? '<button type="button" data-action="cancel">Cancel</button>' : ''}</nav>`;
  const capability = state.capability ? `<p class="notice">${e(state.capability.notice)}</p>` : '';
  if (!detail) {
    const items = state.page?.items ?? [];
    return `${start}${capability}${controls}<section><h2>Saved checkpoints</h2>${items.length ? `<ul class="citations">${items.map(item => `<li>${action('resume', e(item.taskTitle), ` data-checkpoint="${e(item.id)}"`)}<p class="muted">${e(item.createdAt)} · Snapshot ${e(item.snapshotId)}</p></li>`).join('')}</ul>` : `<p>${busy ? 'Loading saved checkpoints�' : state.status === 'error' || gated ? 'Saved checkpoints are unavailable. See the status above; refresh to retry.' : 'No saved checkpoints to show.'}</p>`}${state.page ? `<nav aria-label="Checkpoint pages">${state.page.offset > 0 ? action('previous', 'Previous page') : ''}${state.page.hasMore ? action('next', 'Next page') : ''}</nav>` : ''}</section></main>`;
  }
  const checkpoint = detail.checkpoint;
  const resume = state.resume;
  const references = detail.references.map(reference => `<li>${action('source', sourceLabel(reference), ` class="citation" data-reference="${e(reference.id)}"`)}<p class="muted">Snapshot ${e(reference.snapshotId)} · Reference ${e(reference.id)}</p></li>`).join('');
  const components = detail.components.map(component => `<li>${e(component.name)} · ${e(component.role)}<nav>${action('map', 'Open in Map', ` data-component="${e(component.id)}" data-reference="${e(component.referenceId)}"`)}${action('mentor', 'Explain with Mentor', ` data-component="${e(component.id)}" data-reference="${e(component.referenceId)}"`)}</nav></li>`).join('');
  const changes = resume ? `<p class="notice">${e(resume.changes.notice)}</p><p class="muted">Stored indexed file text comparison only; this does not compare the local checkout. File changes do not establish behavior changes.</p><ul>${resume.changes.items.map(item => `<li>${e(item.file)} — File status: ${e(item.status)}<p class="muted">${e(item.notice)}</p>${(item.status === 'changed' || item.status === 'unchanged') && item.currentReference && detail.references.some(reference => reference.id === item.referenceId) ? action('fileDiff', 'Review stored file diff', ` data-reference="${e(item.referenceId)}"`) : ''}</li>`).join('')}</ul>` : '<p>Resume this checkpoint to compare the saved and current indexed snapshots.</p>';
  const versions = resume ? `<h3>Current repository state</h3>${repositoryState(resume.currentSnapshot, resume.currentLocalContext)}<p class="muted">Snapshot status: ${checkpoint.snapshotId === resume.currentSnapshot.snapshotId ? 'same' : 'different'}. Indexed commit status: ${e(resume.versions.indexed)}. Local HEAD status: ${e(resume.versions.localHead)}.</p>` : '';
  const comparison = resume?.comparison ? action('changes', 'Review Changes') : '<p class="muted">Review Changes unavailable: no matching stored PR comparison is available.</p>';
  return `${start}${capability}${controls}<section><h2>What you saved</h2>${authored(checkpoint)}<p class="muted">Saved ${e(checkpoint.createdAt)}</p></section><section><h2>Repository state</h2>${repositoryState(checkpoint, checkpoint.localContext)}${versions}${resume?.currentLocalContext.headCommit && resume.currentLocalContext.headCommit.toLowerCase() !== resume.currentSnapshot.indexedCommit.toLowerCase() ? '<p class="notice">Current local revision differs from the connected analyzed snapshot. Detailed source changes in this checkout have not been verified.</p>' : ''}${!detail.snapshotAvailable ? '<p class="notice">Saved snapshot unavailable. Original notes are still shown; source navigation is unavailable.</p>' : ''}${detail.warnings.map(warning => `<p class="notice">${e(warning)}</p>`).join('')}</section><section><h2>Changes since checkpoint</h2>${changes}${comparison}</section><section><h2>Continue working</h2><ul class="citations">${references}</ul>${!references ? '<p>No saved source references available.</p>' : ''}<ul class="citations">${components}</ul><nav>${action('handoff', 'Ask Senior About This Task')}${action('resume', 'Refresh resume', ` data-checkpoint="${e(checkpoint.id)}"`)}${action('delete', 'Delete checkpoint', ` data-checkpoint="${e(checkpoint.id)}"`)}</nav></section></main>`;
}

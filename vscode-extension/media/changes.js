/* Render backend-validated PR data and prevalidated native-tree actions only. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('changes-root');
  let epoch = 0;
  const prior = vscode.getState() || {};
  const expanded = new Set(Array.isArray(prior.open) ? prior.open : ['Pull Requests']);
  const el = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text !== undefined) item.textContent = String(text); return item; };
  const action = (text, id, cls = '') => {
    const button = el('button', `cv-button ${cls}`, text); button.type = 'button'; button.disabled = !id;
    button.addEventListener('click', () => { button.disabled = true; vscode.postMessage({ type: 'action', epoch, id }); });
    return button;
  };
  function node(row, depth = 0) {
    if (row.children) {
      const section = el('details', depth === 0 ? 'cv-section' : 'cv-nested');
      const key = row.label.replace(/\s*\(\d+\).*/, '').replace(/\s*·.*/, '');
      section.open = expanded.has(key);
      const head = el('summary', '', row.label); head.title = row.label;
      section.append(head);
      section.addEventListener('toggle', () => { if (section.open) expanded.add(key); else expanded.delete(key); vscode.setState({ open: [...expanded] }); });
      const content = el('div', 'cv-section-items');
      for (const child of row.children) content.append(node(child, depth + 1));
      section.append(content);
      return section;
    }
    const card = el('div','cv-item');
    const label = el('div','cv-item-text');
    label.append(el('span','cv-item-name',row.label));
    if (row.description) label.append(el('small','cv-muted',row.description));
    label.title = [row.label,row.description].filter(Boolean).join('\n');
    card.append(label);
    if (row.action || row.actions?.length) {
      const actions=el('div','cv-item-actions');
      if(row.action) actions.append(action('Open',row.action,'cv-small'));
      for(const extra of row.actions||[]) actions.append(action(extra.title,extra.id,'cv-small'));
      card.append(actions);
    }
    return card;
  }
  function render(data) {
    epoch = data.epoch;
    const view = document.createDocumentFragment();
    const hero = el('section','cv-hero');
    const upper = el('div','cv-line'); upper.append(el('strong','','Pull Request Insights'),el('span',`cv-chip ${data.status === 'error' ? 'error' : ''}`,data.status));
    hero.append(upper);
    if (data.selected) {
      hero.append(el('div','cv-pr-title',`#${data.selected.number} · ${data.selected.title}`));
      hero.append(el('small','cv-muted',`Remote PR · ${data.selected.state}; local branch matching is unverified`));
    } else hero.append(el('p','cv-muted','Select a remote pull request to review changes and possible impacts.'));
    if (data.comparison) {
      const stats = el('div','cv-stats');
      for (const [n, value] of [['Files',data.comparison.files],['Components',data.comparison.components],['Potential impact',data.comparison.impact],['Setup',data.comparison.setup]]) {
        const item = el('div','cv-stat'); item.append(el('strong','',value),el('small','',n));stats.append(item);
      }
      hero.append(stats);
    }
    if (data.job && ['running','starting'].includes(data.status)) {
      const progress = el('progress'); progress.max = 100; progress.value = Math.max(0,Math.min(100,data.job.progress));
      hero.append(progress);
    }
    const status = el('p',`cv-status ${data.status === 'error' ? 'cv-error':''}`,data.message || ''); status.title = data.message || '';
    hero.append(status); view.append(hero);
    const rows = data.rows || [];
    // Prominent native-action shortcuts, derived from the same validated ChangesTree rows.
    const all = [];
    function flatten(list) { for (const item of list) { if (item.action) all.push(item); if (item.children) flatten(item.children); } }
    flatten(rows);
    const find = phrase => all.find(item => item.label === phrase);
    const toolbar = el('div','cv-actions');
    for (const [title, match] of [['Refresh PRs','Refresh PR List'],['Paste PR URL','Enter PR URL'],['Filter','Filter PR List'],['Analyze','Start Analysis'],['Resume','Resume Existing Job'],['Stop Waiting','Stop Local Waiting']]) {
      const row = find(match); if (row) toolbar.append(action(title,row.action,title==='Analyze'?'cv-primary':''));
    }
    view.append(toolbar);
    const headings = ['Pull Requests','Changed Files','Architecture Components','Relationship Changes','Potential Impact','Setup Changes','Analysis Limitations','Comparison Versions'];
    const grouped = rows.filter(row => row.children && headings.some(h => row.label.startsWith(h)));
    for (const section of grouped) view.append(node(section));
    if (!grouped.length) {
      const empty = el('div','cv-empty','No comparison selected. Refresh the PR list or enter a public PR URL.');
      view.append(empty);
    }
    const secondary = rows.filter(row => !row.children && row.action && !all.some(x => x !== row && x.action === row.action));
    for (const row of secondary) if (!['Refresh PR List','Enter PR URL','Filter PR List','Start Analysis','Resume Existing Job','Stop Local Waiting'].includes(row.label)) view.append(node(row));
    root.replaceChildren(view);
  }
  window.addEventListener('message', event => { if (event.data?.type === 'render') render(event.data); });
  vscode.postMessage({ type:'ready' });
})();

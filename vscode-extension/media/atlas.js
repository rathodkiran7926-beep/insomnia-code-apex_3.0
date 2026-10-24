/* One-hop *rendering* of validated backend JSON. No network, graph inference, or LLM. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('atlas-root');
  const NS = 'http://www.w3.org/2000/svg';
  let state, selectedId, zoom = 1, panX = 0, panY = 0;
  const el = (tag, cls, value) => { const node = document.createElement(tag); if (cls) node.className = cls; if (value !== undefined) node.textContent = String(value); return node; };
  const svgEl = (tag, attrs = {}, value) => { const node = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); if (value !== undefined) node.textContent = String(value); return node; };
  const short = str => String(str ?? '').split('/').at(-1);
  const shorten = (str, max = 30) => String(str ?? '').length > max ? String(str).slice(0, max - 1) + '…' : String(str ?? '');
  const send = (action, componentId, referenceId) => {
    if (['source','explain','explore','handoff'].includes(action) && (!state?.viewId || !componentId)) return;
    vscode.postMessage({ type: 'action', action, viewId: state?.viewId, componentId, referenceId });
  };
  function button(name, action, className = '', componentId, referenceId) {
    const b = el('button', className, name); b.type = 'button'; b.dataset.action=action; if(componentId)b.dataset.component=componentId; if(referenceId)b.dataset.reference=referenceId; b.addEventListener('click', () => send(action, componentId, referenceId)); return b;
  }
  function renderEmpty() {
    const box = el('section','empty'); box.append(el('h2', '', 'Architecture Atlas'), el('p','note',state?.message || 'Select code to inspect its architecture.'));
    box.append(button('Show Related Code', 'related','primary'), button('Connect Repository','connect'));
    root.append(box);
  }
  function render() {
    root.replaceChildren();
    const data = state?.neighborhood;
    if (!data) return renderEmpty();
    const byId = new Map(data.components.map(c => [c.id, c]));
    if (!byId.has(selectedId)) selectedId = data.component.id;
    const current = byId.get(selectedId) || data.component;
    const header = el('header');
    const title = el('div', 'title'); title.append(el('span', 'eyebrow', '◈'), el('h1', '', 'Architecture Atlas'));
    header.append(title, el('div','subtle',`${data.repositoryIdentity.replace('https://github.com/', '')} · indexed ${data.indexedCommit.slice(0, 12)} · static source relationships`));
    const tools = el('nav','toolbar'); tools.setAttribute('aria-label','Architecture navigation');
    tools.append(button('Focus Selection','editor','primary'), button('Previous','back'), button('Refresh','refresh'), button('Show Related Code','related'), button('Full Web Atlas','web'));
    tools.children[1].disabled = !state.canBack;
    header.append(tools); root.append(header);
    if (state.status === 'loading' || state.status === 'error') root.append(el('div','banner warn',state.message));
    if (state.scopeNotice) root.append(el('div','banner warn',state.scopeNotice));
    if (state.localNotice) root.append(el('div','banner warn',state.localNotice));
    if (data.truncated) root.append(el('div','banner warn','This is a bounded neighborhood. Some relationships are not shown.'));
    if (data.limitations?.length) {
      const l = el('details','note'); const title = el('summary','','Analysis limitations'); l.append(title);
      for (const message of data.limitations) l.append(el('p','note',message)); root.append(l);
    }
    const layout = el('div','layout'); const shell = el('section','canvas-shell'); shell.setAttribute('aria-label','Interactive architecture diagram');
    const svg = svgEl('svg', { role:'group', 'aria-label':`Interactive component diagram centered on ${data.component.name}` });
    const defs = svgEl('defs'); const arrow = svgEl('marker', { id:'atlas-arrow', markerWidth:8, markerHeight:8, refX:7, refY:4, orient:'auto', markerUnits:'strokeWidth' });
    arrow.append(svgEl('path',{ d:'M0,0 L8,4 L0,8 z', fill:'var(--vscode-textLink-foreground)' })); defs.append(arrow); svg.append(defs);
    const incoming = [...new Set(data.incoming.map(e => e.source).filter(id => id !== data.component.id))];
    const outgoing = [...new Set(data.outgoing.map(e => e.target).filter(id => id !== data.component.id))];
    // Show at most 7 nodes per side in the drawing; the inspector lists *all* returned edges.
    const visibleIncoming = incoming.slice(0, 7), visibleOutgoing = outgoing.slice(0, 7);
    const maxN = Math.max(visibleIncoming.length, visibleOutgoing.length, 2), H = Math.max(510, maxN * 123 + 110), W = 1340;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const positions = new Map(); const centerY = H / 2;
    positions.set(data.component.id, {x:550,y:centerY - 39});
    for (const [i,id] of visibleIncoming.entries()) positions.set(id,{x:80,y:(H-(visibleIncoming.length-1)*123)/2+i*123-39});
    for (const [i,id] of visibleOutgoing.entries()) if (!positions.has(id)) positions.set(id,{x:1010,y:(H-(visibleOutgoing.length-1)*123)/2+i*123-39});
    const zoomGroup = svgEl('g'); svg.append(zoomGroup);
    function updateTransform(){ zoomGroup.setAttribute('transform', `translate(${W/2*(1-zoom)+panX} ${H/2*(1-zoom)+panY}) scale(${zoom})`); }
    function setZoom(value, atX=W/2, atY=H/2) {
      const next = Math.max(.4,Math.min(3,value));
      const tx=W/2*(1-zoom)+panX, ty=H/2*(1-zoom)+panY;
      const newTx=atX-(atX-tx)*next/zoom, newTy=atY-(atY-ty)*next/zoom;
      zoom=next; panX=newTx-W/2*(1-zoom);panY=newTy-H/2*(1-zoom);
      updateTransform();
    }
    updateTransform();
    // Pan is a pure SVG viewport operation; the backend graph never changes.
    let dragging = null;
    svg.addEventListener('pointerdown',event=>{
      if(event.button!==0 || event.target.closest('.node'))return;
      dragging={id:event.pointerId,x:event.clientX,y:event.clientY,startX:panX,startY:panY};
      svg.setPointerCapture?.(event.pointerId);
      svg.classList.add('panning');
    });
    svg.addEventListener('pointermove',event=>{
      if(!dragging||event.pointerId!==dragging.id)return;
      const pixelsPerUnit=Math.min(svg.clientWidth/W,svg.clientHeight/H)||1;
      panX=dragging.startX+(event.clientX-dragging.x)/pixelsPerUnit;
      panY=dragging.startY+(event.clientY-dragging.y)/pixelsPerUnit;
      updateTransform();
    });
    const stopPan=event=>{ if(dragging&&event.pointerId===dragging.id){dragging=null;svg.classList.remove('panning');if(svg.hasPointerCapture?.(event.pointerId))svg.releasePointerCapture(event.pointerId);} };
    svg.addEventListener('pointerup',stopPan);svg.addEventListener('pointercancel',stopPan);
    svg.addEventListener('wheel',event=>{
      event.preventDefault();
      const bounds=svg.getBoundingClientRect();
      const k=Math.min(bounds.width/W,bounds.height/H)||1;
      const x=(event.clientX-bounds.left-(bounds.width-W*k)/2)/k;
      const y=(event.clientY-bounds.top-(bounds.height-H*k)/2)/k;
      setZoom(zoom*(event.deltaY<0?1.12:1/1.12),x,y);
      const output=shell.querySelector('.diagram-controls span');if(output)output.textContent=`${Math.round(zoom*100)}%`;
    },{passive:false});
    const edges = [...new Map([...data.incoming, ...data.outgoing].map(e => [e.id,e])).values()];
    for (const edge of edges) {
      const from=positions.get(edge.source), to=positions.get(edge.target); if (!from||!to) continue;
      const self=edge.source===edge.target;
      const x1=from.x+ (self?170:edge.source===data.component.id?230:230), y1=from.y+39;
      const x2=to.x+ (self?170:edge.target===data.component.id?0:0), y2=to.y+39;
      const d=self?`M${x1} ${y1} C${x1+120} ${y1-120} ${x1-130} ${y1-125} ${x1-5} ${y1-5}`:`M${x1} ${y1} C${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`;
      const line=svgEl('path',{ d,class:'edge-line','marker-end':'url(#atlas-arrow)' });
      const tip=svgEl('title',{},`${edge.type} · ${edge.certainty || 'certainty unavailable'}${edge.inferred?' · inferred':''}`);line.append(tip);zoomGroup.append(line);
      const cx=(x1+x2)/2,cy=(y1+y2)/2-10; const w=Math.min(160,Math.max(48,edge.type.length*7+14));
      zoomGroup.append(svgEl('rect',{x:cx-w/2,y:cy-12,width:w,height:24,class:'edge-label'}));
      zoomGroup.append(svgEl('text',{x:cx,y:cy+4,'text-anchor':'middle',class:'edge-text'},shorten(edge.type,19)));
    }
    for(const [id,pos] of positions){
      const c=byId.get(id);if(!c)continue;
      const node=svgEl('g',{class:`node${id===selectedId?' selected':''}`,tabindex:0,role:'button','aria-label':`Inspect ${c.name}`});
      node.append(svgEl('rect',{x:pos.x,y:pos.y,width:230,height:78}));
      node.append(svgEl('text',{x:pos.x+15,y:pos.y+30,class:'title-node'},shorten(short(c.name),27)));
      node.append(svgEl('text',{x:pos.x+15,y:pos.y+53,class:'subtitle'},shorten(c.role+(c.inferred?' · inferred':''),30)));
      node.append(svgEl('title',{},c.name));
      node.addEventListener('click',()=>{selectedId=id;if(id!==data.component.id)send('explore',id);else render();});
      node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectedId=id;if(id!==data.component.id)send('explore',id);else render();}});
      zoomGroup.append(node);
    }
    if(incoming.length>7||outgoing.length>7){
      zoomGroup.append(svgEl('text',{x:W/2,y:H-25,'text-anchor':'middle',class:'edge-text'},`Diagram shows ${visibleIncoming.length} incoming and ${visibleOutgoing.length} outgoing nodes; inspect all edges on the right.`));
    }
    const controls=el('div','diagram-controls');const percentage=el('span','',`${Math.round(zoom*100)}%`);
    const localControl=(label,change)=>{const b=el('button','',label);b.type='button';b.addEventListener('click',change);return b;};
    const minus=localControl('−',()=>{setZoom(zoom-.15);percentage.textContent=`${Math.round(zoom*100)}%`;});
    const plus=localControl('+',()=>{setZoom(zoom+.15);percentage.textContent=`${Math.round(zoom*100)}%`;});
    const fit=localControl('Fit',()=>{zoom=1;panX=0;panY=0;updateTransform();percentage.textContent='100%';});
    // These three buttons are intentionally view-local, not backend actions.
    controls.append(minus,percentage,plus,fit);shell.append(svg,controls);
    const inspector=el('aside','inspector');inspector.setAttribute('aria-label','Selected component details');
    inspector.append(el('div','eyebrow','Selected component'),el('h2','',current.name));
    const ref=data.references.find(r=>r.id===current.referenceId);
    inspector.append(el('div','path',ref?`${ref.file}:${ref.startLine}–${ref.endLine}`:'Source location not available'));
    inspector.append(el('span','pill',current.role),el('span','pill',current.inferred?'Inferred role':'Indexed declaration'));
    const related=edges.filter(e=>e.source===current.id||e.target===current.id);
    const incomingEdges=related.filter(e=>e.target===current.id),outgoingEdges=related.filter(e=>e.source===current.id);
    inspector.append(el('h3','',`Incoming relationships (${incomingEdges.length})`));
    function relationCard(edge, side){const otherId=side==='incoming'?edge.source:edge.target;const other=byId.get(otherId);
      if(!other)return;
      const b=el('button','related');b.append(el('div','',short(other.name)),el('small','',`${edge.type} · ${edge.certainty||'certainty unknown'}${edge.inferred?' · inferred':''}`));
      b.title=`Explore ${other.name}`;b.addEventListener('click',()=>send('explore',otherId));inspector.append(b);
    }
    if(!incomingEdges.length) inspector.append(el('p','note','No incoming relationships were indexed.'));
    incomingEdges.forEach(e=>relationCard(e,'incoming'));
    inspector.append(el('h3','',`Outgoing relationships (${outgoingEdges.length})`));
    if(!outgoingEdges.length) inspector.append(el('p','note','No outgoing relationships were indexed.'));
    outgoingEdges.forEach(e=>relationCard(e,'outgoing'));
    const actions=el('div','button-grid');
    actions.append(button('Open Source','source','',current.id,current.referenceId),button('Explain with Mentor','explain','',current.id),button('Ask Senior','handoff','',current.id),button('Explore Node','explore','primary',current.id));
    inspector.append(el('h3','','Actions'),actions);
    const evidence=el('div','relationship-evidence');evidence.append(el('h3','','Relationship evidence'));
    for(const edge of related){ const r=data.references.find(ref=>ref.id===edge.referenceId); if(!r)continue;
      const b=button(`${edge.type}: ${short(r.file)}:${r.startLine}`,'source','related',current.id,r.id);b.title=`${r.file}:${r.startLine}–${r.endLine} · indexed evidence`; evidence.append(b); }
    if(!related.length)evidence.append(el('p','note','No relationship evidence indexed.'));
    inspector.append(evidence);
    if(current.id===data.component.id && data.documentation?.length) {
      inspector.append(el('h3','','Documentation'));
      for(const doc of data.documentation) inspector.append(el('p','note',`AI-inferred, review required: ${doc.explanation}`));
    }
    inspector.append(el('p','note','Arrows retain the backend relationship type and direction. Imports are not proof of runtime calls. Click a node to load its neighborhood. Drag the canvas to pan; use the wheel to zoom.'));
    layout.append(shell,inspector);root.append(layout);
  }
  window.addEventListener('message',event=>{
    const m=event.data;if(!m||m.type!=='render')return;
    const previous=state?.viewId;state=m;
    if(previous!==m.viewId){zoom=1;panX=0;panY=0;selectedId=undefined;}
    render();
  });
  vscode.postMessage({type:'ready'});
})();

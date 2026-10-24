/* Repository-wide *presentation* of backend snapshot JSON. No inference, fetching or execution. */
(() => {
  'use strict';
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('repo-atlas');
  const NS = 'http://www.w3.org/2000/svg';
  const html = (tag, className, label) => { const n=document.createElement(tag);if(className)n.className=className;if(label!==undefined)n.textContent=String(label);return n; };
  const svgNode = (tag,attrs={}) => { const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n; };
  const trim = (s,n=30) => String(s||'').length>n?String(s).slice(0,n-1)+'…':String(s||'');
  const short = s => String(s||'').split('/').at(-1);
  let data, view, token = -1, scope = '', selected = '', search = '';
  const command = (action,componentId) => vscode.postMessage({type:'action',action,componentId,token});
  const button = (label,click,cls='') => {const b=html('button',cls,label);b.type='button';b.addEventListener('click',click);return b;};
  const pathPart = file => file.split('/').filter(Boolean);
  function prepare(graph) {
    const refs=new Map(graph.references.map(r=>[r.id,r]));
    const components=new Map(graph.components.map(c=>[c.id,c]));
    const files=new Map();const componentFile=new Map();
    for(const c of graph.components){const r=refs.get(c.referenceId);if(!r)continue;
      if(!files.has(r.file))files.set(r.file,{path:r.file,components:[]});
      files.get(r.file).components.push(c);componentFile.set(c.id,r.file);
    }
    const relations=[];
    for(const e of graph.relationships){const from=componentFile.get(e.source),to=componentFile.get(e.target);if(from&&to)relations.push({...e,from,to});}
    return {graph,refs,components,files,relations};
  }
  function groups() {
    const files=[...view.files.keys()].sort();
    const scoped=scope?files.filter(f=>f.startsWith(scope+'/')):files;
    const direct=[];const folders=new Map();
    for(const file of scoped){const relative=scope?file.slice(scope.length+1):file;const bits=pathPart(relative);
      if(bits.length===1)direct.push({id:file,label:short(file),type:'file',files:[file]});
      else {const directory=scope?`${scope}/${bits[0]}`:bits[0];if(!folders.has(directory))folders.set(directory,[]);folders.get(directory).push(file);}
    }
    // If an exceptionally flat folder has many files, use letter buckets; all remain reachable.
    if(direct.length>100){const buckets=new Map();for(const entry of direct){const letter=(entry.label[0]||'#').toUpperCase();if(!buckets.has(letter))buckets.set(letter,[]);buckets.get(letter).push(entry.id);}
      return [...folders].map(([id,items])=>({id,label:short(id),type:'folder',files:items})).concat([...buckets].map(([letter,items])=>({id:`bucket:${letter}`,label:`${letter}… (${items.length} files)`,type:'bucket',files:items}))).sort((a,b)=>a.label.localeCompare(b.label));
    }
    return [...folders].map(([id,items])=>({id,label:short(id),type:'folder',files:items})).concat(direct).sort((a,b)=>a.label.localeCompare(b.label));
  }
  let bucket=null;
  function visibleNodes(){
    if(!bucket)return groups();
    const all=groups().filter(n=>n.type!=='bucket');
    return all.concat([...view.files.keys()].filter(f=>(scope?f.startsWith(scope+'/'):true)&&((short(f)[0]||'#').toUpperCase()===bucket)).map(f=>({id:f,label:short(f),type:'file',files:[f]}))).sort((a,b)=>a.label.localeCompare(b.label));
  }
  function summary(){
    const counts={ files:view.files.size,components:view.graph.components.length,relationships:view.graph.relationships.length };
    const header=html('header');const brand=html('div','brand');brand.append(html('span','mark','◇'),html('h1','','Full Repository Architecture'));header.append(brand);
    header.append(html('div','subtitle',`${view.graph.repositoryIdentity.replace('https://github.com/','')} · commit ${view.graph.indexedCommit.slice(0,12)} · ${counts.files} files · ${counts.components} components · ${counts.relationships} indexed relationships`));
    const toolbar=html('div','toolbar');toolbar.append(button('All repositories files',()=>{scope='';bucket=null;selected='';draw();},'primary'));
    if(scope)toolbar.append(button(`↑ ${scope}`,()=>{scope=scope.split('/').slice(0,-1).join('/');bucket=null;selected='';draw();}));
    toolbar.append(button('Refresh snapshot',()=>command('refresh')));
    const input=html('input');input.type='search';input.placeholder='Find file in repository…';input.setAttribute('aria-label','Search all indexed repository files');input.value=search;
    input.addEventListener('input',()=>{search=input.value;updateSearch();});toolbar.append(input);
    header.append(toolbar);return header;
  }
  function updateSearch(){const results=document.getElementById('repo-search');if(!results)return;results.replaceChildren();if(!search.trim())return;
    const matches=[...view.files.keys()].filter(f=>f.toLowerCase().includes(search.trim().toLowerCase()));
    results.append(html('div','caption',`${matches.length} indexed files match`));
    for(const file of matches.slice(0,25)){results.append(button(file,()=>{scope=file.split('/').slice(0,-1).join('/');bucket=null;selected=file;search='';draw();},'search-result'));}
    if(matches.length>25)results.append(html('div','caption','Showing first 25; refine your search.'));
  }
  function draw(){root.replaceChildren();if(!data||!view){const container=html('section','empty');container.append(html('h2','','Full Repository Architecture'),html('p','',data?.message||'Connect a repository snapshot first.'));container.append(button('Retry',()=>command('refresh'),'primary'));root.append(container);return;}
    root.append(summary());
    const searchBox=html('div','search-results');searchBox.id='repo-search';root.append(searchBox);updateSearch();
    const content=html('div','layout'), shell=html('section','diagram'),inspector=html('aside','inspector');
    const nodes=visibleNodes();const byId=new Map(nodes.map(n=>[n.id,n]));if(!byId.has(selected))selected=nodes[0]?.id||'';
    const fileGroup=new Map();for(const node of nodes)for(const file of node.files)fileGroup.set(file,node.id);
    const aggregated=new Map();for(const edge of view.relations){const a=fileGroup.get(edge.from),b=fileGroup.get(edge.to);if(!a||!b||a===b)continue;
      const id=`${a}|${b}|${edge.type}`;const item=aggregated.get(id)||{source:a,target:b,type:edge.type,count:0};item.count++;aggregated.set(id,item);
    }
    const edges=[...aggregated.values()];const cols=Math.min(5,Math.max(2,Math.ceil(Math.sqrt(nodes.length/1.3))));const rows=Math.ceil(nodes.length/cols);
    const W=Math.max(820,cols*258+95),H=Math.max(500,rows*112+105);
    const svg=svgNode('svg',{viewBox:`0 0 ${W} ${H}`,role:'group','aria-label':'Repository-wide architecture; drag to pan, wheel to zoom'});
    const defs=svgNode('defs');const marker=svgNode('marker',{id:'repo-arrow',markerWidth:9,markerHeight:9,refX:8,refY:4,orient:'auto'});
    marker.append(svgNode('path',{d:'M0 0 L8 4 L0 8Z',fill:'var(--vscode-textLink-foreground)'}));defs.append(marker);svg.append(defs);
    const plot=svgNode('g');svg.append(plot);
    const positions=new Map();nodes.forEach((node,i)=>positions.set(node.id,{x:55+(i%cols)*258,y:60+Math.floor(i/cols)*112}));
    for(const edge of edges){const a=positions.get(edge.source),b=positions.get(edge.target);if(!a||!b)continue;
      const x1=a.x+110,y1=a.y+29,x2=b.x+110,y2=b.y+29;
      const line=svgNode('path',{d:`M${x1} ${y1} Q${(x1+x2)/2+28} ${(y1+y2)/2-25} ${x2} ${y2}`,
        class:'edge', 'marker-end':'url(#repo-arrow)'});const tooltip=svgNode('title');tooltip.textContent=`${edge.type} · ${edge.count} indexed relationship(s)`;line.append(tooltip);plot.append(line);
    }
    for(const item of nodes){const p=positions.get(item.id);const group=svgNode('g',{class:`node${item.id===selected?' active':''}`,tabindex:0,role:'button', 'aria-label':`${item.type==='file'?'File':'Folder'} ${item.id}`});
      group.append(svgNode('rect',{x:p.x,y:p.y,width:220,height:61,rx:9}));
      const label=svgNode('text',{x:p.x+13,y:p.y+25,class:'node-title'});label.textContent=trim(item.label,27);group.append(label);
      const subtitle=svgNode('text',{x:p.x+13,y:p.y+44,class:'node-caption'});subtitle.textContent=item.type==='file'?`${view.files.get(item.id)?.components.length||0} components`:`${item.files.length} files`;group.append(subtitle);
      const tip=svgNode('title');tip.textContent=item.id;group.append(tip);
      const activate=()=>{if(item.type==='folder'){scope=item.id;bucket=null;selected='';draw();}else if(item.type==='bucket'){bucket=item.id.slice(7);selected='';draw();}else{selected=item.id;draw();}};
      group.addEventListener('click',activate);group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});plot.append(group);
    }
    let zoom=1,tx=0,ty=0;const update=()=>plot.setAttribute('transform',`translate(${tx} ${ty}) scale(${zoom})`);let moving=null;
    svg.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.node'))return;moving={id:e.pointerId,x:e.clientX,y:e.clientY,tx,ty};svg.setPointerCapture?.(e.pointerId);});
    svg.addEventListener('pointermove',e=>{if(!moving||e.pointerId!==moving.id)return;const px=Math.min(svg.clientWidth/W,svg.clientHeight/H)||1;tx=moving.tx+(e.clientX-moving.x)/px;ty=moving.ty+(e.clientY-moving.y)/px;update();});
    const stop=e=>{if(moving?.id===e.pointerId){moving=null;if(svg.hasPointerCapture?.(e.pointerId))svg.releasePointerCapture(e.pointerId);}};
    svg.addEventListener('pointerup',stop);svg.addEventListener('pointercancel',stop);
    const updateZoom=(next,x=W/2,y=H/2)=>{next=Math.min(3,Math.max(.3,next));tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;update();counter.textContent=`${Math.round(100*zoom)}%`;};
    svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect(),scale=Math.min(r.width/W,r.height/H)||1;
      const x=(e.clientX-r.left-(r.width-W*scale)/2)/scale,y=(e.clientY-r.top-(r.height-H*scale)/2)/scale;
      updateZoom(zoom*(e.deltaY<0?1.12:1/1.12),x,y);},{passive:false});
    const controls=html('div','zoom');const counter=html('span','', '100%');controls.append(button('−',()=>updateZoom(zoom-.2)),counter,button('+',()=>updateZoom(zoom+.2)),button('Fit',()=>{zoom=1;tx=0;ty=0;update();counter.textContent='100%';}));shell.append(svg,controls);
    content.append(shell,inspector);root.append(content);
    const title=html('h2','',selected?selected:'No indexed files');inspector.append(html('div','eyebrow','Indexed repository node'),title);
    const item=byId.get(selected);if(item?.type==='file'){
      const file=view.files.get(item.id);inspector.append(html('p','small',`${file.components.length} indexed components in this file`));
      const related=view.relations.filter(e=>e.from===item.id||e.to===item.id);inspector.append(html('h3','',`Relationships (${related.length})`));
      if(!related.length)inspector.append(html('p','small','No indexed relationships for this file.'));
      for(const edge of related.slice(0,35))inspector.append(html('p','edge-detail',`${edge.from===item.id?'→':'←'} ${edge.type} · ${edge.from===item.id?edge.to:edge.from}${edge.inferred?' · inferred':''}`));
      if(related.length>35)inspector.append(html('p','small',`Showing 35 of ${related.length}; all indexed edges are included in the graph model.`));
      inspector.append(html('h3','','Components'));
      for(const component of file.components.slice(0,40)){
        const wrap=html('div','component-row');wrap.append(html('div','',trim(component.name,44)),html('small','',component.role));
        const actions=html('div','component-actions');actions.append(button('Open source',()=>command('source',component.id)),button('Explore 1-hop',()=>command('focus',component.id)));
        wrap.append(actions);inspector.append(wrap);
      }
      if(file.components.length>40)inspector.append(html('p','small',`Showing 40 of ${file.components.length} components; refine selection via the focused Atlas.`));
    }else if(item){inspector.append(html('p','small',`${item.files.length} files inside this group.`));inspector.append(button('Open folder group',()=>{scope=item.id;bucket=null;selected='';draw();},'primary'));}
    inspector.append(html('p','small','File connections are aggregated only for display. Each edge comes from a backend-indexed component relationship. Imports and static calls do not prove runtime execution.'));
    if(view.graph.limitations?.length){const details=html('details');details.append(html('summary','','Analysis limitations'));for(const issue of view.graph.limitations.slice(0,15))details.append(html('p','small',issue));inspector.append(details);}
  }
  window.addEventListener('message',event=>{const m=event.data;if(!m||m.type!=='render'||typeof m.token!=='number')return;
    if(token!==m.token){scope='';selected='';bucket=null;search='';}token=m.token;data=m;view=m.status==='ready'&&m.graph?prepare(m.graph):undefined;draw();});
  vscode.postMessage({type:'ready'});
})();

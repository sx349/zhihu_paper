// Minimal DOM sufficient to execute panel.js render paths in node.
class El {
  constructor(tag){ this.tagName=tag.toUpperCase(); this.children=[]; this._text='';
    this.className=''; this.id=''; this.dataset={}; this.hidden=false; this.style={}; this.attrs={}; }
  append(...n){ for(const x of n){ if(x==null) continue; x.parentElement=this; this.children.push(x);} }
  appendChild(n){ this.append(n); return n; }
  remove(){ const p=this.parentElement; if(p) p.children=p.children.filter(c=>c!==this); }
  replaceWith(n){ const p=this.parentElement; if(!p) return; n.parentElement=p; p.children=p.children.map(c=>c===this?n:c); }
  addEventListener(){}
  setAttribute(k,v){ this.attrs[k]=String(v); }
  getAttribute(k){ return this.attrs[k] ?? null; }
  querySelector(sel){ return this._find(sel)[0]||null; }
  querySelectorAll(sel){ return this._find(sel); }
  _find(sel){ const out=[]; const isClass=sel.startsWith('.'); const want=sel.replace(/^\./,'');
    const hit=(c)=> isClass ? String(c.className).split(' ').includes(want)
                            : (String(c.className).split(' ').includes(want) || c.tagName===want.toUpperCase());
    const walk=(n)=>{ for(const c of n.children){ if(hit(c)) out.push(c); walk(c);} };
    walk(this); return out; }
  set textContent(v){ this._text=String(v); this.children=[]; }
  get textContent(){ return this._text + this.children.map(c=>c.textContent).join(''); }
  set innerHTML(v){ this._html=v; this.children=[]; this._text='';
    // create a child per opening tag so querySelector('b') resolves, as in a real DOM
    for(const m of String(v).matchAll(/<([a-zA-Z]+)[^>]*>/g)) this.append(new El(m[1]));
    this._text=String(v).replace(/<[^>]*>/g,''); }
  get innerHTML(){ return this._html||''; }
  // what the panel actually renders, for assertions
  sections(){ const out=[]; const walk=(n)=>{ for(const c of n.children){
      if(String(c.className).split(' ').includes('sec')){ const h=c._find('shead')[0];
        out.push(h?h.textContent.replace(/\d+$/,'').trim():'(sec)'); }
      walk(c);} }; walk(this); return out; }
}
export function makeDom(){
  const byId={};
  for(const id of ['root','foot','primary','report','settings','fbdlg','fbtext']) byId[id]=new El('div');
  byId.fbdlg.showModal=()=>{};
  globalThis.document={
    createElement:(t)=>new El(t),
    getElementById:(id)=>byId[id]||null,
    querySelectorAll:()=>[],
    addEventListener:()=>{}
  };
  globalThis.chrome={
    runtime:{ sendMessage:async()=>null, openOptionsPage(){}, connect:()=>({onMessage:{addListener(){}},postMessage(){}}), onMessage:{addListener(){}} },
    tabs:{ create(){}, onActivated:{addListener(){}}, query:async()=>[{id:1}] },
    storage:{ local:{ get:async()=>({}), set:async()=>{} }, session:{ get:async()=>({}), set:async()=>{} } }
  };
  try{ Object.defineProperty(globalThis,"navigator",{value:{clipboard:{writeText:async()=>{}}},configurable:true}); }catch(e){}
  return byId;
}

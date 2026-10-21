// Minimal DOM sufficient to execute panel.js render paths in node.
class El {
  constructor(tag){ this.tagName=tag.toUpperCase(); this.children=[]; this._text='';
    this.className=''; this.id=''; this.dataset={}; this.hidden=false; this.style={}; this.attrs={}; }
  append(...n){ for(const x of n){ if(x==null) continue; x.parentElement=this; this.children.push(x);} }
  appendChild(n){ this.append(n); return n; }
  replaceChildren(...n){ this.children=[]; this._text=''; this.append(...n); }
  get childNodes(){ return this.children; }
  remove(){ const p=this.parentElement; if(p) p.children=p.children.filter(c=>c!==this); }
  replaceWith(n){ const p=this.parentElement; if(!p) return; n.parentElement=p; p.children=p.children.map(c=>c===this?n:c); }
  addEventListener(ev,fn){ (this._on ??= {})[ev] ??= []; this._on[ev].push(fn); }
  fire(ev){ for(const fn of this._on?.[ev] ?? []) fn({ preventDefault(){}, key:'Enter' }); }
  get classList(){ const self=this;
    const list=()=>String(self.className).split(' ').filter(Boolean);
    const has=(c)=>list().includes(c);
    const add=(c)=>{ if(!has(c)) self.className=[...list(),c].join(' '); };
    const rm=(c)=>{ self.className=list().filter(x=>x!==c).join(' '); };
    return { contains:has, add, remove:rm,
             toggle:(c,on)=>{ (on===undefined ? !has(c) : !!on) ? add(c) : rm(c); } }; }
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
// The panel renders 直答's markdown through DOMParser rather than innerHTML,
// so node needs something to parse with. This reuses El's own crude parser:
// a child per opening tag, with the tags stripped out of the text.
globalThis.DOMParser = class {
  parseFromString(html){
    const body = new El('body');
    const frag = new El('div');
    frag.innerHTML = html;
    body.append(frag);
    return { body };
  }
};

export function makeDom(){
  const byId={};
  for(const id of ['root','foot','primary','ask','settings','refresh']) byId[id]=new El('div');
  globalThis.document={
    createElement:(t)=>new El(t),
    getElementById:(id)=>byId[id]||null,
    querySelectorAll:()=>[],
    addEventListener:()=>{}
  };
  globalThis.chrome={
    runtime:{ sendMessage:async()=>null, openOptionsPage(){}, connect:()=>({onMessage:{addListener(){}},postMessage(){}}), onMessage:{addListener(){}},
      // What the panel compares against what the browser actually granted.
      // A representative slice of the real manifest: a host permission the
      // panel never runs on, exact-host matches, and one *. domain pattern.
      getManifest:()=>({ host_permissions:['https://api.crossref.org/*','https://arxiv.org/*'],
                         content_scripts:[{ matches:['https://arxiv.org/abs/*','https://www.nature.com/articles/*',
                                                     'https://*.bmj.com/content/*'] }] }) },
    tabs:{ create(){}, onActivated:{addListener(){}}, query:async()=>[{id:1,url:'https://arxiv.org/abs/2503.01800'}] },
    storage:{ local:{ get:async()=>({}), set:async()=>{} }, session:{ get:async()=>({}), set:async()=>{} } },
    // Everything declared is granted, as on Chrome. Tests that care override it.
    permissions:{
      // Browsers answer this by pattern. getAll() is not equivalent: it lists
      // host permissions only, never a content script's matches.
      contains:async()=>true,
      request:async()=>true
    }
  };
  try{ Object.defineProperty(globalThis,"navigator",{value:{clipboard:{writeText:async()=>{}}},configurable:true}); }catch(e){}
  return byId;
}

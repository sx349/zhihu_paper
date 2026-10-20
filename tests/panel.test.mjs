import { makeDom } from './domstub.mjs';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let pass=0,fail=0;
const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

const paper={source:'arXiv',url:'https://arxiv.org/abs/2503.01800',doi:'',arxivId:'2503.01800',
  id:'arxiv:2503.01800',title:'Hilbert sixth problem',authors:['Yu Deng'],year:'2025'};
const authors=[{url_token:'ma-xiao-42-34',nickname:'不等式爱好者',label:'学数学，做数学，爱数学～',label_source:'签名'}];
const linked=[{kind:'question',title:'Q1',url:'https://z/q/1',answers:[{author:'a',votes:5778}]},
              {kind:'article',title:'A1',url:'https://z/p/1',author:'b',votes:150}];
const search={layer:'fuzzy',items:[{kind:'article',title:'S1',url:'https://z/p/2',author:'c',votes:1,score:0.67}],hidden:2};

let lastDom=null;
const dom_primary=()=>lastDom.primary.textContent;
async function run(state){
  const dom=makeDom(); lastDom=dom;
  globalThis.chrome.runtime.sendMessage=async(m)=>(m.type==='GET_STATE'?state:null);
  await import(P+'/src/panel/panel.js?v='+Math.random());
  await new Promise(r=>setTimeout(r,30));
  return { secs: dom.root.sections(), text: dom.root.textContent, foot: !dom.foot.hidden };
}

let r = await run({paper,resolution:{layer:'linked',authors,linked,search,viaAlias:false}});
ck('linked: renders authors + 关联讨论 + 按标题检索', r.secs.includes('本文作者在知乎')&&r.secs.includes('关联讨论')&&r.secs.includes('按标题检索'), r.secs.join(' | '));
ck('linked: title search shown even with a DOI hit', r.secs.includes('按标题检索'));
ck('linked question: no 提问草稿', !r.secs.includes('提问草稿'));
ck('panel never renders a draft section', !r.text.includes('提问草稿'));
ck('linked question: button is 去知乎讨论', dom_primary(r)==='去知乎讨论');
r = await run({paper,resolution:{layer:'linked',authors,linked:[linked[1]],search}});   // article only
ck('linked article only: button is 去知乎提问', dom_primary(r)==='去知乎提问');
ck('linked article only: article still listed under 关联讨论', r.secs.includes('关联讨论'));
ck('linked: no 标题搜索 tag', !r.text.includes('标题搜索'));
ck('author card shows nickname, not real name', r.text.includes('不等式爱好者') && !r.text.includes('Xiao Ma'));
ck('author card shows Zhihu label + token', r.text.includes('学数学，做数学') && r.text.includes('@ma-xiao-42-34'));
r = await run({paper,resolution:{layer:'linked',authors:[{url_token:'x',nickname:'X'}],linked,search}});
ck('empty label falls back to 优秀答主', r.text.includes('优秀答主'));

// the regression: an older service worker shape must not blank the panel
r = await run({paper,resolution:{layer:'linked',authors,items:linked}});
ck('stale SW shape still renders every section', r.secs.length>=3, r.secs.join(' | '));
ck('stale SW shape does not truncate after authors', r.secs.includes('关联讨论'));

r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search}});
ck('no index hit: shows 按标题检索, no 提问草稿', r.secs.includes('按标题检索')&&!r.secs.includes('提问草稿'));

r = await run({paper,resolution:{layer:'error',authors:[],linked:[],search:{layer:'error',items:[],error:'30001'}}});
ck('search error is not reported as 暂无讨论', r.text.includes('知乎搜索失败')&&!r.text.includes('暂无相关讨论'));

r = await run({paper,resolution:{layer:'empty',authors:[],linked:[],search:{layer:'empty',items:[],hidden:4}}});
ck('genuine empty says 暂无相关讨论', r.text.includes('暂无相关讨论')&&r.text.includes('已隐藏 4 条'));

// The seed alias table no longer feeds 关联讨论; Zhihu's index decides what
// a paper is, and says so by matching more than one paper (409).
r = await run({paper,resolution:{layer:'linked',authors,linked,search,conflict:true}});
ck('ambiguous match is disclosed', r.text.includes('可能与本文无关'));

// Progress while the pool is still being fetched / ranked.
r = await run({paper,resolution:null,phase:'fetching'});
ck('fetching phase shows progress', r.text.includes('正在获取结果'));
// 暂无相关讨论 before anything has been fetched would be a claim about
// results that do not exist yet.
ck('  搜索 section waits rather than claiming empty', !r.text.includes('暂无相关讨论'));
r = await run({paper,resolution:{authors:[],linked,search},phase:'ranking'});
ck('ranking phase shows progress', r.text.includes('正在用知乎直答排序'));
// The list is withheld until ranked, so it never reshuffles under the reader.
ck('  no discussion listed while ranking', !r.text.includes(linked[0].title), linked[0].title);
r = await run({paper,resolution:{authors:[],linked,search},phase:null});
ck('  listed once ranking is done', r.text.includes(linked[0].title));

// 直答 persistence + rendering
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},
               zhida:{text:'## 论文做了什么\n\n**核心**结论\n- 一\n- 二',pending:false}});
ck('stored 直答 renders on load without a button', r.text.includes('论文做了什么') && !r.text.includes('生成直答解读'));
ck('stored 直答 is rendered markdown, not raw', r.text.includes('核心') && !r.text.includes('**') && !r.text.includes('## '));
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},zhida:{text:'',pending:true}});
ck('in-flight 直答 shows placeholder, no button', r.text.includes('正在生成') && !r.text.includes('生成直答解读'));
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},zhida:{text:'',pending:false}});
ck('no 直答 yet shows the button', r.text.includes('生成直答解读') && !r.text.includes('正在生成'));
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search}});
ck('missing zhida field (older worker) still renders the button', r.text.includes('生成直答解读'));

r = await run(null);
ck('no paper: placeholder only', r.secs.length===0 && !r.foot);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

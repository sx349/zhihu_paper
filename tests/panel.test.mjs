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
const dom_disabled=()=>lastDom.primary.disabled;
async function run(state){
  const dom=makeDom(); lastDom=dom;
  globalThis.chrome.runtime.sendMessage=async(m)=>(m.type==='GET_STATE'?state:null);
  await import(P+'/src/panel/panel.js?v='+Math.random());
  await new Promise(r=>setTimeout(r,30));
  return { secs: dom.root.sections(), text: dom.root.textContent, foot: !dom.foot.hidden, dom };
}

let r = await run({paper,resolution:{layer:'linked',authors,linked,search,viaAlias:false}});
ck('linked: renders authors + 相关问题 + 相关回答/文章', r.secs.includes('本文作者在知乎')&&r.secs.includes('相关问题')&&r.secs.includes('相关回答/文章'), r.secs.join(' | '));
ck('linked: title search shown even with a DOI hit', r.secs.includes('相关回答/文章'));
ck('linked question: no 提问草稿', !r.secs.includes('提问草稿'));
ck('panel never renders a draft section', !r.text.includes('提问草稿'));
// 参与讨论 opens the top-ranked question, so it is live only once there is
// a ranked pool to open.
ck('ranked pool: 参与讨论 is live', dom_disabled(r)===false);
r = await run({paper,resolution:{layer:'linked',authors,linked:[],search}});
ck('nothing found: 参与讨论 is disabled', dom_disabled(r)===true);
r = await run({paper,resolution:{layer:'linked',authors,linked,search},phase:'ranking'});
ck('still ranking: 参与讨论 is disabled', dom_disabled(r)===true);
ck('linked article only: article still listed under 相关问题', r.secs.includes('相关问题'));
ck('linked: no 标题搜索 tag', !r.text.includes('标题搜索'));
ck('author card shows nickname, not real name', r.text.includes('不等式爱好者') && !r.text.includes('Xiao Ma'));
ck('author card shows Zhihu label + token', r.text.includes('学数学，做数学') && r.text.includes('@ma-xiao-42-34'));
r = await run({paper,resolution:{layer:'linked',authors:[{url_token:'x',nickname:'X'}],linked,search}});
ck('empty label falls back to 优秀答主', r.text.includes('优秀答主'));

// the regression: an older service worker shape must not blank the panel
r = await run({paper,resolution:{layer:'linked',authors,items:linked}});
ck('stale SW shape still renders every section', r.secs.length>=3, r.secs.join(' | '));
ck('stale SW shape does not truncate after authors', r.secs.includes('相关问题'));

r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search}});
ck('no index hit: shows 相关回答/文章, no 提问草稿', r.secs.includes('相关回答/文章')&&!r.secs.includes('提问草稿'));

r = await run({paper,resolution:{layer:'error',authors:[],linked:[],search:{layer:'error',items:[],error:'30001'}}});
ck('search error is not reported as 暂无讨论', r.text.includes('知乎搜索失败')&&!r.text.includes('暂无相关讨论'));

r = await run({paper,resolution:{layer:'empty',authors:[],linked:[],search:{layer:'empty',items:[],hidden:4}}});
ck('genuine empty says 暂无相关讨论', r.text.includes('暂无相关讨论')&&r.text.includes('已隐藏 4 条'));

// The seed alias table no longer feeds 相关问题; Zhihu's index decides what
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
ck('ranking phase shows progress', r.text.includes('正在由知乎直答排序'));
// The list is withheld until ranked, so it never reshuffles under the reader.
ck('  no discussion listed while ranking', !r.text.includes(linked[0].title), linked[0].title);
r = await run({paper,resolution:{authors:[],linked,search},phase:null});
ck('  listed once ranking is done', r.text.includes(linked[0].title));

// 直答 persistence + rendering
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},
               zhida:{text:'## 论文做了什么\n\n**核心**结论\n- 一\n- 二',pending:false}});
ck('stored 直答 renders on load without a button', r.text.includes('论文做了什么') && !r.text.includes('生成直答解读'));
ck('stored 直答 is rendered markdown, not raw', r.text.includes('核心') && !r.text.includes('**') && !r.text.includes('## '));
ck('stored 直答 offers 重新生成', r.text.includes('重新生成'));
ck('  enabled when nothing is running', r.dom.root.querySelectorAll('zdagain')[0].disabled !== true);
ck('  and it sits in the body, not the heading, so folding hides it',
   !(r.dom.root.querySelectorAll('zdhead')[0] || {textContent:''}).textContent.includes('重新生成'));
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},zhida:{text:'',pending:true}});
ck('in-flight 直答 shows placeholder, no button', r.text.includes('正在生成') && !r.text.includes('生成直答解读'));

// a regeneration started elsewhere: text is stored AND pending is set
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},zhida:{text:'旧的解读内容',pending:true}});
ck('regenerating shows progress, not the stale text', r.text.includes('正在生成') && !r.text.includes('旧的解读内容'));
ck('  and 重新生成 is disabled meanwhile', r.dom.root.querySelectorAll('zdagain')[0].disabled === true);
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search},zhida:{text:'',pending:false}});
ck('no 直答 yet shows the button', r.text.includes('生成直答解读') && !r.text.includes('正在生成'));
ck('  and no 重新生成 before there is anything to regenerate', !r.text.includes('重新生成'));
r = await run({paper,resolution:{layer:'fuzzy',authors:[],linked:[],search}});
ck('missing zhida field (older worker) still renders the button', r.text.includes('生成直答解读'));

r = await run(null);
ck('no paper: placeholder only', r.secs.length===0 && !r.foot);

// --- folding --------------------------------------------------------------
r = await run({paper,resolution:{layer:'linked',authors,linked,search,viaAlias:false},zhida:{text:'',pending:false}});
const secs = r.dom.root.querySelectorAll('sec');
const heads = secs.map((x)=> x.querySelectorAll('shead')[0] || x.querySelectorAll('zdhead')[0]);

ck('every section is foldable', secs.length===4 && heads.every(Boolean), String(secs.length)+' sections');
ck('  each heading carries a marker', heads.every((h)=>h.querySelectorAll('chev').length===1));
ck('  and is reachable as a button', heads.every((h)=>h.getAttribute('role')==='button' && h.getAttribute('tabindex')==='0'));
ck('all four start expanded', secs.every((x)=>!x.classList.contains('folded'))
   && heads.every((h)=>h.getAttribute('aria-expanded')==='true'));

// fold 相关问题 and the heading must survive while its body goes
const qi = r.secs.findIndex((t)=>t.includes('相关问题'));
heads[qi].fire('click');
ck('folding sets the class', secs[qi].classList.contains('folded'));
ck('  and flips aria-expanded', heads[qi].getAttribute('aria-expanded')==='false');
ck('  while the heading and its count stay', secs[qi].querySelectorAll('shead')[0].textContent.includes('相关问题'));
ck('  and the others are untouched', secs.filter((x,i)=>i!==qi).every((x)=>!x.classList.contains('folded')));
heads[qi].fire('click');
ck('unfolding puts it back', !secs[qi].classList.contains('folded') && heads[qi].getAttribute('aria-expanded')==='true');

// --- showing three, and getting back to three -----------------------------
const ten = Array.from({length:10},(_,i)=>({kind:'question',title:'Q'+(i+1),url:'https://z/q/'+i,
  answers:[{author:'a',votes:100-i}],top:{author:'a',votes:100-i}}));
r = await run({paper,resolution:{layer:'linked',authors:[],linked:ten,search:{layer:'empty',items:[]}},
               zhida:{text:'',pending:false}});
const items = () => r.dom.root.querySelectorAll('item').length;
const more = r.dom.root.querySelectorAll('zdgen').find((b)=>b.textContent.includes('展开')||b.textContent.includes('收起'));

ck('shows three of ten', items()===3, String(items()));
ck('  and offers the other seven', more && more.textContent==='展开其余 7 条', more && more.textContent);
more.fire('click');
ck('expanding shows all ten', items()===10, String(items()));
ck('  and the same button now collapses', more.textContent==='收起');
more.fire('click');
ck('collapsing returns to three', items()===3, String(items()));
ck('  and the label comes back', more.textContent==='展开其余 7 条');
more.fire('click');
ck('expanding a second time still works', items()===10, String(items()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

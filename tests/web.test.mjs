// searchWeb mapping, its 相关问题 view, and zhidaWeb SSE parsing, against captured shapes.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const store={};
globalThis.chrome={ storage:{ local:{ get:async(k)=>({[k]:store[k]}), set:async(o)=>Object.assign(store,o) } } };
let pass=0,fail=0; const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

// --- search_v3 payload, shaped as captured from the live API
const page0 = { data: [
  { type:'ai_zhida', object:{} },
  { type:'search_result', object:{ type:'answer', id:'123281591095', voteup_count:5915,
      question:{ id:'14073117334', name:'Yu <em>Deng</em> 及合作者在 arxiv 发布…' },
      author:{ name:'Yu <em>Deng</em>', url_token:'paellahorizon' }, excerpt:'<em>x</em>y' } },
  { type:'search_result', object:{ type:'article', id:'2064069519547667924', voteup_count:147, title:'对希尔伯特第六问题证明的思考',
      author:{ name:'周舟', url_token:'nicoldcastle' }, excerpt:'…' } },
  { type:'relevant_query' },
  { type:'search_result', object:{ type:'zvideo', id:1 } }
]};
// Page 2 carries a weaker answer on a question page 1 already had, plus a new one.
const page1 = { data: [
  { type:'search_result', object:{ type:'answer', id:'999', voteup_count:100,
      question:{ id:'14073117334', name:'Yu Deng 及合作者在 arxiv 发布…' }, author:{ name:'someone' } } },
  { type:'search_result', object:{ type:'answer', id:'888', voteup_count:7,
      question:{ id:'20000000001', name:'另一个问题' }, author:{ name:'别人' } } }
]};

let inFlight = 0, peak = 0, offsets = [];
globalThis.fetch = async (u) => {
  const off = new URL(u).searchParams.get('offset');
  offsets.push(off);
  inFlight++; peak = Math.max(peak, inFlight);
  await new Promise((r) => setTimeout(r, 5));
  inFlight--;
  return { ok:true, status:200, json:async()=> (off === '0' ? page0 : page1) };
};

const { searchWeb, questionsFromRows, zhidaWeb } = await import(P+'/src/lib/zhihu.js');
const r = await searchWeb('q');

ck('both pages requested', offsets.join(',')==='0,20', offsets.join(','));
ck('  and fetched together, not one after the other', peak===2, 'peak in-flight ' + peak);
ck('keeps answers and articles only', r.length===4 && r.map(x=>x.kind).join(',')==='answer,article,answer,answer', r.map(x=>x.kind).join(','));
ck('answer url built from question id + answer id', r[0].url==='https://www.zhihu.com/question/14073117334/answer/123281591095');
ck('article url built from id', r[1].url==='https://zhuanlan.zhihu.com/p/2064069519547667924');
ck('<em> stripped from title and author', r[0].title.startsWith('Yu Deng 及合作者') && r[0].author==='Yu Deng');
ck('qid and votes carried', r[0].qid==='14073117334' && r[0].votes===5915);
ck('article carries no qid', r[1].qid==='');
ck('19-digit id survives intact (string end to end)', r[1].url.endsWith('/p/2064069519547667924'));
ck('no score field', r[0].score===undefined);
ck('fields the panel never reads are not produced',
   r[0].excerpt===undefined && r[0].authorToken===undefined && r[0].questionId===undefined);

// --- the 相关问题 view of the same rows
const qs = questionsFromRows(r);
ck('collapses answers to distinct questions', qs.length===2, String(qs.length));
ck('  the article contributes none', !qs.some((q)=>q.kind!=='question'));
ck('  highest-voted answer wins the question', qs[0].qid==='14073117334' && qs[0].votes===5915);
ck('  question url is the question, not the answer', qs[0].url==='https://www.zhihu.com/question/14073117334');
ck('  marked as coming from search', qs.every((q)=>q.src==='search'));

// --- page failures
globalThis.fetch = async (u) => {
  const off = new URL(u).searchParams.get('offset');
  return off === '0' ? { ok:true, status:200, json:async()=>page0 } : { ok:false, status:500 };
};
const partial = await searchWeb('q');
ck('a failed second page is tolerated', partial.length===2, String(partial.length));

globalThis.fetch = async () => ({ ok:false, status:403 });
let threw = '';
try { await searchWeb('q'); } catch (e) { threw = e.message; }
ck('a failed first page throws, so the open platform can take over', threw.includes('403'), threw);

// --- SSE stream, shaped as captured
const sse=[
  'data: {"event":"Init","data":{"session_id":"3752684987876619159","message_id":"1"}}','',
  'data: {"event":"Answer","data":{"delta":true,"summary":"熵是<mark>描述"}}','',
  ': keep-alive','',
  'data: {"event":"HeartBeat","data":{}}','',
  'data: {"event":"Answer","data":{"delta":true,"summary":"系统混乱程度</mark>的量"}}','',
  'data: not json','',
].join('\n')+'\n';
const enc=new TextEncoder();
globalThis.fetch=async(u,o)=>{
  ck('  posts with credentials and empty session_id', o.credentials==='include' && JSON.parse(o.body).session_id==='');
  return { ok:true, status:200, body:new ReadableStream({ start(c){ for(const chunk of [sse.slice(0,70), sse.slice(70)]) c.enqueue(enc.encode(chunk)); c.close(); } }) };
};
const chunks=[]; const full=await zhidaWeb('p',(d)=>chunks.push(d));
ck('accumulates Answer deltas, skips Init/HeartBeat/comments/garbage', full==='熵是描述系统混乱程度的量', full);
ck('<mark> stripped', !full.includes('<mark>'));
ck('onChunk called per delta', chunks.length===2);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);

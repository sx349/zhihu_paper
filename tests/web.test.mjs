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

const { searchWeb, questionsFromRows, zhidaWeb, hasCJK, translateTitle, members } = await import(P+'/src/lib/zhihu.js');
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
  // 直答 cites inline, and an element can straddle two deltas
  'data: {"event":"Answer","data":{"delta":true,"summary":"，约 7 分钟<cite data-id=\'50"}}','',
  'data: {"event":"Answer","data":{"delta":true,"summary":"00003\'>5000003</cite>可读完。"}}','',
  'data: not json','',
].join('\n')+'\n';
const enc=new TextEncoder();
globalThis.fetch=async(u,o)=>{
  ck('  posts with credentials and empty session_id', o.credentials==='include' && JSON.parse(o.body).session_id==='');
  return { ok:true, status:200, body:new ReadableStream({ start(c){ for(const chunk of [sse.slice(0,70), sse.slice(70)]) c.enqueue(enc.encode(chunk)); c.close(); } }) };
};
const chunks=[]; const full=await zhidaWeb('p',(d)=>chunks.push(d));
ck('accumulates Answer deltas, skips Init/HeartBeat/comments/garbage',
   full==='熵是描述系统混乱程度的量，约 7 分钟可读完。', full);
ck('<mark> stripped', !full.includes('<mark>'));
ck('<cite> goes with its contents, not just its tags', !full.includes('5000003') && !full.includes('cite'));
ck('  even when it straddles two deltas', full.endsWith('分钟可读完。'));
ck('  while a real number in the prose survives', full.includes('约 7 分钟'));
ck('onChunk called per delta', chunks.length===4, String(chunks.length));


// --- translating the query ------------------------------------------------
ck('a Chinese title needs no translating', hasCJK('希尔伯特第六问题'));
ck('  an English one does', !hasCJK("Hilbert's sixth problem"));
ck('  and a mixed one does not', hasCJK('Hilbert 第六问题'));

const oneAnswer = (text) => [`data: {"event":"Answer","data":{"delta":true,"summary":${JSON.stringify(text)}}}`, ''].join('\n')+'\n';
const enc2 = new TextEncoder();
const reply = (text) => { globalThis.fetch = async () => ({ ok:true, status:200,
  body:new ReadableStream({ start(c){ c.enqueue(enc2.encode(oneAnswer(text))); c.close(); } }) }); };

reply('坦桑尼亚多多马地区街头食品摊贩自报卫生行为的横断面研究');
ck('translates to the bare title', (await translateTitle('Navigating the urban food frontier')) ===
   '坦桑尼亚多多马地区街头食品摊贩自报卫生行为的横断面研究');

// Verbatim shape of a real reply: it ignores 只输出译文 and echoes the title.
reply('navigating the urban food frontier: a cross-sectional study ... in Dodoma region, Tanzania 的中文翻译是：\n探索城市食品前沿：一项评估坦桑尼亚多多马地区街头食品摊贩自我报告卫生行为决定因素的横断面研究');
ck('takes the translation, not the echoed English',
   (await translateTitle('x')) === '探索城市食品前沿：一项评估坦桑尼亚多多马地区街头食品摊贩自我报告卫生行为决定因素的横断面研究');

reply('标题 的中文翻译是：探索城市食品前沿');
ck('  including when the label is on the same line', (await translateTitle('x')) === '探索城市食品前沿');

reply('Navigating the urban food frontier: a cross-sectional study to evaluate the determinants of self-reported hygiene practices among street food vendors');
ck('  and an English-only answer is refused', (await translateTitle('x')) === '');

reply('译文：街头食品摊贩卫生行为研究');
ck('strips a 译文： label', (await translateTitle('x')) === '街头食品摊贩卫生行为研究');

reply('“街头食品摊贩卫生行为研究”');
ck('strips surrounding quotes', (await translateTitle('x')) === '街头食品摊贩卫生行为研究');

reply('我是知乎直答 —— 知乎官方推出的AI搜索产品，专注于提供高效、精准的知识回答。');
ck('refuses the product blurb as a query', (await translateTitle('x')) === '');

reply('这'.repeat(140));
ck('refuses anything past the 100-char query limit', (await translateTitle('x')) === '');

reply('');
ck('an empty answer yields no query', (await translateTitle('x')) === '');

// --- live author info ------------------------------------------------------
// The seed's nickname and signature are copies nothing refreshes. These come
// from /api/v4/members, which needs the reader's Zhihu session.
const MEMBER = { 'paellahorizon': { name:'Yu Deng', headline:'愿世界和平，愿龙怜结婚。',
    avatar_url:'https://picx.zhimg.com/fecdefe08c23d32e854187eef850b527_xl.jpg?source=32738c0c&needBackground=1' },
  'ma-xiao-42-34': { name:'不等式爱好者', headline:'学数学，做数学', avatar_url:'' } };
let asked = [], lastUrl = '';
globalThis.fetch = async (u) => {
  lastUrl = String(u);
  const t = decodeURIComponent(new URL(u).pathname.split('/').pop());
  asked.push(t);
  if (!MEMBER[t]) return { ok:false, status:404 };
  return { ok:true, status:200, json:async()=>MEMBER[t] };
};

let m = await members(['paellahorizon', 'ma-xiao-42-34']);
ck('one entry per account', m.size===2, String(m.size));
ck('  carries the live name and signature',
   m.get('paellahorizon').name==='Yu Deng' && m.get('paellahorizon').headline==='愿世界和平，愿龙怜结婚。');
// _xl is 200px and the panel draws 32px; _l is 100px, a quarter of the bytes.
ck('  asks the CDN for _l, not the _xl it was handed',
   m.get('paellahorizon').avatar==='https://picx.zhimg.com/fecdefe08c23d32e854187eef850b527_l.jpg',
   m.get('paellahorizon').avatar);
// ?source= differs per size and per response, so leaving it on would cache
// the same image several times over.
ck('  with no ?source= token', !m.get('paellahorizon').avatar.includes('?'));
ck('  an account with no avatar yields none', m.get('ma-xiao-42-34').avatar==='');
// The endpoint returns none of these unless they are asked for by name.
ck('  include= names every field used',
   ['name', 'headline', 'avatar_url'].every((f) => new URL(lastUrl).searchParams.get('include').includes(f)),
   new URL(lastUrl).searchParams.get('include'));

asked = [];
m = await members(['paellahorizon', 'paellahorizon', '', null]);
ck('each account asked once, blanks skipped', asked.join(',')==='paellahorizon', asked.join(','));

m = await members(['paellahorizon', 'nobody']);
ck('a failed account drops out rather than throwing', m.size===1 && m.has('paellahorizon'), String(m.size));

globalThis.fetch = async () => { throw new Error('offline'); };
ck('all failing yields an empty map, not a rejection', (await members(['x'])).size===0);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);

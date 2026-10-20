// parseCandidates + the venue/input shape the live tuning settled on.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
globalThis.chrome={storage:{local:{get:async()=>({}),set:async()=>{}}}};
const { questionPrompt, draftQuestionCandidates } = await import(P+'/src/lib/zhihu.js');
let pass=0,fail=0; const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

const arx={title:'T',abstract:'A',authors:['X Y'],journal:'',source:'arXiv',year:'2025',arxivId:'2503.01800',doi:'',url:'https://arxiv.org/abs/2503.01800'};
const jrn={title:'T',abstract:'A',authors:['X Y'],journal:'Management Science',year:'2023',arxivId:'',doi:'10.1287/mnsc.2022.4522',url:'https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4522'};
const pa=questionPrompt(arx), pj=questionPrompt(jrn);

ck('venue is name + year only, no stage parenthetical', pa.includes('发表平台及时间：arXiv，2025') && !pa.includes('（预印本）'));
ck('no 文献类型 field', !pa.includes('文献类型'));
ck('journal venue likewise', pj.includes('发表平台及时间：Management Science，2023'));
ck('rule 1 still says 30 字', pa.includes('控制在 30 字以内'));
ck('output asks for all five, numbered', pa.includes('输出全部 5 条候选提问') && pa.includes('1. 2. 3. 4. 5.'));
ck('arXiv id and link present', pa.includes('arXiv:2503.01800') && pa.includes('https://arxiv.org/abs/2503.01800'));
ck('DOI paper links through doi.org', pj.includes('https://doi.org/10.1287/mnsc.2022.4522'));
ck('abstract omitted cleanly when absent', !questionPrompt({...arx,abstract:''}).includes('论文摘要：'));

// parseCandidates runs through draftQuestionCandidates; stub the transport
const raw = ['好的，以下是候选：',
  '1. 研究从硬球系统推导出流体方程，意味着什么',
  '2. 论文在 arXiv 发布突破，可信度如何？',
  '3、研究打通牛顿到流体方程链条，可能带来哪些影响。',
  '4. 「论文仅覆盖稀薄硬球气体场景，距离通用应用还有多远」',
  '5. 研究用玻尔兹曼路径推导流体方程，方法边界在哪里',
  '以上。'].join('\n');
globalThis.fetch=async()=>({ok:true,status:200,body:new ReadableStream({start(c){
  c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({event:'Answer',data:{summary:raw}})+'\n\n'));c.close();}})});
const list=await draftQuestionCandidates(arx);
ck('parses five, drops prose around them', list.length===5, JSON.stringify(list.slice(0,1)));
ck('strips numbering incl. CJK 、', list[2].startsWith('研究打通'));
ck('strips 「」 quotes', list[3].startsWith('论文仅覆盖'));
ck('appends ？ where missing', list[0].endsWith('意味着什么？'));
ck('keeps an existing ？', list[1].endsWith('可信度如何？') && !list[1].endsWith('？？'));
ck('replaces a trailing 。 with ？', list[2].endsWith('影响？') && !list[2].includes('。'));
ck('no filtering: platform-led candidate survives', list.some(q=>q.includes('arXiv')));

globalThis.fetch=async()=>{throw new Error('down')};
ck('returns [] on failure, no secret', (await draftQuestionCandidates(arx)).length===0);
ck('returns [] for a paper with no title', (await draftQuestionCandidates({title:''})).length===0);

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);

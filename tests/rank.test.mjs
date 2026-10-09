import { readFileSync } from 'fs';
const P='/Users/yejiaxu/Downloads/zhihu_paper';
globalThis.chrome={ runtime:{ getURL:(p)=>P+'/'+p } };
globalThis.fetch=async(u)=>({ json:async()=>JSON.parse(readFileSync(u,'utf8')) });
const { getPaper } = await import(P+'/src/lib/papergraph.js');
let pass=0,fail=0;
const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

const d=(await getPaper('arxiv:2503.01800')).Data.discussions;
console.log('  ranked order:');
d.forEach((x,i)=>console.log(`    ${i+1}. [${x.kind.padEnd(8)}] w=${String(x.weight).padStart(5)} ${x.title.slice(0,40)}`));
console.log();

ck('questions and articles interleave by weight',
   d.map(x=>x.weight).join(',')==='5917,1405,150,37,31', d.map(x=>x.weight).join(','));
ck('ordering is not grouped by kind',
   d[1].kind==='question' && d[2].kind==='article' && d[3].kind==='question');
ck('question weight = its top answer votes', d[0].weight===5917);
ck('article weight = its own votes', d.find(x=>x.kind==='article').weight===150);
ck('paper co-authors (paellahorizon, ma-xiao-42-34) are author-involved on the top question',
   d[0].authorInvolved===true && d[0].weight===5917, 'w='+d[0].weight+' involved='+d[0].authorInvolved);
ck('only that one item is author-involved in real data', d.filter(x=>x.authorInvolved).length===1);

// author involvement must outrank vote weight — synthetic, since no bound
// author appears in the real seed
const raw = JSON.parse(readFileSync(P+'/data/seed.json','utf8'));
raw.answer.push({ aid:'t1', qid:'2063944001502310564', url_token:'paellahorizon',
                  author_name:'Yu Deng', url:'https://x', vote_count:3 });
const tmp = process.env.TMPDIR + 'seed_rank.json';
(await import('fs')).writeFileSync(tmp, JSON.stringify(raw));
globalThis.chrome = { runtime:{ getURL:()=>tmp } };
const mod = await import(P+'/src/lib/papergraph.js?v=2');
const d2 = (await mod.getPaper('arxiv:2503.01800')).Data.discussions;
// Real data already has one involved item (the 5917 question). Injecting a
// second on the 37-weight question makes two tier-1 entries: they sort by
// weight between themselves, and BOTH sit above every uninvolved item —
// so the 37-weight question must land ahead of the uninvolved 1405 one.
ck('two tier-1 items sort by weight: 5917 then 37',
   d2[0].weight===5917 && d2[0].authorInvolved && d2[1].weight===37 && d2[1].authorInvolved,
   d2.map(x=>x.weight+(x.authorInvolved?'*':'')).join(','));
ck('involved 37-weight question outranks uninvolved 1405-weight question',
   d2[1].weight===37 && d2[2].weight===1405 && !d2[2].authorInvolved);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

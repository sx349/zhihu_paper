import { readFileSync } from 'fs';
const P='/Users/yejiaxu/Downloads/zhihu_paper';
const store={};
globalThis.chrome={
  runtime:{ getURL:(p)=>P+'/'+p },
  storage:{ local:{ get:async(k)=>({[k]:store[k]}), set:async(o)=>Object.assign(store,o) } }
};
const realFetch=globalThis.fetch;
globalThis.fetch=async(u)=> String(u).startsWith('http') ? realFetch(u) : ({ json:async()=>JSON.parse(readFileSync(u,'utf8')) });

const { getPaper, authorsByOrcid, mergeAuthors } = await import(P+'/src/lib/papergraph.js');
const { enrich } = await import(P+'/src/lib/crossref.js');
let pass=0,fail=0;
const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

// 1. the direct link is really gone
const hit = await getPaper('doi:10.1287/mnsc.2022.4522');
ck('paper still in index', hit.Code===0);
ck('but has NO declared authors', hit.Data.authors.length===0);

// 2. what the INFORMS page gives us: DOI, title, no authors (real shape)
const page = { doi:'10.1287/mnsc.2022.4522', id:'doi:10.1287/mnsc.2022.4522',
  title:'Marketplace Scalability and Strategic Use of Platform Investment', authors:[], abstract:'' };
const paper = await enrich(page);
ck('Crossref attaches ORCIDs', paper.orcids?.length===4, JSON.stringify(paper.orcids?.map(o=>o.orcid)));
ck('  one of them is yours', paper.orcids.some(o=>o.orcid==='0000-0003-0541-6673'));

// 3. the bridge
const via = await authorsByOrcid(paper.orcids);
ck('ORCID lookup finds richard-xu-25', via.length===1 && via[0].url_token==='richard-xu-25', JSON.stringify(via.map(v=>v.url_token)));
ck('  with the Zhihu profile, not the paper name', via[0].nickname==='Richard Xu' && via[0].label==='南加州大学 经济学博士');
ck('  marked relation=orcid', via[0].relation==='orcid');

// 4. what the panel will receive
const authors = mergeAuthors(hit.Data.authors, via);
ck('merged authors = [richard-xu-25]', authors.length===1 && authors[0].url_token==='richard-xu-25');

// 5. the other three co-authors have ORCIDs but no Zhihu binding -> not shown
ck('unbound ORCIDs produce nothing', (await authorsByOrcid(['0000-0002-8523-8266'])).length===0);

// 6. Deng paper: arXiv, no DOI -> no Crossref, declared links still work
const deng = await getPaper('arxiv:2503.01800');
const dengAuthors = mergeAuthors(deng.Data.authors, await authorsByOrcid(undefined));
ck('declared links unaffected (2 authors on Deng paper)', dengAuthors.length===2);

// 7. dedupe when both paths find the same account
const dup = mergeAuthors([{url_token:'x',relation:'author'}],[{url_token:'x',relation:'orcid'}]);
ck('same account via both paths appears once, declared wins', dup.length===1 && dup[0].relation==='author');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

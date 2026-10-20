import { readFileSync } from 'fs';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const store={};
globalThis.chrome={ storage:{ local:{
  get: async(k)=>({[k]:store[k]}),
  set: async(o)=>Object.assign(store,o)
}}};
let calls=0;
const realFetch=globalThis.fetch;
globalThis.fetch=async(u)=>{ calls++; return realFetch(u); };

const { resolveDoi, enrich } = await import(P+'/src/lib/crossref.js');
let pass=0,fail=0;
const check=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

const cr = await resolveDoi('10.1287/mnsc.2022.4522');
check('resolves DOI', !!cr);
check('title', cr.title==='Marketplace Scalability and Strategic Use of Platform Investment');
check('4 authors', cr.authors.length===4, cr.authors.join(', '));
check('extracts ORCIDs', cr.orcids.length===4);
check('ORCID stripped of url prefix', /^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(cr.orcids[0].orcid), cr.orcids[0].orcid);
check('venue + year', cr.journal==='Management Science' && cr.year==='2023');
check('abstract stripped of JATS', cr.abstract.length>50 && !cr.abstract.includes('<'));

const before=calls;
await resolveDoi('10.1287/mnsc.2022.4522');
check('second lookup served from cache', calls===before);

// enrich: Crossref is the record for DOI papers; page is fallback; abstract page-first
const page={ doi:'10.1287/mnsc.2022.4522', title:'Page Title Wins', authors:[], abstract:'' };
const e1=await enrich(page);
check('Crossref title supersedes the page title', e1.title==='Marketplace Scalability and Strategic Use of Platform Investment');
check('missing authors filled', e1.authors.length===4);
check('authorsSource marked', e1.authorsSource==='crossref');
check('abstract filled', e1.abstract.length>50);
check('orcids attached', e1.orcids.length===4);

const complete={ doi:'10.1287/mnsc.2022.4522', title:'T', authors:['A'], abstract:'long enough abstract here' };
const before2=calls;
const e2=await enrich(complete);
check('Crossref authors supersede page authors', e2.authors.length===4 && e2.orcids.length===4);

const noDoi=await enrich({ arxivId:'2503.01800', title:'T', authors:[], abstract:'' });
check('arXiv (no DOI): page meta untouched, no call', noDoi.authors.length===0 && !noDoi.orcids);

check('author names have single spaces', e1.authors.every(n=>!/\s{2}/.test(n)), e1.authors.join(' | '));

// a present-but-truncated page abstract must still be replaced by the full one
const truncatedPage={ doi:'10.1287/mnsc.2022.4522', title:'T', authors:['A'], abstract:'The scalability of a marketplace depends on the operations of the marketplace platform and its sellers capacities. In this study, we explore one strategy that a marketplace platform can use to enh...' };
const e3=await enrich(truncatedPage);
check('page abstract kept even when Crossref has a longer one (page-first)', e3.abstract===truncatedPage.abstract);
const fullPage={ doi:'10.1287/mnsc.2022.4522', title:'T', authors:['A'], abstract:'x'.repeat(3000) };   // longer than Crossref's
const before3=calls; const e4=await enrich(fullPage);
check('page abstract kept', e4.abstract===fullPage.abstract);
check('Crossref abstract used only when page has none', (await enrich({doi:'10.1287/mnsc.2022.4522',title:'T',authors:['A'],abstract:''})).abstract.length>500);

// abstract precedence: page body -> Crossref -> truncated description
const pageBody={ doi:'10.1287/mnsc.2022.4522', title:'T', authors:['A'], abstract:'x'.repeat(900), abstractSource:'selector', abstractFallback:'short...' };
check('page abstract wins and keeps its source', (await enrich(pageBody)).abstractSource==='selector');
const noBody={ doi:'10.1287/mnsc.2022.4522', title:'T', authors:['A'], abstract:'', abstractSource:'', abstractFallback:'The scalability of a marketplace depends on...' };
const e5=await enrich(noBody);
check('no page abstract: Crossref used, source=crossref', e5.abstractSource==='crossref' && e5.abstract.length>500);
const arx={ arxivId:'2503.01800', title:'T', authors:['A'], abstract:'', abstractSource:'', abstractFallback:'desc only' };
const e6=await enrich(arx);
check('no DOI and no page abstract: description fallback, source=description', e6.abstract==='desc only' && e6.abstractSource==='description');

const bad=await resolveDoi('10.9999/definitely-not-a-real-doi-xyz');
check('bad DOI returns null, does not throw', bad===null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

import { readFileSync } from 'fs';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
globalThis.chrome={ runtime:{ getURL:(p)=>P+'/'+p } };
globalThis.fetch=async(u)=>({ json:async()=>JSON.parse(readFileSync(u,'utf8')) });
const { getPaper } = await import(P+'/src/lib/papergraph.js');

let pass=0,fail=0;
const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

// old-style arXiv id resolves
const per = await getPaper('arxiv:math/0211159');
ck('old-style arXiv id resolves', per.Code===0);

// arXiv DOI alias -> same paper, same authors
const viaArxivDoi = await getPaper('doi:10.48550/arXiv.2503.01800');
ck('arXiv DOI resolves via alias', viaArxivDoi.Code===0);
ck('  flagged ViaAlias', viaArxivDoi.ViaAlias===true);
ck('  matched canonical id', viaArxivDoi.MatchedId==='arxiv:2503.01800', viaArxivDoi.MatchedId);
ck('  keeps both authors', viaArxivDoi.Data?.authors.length===2);

// preprint DOI -> published paper (the version-mismatch case)
const viaPreprint = await getPaper('doi:10.1101/2024.09.01.610707');
ck('bioRxiv preprint DOI -> published paper', viaPreprint.Code===0);
ck('  resolves to PLOS DOI', viaPreprint.MatchedId==='doi:10.1371/journal.pone.0310348', viaPreprint.MatchedId);
ck('  ViaAlias true', viaPreprint.ViaAlias===true);

// altIds path, as the content script supplies it
const viaAlt = await getPaper('doi:10.99999/unknown', ['doi:10.48550/arXiv.2503.01800']);
ck('altIds fall-through works', viaAlt.Code===0 && viaAlt.ViaAlias===true);

// exact hit is not marked as an alias
const direct = await getPaper('arxiv:2503.01800');
ck('direct hit not flagged ViaAlias', direct.ViaAlias===false);

// genuine miss still misses
const miss = await getPaper('arxiv:2306.00205');
ck('unseeded paper still 404s', miss.Code===404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

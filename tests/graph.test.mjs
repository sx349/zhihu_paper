// Stub the two browser APIs papergraph.js touches, then exercise the real module.
import { readFileSync } from 'fs';
const P = '/Users/yejiaxu/Downloads/zhihu_paper';
globalThis.chrome = { runtime: { getURL: (p) => P + '/' + p } };
globalThis.fetch = async (u) => ({ json: async () => JSON.parse(readFileSync(u, 'utf8')) });

const { getPaper } = await import(P + '/src/lib/papergraph.js');
const { questionBody, zhidaPrompt } = await import(P + '/src/lib/zhihu.js');

let pass = 0, fail = 0;
const check = (name, cond, extra='') => { cond ? pass++ : fail++; console.log(`${cond?'ok  ':'FAIL'}  ${name}${extra?'  '+extra:''}`); };

// --- L1 hit: the Deng/Hani/Ma paper
const hit = await getPaper('arxiv:2503.01800');
check('seeded arXiv id resolves', hit.Code === 0);
check('envelope shape {Code,Message,Data}', 'Code' in hit && 'Message' in hit && 'Data' in hit);
check('two bound authors', hit.Data.authors.length === 2, hit.Data.authors.map(a=>a.name).join(', '));
check('author carries url_token', hit.Data.authors[0].url_token === 'paellahorizon');
check('five discussions resolved', hit.Data.discussions.length === 5);

const q = hit.Data.discussions.find(d => d.kind === 'question' && d.answers.length === 4);
check('question resolves its answers', !!q);
check('Yu Deng answer first, by paellahorizon', q.answers[0].urlToken==='paellahorizon');
check('answers sorted by votes desc', q.answers[0].votes === 5917 && q.answers[1].votes === 5779 && q.answers[3].votes === 12,
      q.answers.map(a=>a.votes).join(' > '));
const art = hit.Data.discussions.find(d => d.kind === 'article');
check('article resolves author + votes', art.author === '大老李' && art.votes === 150);

// --- L2 miss: a paper deliberately not in the index
const miss = await getPaper('arxiv:2306.00205');
check('unseeded paper misses cleanly', miss.Code === 404 && miss.Data === null);

// --- alt-id path (DOI page for a paper indexed by arXiv id)
const alt = await getPaper('doi:10.9999/nope', 'arxiv:2503.01800');
check('falls back to alt id', alt.Code === 0);

// --- 补充说明 body (the title now comes from the compose modal)
const paper = { title:'Hilbert\'s sixth problem: derivation of fluid equations via Boltzmann\'s kinetic theory',
  authors:['Yu Deng','Zaher Hani','Xiao Ma'], arxivId:'2503.01800', doi:'', journal:'', year:'2025',
  url:'https://arxiv.org/abs/2503.01800', abstract:'We derive the fluid equations...' };
const body = questionBody(paper);
check('body is a string, not {title,body}', typeof body === 'string');
check('body: 期刊 line is arXiv with year', body.includes('期刊：arXiv（2025）'));
check('body: arXiv-only paper links to the abs page', body.includes('链接：https://arxiv.org/abs/2503.01800'));
check('body includes abstract when present', body.includes('摘要：We derive'));
check('body has exactly title/authors/venue/link/abstract', body.split('\n').filter(Boolean).length===5);
const doiBody = questionBody({ ...paper, doi:'10.1287/mnsc.2022.4522', arxivId:'', journal:'Management Science', year:'2023', abstract:'' });
check('DOI paper links through doi.org', doiBody.includes('链接：https://doi.org/10.1287/mnsc.2022.4522'));
check('no abstract -> no 摘要 line', !doiBody.includes('摘要'));
check('authorless body has no 作者 line', !questionBody({ ...paper, authors: [] }).includes('作者：'));
check('zhida prompt includes abstract', zhidaPrompt(paper).includes('摘要：'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

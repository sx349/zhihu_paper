// Edge cases for the identifier: old-style arXiv ids, DOIs containing
// parentheses and angle brackets, query-string DOIs, SSRN's abstract_id.
import { at, ARXIV_DOI_RE, doiFromUrl, doiFromSsrn, arxivId } from './loadextract.mjs';

const cases=[
 ['AEA query-string DOI',  'https://www.aeaweb.org/articles?id=10.1257/aer.91.5.1369', 'doi','10.1257/aer.91.5.1369'],
 ['PLOS query-string DOI', 'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0310348','doi','10.1371/journal.pone.0310348'],
 ['Science path DOI',      'https://www.science.org/doi/10.1126/science.abq1841','doi','10.1126/science.abq1841'],
 ['bioRxiv path DOI',      'https://www.biorxiv.org/content/10.1101/2024.09.01.610707v1','doi','10.1101/2024.09.01.610707v1'],
 ['old arXiv (Perelman)',  'https://arxiv.org/abs/math/0211159',        'arxiv','math/0211159'],
 ['old arXiv (Maldacena)', 'https://arxiv.org/abs/hep-th/9711200',      'arxiv','hep-th/9711200'],
 ['old arXiv subclass+ver','https://arxiv.org/abs/cond-mat/0601234v2',  'arxiv','cond-mat/0601234'],
 ['new arXiv',             'https://arxiv.org/abs/2503.01800',          'arxiv','2503.01800'],
 ['new arXiv w/ version',  'https://arxiv.org/abs/1706.03762v5',        'arxiv','1706.03762'],
 ['Wiley SICI',            'https://onlinelibrary.wiley.com/doi/10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2',
                           'doi','10.1002/(SICI)1097-0258(19980815)17:15<1661::AID-SIM968>3.0.CO;2-2'],
 ['Lancet paren DOI',      'https://x.org/doi/10.1016/S0140-6736(20)30183-5','doi','10.1016/S0140-6736(20)30183-5'],
 ['Springer',              'https://link.springer.com/article/10.1007/s11263-015-0816-y','doi','10.1007/s11263-015-0816-y'],
 ['INFORMS + query',       'https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2022.4522?journalCode=mnsc','doi','10.1287/mnsc.2022.4522'],
 ['Wiley epdf',            'https://onlinelibrary.wiley.com/doi/epdf/10.1002/adma.202301234','doi','10.1002/adma.202301234'],
 ['ScienceDirect (PII)',   'https://www.sciencedirect.com/science/article/pii/S0096300316307640','none',''],
 ['SSRN abstract_id',      'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5238498','doi','10.2139/ssrn.5238498'],
];
let pass=0,fail=0;
for(const [name,url,kind,want] of cases){
  at(url);
  const arx = arxivId();
  const doi = arx ? '' : (doiFromUrl() || doiFromSsrn());
  const got = kind==='arxiv'?arx : kind==='doi'?doi : (arx||doi||'');
  const ok = got===want;
  ok?pass++:fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${name.padEnd(23)} ${got||'(nothing)'}`);
  if(!ok) console.log(`      ${' '.repeat(23)} want ${want||'(nothing)'}`);
}
// arXiv DOI <-> arXiv id is a pure string transform, always reliable
for(const [d,want] of [['10.48550/arXiv.2408.07818','2408.07818'],['10.48550/arxiv.math/0211159','math/0211159']]){
  const m=d.match(ARXIV_DOI_RE); const got=m?m[1]:'';
  const ok=got===want; ok?pass++:fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${'arXiv DOI -> id'.padEnd(23)} ${got}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

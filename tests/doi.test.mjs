// Exercises the URL-path identifier logic from extract.js against real URLs.
import { at, cleanDoi, doiFromUrl, arxivId, abstractFromPage } from './loadextract.mjs';

const cases = [
  ['https://arxiv.org/abs/2503.01800',                                      null, '2503.01800'],
  ['https://arxiv.org/abs/1706.03762v5',                                    null, '1706.03762'],
  ['https://arxiv.org/pdf/2306.00205',                                      null, '2306.00205'],
  ['https://arxiv.org/html/2503.01800',                                     null, '2503.01800'],
  ['https://arxiv.org/html/2503.01800v2',                                   null, '2503.01800'],
  ['https://link.springer.com/article/10.1007/s11263-015-0816-y',            '10.1007/s11263-015-0816-y', null],
  ['https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9868.2005.00503.x',   '10.1111/j.1467-9868.2005.00503.x', null],
  ['https://onlinelibrary.wiley.com/doi/full/10.1002/adma.201102306',        '10.1002/adma.201102306', null],
  ['https://onlinelibrary.wiley.com/doi/epdf/10.1002/adma.201102306',        '10.1002/adma.201102306', null],
  ['https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4522',              '10.1287/mnsc.2022.4522', null],
  ['https://pubsonline.informs.org/doi/abs/10.1287/mnsc.2022.4522?journalCode=mnsc', '10.1287/mnsc.2022.4522', null],
  ['https://www.sciencedirect.com/science/article/pii/S0096300316307640',    '', null],  // PII only -> meta path
];
let pass=0, fail=0;
for (const [url, wantDoi, wantArxiv] of cases){
  at(url);
  const arx = arxivId();
  const doi = arx ? '' : doiFromUrl();
  const okDoi   = wantDoi   === null || doi === wantDoi;
  const okArxiv = wantArxiv === null || arx === wantArxiv;
  const ok = okDoi && okArxiv;
  ok ? pass++ : fail++;
  console.log(`${ok?'ok  ':'FAIL'}  ${new URL(url).hostname.padEnd(26)} doi=${(doi||'-').padEnd(34)} arxiv=${arx||'-'}`);
}
// meta-tag path, using the real dump the user supplied from ScienceDirect
const sdMeta = 'dc.identifier = 10.1016/j.amc.2016.12.030';
const sdOk = cleanDoi(sdMeta.split(' = ')[1]) === '10.1016/j.amc.2016.12.030';
sdOk ? pass++ : fail++;
console.log(`${sdOk?'ok  ':'FAIL'}  ScienceDirect via meta`);
// citation_abstract is markup on structured-abstract publishers; the text
// feeds 直答 prompts, so the tags must not survive extraction.
const bmjAbstract = '<h3>Objective</h3>\n<p>This study evaluated self-reported hygienic food-handling '
  + 'practices and their associated factors among street food vendors (<i>machinga</i>) in Dodoma, Tanzania.</p>'
  + '<h3>Design</h3>\n<p>A community-based cross-sectional analytical study.</p>';
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: (sel) => (/citation_abstract/.test(sel) ? [{ content: bmjAbstract }] : [])
};
at('https://bmjopen.bmj.com/content/16/10/e116242');
const abs = abstractFromPage().text;
const absOk = !/[<>]/.test(abs) && abs.includes('Objective') && abs.includes('machinga');
absOk ? pass++ : fail++;
console.log(`${absOk?'ok  ':'FAIL'}  structured abstract stripped of markup  ${abs.slice(0,60)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

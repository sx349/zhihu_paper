// A supported site needs two things that live in different files: a match
// pattern in manifest.json, or the content script never runs, and an entry in
// SOURCE_NAMES, or the panel labels it with a bare hostname. Adding one and
// forgetting the other is silent, so every site is checked for both here
// against a real article URL.
import { readFileSync } from 'fs';
import { at, sourceName } from './loadextract.mjs';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const patterns = manifest.content_scripts.flatMap((c) => c.matches);
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

// Chrome match-pattern semantics, enough for the patterns we ship:
// '*.host' covers the bare host too, and '*' in a path is a glob.
const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
function covers(pattern, url) {
  const m = pattern.match(/^(\*|https?):\/\/([^/]*)(\/.*)$/);
  if (!m) return false;
  const [, scheme, host, path] = m;
  const u = new URL(url);
  if (scheme !== '*' && u.protocol !== scheme + ':') return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
    } else if (u.hostname !== host) return false;
  }
  return new RegExp('^' + path.split('*').map(esc).join('.*') + '$').test(u.pathname + u.search);
}

// Real article URLs. The last four were verified against the live pages.
const sites = [
  ['https://arxiv.org/abs/2503.01800', 'arXiv'],
  ['https://arxiv.org/pdf/2503.01800', 'arXiv'],
  ['https://www.sciencedirect.com/science/article/pii/S0096300316307640', 'ScienceDirect'],
  ['https://link.springer.com/article/10.1007/s11263-015-0816-y', 'Springer'],
  ['https://onlinelibrary.wiley.com/doi/10.1002/adma.202301234', 'Wiley'],
  ['https://pubsonline.informs.org/doi/10.1287/mnsc.2022.4522', 'INFORMS'],
  ['https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3457189', 'SSRN'],
  ['https://www.nber.org/papers/w31122', 'NBER'],
  ['https://www.jstor.org/stable/1831029', 'JSTOR'],
  ['https://www.aeaweb.org/articles?id=10.1257/aer.20201397', 'AEA'],
  ['https://www.journals.uchicago.edu/doi/10.1086/712506', 'UChicago Press'],
  ['https://www.cell.com/cell/fulltext/S0092-8674(23)00001-2', 'Cell'],
  ['https://academic.oup.com/ismej/article/18/1/wrad001/7503955', 'Oxford Academic'],
  ['https://ieeexplore.ieee.org/document/7780459/', 'IEEE Xplore'],
  ['https://www.science.org/doi/10.1126/science.adk1234', 'Science'],
  ['https://www.pnas.org/doi/10.1073/pnas.2301234120', 'PNAS'],
  ['https://dl.acm.org/doi/10.1145/3292500.3330701', 'ACM'],
  ['https://journals.sagepub.com/doi/10.1177/01461672231123456', 'SAGE'],
  ['https://www.tandfonline.com/doi/full/10.1080/01621459.2023.1234567', 'Taylor & Francis'],
  ['https://pubmed.ncbi.nlm.nih.gov/33782057/', 'PubMed'],
  ['https://www.nature.com/articles/s41396-023-01545-3', 'Nature'],
  ['https://www.biorxiv.org/content/10.1101/2023.01.01.522000v1', 'bioRxiv'],
  ['https://www.medrxiv.org/content/10.1101/2023.01.01.23284000v1', 'medRxiv'],
  ['https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0289123', 'PLOS'],
  ['https://www.bmj.com/content/372/bmj.n71', 'BMJ'],
  ['https://bmjopen.bmj.com/content/16/10/e116242', 'BMJ'],
  ['https://elifesciences.org/articles/00065', 'eLife'],
  ['https://elifesciences.org/reviewed-preprints/108404', 'eLife'],
  ['https://gut.bmj.com/content/early/2026/10/16/gutjnl-2026-339334', 'BMJ'],
  ['https://www.jneurosci.org/content/26/1/63', 'Journal of Neuroscience']
];

for (const [url, label] of sites) {
  const host = new URL(url).hostname;
  const matched = patterns.some((p) => covers(p, url));
  at(url);
  const got = sourceName();
  const ok = matched && got === label;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${host.padEnd(28)} script=${matched ? 'yes' : 'NO '} label=${got}`);
}

// A journal's front page is not an article; injecting there would be noise.
for (const url of ['https://journals.bmj.com/', 'https://elifesciences.org/', 'https://www.jneurosci.org/',
                   'https://arxiv.org/list/math.AP/recent']) {
  ck(`not injected on ${new URL(url).hostname}${new URL(url).pathname}`, !patterns.some((p) => covers(p, url)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

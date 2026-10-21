// A supported site needs two things that live in different files: a match
// pattern in manifest.json, or the content script never runs, and an entry in
// SOURCE_NAMES, or the panel labels it with a bare hostname. Adding one and
// forgetting the other is silent, so every site is checked for both here
// against a real article URL.
import { readFileSync } from 'fs';
import { at, sourceName } from './loadextract.mjs';
// The same matcher the panel uses to tell whether the page in front of the
// reader is one of the sites the browser has not granted.
import { covers } from '../src/lib/matchpattern.js';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const patterns = manifest.content_scripts.flatMap((c) => c.matches);
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

// Real article URLs. The last four were verified against the live pages.
const sites = [
  ['https://arxiv.org/abs/2503.01800', 'arXiv'],
  ['https://arxiv.org/pdf/2503.01800', 'arXiv'],
  ['https://arxiv.org/html/2503.01800', 'arXiv'],
  ['https://www.sciencedirect.com/science/article/pii/S0096300316307640', 'ScienceDirect'],
  ['https://link.springer.com/article/10.1007/s11263-015-0816-y', 'Springer'],
  ['https://onlinelibrary.wiley.com/doi/10.1002/adma.201102306', 'Wiley'],
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
  ['https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(20)30183-5/fulltext', 'The Lancet'],
  ['https://www.alphaxiv.org/abs/2503.01800', 'alphaXiv'],
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

// --- one manifest, two browsers -------------------------------------------
// Chrome runs the background as a service worker and the panel through
// side_panel; Firefox has neither, and runs the same files as an event page
// and a sidebar. Dropping either half silently halves the supported browsers.
const bg = manifest.background;
ck('background declared for Chrome', bg.service_worker === 'src/background/service_worker.js');
ck('  and for Firefox, from the same file', JSON.stringify(bg.scripts) === JSON.stringify([bg.service_worker]));
ck('  as a module either way', bg.type === 'module');

ck('panel declared for Chrome', manifest.side_panel?.default_path === 'src/panel/panel.html');
ck('  and for Firefox, the same document', manifest.sidebar_action?.default_panel === manifest.side_panel.default_path);

const gecko = manifest.browser_specific_settings?.gecko;
ck('Firefox add-on id is set', !!gecko?.id, gecko?.id);
ck('  updates come from a host we control', gecko?.update_url?.startsWith('https://sx349.github.io/'), gecko?.update_url);
ck('  and 121 is the floor, where both background keys stopped conflicting',
   gecko?.strict_min_version === '121.0');

// --- host permissions ------------------------------------------------------
// A content script's matches cover the page it runs on, so host_permissions
// are for the worker's own fetches and nothing else. Four publishers were
// declared here and never contacted -- dead grants, and exactly what both
// stores ask you to justify.
import { readdirSync } from 'fs';
const workerSrc = ['src/lib', 'src/background']
  .flatMap((d) => readdirSync(new URL('../' + d, import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(new URL(`../${d}/${f}`, import.meta.url), 'utf8')))
  .join('\n');
for (const h of manifest.host_permissions) {
  const host = h.replace(/^https?:\/\//, '').replace(/^\*\./, '').replace(/\/\*$/, '');
  ck(`host permission ${host} is one the worker actually fetches`, workerSrc.includes(host));
}

// --- the update manifest Firefox polls ------------------------------------
// It is generated from manifest.json, but a stale checked-in copy would be
// invisible: the poll finds a version it already has and nobody updates, with
// no error anywhere. So the two are compared.
const updates = JSON.parse(readFileSync(new URL('../docs/updates.json', import.meta.url), 'utf8'));
const geckoId = manifest.browser_specific_settings.gecko.id;
const entry = updates.addons?.[geckoId]?.updates?.[0];
ck('updates.json is keyed by the add-on id', !!entry, Object.keys(updates.addons || {}).join(','));
ck('  and offers the version in the manifest', entry?.version === manifest.version,
   entry?.version + ' vs ' + manifest.version);
ck('  linking to that version\'s asset', entry?.update_link?.includes('/v' + manifest.version + '/')
   && entry?.update_link?.endsWith(manifest.version + '.xpi'), entry?.update_link);
ck('  over https, which update_link requires', entry?.update_link?.startsWith('https://'));

// --- icons ----------------------------------------------------------------
// Both stores require them, and a missing file is a load error rather than a
// blank square, so the paths are checked against the tree.
import { existsSync } from 'fs';
const iconPath = (rel) => new URL('../' + rel, import.meta.url).pathname;
const wanted = ['16', '32', '48', '96', '128'];
ck('every icon size is declared', wanted.every((w) => manifest.icons?.[w]), JSON.stringify(Object.keys(manifest.icons || {})));
ck('  and every declared file exists', Object.values(manifest.icons || {}).every((f) => existsSync(iconPath(f))));
ck('the toolbar button has an icon', !!manifest.action?.default_icon);
ck('  whose files exist too', Object.values(manifest.action?.default_icon || {}).every((f) => existsSync(iconPath(f))));
ck('  and whose title survived', manifest.action?.default_title === manifest.name);

// A journal's front page is not an article; injecting there would be noise.
for (const url of ['https://journals.bmj.com/', 'https://elifesciences.org/', 'https://www.jneurosci.org/',
                   'https://www.thelancet.com/', 'https://www.alphaxiv.org/',
                   'https://arxiv.org/list/math.AP/recent']) {
  ck(`not injected on ${new URL(url).hostname}${new URL(url).pathname}`, !patterns.some((p) => covers(p, url)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

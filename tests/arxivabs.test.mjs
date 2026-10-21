// Reading an arXiv paper from its abs page, with no content script involved.
// The markup below is verbatim from arxiv.org/abs/2503.01800 -- note the
// &#39; in the title and the "Family, Given" author order, both of which
// would otherwise reach the search query and the panel as written.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const { paperFromAbsHtml, paperFromPdfUrl, ARXIV_PDF_URL } =
  await import(P + '/src/lib/arxivabs.js');

const ABS = `<!doctype html><html><head>
<meta name="citation_title" content="Hilbert&#39;s sixth problem: derivation of fluid equations via Boltzmann&#39;s kinetic theory" />
<meta name="citation_author" content="Deng, Yu" />
<meta name="citation_author" content="Hani, Zaher" />
<meta name="citation_author" content="Ma, Xiao" />
<meta name="citation_date" content="2025/03/03" />
<meta name="citation_online_date" content="2025/03/03" />
<meta name="citation_pdf_url" content="https://arxiv.org/pdf/2503.01800" />
<meta name="citation_arxiv_id" content="2503.01800" />
<meta name="citation_abstract" content="In this paper, we rigorously derive the fundamental PDEs of fluid mechanics,
starting from hard sphere particle systems. This resolves Hilbert&#39;s sixth problem." />
<meta property="og:title" content="something else entirely" />
</head><body></body></html>`;

const p = paperFromAbsHtml(ABS, '2503.01800');
ck('reads the paper', !!p);
ck('  id matches what the content-script path produces', p.id === 'arxiv:2503.01800');
ck('  and so does the alt id', JSON.stringify(p.altIds) === JSON.stringify(['doi:10.48550/arXiv.2503.01800']));
ck('  entities decoded, not left as &#39;', p.title === "Hilbert's sixth problem: derivation of fluid equations via Boltzmann's kinetic theory", p.title);
ck('  authors flipped to given-family', p.authors.join(' · ') === 'Yu Deng · Zaher Hani · Xiao Ma', p.authors.join(' · '));
ck('  year from the date', p.year === '2025');
ck('  abstract joined into one line', p.abstract.startsWith('In this paper') && !p.abstract.includes('\n'));
ck('  abstract entities decoded too', p.abstract.endsWith("Hilbert's sixth problem."), p.abstract.slice(-40));
ck('  url points at abs, not the pdf the reader is on', p.url === 'https://arxiv.org/abs/2503.01800');
ck('  no doi, so it keys as an arXiv paper', p.doi === '' && p.arxivId === '2503.01800');
ck('  og:title is not mistaken for the title', !p.title.includes('something else'));

ck('markup with no citation_title is unusable', paperFromAbsHtml('<html><head></head></html>', 'x') === null);

// --- which URLs this path claims ------------------------------------------
const claims = (u) => ARXIV_PDF_URL.test(u);
ck('claims a bare pdf url', claims('https://arxiv.org/pdf/2503.01800'));
ck('  and a versioned one', claims('https://arxiv.org/pdf/2503.01800v2'));
ck('  and an old-style id', claims('https://arxiv.org/pdf/math.AP/0211159'));
ck('leaves abs alone, the content script has it', !claims('https://arxiv.org/abs/2503.01800'));
ck('  and html', !claims('https://arxiv.org/html/2503.01800'));
ck('  and alphaXiv, which is a different site with its own metas', !claims('https://www.alphaxiv.org/abs/2503.01800'));
ck('  and the listing pages', !claims('https://arxiv.org/list/math.AP/recent'));

// --- fetching -------------------------------------------------------------
globalThis.fetch = async () => ({ ok: true, text: async () => ABS });
const viaUrl = await paperFromPdfUrl('https://arxiv.org/pdf/2503.01800v3');
ck('a versioned pdf url resolves to the unversioned paper', viaUrl && viaUrl.id === 'arxiv:2503.01800');

globalThis.fetch = async () => { throw new Error('should not be called'); };
ck('a non-arXiv url is rejected without fetching', (await paperFromPdfUrl('https://example.com/x.pdf')) === null);

globalThis.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
ck('a failed abs fetch yields nothing, not a broken paper',
   (await paperFromPdfUrl('https://arxiv.org/pdf/2503.01800')) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

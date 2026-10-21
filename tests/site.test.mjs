// The site states what the extension supports. Two hand-written lists said
// that before -- the panel's placeholder and the README -- and both rotted,
// six names and twenty-three against twenty-eight. So the page is generated,
// and these assertions are what keep the generation honest.
import { readFileSync } from 'fs';
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const { manifest, sourceNames, supportedSites, changelog } = await import(P + '/scripts/sitedata.mjs');

// --- SOURCE_NAMES is parsed out of extract.js, which cannot be imported ----
const names = sourceNames();
ck('SOURCE_NAMES parses out of extract.js', names.length > 20, names.length + ' entries');
ck('  as [key, label] pairs', names.every(([k, l]) => k && l));

// --- every matched site gets a label --------------------------------------
const sites = supportedSites();
ck('every supported site is named', sites.every((s) => s.name !== s.host),
   sites.filter((s) => s.name === s.host).map((s) => s.host).join(', ') || 'all named');
ck('  one entry per site, not per pattern', sites.length === new Set(sites.map((s) => s.name)).size);
ck('  arXiv appears once despite three patterns', sites.filter((s) => s.name === 'arXiv').length === 1);
ck('  zhihu.com is not listed as a paper site',
   !sites.some((s) => s.host.includes('zhihu.com')), sites.map((s) => s.host).join(' '));

// --- the changelog survives the trip --------------------------------------
const rel = changelog();
ck('every release is read', rel.length >= 4, rel.map((r) => r.title.split(' ')[0]).join(', '));
ck('  newest first', rel[0].title.startsWith(manifest.version) || rel[0].title > rel[1].title, rel[0].title);
const nested = rel.flatMap((r) => r.groups).flatMap((g) => g.items).filter((i) => i.children.length);
ck('  nested bullets are kept, not flattened', nested.length > 0, nested.length + ' with children');
ck('  groups keep their headings', rel[0].groups.every((g) => g.heading));

// --- and the page actually says so ----------------------------------------
const html = readFileSync(P + '/docs/index.html', 'utf8');
ck('the built page carries the manifest version', html.includes('v' + manifest.version));
// Taylor & Francis is written Taylor &amp; Francis, as it should be.
const escd = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
ck('  lists every site', sites.every((s) => html.includes(escd(s.name))),
   sites.filter((s) => !html.includes(escd(s.name))).map((s) => s.name).join(', ') || 'all present');
ck('  escaping its names rather than injecting them', html.includes('Taylor &amp; Francis'));
ck('  says how many', html.includes(`目前支持 ${sites.length} 个站点`));
ck('  and has the three tabs', ['安装说明', '支持站点', '更新记录'].every((t) => html.includes(t)));
ck('  defaulting to 安装说明', /id="t-install" aria-selected="true"/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

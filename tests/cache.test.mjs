// Trimming, expiry and eviction for the per-paper resolution cache.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let store = {};
globalThis.chrome = { storage: { local: {
  get: async (k) => (k === null ? { ...store }
                   : Array.isArray(k) ? Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]))
                   : (k in store ? { [k]: store[k] } : {})),
  set: async (o) => Object.assign(store, o),
  remove: async (k) => (Array.isArray(k) ? k : [k]).forEach((x) => delete store[x])
} } };
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const { readCache, writeCache, clearCache, readZhida, writeZhida } = await import(P + '/src/lib/cache.js');

const answer = (who) => ({ author: who, urlToken: who + '-token', votes: 5939,
                           url: 'https://www.zhihu.com/question/1/answer/2' });
const resolution = {
  linked: [{
    kind: 'question', qid: '14073117334', title: '希尔伯特第六问题…', src: 'card',
    url: 'https://www.zhihu.com/question/14073117334', score: 95, votes: 5939,
    answers: Array.from({ length: 20 }, (_, i) => answer('ans' + i)),
    authorInvolved: true, authorAnswer: answer('Yu Deng'), top: answer('Yu Deng')
  }],
  authors: [{ url_token: 'paellahorizon', nickname: 'Yu Deng' }],
  search: { layer: 'fuzzy', items: [{ kind: 'answer', title: 'T', url: 'U', excerpt: 'x'.repeat(160),
                                      author: 'A', authorToken: 'tok', votes: 7, questionId: '9', score: 0.4 }] },
  via: 'paper_url', ranked: true
};

// --- round trip -----------------------------------------------------------
await writeCache('arxiv:2503.01800', resolution);
let got = await readCache('arxiv:2503.01800');
ck('reads back', !!got);
ck('  keeps the question', got.linked.length === 1 && got.linked[0].title === '希尔伯特第六问题…');
ck('  keeps the author marking', got.linked[0].authorInvolved === true && got.linked[0].authorAnswer.author === 'Yu Deng');
ck('  keeps the top answer', got.linked[0].top.votes === 5939);
ck('  keeps the search items', got.search.items.length === 1 && got.search.items[0].title === 'T');
ck('  keeps the authors', got.authors[0].nickname === 'Yu Deng');

// --- what it drops --------------------------------------------------------
const raw = store['cache:arxiv:2503.01800'];
ck('drops the 20 raw answers', raw.resolution.linked[0].answers === undefined);
ck('drops the derivable question url', raw.resolution.linked[0].url === undefined);
ck('drops the constant kind', raw.resolution.linked[0].kind === undefined);
ck('drops the unread search excerpt', raw.resolution.search.items[0].excerpt === undefined);
ck('drops the unread authorToken', raw.resolution.search.items[0].authorToken === undefined);
ck('rebuilds the question url on read', got.linked[0].url === 'https://www.zhihu.com/question/14073117334');
ck('rebuilds kind on read', got.linked[0].kind === 'question');

const trimmedBytes = JSON.stringify(raw.resolution).length;
const rawBytes = JSON.stringify(resolution).length;
ck('a quarter of the size or less', trimmedBytes * 4 < rawBytes, trimmedBytes + ' vs ' + rawBytes + ' bytes');

// --- expiry ---------------------------------------------------------------
store['cache:old'] = { ts: Date.now() - 25 * 60 * 60 * 1000, resolution: { linked: [], search: { items: [] } } };
ck('expired entry reads as a miss', (await readCache('old')) === null);
ck('  and is removed on the way out', store['cache:old'] === undefined);

store['cache:fresh'] = { ts: Date.now() - 23 * 60 * 60 * 1000, resolution: { linked: [], search: { items: [] } } };
ck('23h old is still a hit', (await readCache('fresh')) !== null);

// --- eviction -------------------------------------------------------------
store = {};
const now = Date.now();
for (let i = 0; i < 260; i++) store['cache:p' + i] = { ts: now - i * 1000, resolution: { linked: [], search: { items: [] } } };
await writeCache('newest', resolution);
const kept = Object.keys(store).filter((k) => k.startsWith('cache:'));
ck('capped at 200', kept.length === 200, String(kept.length));
ck('  the newest survives', !!store['cache:newest']);
ck('  the oldest is evicted', store['cache:p259'] === undefined);
ck('  a recent one survives', !!store['cache:p0']);

// expired entries go even when the cap is not reached
store = { 'cache:stale': { ts: now - 48 * 60 * 60 * 1000, resolution: { linked: [], search: { items: [] } } } };
await writeCache('x', resolution);
ck('expired entries pruned on write', store['cache:stale'] === undefined);

// --- clear ----------------------------------------------------------------
await clearCache('x');
ck('clearCache removes just that paper', store['cache:x'] === undefined);

// --- the 论文解读 store ----------------------------------------------------
// Its own prefix, week-long expiry and tighter cap: a 解读 does not go stale
// the way a pool does, so it is evicted for space rather than for freshness.
store = {};
await writeZhida('arxiv:2503.01800', '## 一、论文做了什么\n\n这是…');
ck('zhida reads back', (await readZhida('arxiv:2503.01800')).startsWith('## 一、'));
ck('  under its own prefix', !!store['zhida:arxiv:2503.01800'] && !store['cache:arxiv:2503.01800']);
ck('  a paper with none reads as empty, not null', (await readZhida('nope')) === '');

// the two stores must not evict each other
store = {};
await writeCache('p', resolution);
await writeZhida('p', 'text');
ck('resolution and 解读 coexist for one paper', !!store['cache:p'] && !!store['zhida:p']);
await clearCache('p');
ck('clearing the resolution leaves the 解读', !store['cache:p'] && !!store['zhida:p']);

store['zhida:old'] = { ts: Date.now() - 8 * 24 * 60 * 60 * 1000, text: 'x' };
ck('8 days old is a miss', (await readZhida('old')) === '');
store['zhida:recent'] = { ts: Date.now() - 6 * 24 * 60 * 60 * 1000, text: 'x' };
ck('  6 days old is still a hit', (await readZhida('recent')) === 'x');

store = {};
const t = Date.now();
for (let i = 0; i < 60; i++) store['zhida:z' + i] = { ts: t - i * 1000, text: 'x' };
for (let i = 0; i < 300; i++) store['cache:c' + i] = { ts: t - i * 1000, resolution: { linked: [], search: { items: [] } } };
await writeZhida('newest', 'x');
ck('zhida capped at 50', Object.keys(store).filter((k) => k.startsWith('zhida:')).length === 50,
   String(Object.keys(store).filter((k) => k.startsWith('zhida:')).length));
ck('  and the resolution cache is untouched by it',
   Object.keys(store).filter((k) => k.startsWith('cache:')).length === 300);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

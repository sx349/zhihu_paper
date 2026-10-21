// Permutation validation and the three-round aggregate.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const store = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } };
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const { parseOrder, borda, rankByZhida, reorderByQid, fallbackOrder } = await import(P + '/src/lib/rank.js');

// --- parseOrder ----------------------------------------------------------
ck('clean permutation', JSON.stringify(parseOrder('3,1,2', 3)) === JSON.stringify([3, 1, 2]));
ck('whitespace tolerated', JSON.stringify(parseOrder(' 2 , 1 ', 2)) === JSON.stringify([2, 1]));
// Observed live: a round occasionally repeats an index. Dedupe repairs it.
ck('duplicated index repaired', JSON.stringify(parseOrder('5,1,2,3,9,4,14,8,11,12,6,14,10,7,13', 14))
   === JSON.stringify([5, 1, 2, 3, 9, 4, 14, 8, 11, 12, 6, 10, 7, 13]));
ck('short answer rejected', parseOrder('1,2', 3) === null);
ck('out of range rejected', parseOrder('1,2,9', 3) === null);
ck('prose rejected', parseOrder('我认为第一个最相关', 3) === null);
ck('empty rejected', parseOrder('', 3) === null);

// --- borda ---------------------------------------------------------------
ck('unanimous order is kept', JSON.stringify(borda([[2, 1, 3], [2, 1, 3]], 3)) === JSON.stringify([2, 1, 3]));
// 1 scores 0+1=1, 2 scores 1+0=1, 3 scores 2+2=4 -> 1 and 2 tie ahead of 3.
ck('positions summed across rounds', JSON.stringify(borda([[1, 2, 3], [2, 1, 3]], 3).slice(-1)) === JSON.stringify([3]));
// The real shape: three rounds that agree on the head and differ in the tail.
const live = [[5, 7, 2, 9, 10, 11, 12, 6, 3, 4, 1, 8],
              [5, 2, 7, 9, 10, 11, 12, 3, 4, 6, 1, 8],
              [5, 7, 2, 9, 10, 11, 12, 1, 6, 3, 4, 8]];
const agg = borda(live, 12);
ck('live rounds: head is stable', JSON.stringify(agg.slice(0, 5)) === JSON.stringify([5, 7, 2, 9, 10]), String(agg.slice(0, 5)));
ck('live rounds: the finance question stays last', agg[11] === 8, String(agg[11]));

// --- rankByZhida ---------------------------------------------------------
const pool = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
// zhidaWeb reads an SSE stream; fake one carrying the ordering.
const sse = (text) => {
  const body = `data: ${JSON.stringify({ event: 'Answer', data: { summary: text } })}\n\n`;
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }) }) } };
};

let replies = ['2,1,3', '2,1,3', '1,2,3'];
let call = 0;
globalThis.fetch = async () => sse(replies[call++ % replies.length]);
let out = await rankByZhida({ title: 'p', abstract: '' }, pool);
ck('three rounds aggregate', out !== null && out.length === 3);
ck('  majority order wins', out && out[0].title === 'b', out ? out.map((x) => x.title).join(',') : 'null');

// Two bad rounds, one good -> below the floor, caller keeps its own order.
call = 0; replies = ['nonsense', 'also nonsense', '1,2,3'];
out = await rankByZhida({ title: 'p', abstract: '' }, pool);
ck('one valid round is not enough', out === null);

// Everything fails -> null, never a throw.
globalThis.fetch = async () => { throw new Error('offline'); };
out = await rankByZhida({ title: 'p', abstract: '' }, pool).catch(() => 'threw');
ck('network failure yields null, not a throw', out === null, String(out));

ck('a single item is not worth ranking', (await rankByZhida({ title: 'p' }, [{ title: 'only' }])) === null);

// --- the pool is cut after ranking, not before --------------------------
// Mirrors the worker: rank the whole pool, keep ten, show five.
const big = Array.from({ length: 22 }, (_, i) => ({ title: 'q' + (i + 1) }));
call = 0; replies = [[...Array(22).keys()].map((i) => 22 - i).join(',')];   // exact reverse
globalThis.fetch = async () => sse(replies[0]);
const ranked = await rankByZhida({ title: 'p', abstract: '' }, big);
ck('every pooled item is ranked', ranked !== null && ranked.length === 22);
ck('  the last pooled item ranks first', ranked && ranked[0].title === 'q22');
ck('  keeping ten leaves the ranker\'s top ten', ranked && ranked.slice(0, 10).map((x) => x.title).join(',')
   === 'q22,q21,q20,q19,q18,q17,q16,q15,q14,q13');

// --- reapplying a rank order onto the hydrated pool ---------------------
// 直答 ranks before hydration, so its items are the thin ones; the order has
// to land on the fat ones without losing what hydration added.
const thin = [{ qid: 'a', title: 'A' }, { qid: 'b', title: 'B' }, { qid: 'c', title: 'C' }];
const fat = thin.map((q) => ({ ...q, answers: [{ votes: 1 }], top: { votes: 1 }, authorInvolved: false }));
const applied = reorderByQid([thin[2], thin[0], thin[1]], fat);
ck('order applied by qid', applied.map((q) => q.qid).join(',') === 'c,a,b', applied.map((q) => q.qid).join(','));
ck('  returns the hydrated objects, not the ranked ones', applied.every((q) => q.top !== undefined));
ck('  and the same objects, not copies', applied[0] === fat[2]);

const short = reorderByQid([thin[1]], fat);
ck('an order naming fewer keeps the rest at the tail', short.map((q) => q.qid).join(',') === 'b,a,c', short.map((q) => q.qid).join(','));
ck('  and loses nothing', short.length === 3);
ck('an empty order drops nothing', reorderByQid([], fat).length === 3);

const unknown = reorderByQid([{ qid: 'zzz' }, thin[1]], fat);
ck('a qid that is not in the pool is skipped', unknown.map((q) => q.qid).join(',') === 'b,a,c', unknown.map((q) => q.qid).join(','));

// --- the order shown when 直答 cannot rank --------------------------------
// Votes used to be the tiebreak, which put the most popular noise on top.
const q = (id, src, authorInvolved, votes) => ({ qid:id, src, authorInvolved, top:{ votes } });
const fbPool = [
  q('a', 'card',   false, 10),
  q('b', 'search', false, 34168),      // popular and unrelated
  q('c', 'search', true,  5),          // the author answered this one
  q('d', 'card',   false, 3),
  q('e', 'search', false, 17026)
];
const got = fallbackOrder(fbPool).map((x) => x.qid).join(',');
ck('author-involved first, then card, then search', got === 'c,a,d,b,e', got);
ck('  the 34k-vote unrelated question is not promoted', got.indexOf('b') > got.indexOf('a'));
ck('  ties keep the order they arrived in', got.indexOf('a') < got.indexOf('d') && got.indexOf('b') < got.indexOf('e'));
ck('  nothing is dropped', fallbackOrder(fbPool).length === 5);
ck('  the input is left alone', fbPool[0].qid === 'a' && fbPool[1].qid === 'b');

const authorOnCard = fallbackOrder([q('x','search',true,1), q('y','card',true,1), q('z','card',false,1)]).map((x)=>x.qid).join(',');
ck('an author-involved search row still outranks a plain card row', authorOnCard === 'y,x,z', authorOnCard);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

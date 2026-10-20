// Permutation validation and the three-round aggregate.
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const store = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) } } };
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const { parseOrder, borda, rankByZhida } = await import(P + '/src/lib/rank.js');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

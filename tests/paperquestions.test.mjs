// Parameter choice and the title fallback for api.zhihu.com/paper/questions,
// against shapes captured from the live endpoint (2026-10).
const P = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
let pass = 0, fail = 0;
const ck = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${e ? '  ' + e : ''}`); };

const HIT = {
  paper_ids: ['2090359888236868075'],
  data: [{ url_token: '2064355224899395856', title: '邓煜团队证明微观粒子可以推导出N‑S方程…',
           url: 'https://www.zhihu.com/question/2064355224899395856', relevance_score: 100 }],
  paging: { is_end: true, next_cursor: '' }
};
const MISS = { paper_ids: [], data: [], paging: { is_end: true, next_cursor: '' } };

// Records every URL asked for, and answers from a table keyed by query string.
let asked = [];
const serve = (table) => {
  asked = [];
  globalThis.fetch = async (u) => {
    const url = new URL(u);
    asked.push(url);
    const key = [...url.searchParams.entries()].filter(([k]) => k !== 'limit').map(([k, v]) => k + '=' + v).join('&');
    const body = table[key] ?? MISS;
    if (body.__status) return { ok: false, status: body.__status, json: async () => body };
    return { ok: true, status: 200, json: async () => body };
  };
};

const { lookupParam, paperQuestions } = await import(P + '/src/lib/paperquestions.js');

// --- which parameter goes out -------------------------------------------
ck('real DOI wins', JSON.stringify(lookupParam({ doi: '10.1038/s41586-021-03819-2', arxivId: '2503.01800', title: 'T' }))
   === JSON.stringify({ doi: '10.1038/s41586-021-03819-2' }));

// 10.48550/arXiv.* is not indexed; only the abs URL is.
ck('synthesized arXiv DOI is skipped', JSON.stringify(lookupParam({ doi: '10.48550/arXiv.2503.01800', arxivId: '2503.01800' }))
   === JSON.stringify({ paper_url: 'https://arxiv.org/abs/2503.01800' }));

ck('arXiv url is rebuilt, never the page url',
   lookupParam({ arxivId: '2610.22192' }).paper_url === 'https://arxiv.org/abs/2610.22192');

ck('title is the last resort', lookupParam({ title: 'Attention Is All You Need' }).title === 'Attention Is All You Need');
ck('nothing to look up -> null', lookupParam({}) === null);

// Matching tolerates case and outer space but nothing else, so normalise.
ck('title: inner whitespace collapsed', lookupParam({ title: 'Deep  Residual   Learning' }).title === 'Deep Residual Learning');
ck('title: trailing period dropped', lookupParam({ title: 'Deep Residual Learning.' }).title === 'Deep Residual Learning');
ck('title: outer space trimmed', lookupParam({ title: '  Deep Residual Learning  ' }).title === 'Deep Residual Learning');

// --- one parameter at a time --------------------------------------------
serve({ 'paper_url=https://arxiv.org/abs/2503.01800': HIT });
let r = await paperQuestions({ arxivId: '2503.01800', title: "Hilbert's sixth problem" });
ck('arXiv hit by url', r.questions.length === 1 && r.via === 'paper_url');
ck('  only one condition sent', asked.length === 1 && [...asked[0].searchParams.keys()].filter((k) => k !== 'limit').length === 1,
   String([...asked[0].searchParams.keys()]));
ck('  row carries src=card', r.questions[0].src === 'card');
ck('  score preserved', r.questions[0].score === 100);

// --- the title fallback: the only key a preprint and its journal version share
serve({ 'title=Deep Residual Learning for Image Recognition': HIT });   // DOI deliberately absent
r = await paperQuestions({ doi: '10.1109/CVPR.2016.90', title: 'Deep Residual Learning for Image Recognition' });
ck('published DOI misses -> retried by title', r.questions.length === 1 && r.via === 'title-fallback');
ck('  two queries, doi then title', asked.length === 2 && asked[0].searchParams.get('doi') === '10.1109/CVPR.2016.90'
   && asked[1].searchParams.get('title') === 'Deep Residual Learning for Image Recognition');

// A title-keyed lookup must not re-ask the same question.
serve({});
r = await paperQuestions({ title: 'Nothing Indexed Here' });
ck('title miss is not retried', asked.length === 1 && r.questions.length === 0);

// --- errors --------------------------------------------------------------
serve({ 'doi=10.0/x': { __status: 409, error: { name: 'CONFLICT', code: 409, message: 'ambiguous paper' } } });
let err = null;
try { await paperQuestions({ doi: '10.0/x' }); } catch (e) { err = e; }
ck('409 surfaces as an error with status', err && err.status === 409 && err.name === 'CONFLICT', err ? err.name : 'none');

serve({ 'doi=10.0/y': { __status: 400, error: { name: 'INVALID_ARGUMENT', code: 400, message: '参数不正确' } } });
err = null;
try { await paperQuestions({ doi: '10.0/y' }); } catch (e) { err = e; }
ck('400 surfaces as an error', err && err.status === 400);

// --- no credential is ever attached --------------------------------------
serve({ 'doi=10.1/z': HIT });
let sawHeaders = false;
const plain = globalThis.fetch;
globalThis.fetch = async (u, opts) => { if (opts && opts.headers) sawHeaders = true; return plain(u); };
await paperQuestions({ doi: '10.1/z' });
ck('no Authorization header sent', !sawHeaders);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

import { getPaper, authorsByOrcid, mergeAuthors } from '../lib/papergraph.js';
import { searchZhihu, searchWeb, questionsFromRows, questionAnswers, zhida, zhidaWeb, zhidaPrompt, getSecret, draftQuestionCandidates, questionBody } from '../lib/zhihu.js';
import { paperQuestions } from '../lib/paperquestions.js';
import { rankByZhida, reorderByQid } from '../lib/rank.js';
import { readCache, writeCache, clearCache } from '../lib/cache.js';
import { enrich } from '../lib/crossref.js';

// Per-tab state lives in session storage, NOT a Map: MV3 kills the worker
// after ~30s idle and takes any in-memory state with it. A tab that pushed
// its paper minutes ago must still resolve after a tab switch.
const stateKey = (tabId) => 'tab:' + tabId;
const getState = async (tabId) => (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] || null;
const setState = (tabId, s) => chrome.storage.session.set({ [stateKey(tabId)]: s });

// Temporary instrumentation. Every leg of a resolution is timed so the
// parallelisation work has measured numbers rather than estimates. Takes a
// thunk, not a promise, so the clock starts at the call and not at creation.
async function leg(name, run) {
  const t0 = performance.now();
  try {
    return await run();
  } finally {
    console.log('[\u77e5\u4e4e\u8bba\u6587\u52a9\u624b] \u23f1 ' + name.padEnd(16) + Math.round(performance.now() - t0) + 'ms');
  }
}

const zhidaPending = new Set();   // paper ids with a generation in flight

// 直答 output is keyed by paper, not tab, and kept in session storage so it
// survives tab switches and worker restarts but not a browser close.
const zhidaKey = (paperId) => 'zhida:' + paperId;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // First install only — on 'update' this would fire at every reload during
  // development, and on 'chrome_update' for no reason at all.
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(stateKey(tabId)));

// One search feeds both panels. Zhihu's web API with the user's cookies
// first (no secret needed, richer rows); the open platform only if that
// fails and a secret exists -- its rows carry no question to collapse, so
// 相关问题 then rests on the paper index alone, exactly as it did before.
// The web API returns no relevance score, so rows keep Zhihu's own order.
async function search(paper) {
  const none = (layer, extra = {}) => ({ questions: [], search: { layer, items: [], ...extra } });
  if (!paper.title) return none('no-title');
  try {
    const rows = await searchWeb(paper.title);
    const questions = questionsFromRows(rows);
    console.log('[知乎论文助手] search: web', rows.length, 'rows ->', questions.length, 'questions');
    return { questions, search: { layer: rows.length ? 'fuzzy' : 'empty', items: rows.slice(0, 10), via: 'web' } };
  } catch (e) {
    console.log('[知乎论文助手] search: web failed,', e.message);
  }
  if (!(await getSecret())) return none('needs-secret');
  try {
    const items = await searchZhihu(paper.title, 10);
    console.log('[知乎论文助手] search: open-platform', items.length);
    return { questions: [], search: { layer: items.length ? 'fuzzy' : 'empty', items, via: 'open-platform' } };
  } catch (e) {
    return none(e.message === 'NO_SECRET' ? 'needs-secret' : 'error', { error: e.message });
  }
}

/**
 * The 相关问题 pool: questions Zhihu has linked to the paper, plus questions
 * the search turns up. Card rows come first so they win the dedupe and keep
 * their relevance_score.
 */
async function pool(paper) {
  const [card, sr] = await Promise.all([
    leg('paperQuestions', () => paperQuestions(paper)).catch((e) => ({ questions: [], paperIds: [], via: 'error', error: e })),
    leg('search', () => search(paper))
  ]);

  const seen = new Set();
  const items = [];
  for (const q of [...card.questions, ...sr.questions]) {
    if (seen.has(q.qid)) continue;
    seen.add(q.qid);
    items.push(q);
  }
  return { items, search: sr.search, via: card.via, error: card.error, paperIds: card.paperIds };
}

/** Top answers for every pooled question, in parallel. ~1s for a dozen. */
async function hydrate(items) {
  return Promise.all(items.map(async (q) => {
    try {
      const answers = await questionAnswers(q.qid);
      return { ...q, answers };
    } catch (e) {
      return { ...q, answers: [] };   // one question failing must not sink the batch
    }
  }));
}

async function resolve(paper) {
  // Zhihu has no endpoint for this, so the author bindings still come from
  // the seed. ORCID alone cannot stand in: an arXiv preprint has no Crossref
  // record to carry ORCIDs, so a declared link is the only way its authors
  // are found at all.
  const alt = [...(paper.altIds || [])];
  if (paper.doi && paper.arxivId) alt.push('arxiv:' + paper.arxivId);
  const hit = await leg('seed', () => getPaper(paper.id, alt));
  const declared = hit.Code === 0 ? hit.Data.authors : [];
  const authors = mergeAuthors(declared, await authorsByOrcid(paper.orcids));
  const authorTokens = new Set(authors.map((a) => a.url_token).filter(Boolean));

  const p = await leg('pool', () => pool(paper));

  // 直答 ranks on titles alone, so it is launched here rather than after the
  // hydration it does not need. The two then overlap, and since ranking is
  // much the slower of them the hydration costs nothing in wall time.
  const ranking = p.items.length > 1
    ? leg('rank', () => rankByZhida(paper, p.items)).catch(() => null)
    : Promise.resolve(null);

  const hydrated = await leg('hydrate', () => hydrate(p.items));

  // An author's own answer is worth surfacing next to the top one, which is
  // often somebody else's — the badge would otherwise point at a row that
  // does not show the author at all.
  const marked = hydrated.map((q) => {
    const mine = q.answers.find((a) => a.urlToken && authorTokens.has(a.urlToken));
    return { ...q, authorInvolved: !!mine, authorAnswer: mine || null, top: q.answers[0] || null };
  });

  // Something renders now; 直答 reorders it a few seconds later.
  const provisional = [...marked].sort((a, b) =>
    (b.authorInvolved - a.authorInvolved) ||
    ((b.score || 0) - (a.score || 0)) ||
    ((b.top?.votes || 0) - (a.top?.votes || 0)));

  // The ranking promise is handed back rather than stored: the resolution
  // goes into session storage, which cannot hold a promise.
  return {
    ranking,
    resolution: {
      linked: provisional,
      authors,
      search: p.search,
      via: p.via,
      error: p.error?.message,
      conflict: p.error?.status === 409,
      ranked: false
    }
  };
}

/**
 * Second pass: 直答 ranks the pool. Slow (~6s), so it never gates the first
 * render — the panel shows the provisional order and this swaps it in.
 */
async function rerank(tabId, paper, resolution, ranking) {
  const order = await ranking;
  const s = await getState(tabId);
  if (!s || s.paper.id !== paper.id) return;           // tab moved on

  // Kept after ranking, never before it: 直答 judges the whole pool, so a
  // low-vote explainer from the second page of search results can still earn
  // its place. Only the tail it rejected is dropped. Five shown, five more
  // behind the expander.
  const linked = (order ? reorderByQid(order, resolution.linked) : [...resolution.linked])
    .sort((a, b) => (b.authorInvolved - a.authorInvolved) || 0)   // stable: author-first wins
    .slice(0, 10);
  const settled = { ...s.resolution, linked, ranked: !!order };
  await setState(tabId, { ...s, phase: null, resolution: settled });
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
  // Cached only now: the provisional order is not what the panel shows.
  await writeCache(paper.id, settled);
}

// The push (PAPER_FOUND) is the normal path. This is the other half of it:
// badge.js keeps the last paper it found and answers GET_PAPER, so a worker
// that lost its session state can ask the tab again instead of reporting no
// paper on a page that plainly has one. A tab with no content script -- one
// opened before the extension loaded -- has nothing to answer with, and null
// is the honest result there.
async function pullFromTab(tabId) {
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAPER' });
  } catch (e) {
    return null;
  }
  if (!res || !res.paper) return null;
  return handlePaper(tabId, res.paper);
}

/**
 * Registers the paper and returns at once, with resolve() left running.
 *
 * The panel's first GET_STATE on a cold tab comes through pullFromTab, so
 * anything awaited here is time the panel spends showing nothing at all --
 * not even the paper title. The pool, the hydration and the title search
 * take a second or two between them, and they arrive by STATE_CHANGED.
 */
async function handlePaper(tabId, rawPaper, { fresh = false } = {}) {
  // Crossref fills only what the page left blank (ScienceDirect authors,
  // missing abstracts). Never overrides what the page actually said.
  const paper = await leg('enrich', () => enrich(rawPaper));

  if (!fresh) {
    const cached = await readCache(paper.id);
    if (cached) {
      const s = { paper, resolution: cached, phase: null };
      await setState(tabId, s);
      chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
      console.log('[知乎论文助手]', paper.id, '-> cached');
      return s;
    }
  }

  const preliminary = { paper, resolution: null, phase: 'fetching' };
  await setState(tabId, preliminary);
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
  // Deliberately not awaited. Nothing upstream can act on a failure here, and
  // the panel keeps its pending state until a STATE_CHANGED says otherwise.
  resolveInBackground(tabId, paper).catch((e) => console.log('[知乎论文助手] resolve failed:', e.message));
  return preliminary;
}

async function resolveInBackground(tabId, paper) {
  const started = performance.now();
  const { resolution, ranking } = await leg('resolve', () => resolve(paper));
  console.log('[知乎论文助手]', paper.id, '-> matched by', resolution.via,
              '| authors:', resolution.authors.length,
              '| pool:', resolution.linked.length,
              '(card ' + resolution.linked.filter((d) => d.src === 'card').length + ')',
              '| search:', resolution.search.layer, resolution.search.items.length,
              resolution.error ? '| error: ' + resolution.error : '');
  // The tab may have moved on while the pool was being built.
  const current = await getState(tabId);
  if (!current || current.paper.id !== paper.id) return;

  await setState(tabId, { paper, resolution, phase: resolution.linked.length > 1 ? 'ranking' : null });
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
  if (resolution.linked.length > 1) await rerank(tabId, paper, resolution, ranking);
  else await writeCache(paper.id, resolution);   // nothing to rank; this is final
  console.log('[\u77e5\u4e4e\u8bba\u6587\u52a9\u624b] \u23f1 ' + 'TOTAL'.padEnd(16) + Math.round(performance.now() - started) + 'ms');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'STATE_CHANGED' || msg.type === 'ZHIDA_DONE') return;   // our own broadcasts

    const tabId = sender.tab?.id ?? msg.tabId;

    if (msg.type === 'PAPER_FOUND') {
      await handlePaper(tabId, msg.paper);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'REFRESH') {
      const s = await getState(msg.tabId);
      if (!s?.paper) { sendResponse({ ok: false }); return; }
      await clearCache(s.paper.id);
      await handlePaper(msg.tabId, s.paper, { fresh: true });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'OPEN_PANEL') {
      try { await chrome.sidePanel.open({ tabId }); } catch (e) { /* needs a gesture; toolbar icon still works */ }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'GET_STATE') {
      // The panel names its tab: a worker has no 'current window', so
      // querying for the active tab here is ambiguous across windows.
      const id = msg.tabId;
      if (id == null) { sendResponse(null); return; }
      const s = (await getState(id)) || (await pullFromTab(id));
      if (!s) { sendResponse(null); return; }
      const key = zhidaKey(s.paper.id);
      const stored = await chrome.storage.session.get(key);
      sendResponse({ ...s, phase: s.phase || null, zhida: { text: stored[key] || '', pending: zhidaPending.has(s.paper.id) } });
      return;
    }

    if (msg.type === 'OPEN_COMPOSE') {
      const s = await getState(msg.tabId);
      if (s) await chrome.tabs.sendMessage(msg.tabId, { type: 'SHOW_COMPOSE', paper: s.paper, body: questionBody(s.paper) });
      sendResponse({ ok: !!s });
      return;
    }

    if (msg.type === 'ASK_CANDIDATES') {
      sendResponse({ candidates: await draftQuestionCandidates(msg.paper) });
      return;
    }

    if (msg.type === 'SUBMIT_QUESTION') {
      // Same handoff the panel used to do: the zhihu.com content script picks
      // this up and fills Zhihu's own 提问 form.
      await chrome.storage.local.set({ pendingDraft: { title: msg.title, body: msg.body } });
      await chrome.tabs.create({ url: 'https://www.zhihu.com/' });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ error: 'unknown message' });
  })();
  return true;   // async sendResponse
});

// 直答 streams over a port so the panel can show progress; it renders the
// finished markdown once, on completion.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'zhida') return;
  port.onMessage.addListener(async (msg) => {
    const id = msg.paper.id;
    zhidaPending.add(id);
    try {
      const prompt = zhidaPrompt(msg.paper);
      let full;
      try {
        full = await zhidaWeb(prompt, (delta) => port.postMessage({ delta }));
      } catch (e) {
        console.log('[知乎论文助手] 直答: web failed,', e.message);
        if (!(await getSecret())) throw new Error('直答暂不可用');
        full = await zhida(prompt, (delta) => port.postMessage({ delta }));
      }
      await chrome.storage.session.set({ [zhidaKey(id)]: full });
      port.postMessage({ done: true, text: full });
      // The panel may have re-rendered mid-stream (tab switch); tell it to refetch.
      chrome.runtime.sendMessage({ type: 'ZHIDA_DONE', paperId: id }).catch(() => {});
    } catch (e) {
      port.postMessage({ error: e.message });
    } finally {
      zhidaPending.delete(id);
    }
  });
});

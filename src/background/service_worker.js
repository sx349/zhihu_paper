import { getPaper, authorsByOrcid, mergeAuthors, putFeedback, exportFeedback } from '../lib/papergraph.js';
import { searchZhihu, searchZhihuWeb, searchQuestionsWeb, questionAnswers, zhida, zhidaWeb, zhidaPrompt, getSecret, draftQuestionCandidates, questionBody } from '../lib/zhihu.js';
import { paperQuestions } from '../lib/paperquestions.js';
import { rankByZhida } from '../lib/rank.js';
import { enrich } from '../lib/crossref.js';

// Per-tab state lives in session storage, NOT a Map: MV3 kills the worker
// after ~30s idle and takes any in-memory state with it. A tab that pushed
// its paper minutes ago must still resolve after a tab switch.
const stateKey = (tabId) => 'tab:' + tabId;
const getState = async (tabId) => (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] || null;
const setState = (tabId, s) => chrome.storage.session.set({ [stateKey(tabId)]: s });

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

// Title search: Zhihu's web API with the user's cookies first (no secret
// needed, richer rows, verified from the worker); the open platform only if
// that fails and a secret exists. The web API returns no relevance score, so
// results keep Zhihu's own order and the panel shows the top 5.
async function searchFallback(paper) {
  if (!paper.title) return { layer: 'no-title', items: [] };
  try {
    const items = await searchZhihuWeb(paper.title, 10);
    console.log('[知乎论文助手] search: web', items.length);
    return { layer: items.length ? 'fuzzy' : 'empty', items, via: 'web' };
  } catch (e) {
    console.log('[知乎论文助手] search: web failed,', e.message);
  }
  if (!(await getSecret())) return { layer: 'needs-secret', items: [] };
  try {
    const items = await searchZhihu(paper.title, 10);
    console.log('[知乎论文助手] search: open-platform', items.length);
    return { layer: items.length ? 'fuzzy' : 'empty', items, via: 'open-platform' };
  } catch (e) {
    return { layer: e.message === 'NO_SECRET' ? 'needs-secret' : 'error', items: [], error: e.message };
  }
}

/**
 * The 关联讨论 pool: questions Zhihu has linked to the paper, plus questions
 * the title search turns up. Card rows come first so they win the dedupe and
 * keep their relevance_score.
 */
async function pool(paper) {
  const [card, found] = await Promise.all([
    paperQuestions(paper).catch((e) => ({ questions: [], paperIds: [], via: 'error', error: e })),
    paper.title ? searchQuestionsWeb(paper.title).catch(() => []) : Promise.resolve([])
  ]);

  const seen = new Set();
  const items = [];
  for (const q of [...card.questions, ...found]) {
    if (seen.has(q.qid)) continue;
    seen.add(q.qid);
    items.push(q);
  }
  return { items, via: card.via, error: card.error, paperIds: card.paperIds };
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
  const hit = await getPaper(paper.id, alt);
  const declared = hit.Code === 0 ? hit.Data.authors : [];
  const authors = mergeAuthors(declared, await authorsByOrcid(paper.orcids));
  const authorTokens = new Set(authors.map((a) => a.url_token).filter(Boolean));

  const p = await pool(paper);
  const hydrated = await hydrate(p.items);

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

  const search = await searchFallback(paper);
  return {
    linked: provisional,
    authors,
    search,
    via: p.via,
    error: p.error?.message,
    conflict: p.error?.status === 409,
    ranked: false
  };
}

/**
 * Second pass: 直答 ranks the pool. Slow (~6s), so it never gates the first
 * render — the panel shows the provisional order and this swaps it in.
 */
async function rerank(tabId, paper, resolution) {
  const order = await rankByZhida(paper, resolution.linked).catch(() => null);
  const s = await getState(tabId);
  if (!s || s.paper.id !== paper.id) return;           // tab moved on

  const linked = (order || resolution.linked).sort((a, b) =>
    (b.authorInvolved - a.authorInvolved) || 0);        // stable: author-first wins
  await setState(tabId, { ...s, phase: null, resolution: { ...s.resolution, linked, ranked: !!order } });
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
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
async function handlePaper(tabId, rawPaper) {
  // Crossref fills only what the page left blank (ScienceDirect authors,
  // missing abstracts). Never overrides what the page actually said.
  const paper = await enrich(rawPaper);
  const preliminary = { paper, resolution: null, phase: 'fetching' };
  await setState(tabId, preliminary);
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
  // Deliberately not awaited. Nothing upstream can act on a failure here, and
  // the panel keeps its pending state until a STATE_CHANGED says otherwise.
  resolveInBackground(tabId, paper).catch((e) => console.log('[知乎论文助手] resolve failed:', e.message));
  return preliminary;
}

async function resolveInBackground(tabId, paper) {
  const resolution = await resolve(paper);
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
  chrome.tabs.sendMessage(tabId, { type: 'PAPER_COUNT', count: resolution.linked.length }).catch(() => {});
  if (resolution.linked.length > 1) rerank(tabId, paper, resolution);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'STATE_CHANGED' || msg.type === 'ZHIDA_DONE') return;   // our own broadcasts

    const tabId = sender.tab?.id ?? msg.tabId;

    if (msg.type === 'PAPER_FOUND') {
      await handlePaper(tabId, msg.paper);
      // The count is not known yet; the badge gets it via PAPER_COUNT.
      sendResponse({ count: null });
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

    if (msg.type === 'FEEDBACK') {
      sendResponse(await putFeedback(msg.record));
      return;
    }

    if (msg.type === 'EXPORT_FEEDBACK') {
      sendResponse(await exportFeedback());
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

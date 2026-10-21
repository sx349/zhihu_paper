import { getPaper, authorsByOrcid, mergeAuthors } from '../lib/papergraph.js';
import { searchZhihu, searchWeb, questionsFromRows, questionAnswers, hasCJK, translateTitle, zhida, zhidaWebTurn, zhidaPrompt, getSecret, draftQuestionCandidates, questionBody, members } from '../lib/zhihu.js';
import { paperQuestions } from '../lib/paperquestions.js';
import { rankByZhida, reorderByQid, fallbackOrder } from '../lib/rank.js';
import { readCache, writeCache, clearCache, readZhida, writeZhida } from '../lib/cache.js';
import { paperFromPdfUrl } from '../lib/arxivabs.js';
import { enrich } from '../lib/crossref.js';

// Per-tab state lives in session storage, NOT a Map: MV3 kills the worker
// after ~30s idle and takes any in-memory state with it. A tab that pushed
// its paper minutes ago must still resolve after a tab switch.
const stateKey = (tabId) => 'tab:' + tabId;
const getState = async (tabId) => (await chrome.storage.session.get(stateKey(tabId)))[stateKey(tabId)] || null;
const setState = (tabId, s) => chrome.storage.session.set({ [stateKey(tabId)]: s });

const zhidaPending = new Set();   // paper ids with a generation in flight

// Chrome puts the panel behind sidePanel, Firefox behind sidebarAction, and
// neither knows the other. Which one exists is also the only browser test the
// worker needs, so it stands in for one everywhere below.
const CHROME_PANEL = typeof chrome.sidePanel !== 'undefined';

/** Open the panel for a tab. Needs a user gesture on both browsers. */
async function openPanel(tabId) {
  if (CHROME_PANEL) return chrome.sidePanel.open({ tabId });
  return chrome.sidebarAction.open();   // per window, so it takes no tab
}

chrome.runtime.onInstalled.addListener((details) => {
  // Chrome can hand the toolbar button to the panel outright. Firefox has no
  // equivalent, so the button gets a click handler instead, below.
  if (CHROME_PANEL) chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  // First install only — on 'update' this would fire at every reload during
  // development, and on 'chrome_update' for no reason at all.
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

// Firefox only: the click is the user gesture sidebarAction.toggle() needs.
if (!CHROME_PANEL) {
  chrome.action.onClicked.addListener(() => chrome.sidebarAction.toggle());

  // Firefox runs no content script on a PDF, so nothing in the page can
  // report the paper. Nothing can be drawn there either -- no badge -- but
  // the id is in the URL and the abs page has the rest, so the worker reads
  // it itself. Chrome needs none of this: its content script reaches the PDF
  // viewer, and handles /pdf/ exactly as it handles every other page.
  chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (info.status !== 'complete' || !tab?.url) return;
    const paper = await paperFromPdfUrl(tab.url).catch(() => null);
    if (paper) await handlePaper(tabId, paper);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(stateKey(tabId)));

// A tab that navigates has left its paper behind. Until 0.4.0 nothing cleared
// this, deliberately: leaving a paper meant losing its results, so the panel
// held the last one while the reader went to Google Scholar and back. Caching
// made that untrue -- returning re-renders from the cache at once -- and the
// stickiness had become a way to show the previous paper's discussion against
// the current page, which is what happens on any page the content script does
// not run on. info.url is set only when the URL actually changed, and loading
// precedes the script's document_idle, so a real paper still overwrites this.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'loading' || !info.url) return;
  await chrome.storage.session.remove(stateKey(tabId));
  // And say so. Navigating within a tab fires neither onActivated nor any
  // other refresh the panel listens for, so clearing the state alone leaves
  // the previous render on screen against nothing.
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
});

// One search feeds both panels. Zhihu's web API with the user's cookies
// first (no secret needed, richer rows); the open platform only if that
// fails and a secret exists -- its rows carry no question to collapse, so
// 相关问题 then rests on the paper index alone, exactly as it did before.
// The web API returns no relevance score, so rows keep Zhihu's own order.
// Round-robin rather than one list after the other: 相关回答/文章 is not
// ranked, it shows the first ten as they come, so appending would hand every
// slot to whichever query ran first -- on the papers this exists to fix, the
// English one, whose rows are the problem.
function interleave(a, b) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const r of [a[i], b[i]]) {
      if (!r || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push(r);
    }
  }
  return out;
}

async function search(paper, onPhase) {
  const none = (layer, extra = {}) => ({ questions: [], search: { layer, items: [], ...extra } });
  if (!paper.title) return none('no-title');

  // Both queries go at once: the English search costs nothing while the
  // translation is in flight, and keeps the hits where a Chinese post does
  // use the English terms.
  const translating = !hasCJK(paper.title);
  const english = searchWeb(paper.title).catch((e) => e);
  const zh = translating ? translateTitle(paper.title).catch(() => '') : Promise.resolve('');
  const chinese = zh.then((t) => {
    if (translating) onPhase('fetching');
    return t ? searchWeb(t).catch(() => []) : [];
  });

  const [en, cn, zhTitle] = await Promise.all([english, chinese, zh]);
  if (!(en instanceof Error)) {
    const rows = interleave(en, cn);
    const questions = questionsFromRows(rows);
    console.log('[知乎论文助手] search: web', en.length, '+', cn.length, 'rows ->', questions.length, 'questions',
                zhTitle ? '| zh: ' + zhTitle : '');
    return { zhTitle, questions, search: { layer: rows.length ? 'fuzzy' : 'empty', items: rows.slice(0, 10), via: 'web' } };
  }
  console.log('[知乎论文助手] search: web failed,', en.message);
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
async function pool(paper, onPhase) {
  const [card, sr] = await Promise.all([
    paperQuestions(paper).catch((e) => ({ questions: [], paperIds: [], via: 'error', error: e })),
    search(paper, onPhase)
  ]);

  const seen = new Set();
  const items = [];
  for (const q of [...card.questions, ...sr.questions]) {
    if (seen.has(q.qid)) continue;
    seen.add(q.qid);
    items.push(q);
  }
  return { items, search: sr.search, zhTitle: sr.zhTitle || '', via: card.via, error: card.error, paperIds: card.paperIds };
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

async function resolve(paper, onPhase) {
  // Zhihu has no endpoint for this, so the author bindings still come from
  // the seed. ORCID alone cannot stand in: an arXiv preprint has no Crossref
  // record to carry ORCIDs, so a declared link is the only way its authors
  // are found at all.
  const alt = [...(paper.altIds || [])];
  if (paper.doi && paper.arxivId) alt.push('arxiv:' + paper.arxivId);
  const hit = await getPaper(paper.id, alt);
  const declared = hit.Code === 0 ? hit.Data.authors : [];
  const seeded = mergeAuthors(declared, await authorsByOrcid(paper.orcids));
  const authorTokens = new Set(seeded.map((a) => a.url_token).filter(Boolean));

  // Launched, not awaited: the panel needs this only at the end, and pool()
  // is much the slower of the two, so the round trip costs nothing in wall
  // time. Awaiting it here would add one to every page load.
  const live = members([...authorTokens]).catch(() => new Map());

  const p = await pool(paper, onPhase);

  // 直答 ranks on titles alone, so it is launched here rather than after the
  // hydration it does not need. The two then overlap, and since ranking is
  // much the slower of them the hydration costs nothing in wall time.
  const ranking = p.items.length > 1
    ? rankByZhida(paper, p.items).catch(() => null)
    : Promise.resolve(null);

  const hydrated = await hydrate(p.items);

  // An author's own answer is worth surfacing next to the top one, which is
  // often somebody else's — the badge would otherwise point at a row that
  // does not show the author at all.
  const marked = hydrated.map((q) => {
    const mine = q.answers.find((a) => a.urlToken && authorTokens.has(a.urlToken));
    return { ...q, authorInvolved: !!mine, authorAnswer: mine || null, top: q.answers[0] || null };
  });

  // What the panel shows if 直答 cannot rank; see fallbackOrder.
  const provisional = fallbackOrder(marked);

  // Live values win where Zhihu returned one; the seed is the fallback, so a
  // failed lookup or a signed-out reader sees exactly what they saw before.
  const fresh = await live;
  const authors = seeded.map((a) => {
    const m = fresh.get(a.url_token);
    return m ? { ...a,
      nickname: m.name || a.nickname,
      label: m.headline || a.label,
      avatar: m.avatar || '' } : a;
  });

  // The ranking promise is handed back rather than stored: the resolution
  // goes into session storage, which cannot hold a promise.
  return {
    ranking,
    resolution: {
      linked: provisional,
      authors,
      search: p.search,
      zhTitle: p.zhTitle,
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
  const paper = await enrich(rawPaper);

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

  const preliminary = { paper, resolution: null,
                        phase: paper.title && !hasCJK(paper.title) ? 'translating' : 'fetching' };
  await setState(tabId, preliminary);
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
  // Deliberately not awaited. Nothing upstream can act on a failure here, and
  // the panel keeps its pending state until a STATE_CHANGED says otherwise.
  resolveInBackground(tabId, paper).catch((e) => console.log('[知乎论文助手] resolve failed:', e.message));
  return preliminary;
}

/** Moves the panel's status line on, unless the tab has moved to another paper. */
async function setPhase(tabId, paperId, phase) {
  const s = await getState(tabId);
  if (!s || s.paper.id !== paperId || s.resolution) return;
  await setState(tabId, { ...s, phase });
  chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
}

async function resolveInBackground(tabId, paper) {
  const { resolution, ranking } = await resolve(paper, (phase) => setPhase(tabId, paper.id, phase));
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
  if (resolution.linked.length > 1) rerank(tabId, paper, resolution, ranking);
  else await writeCache(paper.id, resolution);   // nothing to rank; this is final
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'STATE_CHANGED' || msg.type === 'ZHIDA_DONE') return;   // our own broadcasts

    const tabId = sender.tab?.id ?? msg.tabId;

    if (msg.type === 'PAPER_FOUND') {
      await handlePaper(tabId, msg.paper);
      // Whether a click in the page can open the panel at all. Firefox wants a
      // live user gesture for sidebarAction and does not expose it to content
      // scripts, so the badge needs to know before it is hovered, not after
      // it is clicked.
      sendResponse({ ok: true, canOpenFromPage: CHROME_PANEL });
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
      // Both browsers want a user gesture here, and the click happened in the
      // content script a message ago. Chrome accepts that; Firefox refuses --
      // "sidebarAction.open may only be called from a user input handler" --
      // and sidebarAction is not exposed to content scripts, so there is
      // nowhere the call could be made with the gesture still live. The badge
      // learns this on PAPER_FOUND and explains itself on hover.
      try { await openPanel(tabId); } catch (e) { console.log('[知乎论文助手] open panel failed:', e.message); }
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
      sendResponse({ ...s, phase: s.phase || null,
                     zhida: { ...(await readZhida(s.paper.id)), pending: zhidaPending.has(s.paper.id) } });
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
      let session = '';
      try {
        // Generating opens a 直答 conversation; keeping its id lets the panel
        // link the reader to it.
        ({ text: full, sessionId: session } = await zhidaWebTurn(prompt, (delta) => port.postMessage({ delta })));
      } catch (e) {
        console.log('[知乎论文助手] 直答: web failed,', e.message);
        if (!(await getSecret())) throw new Error('直答暂不可用');
        full = await zhida(prompt, (delta) => port.postMessage({ delta }));   // no conversation to link
      }
      await writeZhida(id, full, session);
      port.postMessage({ done: true, text: full, sessionId: session });
      // The panel may have re-rendered mid-stream (tab switch); tell it to refetch.
      chrome.runtime.sendMessage({ type: 'ZHIDA_DONE', paperId: id }).catch(() => {});
    } catch (e) {
      port.postMessage({ error: e.message });
    } finally {
      zhidaPending.delete(id);
    }
  });
});

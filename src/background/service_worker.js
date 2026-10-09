import { getPaper, authorsByOrcid, mergeAuthors, putFeedback, exportFeedback } from '../lib/papergraph.js';
import { searchZhihu, searchZhihuWeb, zhida, zhidaWeb, zhidaPrompt, getSecret, draftQuestionCandidates, questionBody } from '../lib/zhihu.js';
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

async function resolve(paper) {
  const alt = [...(paper.altIds || [])];
  if (paper.doi && paper.arxivId) alt.push('arxiv:' + paper.arxivId);
  const hit = await getPaper(paper.id, alt);

  const declared = hit.Code === 0 ? hit.Data.authors : [];
  const linked = hit.Code === 0 ? hit.Data.discussions : [];
  // An author can be found two ways: a link row for this paper, or an ORCID
  // on their account that Crossref lists for the paper. The second needs no
  // per-paper data at all.
  const authors = mergeAuthors(declared, await authorsByOrcid(paper.orcids));

  // Title search runs regardless of whether the index hit. A paper can carry
  // one linked card and still have unlinked discussion worth surfacing.
  const search = await searchFallback(paper);

  return {
    layer: linked.length ? 'linked' : search.layer,
    authors,
    linked,
    search,
    viaAlias: !!hit.ViaAlias,
    matchedId: hit.MatchedId
  };
}

async function handlePaper(tabId, rawPaper) {
  // Crossref fills only what the page left blank (ScienceDirect authors,
  // missing abstracts). Never overrides what the page actually said.
  const paper = await enrich(rawPaper);
  const resolution = await resolve(paper);
  console.log('[知乎论文助手]', paper.id, '->', resolution.layer,
              '| authors:', resolution.authors.length,
              '| linked:', resolution.linked.length,
              '| search:', resolution.search.layer, resolution.search.items.length,
              resolution.search.error ? '| error: ' + resolution.search.error : '');
  const s = { paper, resolution };
  await setState(tabId, s);
  return s;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'STATE_CHANGED' || msg.type === 'ZHIDA_DONE') return;   // our own broadcasts

    const tabId = sender.tab?.id ?? msg.tabId;

    if (msg.type === 'PAPER_FOUND') {
      const s = await handlePaper(tabId, msg.paper);
      chrome.runtime.sendMessage({ type: 'STATE_CHANGED', tabId }).catch(() => {});
      sendResponse({ count: s.resolution.linked.length });
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
      sendResponse({ ...s, zhida: { text: stored[key] || '', pending: zhidaPending.has(s.paper.id) } });
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

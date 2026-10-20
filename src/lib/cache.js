// Resolving a paper costs a paper-index call, two pages of search, a feeds
// fetch per pooled question and three 直答 rounds -- about seven seconds and
// some twenty requests. Keyed by paper rather than by tab, so a reload, a
// second tab on the same paper and a browser restart all reuse it.

const PREFIX = 'cache:';
const TTL_MS = 24 * 60 * 60 * 1000;   // discussion accumulates slowly
const MAX_ENTRIES = 200;              // ~4KB each; a backstop, not the usual bound

const key = (paperId) => PREFIX + paperId;

/**
 * Everything the panel actually reads, and nothing else. The raw answer list
 * is the bulk of a resolution -- twenty rows a question -- and is only ever
 * used to pick `top` and `authorAnswer`, which has already happened by now.
 */
function trim(resolution) {
  const answer = (a) => a && { author: a.author, votes: a.votes, url: a.url };
  return {
    linked: (resolution.linked || []).map((q) => ({
      qid: q.qid,
      title: q.title,
      src: q.src,
      authorInvolved: q.authorInvolved,
      authorAnswer: answer(q.authorAnswer),
      top: answer(q.top)
    })),
    authors: resolution.authors || [],
    search: {
      layer: resolution.search?.layer,
      error: resolution.search?.error,
      hidden: resolution.search?.hidden,
      items: (resolution.search?.items || []).map((i) => ({
        kind: i.kind, title: i.title, url: i.url, author: i.author, votes: i.votes, score: i.score
      }))
    },
    via: resolution.via,
    conflict: resolution.conflict,
    ranked: resolution.ranked
  };
}

/** The question url is the qid, so it is rebuilt rather than stored. */
function rehydrate(cached) {
  return {
    ...cached,
    linked: cached.linked.map((q) => ({ ...q, kind: 'question', url: 'https://www.zhihu.com/question/' + q.qid }))
  };
}

export async function readCache(paperId) {
  const k = key(paperId);
  const got = await chrome.storage.local.get(k);
  const row = got[k];
  if (!row) return null;
  if (Date.now() - row.ts > TTL_MS) {
    await chrome.storage.local.remove(k);
    return null;
  }
  return rehydrate(row.resolution);
}

export async function writeCache(paperId, resolution) {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();

  const rows = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .filter(([, v]) => now - v.ts <= TTL_MS);

  const stale = Object.keys(all).filter((k) => k.startsWith(PREFIX) && !rows.some(([r]) => r === k));
  // Keep the newest; the cap only bites on a day of unusually heavy browsing.
  const overflow = rows.sort((a, b) => b[1].ts - a[1].ts).slice(MAX_ENTRIES - 1).map(([k]) => k);
  const drop = [...new Set([...stale, ...overflow])].filter((k) => k !== key(paperId));
  if (drop.length) await chrome.storage.local.remove(drop);

  await chrome.storage.local.set({ [key(paperId)]: { ts: now, resolution: trim(resolution) } });
}

export async function clearCache(paperId) {
  await chrome.storage.local.remove(key(paperId));
}

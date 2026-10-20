// Resolving a paper costs a paper-index call, two pages of search, a feeds
// fetch per pooled question and three 直答 rounds -- about seven seconds and
// some twenty requests. Keyed by paper rather than by tab, so a reload, a
// second tab on the same paper and a browser restart all reuse it.

const PREFIX = 'cache:';
const TTL_MS = 24 * 60 * 60 * 1000;   // discussion accumulates slowly
const MAX_ENTRIES = 200;              // ~4KB each; a backstop, not the usual bound

// A 论文解读 is a function of the paper and the model, so unlike the pool it
// does not go stale -- the reason to drop one is storage, not freshness.
// Hence a week rather than a day, and a tighter cap, each entry being larger.
const Z_PREFIX = 'zhida:';
const Z_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const Z_MAX_ENTRIES = 50;             // ~4KB each

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

/** One expiring, capped store; the two below differ only in their constants. */
async function read(prefix, paperId, ttl) {
  const k = prefix + paperId;
  const got = await chrome.storage.local.get(k);
  const row = got[k];
  if (!row) return null;
  if (Date.now() - row.ts > ttl) {
    await chrome.storage.local.remove(k);
    return null;
  }
  return row;
}

async function write(prefix, paperId, ttl, max, fields) {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();

  const rows = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .filter(([, v]) => now - v.ts <= ttl);

  const stale = Object.keys(all).filter((k) => k.startsWith(prefix) && !rows.some(([r]) => r === k));
  // Keep the newest; the cap only bites on a day of unusually heavy browsing.
  const overflow = rows.sort((a, b) => b[1].ts - a[1].ts).slice(max - 1).map(([k]) => k);
  const drop = [...new Set([...stale, ...overflow])].filter((k) => k !== prefix + paperId);
  if (drop.length) await chrome.storage.local.remove(drop);

  await chrome.storage.local.set({ [prefix + paperId]: { ts: now, ...fields } });
}

export async function readCache(paperId) {
  const row = await read(PREFIX, paperId, TTL_MS);
  return row ? rehydrate(row.resolution) : null;
}

export async function writeCache(paperId, resolution) {
  await write(PREFIX, paperId, TTL_MS, MAX_ENTRIES, { resolution: trim(resolution) });
}

export async function clearCache(paperId) {
  await chrome.storage.local.remove(key(paperId));
}

// The 论文解读, kept beside the resolution rather than inside it: ⟳ drops the
// pool and re-resolves, and a generation that costs twenty seconds should not
// go with it.
export async function readZhida(paperId) {
  const row = await read(Z_PREFIX, paperId, Z_TTL_MS);
  return row ? row.text : '';
}

export async function writeZhida(paperId, text) {
  await write(Z_PREFIX, paperId, Z_TTL_MS, Z_MAX_ENTRIES, { text });
}

// PaperGraph — stands in for the paper index Zhihu would host.
//
// Everything here is async and returns Zhihu's {Code, Message, Data} envelope
// even though it reads a bundled JSON file, so replacing it with a real
// endpoint is a one-file change and no caller has to move.

let cache = null;

async function load() {
  if (cache) return cache;
  const res = await fetch(chrome.runtime.getURL('data/seed.json'));
  const raw = await res.json();

  // Index the flat rows the way a SQL backend would be queried.
  const byId = new Map();
  for (const p of raw.paper) {
    byId.set(p.id, {
      paper: p,
      authors: raw.user_paper_link
        .filter((l) => l.paper_id === p.id)
        .map((l) => ({ ...raw.zhihu_user.find((u) => u.url_token === l.url_token), relation: l.relation })),
      discussions: rankDiscussions(
        raw.paper_card.filter((c) => c.paper_id === p.id).map((c) => resolveCard(raw, c)).filter(Boolean),
        new Set(
          raw.user_paper_link.filter((l) => l.paper_id === p.id).map((l) => l.url_token)
        )
      )
    });
  }
  // Alias -> canonical id, both directions. A preprint and its published
  // version are the same work; discussion attached to either should surface
  // on both. This cannot be derived from metadata — measured Crossref
  // preprint-relation coverage is 0-6% — so it lives here as data.
  const alias = new Map();
  for (const a of raw.paper_alias || []) {
    alias.set(a.alias_id, a.paper_id);
    alias.set(a.paper_id, a.paper_id);
  }

  cache = { raw, byId, alias };
  return cache;
}

function resolveCard(raw, card) {
  if (card.attached_type === 'question') {
    const q = raw.question.find((x) => x.qid === card.attached_id);
    if (!q) return null;
    return {
      kind: 'question',
      title: q.title,
      url: q.url,
      answers: raw.answer
        .filter((a) => a.qid === q.qid)
        .sort((a, b) => b.vote_count - a.vote_count)
        .map((a) => ({ author: a.author_name, url: a.url, votes: a.vote_count, urlToken: a.url_token }))
    };
  }
  const art = raw.article.find((x) => x.pid === card.attached_id);
  if (!art) return null;
  return { kind: 'article', title: art.title, url: art.url, author: art.author_name, votes: art.vote_count, urlToken: art.url_token };
}

/**
 * Rank discussions attached to one paper.
 *   1. anything a bound author of the paper took part in
 *   2. everything else by vote weight — a question scores as its top answer,
 *      an answer or article as its own votes, so the two kinds interleave
 * Zhihu would replace the vote proxy with internal ranking signals.
 */
function rankDiscussions(items, authorTokens) {
  const weight = (d) =>
    d.kind === 'question'
      ? Math.max(0, ...(d.answers || []).map((a) => a.votes || 0))
      : d.votes || 0;
  const involved = (d) =>
    d.kind === 'question'
      ? (d.answers || []).some((a) => a.urlToken && authorTokens.has(a.urlToken))
      : !!(d.urlToken && authorTokens.has(d.urlToken));

  return items
    .map((d) => ({ ...d, authorInvolved: involved(d), weight: weight(d) }))
    .sort((a, b) => (b.authorInvolved - a.authorInvolved) || (b.weight - a.weight));
}

function envelope(data) { return { Code: 0, Message: 'success', Data: data }; }

/**
 * Look up one paper. Tries the canonical id, then any alternate ids the page
 * offered (arXiv's own DOI, say), then the alias table for preprint/published
 * pairs. Returns which id actually matched so the panel can say so.
 */
export async function getPaper(id, altIds = []) {
  const { byId, alias } = await load();
  const candidates = [id, ...(Array.isArray(altIds) ? altIds : [altIds])].filter(Boolean);

  for (const c of candidates) {
    if (byId.has(c)) return { ...envelope(byId.get(c)), MatchedId: c, ViaAlias: c !== id };
    const canonical = alias.get(c);
    if (canonical && byId.has(canonical)) {
      return { ...envelope(byId.get(canonical)), MatchedId: canonical, ViaAlias: true };
    }
  }
  return { Code: 404, Message: 'not found', Data: null };
}

/**
 * Accounts whose bound ORCID appears among the paper's authors. This is the
 * bridge that finds an author with no hand-made paper link at all: Crossref
 * supplies paper -> ORCID, Zhihu supplies ORCID -> account.
 */
export async function authorsByOrcid(orcids) {
  if (!orcids?.length) return [];
  const { raw } = await load();
  const want = new Set(orcids.map((o) => (typeof o === 'string' ? o : o.orcid)).filter(Boolean));
  return raw.zhihu_user.filter((u) => u.orcid && want.has(u.orcid)).map((u) => ({ ...u, relation: 'orcid' }));
}

/** Declared links first, then ORCID matches, one entry per account. */
export function mergeAuthors(declared, viaOrcid) {
  const seen = new Set();
  return [...declared, ...viaOrcid].filter((a) => !seen.has(a.url_token) && seen.add(a.url_token));
}

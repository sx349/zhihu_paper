// Zhihu's paper index: paper -> the questions carrying its 论文卡片.
//
// This replaces the seeded paper_card table. It needs no credential at all —
// an Authorization header is in fact worse than none, since a stale Bearer
// turns a working call into a 401.
//
// Measured against the live endpoint (2026-10):
//   doi         normalised. bare / https://doi.org/ / http://dx.doi.org/ /
//               mixed case all resolve. only a `doi:` prefix misses.
//   paper_url   byte-exact. a trailing slash, http://, www., ?context= or
//               /pdf/ each miss, and the stored URL is whichever one Zhihu
//               captured — arxiv.org/abs/... for a preprint, doi.org/... for
//               a journal article, so a publisher URL usually misses.
//   title       exact, but case-insensitive and outer-space-trimmed. a
//               trailing period, doubled spaces or hyphens-for-spaces miss.
//
// Parameters AND together, so exactly one goes out: two conditions can only
// ever narrow the match, never improve it.

const BASE = 'https://api.zhihu.com/paper/questions';

/** Zhihu does not index the synthesized arXiv DOI, only the abs URL. */
const isArxivDoi = (doi) => /^10\.48550\/arxiv\./i.test(doi || '');

/** Collapse the differences the endpoint tolerates nothing of but we can fix. */
function normalizeTitle(t) {
  return String(t || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/**
 * The single lookup parameter, most reliable first. Exported so the panel can
 * say which key found the paper, and so this is testable without a network.
 */
export function lookupParam(paper) {
  if (paper.doi && !isArxivDoi(paper.doi)) return { doi: paper.doi };
  // Rebuilt from the extracted id, never location.href: matching is exact and
  // a version suffix or a query string is enough to miss.
  if (paper.arxivId) return { paper_url: 'https://arxiv.org/abs/' + paper.arxivId };
  const title = normalizeTitle(paper.title);
  return title ? { title } : null;
}

async function query(params) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('limit', '50');

  const res = await fetch(url);          // no Authorization header, deliberately
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const name = json?.error?.name || ('HTTP ' + res.status);
    const e = new Error(json?.error?.message || name);
    e.name = name;
    e.status = res.status;
    throw e;
  }
  return {
    paperIds: json?.paper_ids || [],
    questions: (json?.data || []).map((q) => ({
      kind: 'question',
      qid: String(q.url_token),
      title: q.title,
      url: q.url,
      score: q.relevance_score,
      src: 'card'
    }))
  };
}

/**
 * Questions Zhihu has linked to this paper. Falls back to an exact-title
 * query when the primary key finds nothing: the title is the only identifier
 * a preprint and its published version share, and Zhihu often holds only one
 * of the two (ResNet is indexed by its arXiv URL; its CVPR DOI is not indexed
 * at all).
 */
export async function paperQuestions(paper) {
  const primary = lookupParam(paper);
  if (!primary) return { questions: [], paperIds: [], via: 'no-identifier' };

  const first = await query(primary);
  if (first.paperIds.length) return { ...first, via: Object.keys(primary)[0] };

  const title = normalizeTitle(paper.title);
  if (!title || primary.title) return { ...first, via: Object.keys(primary)[0] };

  const second = await query({ title });
  return { ...second, via: second.paperIds.length ? 'title-fallback' : Object.keys(primary)[0] };
}

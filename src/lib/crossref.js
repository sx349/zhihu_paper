// Crossref DOI resolution.
//
// Publishers register canonical metadata against every DOI, so one lookup
// replaces per-publisher author scraping. Used only to fill gaps the page
// left — ScienceDirect emits no citation_author at all, and several
// publishers omit the abstract.
//
// Public pool (no mailto). Results are cached per DOI so a re-visit costs
// nothing.

const BASE = 'https://api.crossref.org/works/';
const CACHE_KEY = 'crossrefCache';
const MAX_CACHE = 200;

function stripJats(s) {
  return s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function shape(m) {
  const authors = (m.author || []).map((a) => ({
    name: [a.given, a.family].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || a.name || '',
    orcid: (a.ORCID || '').replace(/^https?:\/\/orcid\.org\//, '')
  })).filter((a) => a.name);

  return {
    title: (m.title || [])[0] || '',
    authors: authors.map((a) => a.name),
    orcids: authors.filter((a) => a.orcid).map((a) => ({ name: a.name, orcid: a.orcid })),
    journal: (m['container-title'] || [])[0] || '',
    year: String(m.issued?.['date-parts']?.[0]?.[0] || ''),
    volume: m.volume || '',
    type: m.type || '',
    abstract: stripJats(m.abstract)
  };
}

async function readCache(doi) {
  const store = await chrome.storage.local.get(CACHE_KEY);
  return (store[CACHE_KEY] || {})[doi] || null;
}

async function writeCache(doi, value) {
  const store = await chrome.storage.local.get(CACHE_KEY);
  const cache = store[CACHE_KEY] || {};
  cache[doi] = value;
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE) delete cache[keys[0]];
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

/** Resolve one DOI. Returns null on any failure — this only ever adds detail. */
export async function resolveDoi(doi) {
  if (!doi) return null;
  const cached = await readCache(doi);
  if (cached) return cached;

  try {
    // A hung request would stall the whole panel, so bound it. Crossref is
    // strictly an enhancement — timing out costs detail, never correctness.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(BASE + encodeURIComponent(doi), { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'ok' || !json.message) return null;
    const out = shape(json.message);
    await writeCache(doi, out);
    return out;
  } catch (e) {
    return null;
  }
}

/**
 * For a DOI paper, Crossref is the source of record for title, authors,
 * journal, year and ORCIDs; the page's meta is only the fallback when the
 * lookup fails. arXiv has no Crossref record, so it keeps its page meta,
 * which is complete. The abstract is page-first: Crossref carries one for
 * only some publishers, and the page has it more often.
 */
export async function enrich(paper) {
  const settled = (p) => ({ ...p, abstract: p.abstract || p.abstractFallback || '',
                            abstractSource: p.abstract ? p.abstractSource : p.abstractFallback ? 'description' : '' });
  if (!paper.doi) return settled(paper);
  const cr = await resolveDoi(paper.doi);
  if (!cr) return settled(paper);

  return {
    ...paper,
    title: cr.title || paper.title,
    authors: cr.authors.length ? cr.authors : paper.authors,
    authorsSource: cr.authors.length ? 'crossref' : paper.authorsSource,
    journal: cr.journal || paper.journal,
    year: cr.year || paper.year,
    abstract: paper.abstract || cr.abstract || paper.abstractFallback || '',
    abstractSource: paper.abstract ? paper.abstractSource : cr.abstract ? 'crossref' : paper.abstractFallback ? 'description' : '',
    orcids: cr.orcids || []
  };
}

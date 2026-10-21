// Reading an arXiv paper without a content script.
//
// Firefox runs none on a PDF. pdf.js renders it under a privileged principal
// that an arxiv.org host permission does not reach, so neither a declarative
// match nor scripting.executeScript gets in -- the latter answering "Missing
// host permission for the tab" with the permission demonstrably granted. The
// id is in the URL though, and the abs page carries everything else.
//
// extract.js cannot be reused for this: it is a classic script built around
// the live document. Parsing is by regex rather than DOMParser so the whole
// thing stays testable under node, where there is no DOM.

export const ARXIV_PDF_URL =
  /^https:\/\/arxiv\.org\/pdf\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/;

/** arXiv writes an apostrophe as &#39;, and the title is a search query. */
function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function metas(html, name) {
  const tag = new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]*>', 'gi');
  return (String(html).match(tag) || [])
    .map((m) => (m.match(/content=["']([\s\S]*?)["']\s*\/?>/i) || [])[1] || '')
    .map((v) => decode(v).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 'Deng, Yu' -> 'Yu Deng'. The same rule as normalizeAuthor in extract.js. */
function flipName(s) {
  const parts = s.split(',');
  return parts.length === 2 && parts[1].trim() ? parts[1].trim() + ' ' + parts[0].trim() : s.trim();
}

/** The shape extract() produces, from an abs page's markup. Null if unusable. */
export function paperFromAbsHtml(html, id) {
  const title = metas(html, 'citation_title')[0] || '';
  if (!title) return null;
  const abstract = metas(html, 'citation_abstract')[0] || '';
  const date = metas(html, 'citation_date')[0] || metas(html, 'citation_publication_date')[0] || '';
  return {
    source: 'arXiv',
    // The reader is on the PDF, but abs is the landing page, as it is for the
    // content-script path on Chrome.
    url: 'https://arxiv.org/abs/' + id,
    doi: '',
    arxivId: id,
    id: 'arxiv:' + id,
    altIds: ['doi:10.48550/arXiv.' + id],
    title,
    authors: metas(html, 'citation_author').map(flipName),
    authorsSource: 'meta',
    journal: '',
    year: (date.match(/\d{4}/) || [''])[0],
    abstract,
    abstractSource: abstract ? 'meta' : '',
    abstractFallback: ''
  };
}

/** null for any URL that is not an arXiv PDF, and for a fetch that fails. */
export async function paperFromPdfUrl(url) {
  const m = ARXIV_PDF_URL.exec(String(url || ''));
  if (!m) return null;
  const res = await fetch('https://arxiv.org/abs/' + m[1]);
  if (!res.ok) return null;
  return paperFromAbsHtml(await res.text(), m[1]);
}

// extract.js is a classic content script: it assigns a global inside an IIFE,
// so a module cannot import from it. Evaluate the real file here and hand the
// global back, so tests run the shipped regexes rather than a copy of them.
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../src/content/extract.js', import.meta.url), 'utf8');

// Nothing in the IIFE body touches these at evaluation time -- they are read
// inside the functions -- but watch() reads history, so give it something.
globalThis.document = { querySelectorAll: () => [] };
globalThis.window = { addEventListener() {} };
globalThis.history = { pushState() {} };

export const { ARXIV_DOI_RE, cleanDoi, doiFromUrl, doiFromSsrn, arxivId, sourceName } =
  new Function(src + '\nreturn ZhihuPaper;')().identifier;

// Put the extractor on a page, the way a real navigation would.
export function at(url) {
  globalThis.location = new URL(url);
}

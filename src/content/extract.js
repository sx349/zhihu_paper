// Identifies the paper on the current page and pulls what the page can give.
//
// The identifier is the job. For the descriptive fields, Crossref is the
// record for any DOI paper and arXiv's own meta is complete; the page is
// consulted only where neither helps — chiefly the ABSTRACT, which Crossref
// carries for few publishers and meta descriptions truncate at ~160 chars.
// Every selector and source below was verified on the live site (2026-09).

var ZhihuPaper = (function () {
  'use strict';

  var DOI_RE = /\b(10\.\d{4,9}\/[^\s"']+)/;
  var ARXIV_RE = /\/(?:abs|pdf)\/((?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/;
  var ARXIV_DOI_RE = /^10\.48550\/arxiv\.(.+)$/i;

  // ---- meta -----------------------------------------------------------

  function metaAll(name) {
    var sel = 'meta[name="' + name + '" i], meta[property="' + name + '" i]';
    return Array.prototype.map
      .call(document.querySelectorAll(sel), function (m) { return (m.content || '').trim(); })
      .filter(Boolean);
  }
  function meta(name) { return metaAll(name)[0] || ''; }
  function firstMeta(names) {
    for (var i = 0; i < names.length; i++) { var v = meta(names[i]); if (v) return v; }
    return '';
  }

  // ---- JSON-LD (JSTOR carries DOI, authors and abstract only here) -----

  var ldCache;
  function jsonLd() {
    if (ldCache) return ldCache;
    ldCache = Array.prototype.map.call(
      document.querySelectorAll('script[type="application/ld+json"]'),
      function (s) { try { return JSON.parse(s.textContent); } catch (e) { return null; } }
    ).filter(Boolean);
    return ldCache;
  }
  function ldArticle() {
    var all = jsonLd();
    for (var i = 0; i < all.length; i++) {
      var o = all[i];
      if (o && (o.abstract || o.headline || /Article/i.test(String(o['@type'])))) return o;
    }
    return null;
  }

  // ---- IEEE keeps everything in an inline script, no meta at all -------

  var ieeeCache;
  function ieeeInline() {
    if (ieeeCache !== undefined) return ieeeCache;
    ieeeCache = '';
    if (location.hostname.indexOf('ieee.org') === -1) return ieeeCache;
    var scripts = document.querySelectorAll('script:not([src])');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].textContent.indexOf('xplGlobal.document.metadata') > -1) { ieeeCache = scripts[i].textContent; break; }
    }
    return ieeeCache;
  }
  function ieeeField(key, longest) {
    var src = ieeeInline();
    if (!src) return '';
    var re = new RegExp('"' + key + '":"((?:[^"\\\\]|\\\\.)*)"', 'g');
    var m, best = '';
    while ((m = re.exec(src))) {
      if (!longest) { best = m[1]; break; }
      if (m[1].length > best.length) best = m[1];
    }
    try { return best ? JSON.parse('"' + best + '"') : ''; } catch (e) { return best; }
  }

  // ---- identifiers ----------------------------------------------------

  function cleanDoi(raw) {
    if (!raw) return '';
    var d = raw.trim();
    try { d = decodeURIComponent(d); } catch (e) { /* keep raw */ }
    d = d.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
    d = d.replace(/[.,;]+$/, '');      // prose punctuation only; ) and ] are legal in DOIs
    var m = d.match(DOI_RE);
    return m ? m[1] : '';
  }

  function doiFromUrl() {
    // Path first (Springer, Wiley, INFORMS, Science, PNAS, ACM, ...), then the
    // query string (AEA ?id=, PLOS ?id=).
    var m = decodeURIComponent(location.pathname).match(DOI_RE);
    if (m) return cleanDoi(m[1]);
    m = decodeURIComponent(location.search).match(DOI_RE);
    return m ? cleanDoi(m[1]) : '';
  }

  // SSRN mints 10.2139/ssrn.<abstract_id>; the URL carries the id.
  function doiFromSsrn() {
    if (location.hostname.indexOf('ssrn.com') === -1) return '';
    var m = location.search.match(/abstract_id=(\d+)/);
    return m ? '10.2139/ssrn.' + m[1] : '';
  }

  function doiFromMeta() {
    return cleanDoi(firstMeta(['citation_doi', 'dc.identifier', 'prism.doi']));
  }
  function doiFromJsonLd() {
    var a = ldArticle();
    return a ? cleanDoi((JSON.stringify(a).match(DOI_RE) || [])[1]) : '';
  }

  function arxivId() {
    var m = decodeURIComponent(location.pathname).match(ARXIV_RE);
    if (m) return m[1];
    return meta('citation_arxiv_id') || '';
  }

  // ---- authors --------------------------------------------------------

  function normalizeAuthor(s) {
    var parts = s.split(',');
    if (parts.length === 2 && parts[1].trim()) return parts[1].trim() + ' ' + parts[0].trim();
    return s.trim();
  }
  function authorsFromMeta() {
    var a = metaAll('citation_author');
    if (!a.length) a = metaAll('dc.creator');
    return a.map(normalizeAuthor);
  }
  function authorsFromJsonLd() {
    var a = ldArticle();
    var list = a && a.author ? (Array.isArray(a.author) ? a.author : [a.author]) : [];
    return list.map(function (x) { return typeof x === 'string' ? x : (x && x.name) || ''; }).filter(Boolean);
  }

  // ---- abstract -------------------------------------------------------

  // Verified per site. Where a site is absent here it either puts the full
  // text in citation_abstract (arXiv, bioRxiv, Cell) or uses the DPUB-ARIA
  // role below (PNAS, ACM, UChicago, SAGE, Cell).
  var ABSTRACT_SELECTORS = [
    ['pubsonline.informs.org',   '.abstractSection.abstractInFull'],
    ['sciencedirect.com',        'div.abstract.author'],
    ['onlinelibrary.wiley.com',  'section.article-section__abstract'],
    ['papers.ssrn.com',          'div.abstract-text'],
    ['nber.org',                 '.page-header__intro'],
    ['aeaweb.org',               'section.abstract'],
    ['academic.oup.com',         'section.abstract'],
    ['science.org',              'section#abstract'],
    ['tandfonline.com',          '.hlFld-Abstract'],
    ['pubmed.ncbi.nlm.nih.gov',  '#eng-abstract'],
    ['nature.com',               '#Abs1-content'],
    ['link.springer.com',        '#Abs1-content'],
    ['biorxiv.org',              '#abstract-1'],
    ['medrxiv.org',              '#abstract-1']
  ];

  function cleanAbstract(t) {
    return String(t || '')
      .replace(/^\s*(abstract|summary|摘要)\s*[:：]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function textOf(sel) {
    var el = document.querySelector(sel);
    return el ? cleanAbstract(el.innerText) : '';
  }

  // Returns { text, source }. Order: full meta, site selector, DPUB role,
  // JSON-LD, IEEE inline. The truncated description meta is NOT here — the
  // worker tries Crossref before falling back to it.
  function abstractFromPage() {
    var t = meta('citation_abstract');
    if (t.length > 200) return { text: cleanAbstract(t), source: 'meta' };

    for (var i = 0; i < ABSTRACT_SELECTORS.length; i++) {
      if (location.hostname.indexOf(ABSTRACT_SELECTORS[i][0]) > -1) {
        t = textOf(ABSTRACT_SELECTORS[i][1]);
        if (t.length > 100) return { text: t, source: 'selector' };
      }
    }
    t = textOf('[role="doc-abstract"]');
    if (t.length > 100) return { text: t, source: 'doc-abstract' };

    var a = ldArticle();
    if (a && typeof a.abstract === 'string' && a.abstract.length > 200) return { text: cleanAbstract(a.abstract), source: 'json-ld' };

    t = ieeeField('abstract', true);
    if (t.length > 100) return { text: cleanAbstract(t), source: 'ieee-inline' };

    return { text: '', source: '' };
  }

  // ---- misc -----------------------------------------------------------

  var SOURCE_NAMES = [
    ['arxiv.org', 'arXiv'], ['sciencedirect', 'ScienceDirect'], ['springer', 'Springer'],
    ['wiley', 'Wiley'], ['informs', 'INFORMS'], ['ssrn', 'SSRN'], ['nber', 'NBER'],
    ['jstor', 'JSTOR'], ['aeaweb', 'AEA'], ['oup.com', 'Oxford Academic'], ['ieee', 'IEEE Xplore'],
    ['science.org', 'Science'], ['pnas', 'PNAS'], ['acm.org', 'ACM'], ['uchicago', 'UChicago Press'],
    ['sagepub', 'SAGE'], ['tandfonline', 'Taylor & Francis'], ['pubmed', 'PubMed'],
    ['nature.com', 'Nature'], ['cell.com', 'Cell'], ['biorxiv', 'bioRxiv'], ['medrxiv', 'medRxiv'],
    ['plos.org', 'PLOS']
  ];
  function sourceName() {
    var h = location.hostname;
    for (var i = 0; i < SOURCE_NAMES.length; i++) if (h.indexOf(SOURCE_NAMES[i][0]) > -1) return SOURCE_NAMES[i][1];
    return h;
  }

  function year() {
    var d = firstMeta(['citation_publication_date', 'citation_date', 'citation_online_date', 'dc.date']);
    var m = d.match(/\d{4}/);
    return m ? m[0] : '';
  }

  // ---- extract --------------------------------------------------------

  function extract() {
    var arxiv = arxivId();
    var doi = doiFromUrl() || doiFromSsrn() || doiFromMeta() || doiFromJsonLd() || cleanDoi(ieeeField('doi'));

    // 10.48550/arXiv.X is arXiv's own DOI for X, not a journal DOI.
    var alt = [];
    var asArxiv = doi && doi.match(ARXIV_DOI_RE);
    if (asArxiv) { arxiv = arxiv || asArxiv[1]; alt.push('doi:' + doi); doi = ''; }
    if (!doi && !arxiv) return null;
    if (arxiv) alt.push('doi:10.48550/arXiv.' + arxiv);

    var authors = authorsFromMeta();
    var authorsSource = authors.length ? 'meta' : '';
    if (!authors.length) { authors = authorsFromJsonLd(); authorsSource = authors.length ? 'json-ld' : 'none'; }

    var ld = ldArticle();
    var abs = abstractFromPage();

    return {
      source: sourceName(),
      url: location.href.split('?')[0],
      doi: doi,
      arxivId: arxiv,
      id: doi ? 'doi:' + doi : 'arxiv:' + arxiv,
      altIds: alt,
      title: firstMeta(['citation_title', 'dc.title']) || (ld && (ld.headline || ld.name)) || ieeeField('title') || meta('og:title'),
      authors: authors,
      authorsSource: authorsSource,
      journal: firstMeta(['citation_journal_title', 'citation_conference_title', 'prism.publicationName']),
      year: year(),
      abstract: abs.text,
      abstractSource: abs.source,
      // truncated site description, kept separately as the last resort
      abstractFallback: firstMeta(['dc.description', 'description', 'og:description'])
    };
  }

  // SPA publishers rewrite the URL without a reload and can mount metadata
  // (abstract included) after our first look, so re-extract until the
  // signature settles rather than keying on the URL.
  function watch(onChange) {
    var lastSig = null;
    function tick() {
      ldCache = undefined; ieeeCache = undefined;
      var p = extract();
      var sig = p ? p.id + '|' + (p.title || '') + '|' + (p.abstract ? 1 : 0) : null;
      if (sig === lastSig) return;
      lastSig = sig;
      console.log('[知乎论文助手] extracted:', p || '(no paper on this page)');
      onChange(p);
    }
    tick();
    var push = history.pushState;
    history.pushState = function () { push.apply(this, arguments); setTimeout(tick, 400); };
    window.addEventListener('popstate', function () { setTimeout(tick, 400); });
    var tries = 0;
    var poll = setInterval(function () { tick(); if (++tries > 20) clearInterval(poll); }, 500);
  }

  // The identifier helpers are exposed so the tests can exercise the real
  // regexes against real URLs. They used to keep their own copies, which
  // silently drifted: one still carried the older DOI_RE that stops at '<',
  // so it could not read a Wiley SICI DOI, and the test passed anyway.
  return {
    extract: extract,
    watch: watch,
    identifier: {
      ARXIV_DOI_RE: ARXIV_DOI_RE,
      cleanDoi: cleanDoi,
      doiFromUrl: doiFromUrl,
      doiFromSsrn: doiFromSsrn,
      arxivId: arxivId
    }
  };
})();

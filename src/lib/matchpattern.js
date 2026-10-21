// Does a match pattern cover a URL?
//
// Chrome and Firefox answer this internally when deciding where to run a
// content script, and never expose it. The panel needs the same answer to
// tell whether the page in front of the reader is one of the sites the
// browser has not granted -- a warning about some other site, on a page that
// works, is noise.
//
// Enough of the grammar for the patterns we ship: a scheme, a host that may
// lead with '*.', and a path glob. No <all_urls>, no '*' scheme-and-host.

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function covers(pattern, url) {
  const m = /^(\*|https?):\/\/([^/]*)(\/.*)$/.exec(pattern);
  if (!m) return false;
  const [, scheme, host, path] = m;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (scheme !== '*' && u.protocol !== scheme + ':') return false;
  if (host !== '*') {
    if (host.startsWith('*.')) {
      // '*.bmj.com' covers bmj.com itself as well as its subdomains.
      const base = host.slice(2);
      if (u.hostname !== base && !u.hostname.endsWith('.' + base)) return false;
    } else if (u.hostname !== host) {
      return false;
    }
  }
  return new RegExp('^' + path.split('*').map(esc).join('.*') + '$').test(u.pathname + u.search);
}

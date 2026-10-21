// Everything the site states about the extension, read from the extension.
//
// The panel's placeholder and the README each carried a hand-written list of
// supported sites. Both rotted -- six names and twenty-three against
// twenty-eight real ones -- because nothing connected them to the manifest.
// The page that replaced them must not repeat that, so nothing here is typed.
import { readFileSync } from 'fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

export const manifest = JSON.parse(read('manifest.json'));

/**
 * SOURCE_NAMES lives inside extract.js's IIFE, which a build script cannot
 * import -- it is a classic content script, not a module, and moving the
 * table out would leave extract.js unable to read it either. So the literal
 * is parsed. A test asserts this still finds a label for every matched host,
 * which is what stops the parse breaking quietly.
 */
export function sourceNames() {
  const src = read('src/content/extract.js');
  const block = /var SOURCE_NAMES = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error('SOURCE_NAMES not found in extract.js');
  return [...block[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
}

/** Each supported site once: its display name and the host a reader sees. */
export function supportedSites() {
  const names = sourceNames();
  const byName = new Map();
  // The block that runs the extractor. The other one runs ask.js on zhihu.com
  // to fill the 提问 modal, which is not a site papers are read on.
  const papers = manifest.content_scripts
    .filter((c) => (c.js || []).some((f) => f.endsWith('extract.js')))
    .flatMap((c) => c.matches);
  for (const pattern of papers) {
    const host = /^https?:\/\/([^/]+)/.exec(pattern)[1].replace(/^\*\./, '');
    const hit = names.find(([key]) => host.includes(key));
    const label = hit ? hit[1] : host;
    // arXiv matches /abs/, /pdf/ and /html/; the reader sees one site.
    if (!byName.has(label)) byName.set(label, host);
  }
  return [...byName].map(([name, host]) => ({ name, host }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * The changelog, as sections. md.js is not reused: it flattens nested
 * bullets, having been written for 直答's output, which never nests.
 */
export function changelog() {
  const out = [];
  let release = null;
  let group = null;
  for (const raw of read('CHANGELOG.md').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^## (.+)$/.exec(line))) {
      release = { title: m[1], groups: [] };
      out.push(release);
      group = null;
      continue;
    }
    if (!release || !line.trim()) continue;
    if ((m = /^- (.+)$/.exec(line))) {
      if (!group) { group = { heading: '', items: [] }; release.groups.push(group); }
      group.items.push({ text: m[1], children: [] });
      continue;
    }
    if ((m = /^ {2,}- (.+)$/.exec(line))) {
      const items = group?.items;
      if (items?.length) items[items.length - 1].children.push(m[1]);
      continue;
    }
    if (/^[^-#\s]/.test(line)) {           // 更新 / 修复 / 其他
      group = { heading: line.trim(), items: [] };
      release.groups.push(group);
    }
  }
  return out;
}

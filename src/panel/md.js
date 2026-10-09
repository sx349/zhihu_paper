// Minimal markdown for 直答 output: headings, bold, inline code, links,
// bullet and numbered lists, paragraphs. Everything is HTML-escaped before
// any transform, and every tag emitted is one of ours, so model output can
// never inject markup. Deliberately not a full parser — an MV3 extension page
// cannot load one from a CDN, and 直答 uses only this subset.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

export function renderMarkdown(src) {
  let html = '';
  let para = [];
  let list = null;

  const flushPara = () => {
    if (para.length) html += '<p>' + inline(para.join(' ')) + '</p>';
    para = [];
  };
  const flushList = () => {
    if (list) html += `<${list.tag}>` + list.items.map((i) => '<li>' + inline(i) + '</li>').join('') + `</${list.tag}>`;
    list = null;
  };

  for (const raw of String(src || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^-{3,}$/.test(line.trim())) { flushPara(); flushList(); html += '<hr>'; continue; }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara(); flushList();
      const lvl = Math.min(m[1].length + 1, 4);   // '#' -> h2; the panel owns h1
      html += `<h${lvl}>` + inline(m[2]) + `</h${lvl}>`;
      continue;
    }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    // '、' needs no following space (Chinese convention); '.' and ')' do, so
    // that '1.5 million' is prose, not a list.
    if ((m = line.match(/^\s*\d+(?:[.)]\s+|、\s*)(.*)$/))) {
      flushPara();
      if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(m[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return html;
}

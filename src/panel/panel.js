import { renderMarkdown } from './md.js';
import { covers } from '../lib/matchpattern.js';

const root = document.getElementById('root');
const SUPPORTED_URL = 'https://sx349.github.io/zhihu_paper';
const foot = document.getElementById('foot');
let current = null;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const link = (href, cls) => {
  const a = el('a', cls);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
};

// Medical and collaboration papers run to dozens of names, which pushes the
// identifiers and everything under them off the top of a narrow panel. Six or
// fewer are left alone -- collapsing them would cost a line and save none.
const SHOWN_AUTHORS = 5;

function authorLine(authors) {
  const line = el('p', 'pauth');
  if (authors.length <= SHOWN_AUTHORS + 1) {
    line.textContent = authors.join(' · ');
    return line;
  }

  const label = `等 ${authors.length} 人`;
  const more = el('button', 'pmore', label);
  more.addEventListener('click', () => {
    const open = line.classList.contains('open');
    line.classList.toggle('open', !open);
    more.textContent = open ? label : '收起';
  });

  line.append(
    el('span', null, authors.slice(0, SHOWN_AUTHORS).join(' · ')),
    el('span', 'prest', ' · ' + authors.slice(SHOWN_AUTHORS).join(' · ')),
    more
  );
  return line;
}

function paperHeader(p) {
  const box = el('div', 'paper');
  const src = el('span', 'src');
  src.innerHTML = '当前页面 · <b></b>';
  src.querySelector('b').textContent = p.source;
  box.append(src, el('p', 'ptitle', p.title || '(无标题)'));
  if (p.authors?.length) box.append(authorLine(p.authors));
  const id = el('div', 'pid');
  if (p.arxivId) id.append(el('span', null, 'arXiv:' + p.arxivId));
  if (p.doi) id.append(el('span', null, p.doi));
  if (p.journal) id.append(el('span', null, p.journal));
  if (p.year) id.append(el('span', null, p.year));
  box.append(id);
  return box;
}

// Which sections the reader has folded away. Held in memory, not storage:
// the panel re-renders on every STATE_CHANGED and would otherwise unfold
// what was just folded, while a fresh panel is meant to open expanded.
const folded = new Set();

// Folding hides the section's body but never its heading, so the count stays
// readable -- that is what says what is hidden. CSS does the hiding, which
// is why no caller has to route its content through a wrapper.
// Called before the heading text so the marker sits first. The marker is a
// bare span -- CSS draws the arrow off .folded, which keeps the glyph out of
// the heading's text.
function foldable(s, head, key) {
  head.append(el('span', 'chev'));
  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');

  const apply = () => {
    const off = folded.has(key);
    s.classList.toggle('folded', off);
    head.setAttribute('aria-expanded', String(!off));
  };
  const toggle = () => {
    if (folded.has(key)) folded.delete(key); else folded.add(key);
    apply();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  apply();
}

function section(title, count) {
  const s = el('div', 'sec');
  const h = el('div', 'shead');
  s.append(h);
  foldable(s, h, title);
  h.append(el('h3', null, title));
  if (count != null) h.append(el('span', 'count', String(count)));
  return s;
}

// Shows the account as Zhihu presents it: nickname, then Zhihu's own label
// (认证 first, 个性签名 second), then the url_token so identical nicknames can
// be told apart. The real name never appears — the binding row is what says
// this account authored the paper.
function authorCard(a) {
  const nick = a.nickname || a.name || a.url_token;
  const card = link('https://www.zhihu.com/people/' + a.url_token, 'auth');
  card.append(el('div', 'av', nick.trim()[0]));
  const info = el('div', 'ainfo');
  info.append(el('span', 'aname', nick));
  info.append(el('span', 'ahead', a.label || '优秀答主'));
  info.append(el('span', 'atok', '@' + a.url_token));
  card.append(info);
  return card;
}

// A pooled question: where it came from, Zhihu's own top answer, and the
// author's own answer when there is one. Both are shown — the top answer is
// usually somebody else's, so marking the row 作者 and showing only that
// would point at the wrong person.
function questionItem(d) {
  const a = link(d.url, 'item');
  a.append(el('div', 'stripe'));
  const body = el('div', 'ibody');

  const kind = el('div', 'ikind');
  kind.append(el('span', 'k', '问题'));
  kind.append(el('span', 'src' + (d.src === 'card' ? ' card' : ''), d.src === 'card' ? '论文卡片' : '标题检索'));
  if (d.authorInvolved) kind.append(el('span', 'byauth', '作者参与'));
  body.append(kind, el('p', 'ititle', d.title));

  const rows = el('div', 'ans');
  const row = (label, ans, cls) => {
    const r = el('div', 'arow' + (cls ? ' ' + cls : ''));
    if (label) r.append(el('span', 'tag', label));
    r.append(el('span', 'who', ans.author || '—'),
             el('span', 'votes', (ans.votes || 0).toLocaleString()),
             el('span', 'up', '赞同'));
    rows.append(r);
  };
  if (d.authorAnswer) row('作者', d.authorAnswer, 'byauthor');
  // Skip the top answer when it is the author's own — it would repeat.
  if (d.top && (!d.authorAnswer || d.top.urlToken !== d.authorAnswer.urlToken)) row('最高', d.top);
  if (!d.top && !d.authorAnswer) rows.append(el('div', 'arow', '暂无回答'));
  body.append(rows);

  a.append(body);
  return a;
}

function discussionItem(d, fuzzy) {
  const a = link(d.url, 'item' + (fuzzy ? ' f' : ''));
  a.append(el('div', 'stripe'));
  const body = el('div', 'ibody');

  const kind = el('div', 'ikind');
  const k = el('span', 'k', d.kind === 'question' ? '问题' : d.kind === 'answer' ? '回答' : '文章');
  kind.append(k);
  if (d.answers?.length) kind.append(el('span', null, ' · ' + d.answers.length + ' 个回答'));
  body.append(kind, el('p', 'ititle', d.title));

  if (d.answers?.length) {
    const list = el('div', 'ans');
    for (const ans of d.answers.slice(0, 3)) {
      const row = el('div', 'arow');
      row.append(el('span', 'who', ans.author),
                 el('span', 'votes', ans.votes.toLocaleString()),
                 el('span', 'up', '赞同'));
      list.append(row);
    }
    body.append(list);
  } else {
    const meta = el('div', 'imeta');
    if (d.author) meta.append(el('span', 'who', d.author));
    if (d.votes != null) meta.append(el('span', 'votes', d.votes.toLocaleString()), el('span', null, '赞同'));
    if (fuzzy && d.score != null) meta.append(el('span', 'score', '相关度 ' + d.score.toFixed(2)));
    body.append(meta);
  }
  a.append(body);
  return a;
}

// Renders 直答's markdown into an element without assigning innerHTML.
//
// md.js escapes every input before it transforms anything and emits only its
// own tags, so the markup is safe either way -- but AMO's validator flags any
// dynamic innerHTML as a rejection risk, and a reviewer should not have to
// take that on trust. DOMParser builds the nodes inert: it runs no script and
// loads nothing, which is why the same call in extract.js draws no warning.
function setMarkdown(el, text) {
  const doc = new DOMParser().parseFromString(renderMarkdown(text || ''), 'text/html');
  el.replaceChildren(...doc.body.childNodes);
}

function zhidaSection(paper, zhida) {
  const s = el('div', 'sec');
  const head = el('div', 'zdhead');
  s.append(head);
  foldable(s, head, '论文解读');
  head.append(el('h3', null, '论文解读'), el('span', 'ai', 'AI 生成'));

  const out = el('div', 'zdbody');
  const placeholder = el('div', 'zdwait', '正在生成…');

  // Disclaimer left, 重新生成 right, directly under the heading -- the body
  // can run long, and a control parked below it is a control nobody finds.
  const meta = el('div', 'zdmeta');
  meta.append(el('span', 'zdnote', '由知乎直答生成，仅供参考。'));
  s.append(meta);

  // Generating opens a real 直答 conversation, which the reader can carry on
  // with. Absent for a 解读 stored before this existed, or one that came from
  // the open platform, which holds no conversation.
  const openChat = (sessionId) => {
    if (!sessionId) return;
    const a = link('https://zhida.zhihu.com/search/' + sessionId, 'pill');
    a.textContent = '前往对话';
    meta.append(a);
  };

  const again = el('button', 'pill', '重新生成');

  // Streams into `placeholder`, which `from` is replaced by, and settles into
  // `out`. Shared by the first generation and by 重新生成, which is held
  // disabled for the duration so a second click cannot open a second stream.
  const generate = (from) => {
    again.disabled = true;
    from.replaceWith(placeholder);
    let received = 0;
    const port = chrome.runtime.connect({ name: 'zhida' });
    port.onMessage.addListener((m) => {
      if (m.delta) {
        received += m.delta.length;
        placeholder.textContent = `正在生成… ${received} 字`;
      }
      if (m.error) {
        placeholder.replaceWith(warn('!', m.error));
        again.disabled = false;
      }
      if (m.done) {
        setMarkdown(out, m.text);
        placeholder.replaceWith(out);
        again.disabled = false;
        openChat(m.sessionId);
      }
    });
    port.postMessage({ paper });
  };

  // Already generated for this paper. Kept for a week in local storage, so
  // this survives a browser restart and an extension reload, not just a tab
  // switch -- and ⟳ re-resolves the pool without discarding it.
  if (zhida?.text) {
    setMarkdown(out, zhida.text);
    openChat(zhida.sessionId);
    again.addEventListener('click', () => generate(out));
    meta.append(again);
    // A regeneration started before this render -- the panel re-renders on
    // every STATE_CHANGED, and this branch outranks the pending one below.
    // Show what the local path shows, so the two cannot disagree.
    if (zhida.pending) { again.disabled = true; s.append(placeholder); }
    else s.append(out);
    return s;
  }

  // Generation in flight from an earlier render; ZHIDA_DONE will refresh us.
  if (zhida?.pending) {
    s.append(placeholder);
    return s;
  }

  const btn = el('button', 'zdgen', '生成直答解读');
  btn.addEventListener('click', () => generate(btn));
  s.append(btn);
  return s;
}

function warn(icon, text) {
  const w = el('div', 'warn');
  w.append(el('span', 'ic', icon), el('span', null, text));
  return w;
}

// Linked lists can get long once an index exists; show the strongest few and
// keep the rest one click away, in both directions.
//
// The rest go in a container appended ahead of the button rather than after
// the visible items, so expanding and collapsing never has to move the button
// -- it keeps its place, and only its label changes.
function collapsingList(parent, items, renderItem, shown) {
  items.slice(0, shown).forEach((d) => parent.append(renderItem(d)));
  if (items.length <= shown) return;

  const rest = items.slice(shown);
  const box = el('div', 'rest');
  const more = el('button', 'zdgen', `展开其余 ${rest.length} 条`);
  more.addEventListener('click', () => {
    const open = box.children.length > 0;
    box.innerHTML = '';
    if (!open) rest.forEach((d) => box.append(renderItem(d)));
    more.textContent = open ? `展开其余 ${rest.length} 条` : '收起';
  });
  parent.append(box, more);
}

// Only 'translating' is conditional -- it appears for a title that has to be
// translated before it can be searched, and not at all for a Chinese one.
const PHASE = {
  translating: '正在翻译标题…',
  fetching: '正在获取结果…',
  ranking: '正在由知乎直答排序…'
};

function searchSection(search, pending) {
  // Nothing has been looked up yet, so 暂无相关讨论 below would be a claim
  // about results that have not been fetched.
  if (pending) {
    const s = section('相关回答/文章');
    s.append(el('div', 'zdwait', '正在获取结果…'));
    return s;
  }
  if (search.layer === 'needs-secret') {
    const s = section('相关回答/文章');
    s.append(warn('!', '知乎搜索暂不可用。'));
    const b = el('button', 'pill', '前往设置');
    b.addEventListener('click', () => chrome.runtime.openOptionsPage());
    s.append(b);
    return s;
  }
  if (search.layer === 'error') {
    const s = section('相关回答/文章');
    s.append(warn('!', '知乎搜索失败：' + (search.error || '未知错误')));
    const b = el('button', 'btn', '重试');
    b.addEventListener('click', refresh);
    s.append(b);
    return s;
  }
  if (search.layer === 'no-title') {
    const s = section('相关回答/文章');
    s.append(warn('!', '未能从页面提取论文标题，无法执行标题检索。'));
    return s;
  }
  if (!search.items.length) {
    const s = section('相关回答/文章');
    const e = el('div', 'empty');
    e.append(el('span', 'big', '知乎上暂无相关讨论'));
    if (search.hidden) e.append(el('p', null, `已隐藏 ${search.hidden} 条低相关度结果`));
    s.append(e);
    return s;
  }
  const s = section('相关回答/文章', search.items.length);
  s.append(warn('!', '以下为按标题检索的结果，可能与本文无关。'));
  collapsingList(s, search.items, (d) => discussionItem(d, true), 3);
  return s;
}

// Firefox does not grant host permissions that an update adds, and says
// nothing about it: a publisher supported in a later release simply never
// fires, and the panel reports no paper on a page that plainly has one. The
// manifest is the list of what we meant to have, so the gap is computable.
// Chrome grants everything at install, so this finds nothing there.
let ungranted = [];

/** The host as the browser words it: 'arxiv.org', or '*.bmj.com' for a domain. */
const hostOf = (pattern) => (/^(?:\*|https?):\/\/([^/]*)/.exec(pattern) || [])[1] || pattern;

async function findUngranted(url) {
  ungranted = [];
  if (!url) return;
  try {
    const m = chrome.runtime.getManifest();
    const declared = [...new Set([
      ...(m.host_permissions || []),
      ...(m.content_scripts || []).flatMap((c) => c.matches || [])
    ])];
    // Only what covers the page in front of the reader. Naming some other
    // site, on a page where everything works, is noise -- and the sentence
    // below would be false.
    const here = declared.filter((o) => covers(o, url));
    if (!here.length) return;
    // contains(), not getAll(). getAll().origins reports a granted origin as
    // the pattern that was declared, so comparing a declared pattern against
    // that list is string equality: https://arxiv.org/abs/* is held but never
    // listed under that spelling. contains() matches patterns against what is
    // actually held, which is the question being asked.
    const held = await Promise.all(
      here.map((o) => chrome.permissions.contains({ origins: [o] }).catch(() => true))
    );
    ungranted = here.filter((o, i) => !held[i]);
  } catch (e) {
    ungranted = [];   // no permissions API, nothing to report
  }
}

// Almost everything here needs a signed-in Zhihu: search, ranking, 论文解读
// and the author lookups all travel on the reader's own cookies. Signed out,
// the panel used to identify the paper and then quietly fail at the rest,
// which reads as broken rather than as logged out.
let signedOut = false;

async function checkSignedIn() {
  try {
    const c = await chrome.cookies.get({ url: 'https://www.zhihu.com', name: 'z_c0' });
    signedOut = !c;
  } catch (e) {
    signedOut = false;   // cannot tell, so do not claim
  }
}

function signInSection() {
  const s = section('需要登录知乎');
  s.append(el('div', 'zdnote', '未检测到知乎登录状态，无法获取相关问题与论文解读。'));
  const a = link('https://www.zhihu.com/signin', 'pill');
  a.textContent = '前往登录';
  s.append(a);
  return s;
}

/** The site this page needs, and the one gesture that grants it. */
function permissionSection() {
  const hosts = [...new Set(ungranted.map(hostOf))];
  const s = section('需要授权');
  s.append(el('div', 'zdnote', '浏览器尚未授权 ' + hosts.join('、')));
  const btn = el('button', 'pill', '前往授权');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    // Must be called from a click: the browser wants a live user gesture.
    // Firefox resolves these patterns to one grant per host, so a page under
    // *.bmj.com asks for the bmj.com domain rather than this subdomain alone.
    try { await chrome.permissions.request({ origins: ungranted }); } catch (e) { /* declined */ }
    refresh();
  });
  s.append(btn);
  return s;
}

function renderInner(state) {
  current = state;
  root.innerHTML = '';
  foot.hidden = true;

  // Before anything else: with a site ungranted, or no Zhihu session, every
  // section below would be empty and none of them could say why.
  if (ungranted.length) root.append(permissionSection());
  if (signedOut) root.append(signInSection());

  if (!state?.paper) {
    // The list used to be written out here and had gone stale -- six names
    // against twenty-eight sites. It lives where it can be kept current.
    const ph = el('div', 'placeholder');
    ph.append(el('p', 'big', '未识别到论文'));
    const where = el('p');
    const a = link(SUPPORTED_URL, null);
    a.textContent = SUPPORTED_URL.replace(/^https?:\/\//, '');
    where.append(document.createTextNode('请前往 '), a,
                 document.createTextNode(' 查看目前支持的期刊/出版社/预印本平台。'));
    ph.append(where);
    root.append(ph);
    return;
  }

  const { paper } = state;
  // null while the first pass is still running, so the header and the
  // progress note can render before there is anything to put under them.
  const resolution = state.resolution || {};

  // Tolerate a resolution from an older service worker: a shape mismatch
  // should cost detail, never blank the panel below the first section.
  const linked = resolution.linked || resolution.items || [];
  const search = resolution.search || {
    layer: resolution.layer, items: resolution.items || [],
    hidden: resolution.hidden, error: resolution.error
  };

  root.append(paperHeader(paper));

  // Signed out, every section below is about things we could not look up.
  // Rendering them empty makes the panel assert that Zhihu has no discussion
  // of this paper, when in fact it was never asked. The paper itself still
  // identifies, which is the one thing that needs no session.
  if (signedOut) {
    document.getElementById('primary').disabled = true;
    document.getElementById('ask').disabled = true;
    foot.hidden = false;
    return;
  }

  if (resolution.authors?.length) {
    const s = section('本文作者在知乎', resolution.authors.length);
    resolution.authors.forEach((a) => s.append(authorCard(a)));
    root.append(s);
  }

  // Nothing is listed until the ranking is in. The provisional order exists
  // in state and is good enough to show, but a list that silently reshuffles
  // itself five seconds after the reader starts on it is worse than a wait.
  const phase = state.phase;
  if (linked.length || phase) {
    const s = section('相关问题', phase ? null : linked.length);
    if (resolution.conflict) s.append(warn('i', '匹配到多篇论文，以下结果可能与本文无关。'));
    // 部分, not 以下: this list mixes 论文卡片 rows, which Zhihu linked to the
    // paper itself, with 标题检索 ones that may have nothing to do with it.
    // Dropped entirely when every row came from the card, where the caveat
    // would be false.
    if (!phase && linked.some((d) => d.src !== 'card')) {
      s.append(warn('!', '以下部分为按标题检索的结果，可能与本文无关。'));
    }
    if (phase) s.append(el('div', 'zdwait', PHASE[phase] || PHASE.fetching));
    else collapsingList(s, linked, questionItem, 3);
    root.append(s);
  }

  root.append(searchSection(search, !state.resolution));
  root.append(zhidaSection(paper, state.zhida));

  // 参与讨论 opens the top-ranked question, so it stays disabled until the
  // ranking is in -- otherwise it would act on the provisional order the
  // panel is deliberately not showing -- and when there is nothing to open.
  document.getElementById('primary').disabled = !!state.phase || !linked.length;
  // 发起提问 drafts its candidates through 直答, which needs the reader's
  // session just as much as the rest.
  document.getElementById('ask').disabled = signedOut;
  foot.hidden = false;
}

function render(state) {
  try {
    renderInner(state);
  } catch (e) {
    // Without this a render error truncates the panel with no explanation.
    console.error('[知乎论文助手] render failed', e);
    root.append(warn('!', '面板渲染失败：' + e.message + '（请在 chrome://extensions 重新加载扩展）'));
    foot.hidden = false;
  }
}

async function refresh() {
  // render() guards what it draws; this guards getting there at all. Without
  // it a rejection here leaves the panel blank, with the reason only in a
  // console the reader has no easy way to open.
  try {
    // Resolve the tab here: the panel has a real window, the worker does not.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await Promise.all([findUngranted(tab?.url), checkSignedIn()]);
    const state = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: tab?.id });
    render(state);
  } catch (e) {
    console.error('[知乎论文助手] refresh failed', e);
    root.innerHTML = '';
    if (ungranted.length) root.append(permissionSection());
    root.append(warn('!', '面板加载失败：' + e.message));
    foot.hidden = true;
  }
}

document.getElementById('primary').addEventListener('click', () => {
  // linked is ranked by the time this is clickable, so the first entry is
  // the top-ranked question.
  const q = (current?.resolution?.linked || [])[0];
  if (q) chrome.tabs.create({ url: q.url });
});

// Composing needs no existing discussion, so this is always available. The
// dialog opens on the paper page, where there is room for five candidates
// and an abstract-sized body.
document.getElementById('ask').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'OPEN_COMPOSE', tabId: tab?.id });
});

document.getElementById('refresh').addEventListener('click', async () => {
  const btn = document.getElementById('refresh');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('spin');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({ type: 'REFRESH', tabId: tab?.id });
  } finally {
    btn.disabled = false;
    btn.classList.remove('spin');
  }
});

document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'STATE_CHANGED' || m.type === 'ZHIDA_DONE') refresh(); });
chrome.tabs.onActivated.addListener(refresh);
refresh();

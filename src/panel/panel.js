import { renderMarkdown } from './md.js';

const root = document.getElementById('root');
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

function paperHeader(p) {
  const box = el('div', 'paper');
  const src = el('span', 'src');
  src.innerHTML = '当前页面 · <b></b>';
  src.querySelector('b').textContent = p.source;
  box.append(src, el('p', 'ptitle', p.title || '(无标题)'));
  if (p.authors?.length) box.append(el('p', 'pauth', p.authors.join(' · ')));
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

  const again = el('button', 'zdagain', '重新生成');

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
        out.innerHTML = renderMarkdown(m.text || '');
        placeholder.replaceWith(out);
        again.disabled = false;
      }
    });
    port.postMessage({ paper });
  };

  // Already generated for this paper. Kept for a week in local storage, so
  // this survives a browser restart and an extension reload, not just a tab
  // switch -- and ⟳ re-resolves the pool without discarding it.
  if (zhida?.text) {
    out.innerHTML = renderMarkdown(zhida.text);
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

// Linked lists can get long once an index exists; show the strongest few
// and keep the rest one click away.
function collapsingList(parent, items, renderItem, shown) {
  items.slice(0, shown).forEach((d) => parent.append(renderItem(d)));
  if (items.length <= shown) return;
  const rest = items.slice(shown);
  const more = el('button', 'zdgen', `展开其余 ${rest.length} 条`);
  more.addEventListener('click', () => {
    more.remove();
    rest.forEach((d) => parent.append(renderItem(d)));
  });
  parent.append(more);
}

function searchSection(search, pending) {
  // Nothing has been looked up yet, so 暂无相关讨论 below would be a claim
  // about results that have not been fetched.
  if (pending) {
    const s = section('相关回答/文章');
    s.append(el('div', 'zdwait', '正在获取结果…'));
    return s;
  }
  if (search.layer === 'needs-secret') {
    const s = el('div', 'sec');
    s.append(warn('!', '未配置 Access Secret，无法使用知乎搜索与直答。'));
    const b = el('button', 'btn pri', '去设置');
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
  collapsingList(s, search.items, (d) => discussionItem(d, true), 5);
  return s;
}

function renderInner(state) {
  current = state;
  root.innerHTML = '';
  foot.hidden = true;

  if (!state?.paper) {
    root.append(Object.assign(el('div', 'placeholder'), {
      innerHTML: '<p class=\'big\'>未识别到论文</p><p>支持 arXiv、SSRN、NBER、JSTOR、IEEE、PubMed 及主要出版社平台。</p>'
    }));
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
    if (phase) s.append(el('div', 'zdwait', phase === 'fetching' ? '正在获取结果…' : '正在由知乎直答排序…'));
    else collapsingList(s, linked, questionItem, 5);
    root.append(s);
  }

  root.append(searchSection(search, !state.resolution));
  root.append(zhidaSection(paper, state.zhida));

  // 参与讨论 opens the top-ranked question, so it stays disabled until the
  // ranking is in -- otherwise it would act on the provisional order the
  // panel is deliberately not showing -- and when there is nothing to open.
  document.getElementById('primary').disabled = !!state.phase || !linked.length;
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
  // Resolve the tab here: the panel has a real window, the worker does not.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const state = await chrome.runtime.sendMessage({ type: 'GET_STATE', tabId: tab?.id });
  render(state);
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

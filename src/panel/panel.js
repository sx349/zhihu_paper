import { renderMarkdown } from './md.js';

const root = document.getElementById('root');
const foot = document.getElementById('foot');
const dlg = document.getElementById('fbdlg');
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

function section(title, count, note) {
  const s = el('div', 'sec');
  const h = el('div', 'shead');
  h.append(el('h3', null, title));
  if (count != null) h.append(el('span', 'count', String(count)));
  // The pool arrives in about a second but 直答 takes another six to order
  // it, so the heading says which of the two is still running.
  if (note) h.append(el('span', 'note', note));
  s.append(h);
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
  head.append(el('h3', null, '论文解读'), el('span', 'ai', 'AI 生成'));
  s.append(head);

  const out = el('div', 'zdbody');
  const note = el('div', 'zdnote', '由知乎直答生成，仅供参考。');

  // Already generated for this paper (survives tab switches via session storage).
  if (zhida?.text) {
    out.innerHTML = renderMarkdown(zhida.text);
    s.append(out, note);
    return s;
  }

  const placeholder = el('div', 'zdwait', '正在生成…');

  // Generation in flight from an earlier render; ZHIDA_DONE will refresh us.
  if (zhida?.pending) {
    s.append(placeholder, note);
    return s;
  }

  const btn = el('button', 'zdgen', '生成直答解读');
  btn.addEventListener('click', () => {
    btn.replaceWith(placeholder);
    let received = 0;
    const port = chrome.runtime.connect({ name: 'zhida' });
    port.onMessage.addListener((m) => {
      if (m.delta) {
        received += m.delta.length;
        placeholder.textContent = `正在生成… ${received} 字`;
      }
      if (m.error) {
        placeholder.replaceWith(warn('!', m.error));
      }
      if (m.done) {
        out.innerHTML = renderMarkdown(m.text || '');
        placeholder.replaceWith(out);
      }
    });
    port.postMessage({ paper });
  });

  s.append(btn, note);
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

function searchSection(search) {
  if (search.layer === 'needs-secret') {
    const s = el('div', 'sec');
    s.append(warn('!', '未配置 Access Secret，无法使用知乎搜索与直答。'));
    const b = el('button', 'btn pri', '去设置');
    b.addEventListener('click', () => chrome.runtime.openOptionsPage());
    s.append(b);
    return s;
  }
  if (search.layer === 'error') {
    const s = section('按标题检索');
    s.append(warn('!', '知乎搜索失败：' + (search.error || '未知错误')));
    const b = el('button', 'btn', '重试');
    b.addEventListener('click', refresh);
    s.append(b);
    return s;
  }
  if (search.layer === 'no-title') {
    const s = section('按标题检索');
    s.append(warn('!', '未能从页面提取论文标题，无法执行标题检索。'));
    return s;
  }
  if (!search.items.length) {
    const s = section('按标题检索');
    const e = el('div', 'empty');
    e.append(el('span', 'big', '知乎上暂无相关讨论'));
    if (search.hidden) e.append(el('p', null, `已隐藏 ${search.hidden} 条低相关度结果`));
    s.append(e);
    return s;
  }
  const s = section('按标题检索', search.items.length);
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

  const phase = state.phase;
  if (linked.length || phase) {
    const note = phase === 'fetching' ? '正在获取结果…'
               : phase === 'ranking'  ? '正在用知乎直答排序…'
               : null;
    const s = section('关联讨论', linked.length || null, note);
    if (resolution.conflict) s.append(warn('i', '匹配到多篇论文，以下结果可能与本文无关。'));
    if (linked.length) collapsingList(s, linked, questionItem, 5);
    else if (phase) s.append(el('div', 'empty', '正在查找…'));
    root.append(s);
  }

  root.append(searchSection(search));
  root.append(zhidaSection(paper, state.zhida));
  // Only a question is somewhere a reader can add to. Linked articles and
  // answers are still listed, but they don't count as a place to discuss.
  const questions = linked.filter((d) => d.kind === 'question');

  document.getElementById('primary').textContent =
    questions.length ? '去知乎讨论' : '去知乎提问';
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

// feedback
document.querySelectorAll('.tb').forEach((b) => {
  b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') === 'true';
    b.parentElement.querySelectorAll('.tb').forEach((s) => s.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', on ? 'false' : 'true');
    if (on) return;
    chrome.runtime.sendMessage({
      type: 'FEEDBACK',
      record: { paperId: current?.paper?.id, layer: current?.resolution?.layer, verdict: b.dataset.v }
    });
  });
});

document.getElementById('report').addEventListener('click', () => dlg.showModal());
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'send') return;
  const note = document.getElementById('fbtext').value.trim();
  if (!note) return;
  chrome.runtime.sendMessage({
    type: 'FEEDBACK',
    record: { paperId: current?.paper?.id, layer: current?.resolution?.layer, verdict: 'note', note }
  });
  document.getElementById('fbtext').value = '';
});

document.getElementById('primary').addEventListener('click', async () => {
  const r = current?.resolution;
  // linked is already ranked, so the first question in it is the top-ranked one.
  const q = (r?.linked || []).find((d) => d.kind === 'question');
  if (q) {
    chrome.tabs.create({ url: q.url });
    return;
  }
  // No question to join — compose one. The dialog opens on the paper page,
  // where there is room for five candidates and an abstract-sized body.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.runtime.sendMessage({ type: 'OPEN_COMPOSE', tabId: tab?.id });
});

document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'STATE_CHANGED' || m.type === 'ZHIDA_DONE') refresh(); });
chrome.tabs.onActivated.addListener(refresh);
refresh();

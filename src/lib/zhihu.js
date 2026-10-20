// Zhihu open-platform client. Runs in the service worker, where
// host_permissions let us call developer.zhihu.com without CORS trouble.
//
// The Access Secret is user-supplied and lives in chrome.storage. Once Zhihu
// hosts this behind their own backend, only BASE and headers() change.

const BASE = 'https://developer.zhihu.com';

export async function getSecret() {
  const { accessSecret } = await chrome.storage.local.get('accessSecret');
  return accessSecret || '';
}

async function headers() {
  const secret = await getSecret();
  if (!secret) throw new Error('NO_SECRET');
  return {
    Authorization: 'Bearer ' + secret,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type': 'application/json'
  };
}

const strip = (h) => String(h || '').replace(/<[^>]+>/g, '');

/**
 * Title search through Zhihu's web API with the user's cookies. No secret,
 * no signed header (verified from the worker context). Returns richer rows
 * than the open platform — author url_token, question id and votes are
 * fields — but no relevance score, so order is Zhihu's own ranking.
 */
export async function searchZhihuWeb(query, count = 10) {
  const url = new URL('https://www.zhihu.com/api/v4/search_v3');
  url.searchParams.set('t', 'general');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(count));
  url.searchParams.set('offset', '0');
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('search_v3 HTTP ' + res.status);
  const json = await res.json();

  return (json.data || [])
    .filter((d) => d.type === 'search_result' && d.object)
    .map((d) => d.object)
    .filter((o) => o.type === 'answer' || o.type === 'article')
    .map((o) => {
      // Ids are 19-digit and arrive as strings; they must never pass through
      // a Number, which would round them.
      const id = String(o.id);
      const qid = o.question?.id != null ? String(o.question.id) : '';
      return {
        kind: o.type,
        title: strip(o.type === 'answer' ? o.question?.name : o.title),
        url: o.type === 'answer'
          ? 'https://www.zhihu.com/question/' + qid + '/answer/' + id
          : 'https://zhuanlan.zhihu.com/p/' + id,
        excerpt: strip(o.excerpt).slice(0, 160),
        author: strip(o.author?.name),   // matched terms are <em>-highlighted here too
        authorToken: o.author?.url_token || '',
        votes: o.voteup_count || 0,
        questionId: qid
      };
    });
}

/**
 * The same search, reduced to distinct questions, for the 相关问题 pool.
 *
 * There is no question vertical to ask for: t=question, t=answer and
 * t=article all return zero rows, and Zhihu's own search UI has no 问题 tab,
 * so the filtering is ours to do. Answers carry their question, articles are
 * dropped here (they keep their place in 相关回答/文章).
 *
 * Two pages, because one is not enough and three is too many: page 1 of a
 * worked example yielded 4 questions, page 2 took it to 11 and completed
 * every question the hand-built seed had, and pages 3-4 added 21 more
 * without a single further hit.
 */
export async function searchQuestionsWeb(query, pages = 2) {
  const byQid = new Map();
  for (let page = 0; page < pages; page++) {
    const url = new URL('https://www.zhihu.com/api/v4/search_v3');
    url.searchParams.set('t', 'general');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', '20');
    url.searchParams.set('offset', String(page * 20));
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) break;
    const json = await res.json();

    for (const o of (json.data || []).filter((d) => d.object).map((d) => d.object)) {
      if (o.type !== 'answer') continue;
      const qid = o.question?.id != null ? String(o.question.id) : '';
      if (!qid) continue;
      const prev = byQid.get(qid);
      const votes = o.voteup_count || 0;
      if (!prev || votes > prev.votes) {
        byQid.set(qid, {
          kind: 'question',
          qid,
          title: strip(o.question?.name),
          url: 'https://www.zhihu.com/question/' + qid,
          votes,
          src: 'search'
        });
      }
    }
  }
  return [...byQid.values()];
}

/**
 * Top answers for a question, in Zhihu's own order.
 *
 * This is /feeds, not /answers. /answers ignores sort_by entirely — default,
 * voteups, voteup_count and score return byte-identical rows — and serves a
 * slice that omits the top answers outright: on question 14073117334 it leads
 * with a 381-vote answer and never shows the 5939-vote one. /feeds matches
 * what the question page itself renders, including Zhihu's ranking, which is
 * not vote order and must not be re-sorted here — the panel has to agree with
 * the page the reader lands on.
 */
export async function questionAnswers(qid, limit = 20) {
  const url = new URL('https://www.zhihu.com/api/v4/questions/' + qid + '/feeds');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('cursor', '');
  url.searchParams.set('include', 'data[*].target.voteup_count,data[*].target.author');
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('feeds HTTP ' + res.status);
  const json = await res.json();

  return (json.data || []).map((row) => {
    const a = row.target || row;
    return {
      author: strip(a.author?.name),
      urlToken: a.author?.url_token || '',
      votes: a.voteup_count || 0,
      url: 'https://www.zhihu.com/question/' + qid + '/answer/' + String(a.id || '')
    };
  });
}

/** Fuzzy title search — the L2 fallback when the paper index has no entry. */
export async function searchZhihu(query, count = 8) {
  const url = new URL(BASE + '/api/v1/content/zhihu_search');
  url.searchParams.set('Query', query);
  url.searchParams.set('Count', String(Math.min(count, 10)));
  const res = await fetch(url, { headers: await headers() });
  const json = await res.json();
  if (json.Code !== 0) throw new Error(json.Message || 'search failed');

  return (json.Data?.Items || []).map((it) => ({
    kind: it.ContentType === 'Answer' ? 'answer' : 'article',
    title: (it.Title || '').replace(/\s*-\s*知乎$/, ''),
    url: (it.Url || '').split('?')[0],
    excerpt: (it.ContentText || '').slice(0, 160),
    author: it.AuthorName,
    authorToken: it.AuthorSignature || '',
    votes: it.VoteUpCount || 0,
    score: it.RankingScore || 0,
    questionId: (it.Url || '').match(/question\/(\d+)/)?.[1] || ''
  }));
}

/**
 * 知乎直答. Streams so a narrow panel shows text immediately rather than
 * sitting blank; onChunk receives incremental content.
 */
export async function zhida(prompt, onChunk, model = 'zhida-fast-1p5') {
  const res = await fetch(BASE + '/v1/chat/completions', {
    method: 'POST',
    headers: await headers(),
    body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) throw new Error('直答 HTTP ' + res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;      // skips ": keep-alive"
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return full;
      try {
        const obj = JSON.parse(payload);
        if (obj.error) throw new Error(obj.error.message || '直答 error');
        const delta = obj.choices?.[0]?.delta?.content;
        if (delta) { full += delta; onChunk(delta); }
      } catch (e) {
        if (e.message?.includes('直答')) throw e;   // real error, not a partial line
      }
    }
  }
  return full;
}

/**
 * 知乎直答 through the web endpoint the site itself uses, with cookies.
 * Empty session_id starts a session (the Init event returns one). Answer
 * events carry text deltas in `summary`, wrapped in <mark> for highlights.
 */
export async function zhidaWeb(prompt, onChunk) {
  const res = await fetch('https://zhida.zhihu.com/ai_ingress/stream/completion', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({
      knowledge_ids: ['KBT_GLOBAL', 'KBT_ZHIHU', 'KBT_PAPER'],
      quiz_type: 'QT_CHAT', attachments: [], message_source_type: 'text',
      session_id: '', zhida_source: 'zhida', chat_mode: 'FAST',
      // What the site itself sends. Measured against 'ai_search_general' it is
      // no faster -- chat_model is in fact ignored outright, a garbage value
      // returns 200 and a usable answer -- but matching the site keeps us off
      // whatever path the ai_search_general source selects.
      chat_model: 'CM_DEEP_SEEK_R1',
      message_content: prompt, push_interval: 50
    })
  });
  if (!res.ok) throw new Error('直答 HTTP ' + res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let obj;
      try { obj = JSON.parse(line.slice(5).trim()); } catch (e) { continue; }
      if (obj.event !== 'Answer') continue;
      const delta = strip(obj.data?.summary || '');
      if (delta) { full += delta; onChunk(delta); }
    }
  }
  return full;
}

// Zhihu's own editorial prompt for turning a paper into a public question.
// It emits five candidates and the reader picks: asked to choose for itself the
// model returned worse than its own pool — a 44-character platform-led title
// when every candidate it had generated was clean and under 25. Rule 9 bans
// 如何评价/如何看待, the framing this extension used to hard-code, as too plain.
const QUESTION_PROMPT = [
  '# 角色',
  '你是一名知乎科学问题编辑，负责将用户正在阅读的论文转化为适合公开讨论的知乎提问。',
  '',
  '# 任务',
  '基于以下论文信息，提取最具讨论价值的核心信息，先拟出 5 条候选提问，再从中选出最值得公众讨论的 1 条输出。',
  '',
  '优先选择具备公众关联、时效性和讨论空间的内容，引导用户讨论研究的意义、证据可信度、结论边界、现实影响和应用空间。',
  '',
  '# 提问要求',
  '1. 每条提问控制在 30 字以内，由「研究事实 + 讨论问题」构成；',
  '2. 前半句简要陈述论文的研究对象、关键发现或核心数据，后半句设置问题；',
  '3. 忠实呈现原文，采用「论文提出」「研究发现」「数据显示」等客观表达；',
  '4. 区分预印本、同行评议论文、动物实验、观察性研究和临床研究；',
  '5. 论文仅证明相关关系时，禁止改写为因果关系；',
  '6. 提问可考虑研究的意义、方法、边界、影响或应用，选择最值得公众讨论的角度切入；',
  '7. 降低理解门槛，解释生僻概念，使用简单、明白、自然的语言；',
  '8. 避免情绪化表达、立场预设、结论夸大和矛盾挑拨；',
  '9. 避免使用「如何评价」「如何看待」，优先使用「意味着什么」「可信度如何」「可能带来哪些影响」「距离实际应用还有多远」等表达；',
  '10. 信息不足时仅使用论文已有内容，禁止额外补充或猜测结论；',
  '11. 汉字与英文、数字之间保留一个半角空格，英文大小写准确，中文引号使用「」。',
  '',
  '# 错误示例',
  '下列提问是错误的，不得模仿：',
  '论文在 arXiv 发布希尔伯特第六问题突破，可信度如何',
  ''
].join('\n');

// Venue is name + year only. Naming the publication stage here (e.g.
// 'arXiv（预印本）') made the model use the platform as the sentence subject —
// 'arXiv 预印本从硬球系统推导出…', which nobody writes. Rule 4 still asks it to
// distinguish preprints, and it does so from the venue name and link.
function venueLine(paper) {
  const name = paper.journal || paper.source || '';
  return name + (paper.year ? '，' + paper.year : '');
}

function idLine(paper) {
  const ids = [paper.arxivId ? 'arXiv:' + paper.arxivId : '', paper.doi ? 'DOI:' + paper.doi : ''].filter(Boolean);
  const link = paper.doi ? 'https://doi.org/' + paper.doi : paper.url;
  return ids.concat(link).join(' ');
}

export function questionPrompt(paper) {
  return QUESTION_PROMPT + [
    '# 输入',
    '论文标题：' + paper.title,
    paper.abstract ? '论文摘要：' + paper.abstract : '',
    paper.authors?.length ? '作者：' + paper.authors.join(', ') : '',
    '发表平台及时间：' + venueLine(paper),
    '论文标识及链接：' + idLine(paper),
    '',
    '# 输出',
    '输出全部 5 条候选提问，每行一条，用 1. 2. 3. 4. 5. 编号，不输出分析、说明或标签。'
  ].filter(Boolean).join('\n');
}

// Zhihu titles must end in a question mark; the model omits it perhaps half
// the time, so it is appended rather than made a 12th rule.
function parseCandidates(raw) {
  return String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[.、)]/.test(l))
    .map((l) => l.replace(/^\d+[.、)]\s*/, '').replace(/^[「"'《]+|[」"'》]+$/g, '').trim())
    .filter(Boolean)
    .map((q) => (/[？?]$/.test(q) ? q : q.replace(/[。.，,]$/, '') + '？'));
}

/** Five candidate questions for one paper; [] on any failure. */
export async function draftQuestionCandidates(paper) {
  if (!paper?.title) return [];
  const prompt = questionPrompt(paper);
  try {
    return parseCandidates(await zhidaWeb(prompt, () => {}));
  } catch (e) { /* fall through to the open platform if a secret exists */ }
  if (!(await getSecret())) return [];
  try {
    const res = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ model: 'zhida-fast-1p5', stream: false, messages: [{ role: 'user', content: prompt }] })
    });
    if (!res.ok) return [];
    const json = await res.json();
    return parseCandidates(json.choices?.[0]?.message?.content);
  } catch (e) {
    return [];
  }
}

/** Deterministic prompt. Abstract is included when the page gave us one. */
export function zhidaPrompt(paper) {
  const bits = [
    '请解读这篇论文：',
    '标题：' + paper.title,
    paper.authors?.length ? '作者：' + paper.authors.join(', ') : '',
    paper.arxivId ? 'arXiv：' + paper.arxivId : '',
    paper.doi ? 'DOI：' + paper.doi : '',
    paper.journal ? '期刊：' + paper.journal : '',
    paper.abstract ? '\n摘要：' + paper.abstract.slice(0, 1200) : '',
    '\n请说明：这篇论文要解决什么问题、核心方法是什么、相比已有工作推进在哪里。'
  ];
  return bits.filter(Boolean).join('\n');
}

/**
 * The 补充说明 body: the minimum that identifies the work, plus the abstract
 * when the page or Crossref gave one. The title is no longer generated here —
 * the reader picks a candidate and edits it in the compose modal.
 */
export function questionBody(paper) {
  const venue = paper.journal || (paper.arxivId ? 'arXiv' : '');
  const link = paper.doi ? 'https://doi.org/' + paper.doi : paper.url;
  const lines = [
    '论文：' + paper.title,
    paper.authors?.length ? '作者：' + paper.authors.join(', ') : '',
    venue ? '期刊：' + venue + (paper.year ? '（' + paper.year + '）' : '') : '',
    '链接：' + link
  ].filter(Boolean);
  if (paper.abstract) lines.push('', '摘要：' + paper.abstract);
  return lines.join('\n');
}

// Ordering the pooled discussions by how closely they read on the paper.
//
// relevance_score from the paper index is too coarse to rank on: measured
// values are only 80/90/95/100, and 95 covers both「transformer 中 embedding
// 层输出为什么要乘上 sqrt(d_k)」and「一作是印度人」. 直答 separates those
// reliably, but a single round is unstable once the pool passes ~15 items —
// three rounds and a positional aggregate hold the top of the list steady.

import { zhidaWebTurn, zhida, getSecret } from './zhihu.js';

const ROUNDS = 3;

// 直答 answers with its own product blurb instead of the task when it does
// not want to engage with the message. It is a 200 with a body, not an error,
// so nothing upstream notices -- parseOrder simply rejects it.
const CANNED = '我是知乎直答';

const ASK = '请判断每个问题与这篇论文本身内容的相关程度，按相关度从高到低排序。不相关的排在最后。只输出序号，用英文逗号分隔，不要输出任何其他文字。例如：3,1,5,2';

function prompt(paper, pool) {
  return `下面是一篇论文，以及知乎上若干个可能与它相关的问题。

论文标题：${paper.title || ''}
论文摘要：${(paper.abstract || '').slice(0, 1200)}

问题列表：
${pool.map((p, i) => `${i + 1}. ${p.title}`).join('\n')}

${ASK}`;
}

/**
 * A round counts only if it names every item exactly once. The model does
 * occasionally repeat an index, which dedupe repairs; anything still short or
 * out of range is discarded rather than guessed at.
 */
export function parseOrder(text, n) {
  const seen = new Set();
  for (const part of String(text || '').split(',')) {
    const v = parseInt(part.trim(), 10);
    if (v >= 1 && v <= n) seen.add(v);
  }
  return seen.size === n ? [...seen] : null;
}

/** Sum of positions across rounds; lower is more relevant. */
export function borda(orders, n) {
  const pts = new Map();
  for (const order of orders) order.forEach((id, i) => pts.set(id, (pts.get(id) || 0) + i));
  return [...Array(n).keys()]
    .map((i) => i + 1)
    .sort((a, b) => (pts.get(a) ?? Infinity) - (pts.get(b) ?? Infinity));
}

/**
 * The order the panel shows when 直答 could not rank at all.
 *
 * It fails more often than it looks: an unrecognised prompt, or one carrying
 * a rival product's name -- "moonshot" and "ai code" both do it -- comes back
 * as 直答's own product blurb, which parseOrder rejects, and two rejected
 * rounds leave nothing to aggregate.
 *
 * Author-involved first, then the questions Zhihu itself linked to the paper,
 * then the rest. Ties keep the order they arrived in, which is the paper
 * index's own and then Zhihu's search ranking -- both better priors than the
 * vote count this used to fall back on. Votes promote whatever is popular,
 * and on a pool that is mostly noise, the most popular rows are the noise.
 */
export function fallbackOrder(items) {
  const rank = (q) => (q.authorInvolved ? 0 : 2) + (q.src === 'card' ? 0 : 1);
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/**
 * 直答 is handed the pool before it is hydrated, so the items it returns are
 * the pre-hydration objects. This reapplies that order to the hydrated list
 * by qid. Anything the order does not name keeps the tail rather than being
 * dropped -- rankByZhida only returns full permutations, but losing a
 * question to a mismatch between two modules would be silent.
 */
export function reorderByQid(ordered, hydrated) {
  const left = new Map(hydrated.map((q) => [q.qid, q]));
  const out = [];
  for (const o of ordered) {
    const h = left.get(o.qid);
    if (h) { out.push(h); left.delete(o.qid); }
  }
  return [...out, ...left.values()];
}

/**
 * Returns the pool reordered, or null when 直答 could not be reached or
 * agreed on too little — the caller then keeps whatever order it had.
 */
export async function rankByZhida(paper, pool) {
  if (pool.length < 2) return null;
  const p = prompt(paper, pool);

  // What 直答 refuses is decided by the final user message alone, and the
  // trigger is cumulative rather than any one item -- a pool of 18 can pass
  // where one of 9 fails, and no single question explains it. A refusal still
  // leaves the list in that session's history, where it is not classified, so
  // asking again with nothing but the instruction gets a real answer. Costs
  // one extra request, and only on a round that was refused.
  const once = async () => {
    try {
      const { text, sessionId } = await zhidaWebTurn(p, () => {});
      if (!text.includes(CANNED) || !sessionId) return text;
      return (await zhidaWebTurn('上面问题列表中，' + ASK, () => {}, sessionId)).text;
    } catch (e) {
      if (!(await getSecret())) throw e;
      return await zhida(p, () => {});
    }
  };

  const settled = await Promise.allSettled(Array.from({ length: ROUNDS }, once));
  const orders = settled
    .filter((s) => s.status === 'fulfilled')
    .map((s) => parseOrder(s.value, pool.length))
    .filter(Boolean);

  // One round is the unstable case this exists to avoid; below two, the
  // caller's own order is the safer answer.
  if (orders.length < 2) return null;
  return borda(orders, pool.length).map((i) => pool[i - 1]);
}

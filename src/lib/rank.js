// Ordering the pooled discussions by how closely they read on the paper.
//
// relevance_score from the paper index is too coarse to rank on: measured
// values are only 80/90/95/100, and 95 covers both「transformer 中 embedding
// 层输出为什么要乘上 sqrt(d_k)」and「一作是印度人」. 直答 separates those
// reliably, but a single round is unstable once the pool passes ~15 items —
// three rounds and a positional aggregate hold the top of the list steady.

import { zhidaWeb, zhida, getSecret } from './zhihu.js';

const ROUNDS = 3;

function prompt(paper, pool) {
  return `下面是一篇论文，以及知乎上若干个可能与它相关的问题。

论文标题：${paper.title || ''}
论文摘要：${(paper.abstract || '').slice(0, 1200)}

问题列表：
${pool.map((p, i) => `${i + 1}. ${p.title}`).join('\n')}

请判断每个问题与这篇论文本身内容的相关程度，按相关度从高到低排序。不相关的排在最后。只输出序号，用英文逗号分隔，不要输出任何其他文字。例如：3,1,5,2`;
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
 * Returns the pool reordered, or null when 直答 could not be reached or
 * agreed on too little — the caller then keeps whatever order it had.
 */
export async function rankByZhida(paper, pool) {
  if (pool.length < 2) return null;
  const p = prompt(paper, pool);

  const once = async () => {
    try {
      return await zhidaWeb(p, () => {});
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

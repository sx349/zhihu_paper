// Fills Zhihu's 提问 modal with a drafted question.
//
// There is no create-question API, so we drive the real form. Two wrinkles
// found in the live markup:
//   - the title is a React-controlled <textarea>, so assigning .value is
//     ignored; the native setter plus an input event is what registers.
//   - the body is Draft.js, which keeps its own EditorState. textContent
//     does nothing. Focus + execCommand('insertText') is what Draft listens for.
// The body field also does not exist until the title is non-empty, so the
// sequence matters.
//
// We never submit. The draft is filled, the reader reviews and clicks 发布问题.

(function () {
  'use strict';

  const DRAFT_KEY = 'pendingDraft';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(selector, timeout = 6000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(120);
    }
    return null;
  }

  async function waitForText(text, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const hit = [...document.querySelectorAll('button, [role="menuitem"], a, span, div')]
        .filter((e) => e.textContent.trim() === text && e.offsetParent !== null)
        .pop();
      if (hit) return hit;
      await sleep(120);
    }
    return null;
  }

  // React tracks the previous value on the DOM node; bypass its setter so the
  // change is seen as real user input.
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc && desc.set ? desc.set.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Select everything in the editor so the next insert REPLACES rather than
  // appends. Zhihu autosaves an unsent 提问 draft, so on a second run the
  // body already holds the previous fill.
  function selectAll(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Draft.js discards direct DOM writes on its next render, and a single
  // insertText containing blank lines splits blocks and drops everything
  // before the split — only the abstract survived. A paste event goes through
  // Draft's own multi-paragraph handler, which is what we want.
  async function fillDraftJs(el, text) {
    const firstLine = text.split('\n')[0];
    // Replaced, not appended: the body must BEGIN with our first line and
    // contain it once. Checking only that it appears somewhere let an
    // autosaved draft sit above ours while we reported success.
    const replaced = () => {
      const t = el.textContent;
      return t.trimStart().startsWith(firstLine) && t.indexOf(firstLine) === t.lastIndexOf(firstLine);
    };

    // Draft.js syncs its own SelectionState from the DOM asynchronously, so
    // writing in the same tick as selectAll lands at its stale selection —
    // collapsed at the end — and inserts instead of replacing. Yield first.
    selectAll(el);
    await sleep(50);
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { /* fall through */ }
    await sleep(50);
    if (replaced()) return true;

    // Paste ignored or applied in the wrong place: clear explicitly, then
    // insert one paragraph at a time so no block split can eat earlier text.
    selectAll(el);
    await sleep(50);
    document.execCommand('delete', false);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand('insertText', false, lines[i]);
      if (i < lines.length - 1) document.execCommand('insertParagraph', false);
    }
    return replaced();
  }

  async function openAskModal() {
    if (document.querySelector('.Ask-form')) return true;
    const plus = document.querySelector('#Popover2-toggle, .SearchBar-askDropdownButton');
    if (!plus) return false;
    plus.click();
    const item = await waitForText('提问题');
    if (!item) return false;
    item.click();
    return !!(await waitFor('.Ask-form'));
  }

  async function fill(draft) {
    if (!(await openAskModal())) return 'modal';

    const title = await waitFor('.Ask-form textarea.Input, .AskTitle-input textarea');
    if (!title) return 'title';
    setNativeValue(title, draft.title);

    // The description editor only mounts once the title has content.
    const body = await waitFor('.AskDetail .public-DraftEditor-content[contenteditable="true"]', 5000);
    if (!body) return 'body';
    await sleep(150);
    // Whatever Zhihu autosaved in here is replaced.
    if (!(await fillDraftJs(body, draft.body))) return 'body-partial';

    return 'ok';
  }

  /** Returns the element, so a caller can add to it and keep it on screen. */
  function toast(text, ok, sticky) {
    const t = document.createElement('div');
    t.style.cssText = [
      'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483000',
      'background:' + (ok ? '#0B7A5A' : '#A9391A') + ';color:#fff;padding:10px 16px',
      'border-radius:8px;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,"Noto Sans SC",sans-serif',
      'box-shadow:0 6px 24px rgba(0,0,0,.22);max-width:min(420px,86vw)',
      'display:flex;align-items:center;gap:10px'
    ].join(';');
    t.appendChild(document.createTextNode(text));
    document.body.appendChild(t);
    // A toast carrying a button must not vanish mid-reach.
    if (!sticky) setTimeout(() => t.remove(), 5200);
    return t;
  }

  /** The draft as the reader would paste it: title, blank line, body. */
  const asText = (draft) => [draft.title, draft.body].filter(Boolean).join('\n\n');

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      return false;   // no user gesture, or the document is not focused
    }
  }

  function copyButton(t, text) {
    const b = document.createElement('button');
    b.textContent = '复制草稿';
    b.style.cssText = [
      'flex:none;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.45)',
      'color:#fff;border-radius:999px;padding:3px 10px;font:600 12px/1 inherit;cursor:pointer'
    ].join(';');
    b.addEventListener('click', async () => {
      // The click is the user gesture writeText wants, which is why this
      // works where the attempt on load did not.
      b.disabled = true;
      b.textContent = (await copy(text)) ? '已复制' : '复制失败';
    });
    t.appendChild(b);
  }

  (async function run() {
    const store = await chrome.storage.local.get(DRAFT_KEY);
    const draft = store[DRAFT_KEY];
    if (!draft) return;
    // One shot: clear first so a reload never re-fires it.
    await chrome.storage.local.remove(DRAFT_KEY);

    if (document.readyState === 'loading') {
      await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    }
    await sleep(700);   // the top bar mounts after hydration

    const result = await fill(draft);
    if (result === 'ok') {
      toast('已填入论文信息', true);
      return;
    }

    // Filling failed, so the draft is all the reader has left -- and it has
    // already been removed from storage, one-shot, so this copy is the only
    // place it still exists. Try the clipboard outright: there is no user
    // gesture here, so the browser will usually refuse, and then the button
    // supplies one.
    const text = asText(draft);
    if (await copy(text)) {
      toast('自动填入失败（' + result + '），草稿已复制到剪贴板', false);
    } else {
      copyButton(toast('自动填入失败（' + result + '）', false, true), text);
    }
  })();
})();

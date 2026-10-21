// Small in-page entry point. Never auto-opens the panel — a reader who
// doesn't care about Zhihu should be able to ignore this entirely.

(function () {
  'use strict';

  var badge = null;
  var canOpenFromPage = null;   // the worker says, on PAPER_FOUND

  function render(paper) {
    if (!paper) { if (badge) { badge.remove(); badge = null; } return; }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'zhihu-paper-badge';
      badge.setAttribute('role', 'button');
      badge.setAttribute('tabindex', '0');
      badge.addEventListener('click', open);
      badge.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      document.body.appendChild(badge);
      inject();
    }
    badge.innerHTML = '';
    var label = document.createElement('span');
    label.textContent = '知乎讨论';
    badge.appendChild(label);

    // Firefox cannot open its sidebar from a page: the API wants a live user
    // gesture and is not exposed to content scripts, so a click here can only
    // ever be relayed, and arrives too late. The badge stays as it is and
    // says where to click instead, on hover, before the click is wasted.
    if (canOpenFromPage === false) {
      var tip = document.createElement('span');
      tip.className = 'tip';
      tip.textContent = '请点击侧边栏图标打开';
      badge.appendChild(tip);
    }
  }

  function open() {
    chrome.runtime.sendMessage({ type: 'OPEN_PANEL' });
  }

  function inject() {
    if (document.getElementById('zhihu-paper-badge-style')) return;
    var s = document.createElement('style');
    s.id = 'zhihu-paper-badge-style';
    s.textContent = [
      '#zhihu-paper-badge{position:fixed;right:20px;bottom:20px;z-index:2147483000;',
      'display:inline-flex;align-items:center;gap:7px;background:#0084FF;color:#fff;',
      'font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;',
      'padding:10px 15px;border-radius:999px;cursor:pointer;border:0;',
      'box-shadow:0 2px 6px rgba(0,0,0,.18),0 10px 26px rgba(0,0,0,.16);',
      'transition:transform .12s ease,box-shadow .12s ease}',
      '#zhihu-paper-badge:hover{transform:translateY(-1px);box-shadow:0 3px 8px rgba(0,0,0,.2),0 14px 32px rgba(0,0,0,.2)}',
      '#zhihu-paper-badge:focus-visible{outline:2px solid #fff;outline-offset:2px}',
      '@media (prefers-reduced-motion:reduce){#zhihu-paper-badge{transition:none}}',
      '#zhihu-paper-badge .tip{position:absolute;bottom:calc(100% + 9px);right:0;white-space:nowrap;',
      'background:#111721;color:#fff;border-radius:7px;padding:7px 10px;',
      'font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif;',
      'opacity:0;pointer-events:none;transition:opacity .12s ease;',
      'box-shadow:0 2px 10px rgba(0,0,0,.25)}',
      '#zhihu-paper-badge .tip::after{content:"";position:absolute;top:100%;right:20px;',
      'border:5px solid transparent;border-top-color:#111721}',
      '#zhihu-paper-badge:hover .tip,#zhihu-paper-badge:focus-visible .tip{opacity:1}'
    ].join('');
    document.documentElement.appendChild(s);
  }

  var lastPaper = null;

  // The worker can restart and lose what we pushed; let it ask again.
  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (msg.type === 'GET_PAPER') reply({ paper: lastPaper });
  });

  ZhihuPaper.watch(function (paper) {
    lastPaper = paper;
    if (!paper) { render(null); return; }
    chrome.runtime.sendMessage({ type: 'PAPER_FOUND', paper: paper }, function (res) {
      if (chrome.runtime.lastError) return;
      if (res && typeof res.canOpenFromPage === 'boolean') canOpenFromPage = res.canOpenFromPage;
      render(paper);
    });
  });
})();

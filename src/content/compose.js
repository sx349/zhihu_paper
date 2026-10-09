// The 提问 compose dialog, drawn on the paper page.
//
// Centred rather than in the side panel because composing needs room: five
// candidates, a title field and an abstract-sized body do not fit a 380px
// column. It lives in a shadow root so publisher CSS cannot reach in and ours
// cannot leak out — the badge gets away with a scoped <style> tag because it
// is one pill; a dialog with form controls does not.

(function () {
  'use strict';

  var TITLE_MAX = 50;      // Zhihu's own limit
  var host = null;

  function close() {
    if (host) { host.remove(); host = null; }
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",sans-serif}',
    '.back{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}',
    '.box{width:min(620px,100%);max-height:88vh;overflow-y:auto;background:#fff;color:#111721;border-radius:12px;',
    '  box-shadow:0 10px 50px rgba(0,0,0,.3);padding:20px 22px;display:flex;flex-direction:column;gap:16px}',
    '.hd{display:flex;align-items:center;gap:10px}',
    '.hd h2{margin:0;font-size:16px;font-weight:600}',
    '.hd .x{margin-left:auto;border:0;background:none;font-size:20px;line-height:1;color:#667385;cursor:pointer;padding:2px 6px;border-radius:6px}',
    '.hd .x:hover{background:#f1f3f7;color:#111721}',
    '.lab{font-size:11px;font-weight:700;letter-spacing:.1em;color:#667385;margin-bottom:7px;display:flex;align-items:center;gap:8px}',
    '.lab .n{margin-left:auto;font-variant-numeric:tabular-nums;letter-spacing:0;font-weight:600}',
    '.lab .n.over{color:#A9391A}',
    '.cands{display:flex;flex-direction:column;gap:6px}',
    '.c{text-align:left;border:1px solid #DCE1E9;background:#F6F8FB;border-radius:8px;padding:9px 11px;font-size:13.5px;',
    '  line-height:1.5;color:#111721;cursor:pointer}',
    '.c:hover{border-color:#0084FF;background:#fff}',
    '.c:focus-visible{outline:2px solid #0084FF;outline-offset:1px}',
    '.wait{padding:14px;border:1px dashed #C8D0DB;border-radius:8px;color:#667385;font-size:13px;text-align:center}',
    'input,textarea{width:100%;border:1px solid #C8D0DB;border-radius:8px;padding:9px 11px;font-size:13.5px;',
    '  line-height:1.55;color:#111721;background:#fff;resize:vertical}',
    'input:focus,textarea:focus{outline:2px solid #0084FF;outline-offset:-1px;border-color:#0084FF}',
    'textarea{min-height:190px;white-space:pre-wrap}',
    '.btns{display:flex;gap:10px;justify-content:flex-end}',
    '.btn{padding:9px 18px;border-radius:8px;font-size:13.5px;font-weight:600;border:1px solid #C8D0DB;background:#fff;color:#111721;cursor:pointer}',
    '.btn:hover{border-color:#667385}',
    '.btn.pri{background:#0084FF;border-color:#0084FF;color:#fff}',
    '.btn.pri:disabled{opacity:.45;cursor:not-allowed}',
    '@media (prefers-color-scheme:dark){',
    '  .box{background:#171C24;color:#E7ECF3}',
    '  .c{background:#1E242E;border-color:#28303B;color:#E7ECF3}',
    '  .c:hover{background:#171C24}',
    '  input,textarea{background:#1E242E;border-color:#36404E;color:#E7ECF3}',
    '  .btn{background:#171C24;border-color:#36404E;color:#E7ECF3}',
    '  .hd .x:hover{background:#1E242E;color:#E7ECF3}',
    '  .wait{border-color:#36404E}',
    '}'
  ].join('');

  function open(paper, body) {
    close();
    host = document.createElement('div');
    host.id = 'zhihu-paper-compose';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;

    var back = document.createElement('div');
    back.className = 'back';
    back.addEventListener('click', function (e) { if (e.target === back) close(); });

    var box = document.createElement('div');
    box.className = 'box';

    // header
    var hd = document.createElement('div');
    hd.className = 'hd';
    var h2 = document.createElement('h2');
    h2.textContent = '向知乎提问';
    var x = document.createElement('button');
    x.className = 'x';
    x.textContent = '×';
    x.title = '关闭';
    x.addEventListener('click', close);
    hd.append(h2, x);

    // candidates
    var cWrap = document.createElement('div');
    var cLab = document.createElement('div');
    cLab.className = 'lab';
    cLab.textContent = '候选提问';
    var cands = document.createElement('div');
    cands.className = 'cands';
    var wait = document.createElement('div');
    wait.className = 'wait';
    wait.textContent = '提问生成中……';
    cands.append(wait);
    cWrap.append(cLab, cands);

    // title
    var tWrap = document.createElement('div');
    var tLab = document.createElement('div');
    tLab.className = 'lab';
    var tText = document.createElement('span');
    tText.textContent = '标题';
    var count = document.createElement('span');
    count.className = 'n';
    tLab.append(tText, count);
    var title = document.createElement('input');
    title.type = 'text';
    title.placeholder = '点击上方候选填入，或自行输入';
    tWrap.append(tLab, title);

    // body
    var bWrap = document.createElement('div');
    var bLab = document.createElement('div');
    bLab.className = 'lab';
    bLab.textContent = '补充说明';
    var bodyEl = document.createElement('textarea');
    bodyEl.value = body || '';
    bWrap.append(bLab, bodyEl);

    // buttons
    var btns = document.createElement('div');
    btns.className = 'btns';
    var cancel = document.createElement('button');
    cancel.className = 'btn';
    cancel.textContent = '取消';
    cancel.addEventListener('click', close);
    var ok = document.createElement('button');
    ok.className = 'btn pri';
    ok.textContent = '去知乎提问';
    btns.append(cancel, ok);

    function sync() {
      var n = title.value.trim().length;
      count.textContent = n + '/' + TITLE_MAX;
      count.className = 'n' + (n > TITLE_MAX ? ' over' : '');
      ok.disabled = n === 0 || n > TITLE_MAX;
    }
    title.addEventListener('input', sync);
    sync();

    ok.addEventListener('click', function () {
      var t = title.value.trim();
      if (!t || t.length > TITLE_MAX) return;
      if (!/[？?]$/.test(t)) t = t.replace(/[。.，,]$/, '') + '？';
      chrome.runtime.sendMessage({ type: 'SUBMIT_QUESTION', title: t, body: bodyEl.value });
      close();
    });

    box.append(hd, cWrap, tWrap, bWrap, btns);
    back.append(box);
    root.append(style, back);
    document.documentElement.append(host);
    document.addEventListener('keydown', onKey);
    title.focus();

    // Generated only now, on an explicit ask — not on every paper page view.
    chrome.runtime.sendMessage({ type: 'ASK_CANDIDATES', paper: paper }, function (res) {
      if (!host) return;                       // dismissed while waiting
      var list = (res && res.candidates) || [];
      cands.innerHTML = '';
      if (!list.length) {
        var none = document.createElement('div');
        none.className = 'wait';
        none.textContent = '候选提问生成失败，可直接输入标题';
        cands.append(none);
        return;
      }
      list.forEach(function (q) {
        var b = document.createElement('button');
        b.className = 'c';
        b.textContent = q;
        b.addEventListener('click', function () { title.value = q; sync(); title.focus(); });
        cands.append(b);
      });
    });
  }

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === 'SHOW_COMPOSE') open(msg.paper, msg.body);
  });
})();

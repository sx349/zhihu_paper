// Builds docs/index.html, which GitHub Pages serves at
// sx349.github.io/zhihu_paper -- the address the panel's placeholder, the
// README and the Firefox update manifest all point at.
//
// Two of the three tabs are generated, so the page cannot drift from the
// extension the way the two hand-written lists it replaced did.
import { writeFileSync } from 'fs';
import { manifest, supportedSites, changelog } from './sitedata.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REPO = 'https://github.com/sx349/zhihu_paper';
const v = manifest.version;

const sites = supportedSites().map(({ name, host }) =>
  `      <li><b>${esc(name)}</b><span>${esc(host)}</span></li>`).join('\n');

const notes = changelog().map((rel) => {
  const groups = rel.groups.map((g) => {
    const items = g.items.map((it) => {
      const kids = it.children.length
        ? '\n          <ul>' + it.children.map((c) => `<li>${esc(c)}</li>`).join('') + '</ul>'
        : '';
      return `        <li>${esc(it.text)}${kids}</li>`;
    }).join('\n');
    return (g.heading ? `      <h4>${esc(g.heading)}</h4>\n` : '') + `      <ul>\n${items}\n      </ul>`;
  }).join('\n');
  return `    <section class="rel">\n      <h3>${esc(rel.title)}</h3>\n${groups}\n    </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知乎论文助手</title>
<link rel="icon" href="icon-48.png">
<style>
:root{--ink:#111721;--ink-2:#3D4757;--muted:#667385;--line:#DCE1E9;--line-2:#C8D0DB;
  --surface:#fff;--surface-2:#F6F8FB;--zhihu:#0084FF;
  --sans:"IBM Plex Sans","Noto Sans SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:40px 20px 72px}
header{display:flex;align-items:center;gap:12px;margin-bottom:6px}
header img{width:40px;height:40px}
h1{font-size:22px;margin:0;font-weight:700}
.sub{color:var(--muted);font-size:14px;margin:0 0 26px 52px}
.ver{font-family:var(--mono);font-size:12px;color:var(--muted);border:1px solid var(--line);
  border-radius:999px;padding:2px 9px}
nav{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:28px}
nav button{appearance:none;background:none;border:0;border-bottom:2px solid transparent;
  padding:9px 14px;font:inherit;font-size:14px;font-weight:600;color:var(--muted);cursor:pointer}
nav button:hover{color:var(--ink)}
nav button[aria-selected=true]{color:var(--zhihu);border-bottom-color:var(--zhihu)}
section[hidden]{display:none}
h2{font-size:16px;margin:28px 0 10px}
h2:first-child{margin-top:0}
h3{font-size:15px;margin:0 0 10px;font-family:var(--mono)}
h4{font-size:13px;margin:16px 0 6px;color:var(--muted);font-weight:700;letter-spacing:.06em}
ol,ul{margin:0 0 14px;padding-left:22px}
li{margin:4px 0}
code{font-family:var(--mono);font-size:13px;background:var(--surface-2);
  border:1px solid var(--line);border-radius:4px;padding:1px 5px}
a{color:var(--zhihu)}
.soon{border:1px dashed var(--line-2);border-radius:8px;padding:14px 16px;color:var(--muted);
  background:var(--surface-2);font-size:14px}
.sites{list-style:none;padding:0;display:grid;gap:8px;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.sites li{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:8px;
  padding:9px 12px;margin:0}
.sites b{font-size:14px}
.sites span{font-family:var(--mono);font-size:11.5px;color:var(--muted)}
.count{color:var(--muted);font-size:14px;margin:0 0 16px}
.rel{border-top:1px solid var(--line);padding-top:18px;margin-top:22px}
.rel:first-of-type{border-top:0;padding-top:0;margin-top:0}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);
  color:var(--muted);font-size:13px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <img src="icon-48.png" alt="">
    <h1>知乎论文助手</h1>
    <span class="ver">v${esc(v)}</span>
  </header>
  <p class="sub">${esc(manifest.description)}</p>

  <nav>
    <button id="t-install" aria-selected="true" aria-controls="install">安装说明</button>
    <button id="t-sites" aria-selected="false" aria-controls="sites">支持站点</button>
    <button id="t-notes" aria-selected="false" aria-controls="notes">更新记录</button>
  </nav>

  <section id="install">
    <h2>Chrome / Edge</h2>
    <ol>
      <li>从 <a href="${REPO}/releases/latest">GitHub Releases</a> 下载 <code>zhihu_paper.zip</code> 并解压</li>
      <li>打开 <code>chrome://extensions</code>，开启右上角的「开发者模式」</li>
      <li>点击「加载已解压的扩展程序」，选择解压得到的 <code>zhihu_paper</code> 文件夹</li>
    </ol>
    <p class="soon">Chrome 应用商店：审核中，上架后此处提供链接。</p>

    <h2>Firefox</h2>
    <p class="soon">Firefox 版本正在签名中，完成后此处提供 <code>.xpi</code> 下载链接。安装后可自动更新。</p>

    <h2>使用前</h2>
    <ul>
      <li>需在浏览器中登录知乎，扩展通过你的登录状态访问知乎</li>
      <li>安装后请刷新已打开的论文页面</li>
    </ul>
  </section>

  <section id="sites" hidden>
    <p class="count">目前支持 ${supportedSites().length} 个站点。</p>
    <ul class="sites">
${sites}
    </ul>
  </section>

  <section id="notes" hidden>
${notes}
  </section>

  <footer>
    <a href="${REPO}">GitHub</a> · 本页由扩展源码生成
  </footer>
</div>
<script>
  var tabs = [['t-install','install'],['t-sites','sites'],['t-notes','notes']];
  tabs.forEach(function (pair) {
    document.getElementById(pair[0]).addEventListener('click', function () {
      tabs.forEach(function (p) {
        var on = p[0] === pair[0];
        document.getElementById(p[0]).setAttribute('aria-selected', String(on));
        document.getElementById(p[1]).hidden = !on;
      });
      location.hash = pair[1];
    });
  });
  if (location.hash) {
    var t = tabs.find(function (p) { return '#' + p[1] === location.hash; });
    if (t) document.getElementById(t[0]).click();
  }
</script>
</body>
</html>
`;

writeFileSync(new URL('../docs/index.html', import.meta.url), html);
console.log(`docs/index.html -> v${v}, ${supportedSites().length} sites, ${changelog().length} releases`);

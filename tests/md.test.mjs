const { renderMarkdown: md } = await import(new URL('../src/panel/md.js', import.meta.url));
let pass=0,fail=0;
const ck=(n,c,e='')=>{c?pass++:fail++;console.log(`${c?'ok  ':'FAIL'}  ${n}${e?'  '+e:''}`);};

// the shape 直答 actually produced in this session
const real = `# 如何解读《Hilbert's Sixth Problem》（arXiv:2503.01800）

## 一、论文做了什么

这是邓煜（芝加哥大学）、Zaher Hani、马骁（密歇根大学）三人于 2025 年提交的 49 页预印本。

**牛顿硬球动力学 → Boltzmann 方程 → Euler / Navier–Stokes–Fourier 流体方程**

## 二、问题背景：为什么难

- 希尔伯特 1900 年提出的第六问题主旨是"物理学的公理化"。
- 微观粒子遵循时间反演对称的牛顿定律。
1. 第一步
2. 第二步`;
const h = md(real);
ck('# -> h2 (panel owns h1)', h.includes('<h2>如何解读') && !h.includes('<h1>'));
ck('## -> h3', h.includes('<h3>一、论文做了什么</h3>'));
ck('bold', h.includes('<strong>牛顿硬球动力学 → Boltzmann 方程 → Euler / Navier–Stokes–Fourier 流体方程</strong>'));
ck('bullets become one <ul> with two <li>', (h.match(/<ul>/g)||[]).length===1 && (h.match(/<li>/g)||[]).length===4);
ck('numbered list becomes <ol>', h.includes('<ol><li>第一步</li><li>第二步</li></ol>'));
ck('paragraph wrapped', h.includes('<p>这是邓煜'));
ck('no raw markdown left', !h.includes('**') && !h.includes('\n# '));

// untrusted model output must never become markup
const evil = `<script>alert(1)</script>\n**<img src=x onerror=alert(1)>**\n[x](javascript:alert(1))\n- <b>hi</b>`;
const e = md(evil);
ck('script tag escaped', !e.includes('<script') && e.includes('&lt;script&gt;'));
ck('img/onerror escaped even inside bold', !e.includes('<img') && e.includes('<strong>&lt;img'));
ck('javascript: link NOT turned into <a>', !e.includes('<a ') );
ck('html inside list item escaped', e.includes('<li>&lt;b&gt;hi&lt;/b&gt;</li>'));
ck('https link IS turned into <a> with rel=noopener', md('[z](https://zhihu.com)').includes('<a href="https://zhihu.com" target="_blank" rel="noopener">z</a>'));

ck('inline code', md('用 `execCommand` 填入').includes('<code>execCommand</code>'));
ck('hr', md('a\n---\nb')==='<p>a</p><hr><p>b</p>');
ck('empty input -> empty string', md('')==='' && md(null)==='');
ck('CJK numbered marker 、 without space', md('1、第一').includes('<ol><li>第一</li></ol>'));
ck('1.5 million is prose, not a list', md('1.5 million people')==='<p>1.5 million people</p>');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

import { searchZhihu } from '../lib/zhihu.js';

const $ = (id) => document.getElementById(id);
const set = (node, text, cls) => { node.textContent = text; node.className = 'status' + (cls ? ' ' + cls : ''); };

(async function initLogin() {
  try {
    const c = await chrome.cookies.get({ url: 'https://www.zhihu.com', name: 'z_c0' });
    c ? set($('login'), '✓ 已登录知乎', 'ok') : set($('login'), '○ 未检测到登录状态', 'bad');
  } catch (e) {
    set($('login'), '无法读取登录状态：' + e.message, 'bad');
  }
})();

(async function initSecret() {
  const { accessSecret } = await chrome.storage.local.get('accessSecret');
  if (accessSecret) {
    $('secret').value = accessSecret;
    set($('status'), '✓ 已保存（' + accessSecret.slice(0, 4) + '…' + accessSecret.slice(-4) + '）', 'ok');
  }
})();

$('save').addEventListener('click', async () => {
  const v = $('secret').value.trim();
  if (!v) return set($('status'), '请填入密钥', 'bad');
  await chrome.storage.local.set({ accessSecret: v });
  set($('status'), '✓ 已保存', 'ok');
});

$('test').addEventListener('click', async () => {
  set($('status'), '测试中…');
  try {
    const r = await searchZhihu('知乎', 1);
    set($('status'), '✓ 连接正常，返回 ' + r.length + ' 条结果', 'ok');
  } catch (e) {
    set($('status'), '✗ ' + (e.message === 'NO_SECRET' ? '尚未配置密钥' : e.message), 'bad');
  }
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('accessSecret');
  $('secret').value = '';
  set($('status'), '已清除');
});

$('export').addEventListener('click', async () => {
  const { feedback = [] } = await chrome.storage.local.get('feedback');
  if (!feedback.length) return set($('fbstat'), '暂无反馈记录');
  const blob = new Blob([JSON.stringify(feedback, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'zhihu-paper-feedback.json';
  a.click();
  URL.revokeObjectURL(a.href);
  set($('fbstat'), '已导出 ' + feedback.length + ' 条', 'ok');
});

# 更新记录

版本号和 `chrome://extensions` 里显示的一致。遇到问题时，先确认自己装的是哪个版本。

## 0.2.0 — 2026-10-20

修复

- 侧边栏在某些情况下一直显示「未识别到论文」。`service_worker.js` 里调用了一个从未定义的函数
  `pullFromTab`，后台丢失状态后无法向页面重新取回论文信息，直接抛错。

工程

- 加入 ESLint 和 GitHub Actions。上面那个 bug 属于「引用了不存在的函数」，一次 lint 就能发现。
- 测试不再写死本机路径，可以在任何机器上跑。`doi` 和 `identifier-edge` 两个测试此前失败也返回 0，
  现已改正。
- CI 会检查 `manifest.json` 和 `package.json` 的版本号是否一致。

## 0.1.0

首个版本。支持 arXiv、SSRN、NBER、JSTOR、IEEE、PubMed 及主要出版社平台共 23 个站点。

> 早期曾有一版只支持 arXiv、ScienceDirect、Springer、Wiley、INFORMS 五个站点，版本号同样是 0.1.0。
> 如果侧边栏底部写着「目前已支持 arXiv、ScienceDirect、Springer、Wiley 和 INFORMS」，说明装的是那一版，
> 请重新下载。

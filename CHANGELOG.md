# 更新记录

版本号和 `chrome://extensions` 里显示的一致。遇到问题时，先确认自己装的是哪个版本。

## 0.3.0 — 2026-10-20

「关联讨论」不再读取预置数据库，改用知乎的论文关联问题接口。

新增

- 接入 `api.zhihu.com/paper/questions`，按 DOI、arXiv 链接或论文标题查询站内关联问题。
  该接口无需 Access Secret。
- 关联讨论的范围不止于论文卡片：标题检索的前两页结果中的问题会一并纳入，
  每条结果标明来源（论文卡片 / 标题检索）。
- 由知乎直答对候选问题排序，取相关度最高的五条。接口返回的 relevance_score
  只有 80/90/95/100 四档，不足以排序。
- 论文作者参与过的问题排在最前，并同时显示作者本人的回答和该问题的最高票回答。
- 查询过程中显示进度：「正在获取结果…」「正在用知乎直答排序…」。排序约需 6 秒，
  列表会先出现，排好后再重新排列。

修复

- 回答改从 `/api/v4/questions/{id}/feeds` 读取。此前用的 `/answers` 接口完全忽略
  `sort_by` 参数，且返回的内容会漏掉高票回答——在某个问题上它给出的首条是 381 赞，
  而实际首条是 5939 赞。现在的顺序与知乎问题页一致。

说明

- 「本文作者在知乎」仍然来自预置数据库和 ORCID，知乎暂无对应接口。
- seed.json 中的 `paper_card`、`question`、`answer`、`article`、`paper_alias`
  不再被关联讨论使用，但予以保留。

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

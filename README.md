# 知乎论文助手 · 使用说明

> 在论文页面连接知乎讨论

Chrome 扩展：在论文页面识别当前论文，并连接知乎上的相关讨论。

---

## 一、安装与配置

- 从 GitHub 下载本项目：点击页面右上角 **Code → Download ZIP**，解压；或 `git clone https://github.com/sx349/zhihu_paper.git`
- `chrome://extensions` → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的 `zhihu_paper` 文件夹
- 点击工具栏拼图图标，将扩展固定到工具栏
- 首次安装会自动打开设置页；之后可右键扩展图标 →「选项」进入
- **目前所有功能通过浏览器的知乎登录状态即可使用，无需额外配置**
- 开放平台 Access Secret 仅作为备用通道（可选）；如需使用，请前往 [developer.zhihu.com/profile](https://developer.zhihu.com/profile) 生成，配置后仅保存在本地浏览器
- 加载扩展后需刷新已打开的论文页面

### 当前支持站点

| | |
|---|---|
| **预印本** | arXiv、SSRN、NBER、bioRxiv、medRxiv |
| **出版社** | Nature、Science、Cell、PNAS、ScienceDirect、Springer、Wiley、Oxford Academic、Taylor & Francis、SAGE、University of Chicago Press、PLOS |
| **学会与索引** | INFORMS、AEA、ACM、IEEE Xplore、JSTOR、PubMed |

---

## 二、功能

- **提取论文信息**：标题、作者、期刊、年份、DOI / arXiv ID、摘要
- 如果作者在知乎有账号，**显示论文作者的知乎账号**（开发中，目前仅读取预置数据库）
- **显示标记有该论文卡片的相关问题 / 回答**（开发中，目前仅读取预置数据库）
- **按论文标题检索知乎**，结果单独列出并标注「可能与本文无关」
- **论文解读**：调用知乎直答生成，点击后流式返回，按论文缓存

### 提问与跳转

- 若已有相关问题 → 按钮为「**去知乎讨论**」，跳转至排序最高的关联问题
- 若无相关问题 → 按钮为「**去知乎提问**」
  - 弹出提问面板，列出 5 条候选标题（由知乎直答生成），点击任一条填入标题栏，可自由编辑
  - 补充说明已预填论文标题、作者、期刊、链接与摘要，可自由编辑
  - 点击「去知乎提问」后跳转知乎并自动填入，**不会自动发布**，需自行确认后点击「发布问题」

---

## 三、反馈

- 可通过私信或评论联系知乎 [@Richard Xu](https://www.zhihu.com/people/richard-xu-25)
- 扩展内置反馈功能：面板底部的 👍 / 👎 与文字反馈，均记录在本地
- 在设置页可点击「导出反馈 JSON」，在联系时一并发送可便于定位问题

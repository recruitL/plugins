# Research Dashboard

一个面向结构化科研知识库的本地 Obsidian 首页。它借鉴 Hearth 的“首页 + 搜索 + 实时卡片”体验，但首版刻意保持固定布局、只读聚合和零第三方运行时依赖。

A quiet, local-first Obsidian research home screen. It reads vault metadata locally and does not send data to external services.

## 首版内容

- 文件名、路径和 alias 搜索
- 今日 Daily 的 `work_summary` 与 `## 今日任务`
- 项目明确待办与最近更新
- 研究主题与长期知识目录最近更新
- 当月 Daily 日历和记录连续天数
- 按 Daily 文件存在日期生成的记录活跃度
- 正式 Maps / Application 索引快捷入口
- 每张卡片独立配色，可一键关闭或恢复默认调色板
- 记录活跃度置于工作卡片首位，并提供更宽、更易点击的搜索栏
- 活跃度覆盖完整 52 周，配有月份标记，并采用柔和的浅青绿色记录格

## 使用

插件启用后，点击左侧 `layout-dashboard` 图标，或从命令面板运行“打开科研仪表盘”。默认不会替换当前工作区，也不会在启动时自动打开；可在插件设置中修改。

在 `设置 → 第三方插件 → Research Dashboard → 区块颜色` 中，可以分别调整今日 Daily、月历、聚焦待办、快捷入口、研究主题、待复核、最近沉淀和记录活跃度。颜色只做低比例背景混合，并保留 Obsidian 主题的正文颜色。

当 Phycat 主题通过 Style Settings 启用 `Cards (Floating)` 时，插件会仅在 Research Dashboard 为活动标签时撤销主题的外层卡片和透明背景；普通笔记、侧栏和其他标签仍保留原有主题样式。

### 使用 BRAT 安装

1. 在 Obsidian 中安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 打开命令面板，运行 `BRAT: Add a beta plugin for testing`。
3. 输入仓库地址 `recruitL/plugins`。
4. 选择跟踪最新版本，然后在“第三方插件”中启用 Research Dashboard。

BRAT 会从 GitHub Release 下载 `main.js`、`manifest.json` 和 `styles.css`。当前仓库只将 Research Dashboard 暴露为 BRAT 可安装的 Obsidian 插件。

### 手动安装

1. 下载本目录中的 `main.js`、`manifest.json` 和 `styles.css`。
2. 在 vault 下创建 `.obsidian/plugins/research-dashboard/`。
3. 将三个文件放入该目录，然后在 Obsidian 的第三方插件设置中启用 Research Dashboard。

插件首次运行后生成的 `data.json` 只保存本机设置，不属于源码，也不会提交到仓库。

默认目录如 `01 Daily`、`03 Projects_Task` 和 `08 Maps` 都可以在插件设置中修改。

## 开发

```bash
npm ci
npm run test
npm run build
```

开发环境需要 Node.js 22.12 或更高版本。构建会在插件目录生成 Obsidian 直接加载的 `main.js`。

## 数据边界

- 不依赖 Dataview。
- 不修改任何笔记。
- 今日 Daily 缺失时只显示预期路径和现有 QuickAdd 快捷键提示。
- “记录活跃度”只表示 Daily 文件是否存在，不代表科研产出或实际编辑时长。

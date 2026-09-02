# Plugins

[![Latest release](https://img.shields.io/github/v/release/recruitL/plugins?label=release)](https://github.com/recruitL/plugins/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

面向科研与知识管理工作流的个人插件集合。仓库按宿主应用分层，每个插件保留独立的源码、构建配置、测试和使用说明。

A public collection of small, local-first plugins for research and knowledge workflows.

## 仓库结构

```text
plugins/
├── obsidian/
│   └── research-dashboard/
├── zotero/
└── edge/
```

## 当前插件

| 平台 | 插件 | 状态 | 说明 |
| --- | --- | --- | --- |
| Obsidian | [Research Dashboard](obsidian/research-dashboard/) | 可用 | 本地优先的科研首页，提供知识库搜索、Daily 摘要、项目任务、月历和 52 周记录活跃度。 |
| Zotero | — | 预留 | 后续 Zotero 插件放在这里。 |
| Edge | — | 预留 | 后续 Microsoft Edge 扩展放在这里。 |

## 安装 Research Dashboard

### 使用 BRAT 安装（推荐）

1. 在 Obsidian 中打开“设置 → 第三方插件”，安装并启用 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. 打开命令面板：macOS 按 `Command + P`，Windows/Linux 按 `Ctrl + P`。
3. 运行 `BRAT: Add a beta plugin for testing`。
4. 输入仓库地址：

   ```text
   recruitL/plugins
   ```

5. 选择跟踪最新版本并完成添加。
6. 回到“设置 → 第三方插件”，启用 **Research Dashboard**。

请填写仓库地址 `recruitL/plugins`，不要填写子目录 `recruitL/plugins/obsidian/research-dashboard`。BRAT 会从 [GitHub Releases](https://github.com/recruitL/plugins/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`。

后续有新版本时，可通过 BRAT 的插件更新命令检查并安装更新。

### 手动安装

1. 打开[最新 Release](https://github.com/recruitL/plugins/releases/latest)。
2. 下载 `main.js`、`manifest.json` 和 `styles.css`。
3. 在你的 Obsidian Vault 中创建目录：

   ```text
   .obsidian/plugins/research-dashboard/
   ```

4. 将三个文件放进该目录。
5. 重启或重新加载 Obsidian，然后在“设置 → 第三方插件”中启用 **Research Dashboard**。

插件运行后生成的 `data.json` 只保存本机设置，不需要上传到 GitHub。更完整的功能和配置说明请查看 [Research Dashboard README](obsidian/research-dashboard/README.md)。

## 开发与验证

```bash
cd obsidian/research-dashboard
npm ci
npm run typecheck
npm test
npm run build
```

开发环境需要 Node.js 22.12 或更高版本。构建产物为 Obsidian 可直接加载的 `main.js`。

## 仓库原则

- 不提交运行时设置和个人知识库数据。
- 每个插件保持独立构建和测试能力。
- 为便于手动安装，可以提交必要的构建产物。
- 各宿主应用的专用文档放在对应平台目录中。
- 当前只有 Research Dashboard 通过本仓库的 Release 提供 BRAT 安装；增加第二个 Obsidian 插件时将使用独立的发布仓库。

## License

Released under the [MIT License](LICENSE).

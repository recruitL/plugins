# Plugins

A public collection of small, local-first plugins for research and knowledge workflows.

这是一个面向科研与知识管理工作流的个人插件集合。仓库按宿主应用分层，每个插件保留独立的源码、构建配置、测试和使用说明。

## Structure

```text
plugins/
├── obsidian/
│   └── research-dashboard/
├── zotero/
└── edge/
```

## Current plugins

| Platform | Plugin | Status | Description |
| --- | --- | --- | --- |
| Obsidian | [Research Dashboard](obsidian/research-dashboard/) | Active | A quiet, local-first research home screen with vault search, Daily summaries, project tasks, calendar, and a 52-week activity view. |
| Zotero | — | Reserved | Future Zotero integrations will live here. |
| Edge | — | Reserved | Future Microsoft Edge extensions will live here. |

## Repository principles

- Runtime settings and personal vault data are never committed.
- Each plugin remains independently buildable and testable.
- Generated install files may be committed when they make manual installation practical.
- Host-specific documentation stays inside the corresponding platform directory.

## License

Released under the [MIT License](LICENSE).

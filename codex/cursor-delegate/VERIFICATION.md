# 验证记录：2026-09-16 至 2026-09-17

结论：**部分实现与安装完成，真实闭环验收未通过，不应标为可用生产版本。**

环境：macOS，Node.js 22.23.1；Codex CLI 0.153.4（App 捆绑）；Cursor Agent 2026.05.28-a70ca7c。上游当前适配 2026.08.25-3e8eec8，与本机不同；没有使用上游的 `--auto-review` 参数，也没有升级全局 Cursor。

| 层级 | 实际执行 | 结果及边界 |
| --- | --- | --- |
| 纯函数/入参 | realpath 越界与符号链接、未知模型/force/批准字段 | 通过；目录检查不是沙箱 |
| ACP 模拟子进程 | 同会话两轮、普通问题、计划、权限副作用哨兵、断线加载一次、取消、超时 | 通过；提供者是测试夹具，无真实模型 |
| MCP 实际 stdio 子进程 | initialize、9 个工具发现、status、未配置根目录时拒绝启动、拒绝虚构批准工具 | 通过；这是桥接服务验证，不是 App 验证 |
| 插件结构 | 官方 plugin validator、Skill validator | 通过（隔离 Python 环境安装 PyYAML） |
| 独立安装器 | 临时 HOME/CODEX_HOME 中运行 install-local.mjs，调用真实 Codex marketplace add/plugin add | 通过；只写自行创建的安装测试目录 |
| 本机安装 | 官方脚手架 personal marketplace；codex plugin add/list | 显示 installed=true、enabled=true，缓存路径为 personal/cursor-delegate/0.1.0（后续更新可能带 cachebuster） |
| 真实 Cursor | 原生 `--sandbox enabled acp`，initialize 后 authenticate | 初始化成功；authenticate 20 秒超时，进程停止；agent status 为 Not logged in |
| 安装缓存实际运行 | 从 personal 安装缓存启动 MCP，调用 cursor_status | 返回 configured=true 和测试项目路径；仍非 App 调用 |
| App 内发现/调用 | 当前工具列表查找、Computer Use 尝试打开 Codex App | 工具未出现；宿主明确拒绝 Computer Use 访问 Codex App；未验证 |

`npm test` 当前 9 项全部通过。开发中曾出现恢复等待进程退出事件的测试失败，已修复“事件已发生后才订阅”的顺序问题，随后完整重跑 9/9 通过。测试分类如上，不能把全部称为单元测试，更不能等同真实联调。

## A–E 对照

- A 正常实现→实际改代码/运行测试→Codex验收→同会话补改：**未验证**，受真实 Cursor 登录阻塞。模拟同会话两轮通过。
- B 真实 Cursor 提问/计划→Codex自主答复：**未验证**。协议模拟问答与计划处理通过，Skill 不再设置用户审批关卡。
- C 可恢复失败与取消：模拟意外进程退出→加载同会话→新轮次通过；第二次恢复拒绝；取消终止进程组、禁止恢复。真实 Cursor 工作中故障 **未验证**。
- D 越权无副作用：模拟权限请求声称“用户已批准”，桥接返回取消且副作用哨兵不存在；未知批准参数拒绝。原生 Cursor/OS 沙箱越权写测试 **未验证**。
- E App 实际调用：**未验证**；本机安装记录不替代该项。

## 权限链与限制

当前 Codex 任务本身以用户级完整访问运行。MCP 与 Cursor 为独立用户级进程，并不继承一个已证实的 Codex OS 沙箱。插件要求 Cursor 自己启用原生沙箱；启动探测接受该参数，但不证明后续全部操作被隔离。

只读检查本机 Cursor 配置：permissions.allow 仅 `Shell(ls)`，deny 为空；用户级 MCP 与 sandbox.json 不存在。没有修改这些配置，未读取/复制认证文件。进程环境只继承基本运行字段，不转发整个 Codex 环境或 API 密钥变量。既有原生凭据仍由 Cursor 管理。

没有可信的人类批准通道，权限请求全部拒绝，可能连普通已授权写入也会阻塞。此局限不是靠 Skill 文案就能解决；当前选择停止，未伪装成原生审批。

## 继续验收需要的最小人工动作

1. 本人运行 `agent login` 完成 Cursor 官方登录，再运行 `agent status` 确认。无需提供密钥。
2. 在 Codex App 打开一个新的本地任务，启用 Cursor Delegate，并要求调用 `cursor_status`。若宿主不加载工具，在插件设置中重新启用/重载。
3. 返回调用结果后，继续在已建立的无敏感测试目录执行 A–D 的真实闭环。若遭遇原生权限请求，本版保持拒绝；需另行确认宿主可信授权能力，不能为了通过验收降低权限保护。

本机备份与探测细节留在独立工作区，未提交认证信息或完整用户配置。PR 保持草稿，不合并、不发版。

# Cursor Delegate（本地测试版）

Codex App → 本插件 MCP 服务 → Cursor 官方 ACP。Codex 负责派工、技术决策、检查实际改动和返修；Cursor 保持一个会话承担实现工作。没有任务数据库、独立界面、自动付费或云端总控。

**当前未达到完整验收标准。** 本机安装、真实 Cursor 认证和 App 内工具调用已验证；App 代码任务在准备阶段因权限请求被插件取消。安全升级目前只支持拒绝执行，尚未接通可信的人类批准通道。不能作为已验证的无人值守生产工具。详见 [验证记录](VERIFICATION.md)。

## 安装、启用

需要 macOS/Linux、Node.js 22+、Codex 插件 CLI，以及官方 Cursor Agent 的 `agent acp`。沿用已有 Cursor 登录；尚未登录时由本人执行 `agent login`，不要把密钥贴进对话。

在此目录运行：

```sh
npm test
node scripts/install-local.mjs /absolute/path/to/disposable-test-project
```

安装脚本将源码复制到 `~/.local/share/cursor-delegate-local/plugins/cursor-delegate`，只为该插件写入根目录与本机可执行文件路径，通过 Codex CLI 注册独立本地 marketplace 并安装。不会整份重写 Codex 配置。修改前备份配置与旧插件至该目录的 `backups/<时间>/`，备份不提交 Git。重新运行安装脚本可更新插件。

打开新的 Codex App 任务，在插件中启用 **Cursor Delegate**，让 Codex 调用 `cursor_status`。返回根目录应等于安装时指定的目录；确认后才开始测试派工。CLI 安装成功并不证明 App 成功加载 MCP。

本次开发机先使用 Codex 官方脚手架安装为 `cursor-delegate@personal`，源码位于 `~/plugins/cursor-delegate`。若改用上述独立安装器，请先卸载旧的 personal 安装，避免同时启用两个 MCP 实例。

## 日常派工

可以对 Codex 说：“在已授权项目内，让 Cursor 实现这个修复。你判断技术方案并独立运行测试，必要时在同一会话返修。”

工具顺序：`cursor_status` → `cursor_start` → `cursor_prompt` → `cursor_wait` → 按需 `cursor_answer` → `cursor_result`。Codex 阅读真实文件和测试结果后，用同一 session 的 `cursor_prompt` 提出修正，最后 `cursor_close`。

- 问题和计划由 Codex 按实际内容审阅；不会一律回复“同意”，也不会默认要求用户批准。已有原生问答工具时使用回调；没有时以文本返回并结束本轮，由 Codex 在同会话答复。无需去父目录寻找通信协议。
- 用户项目授权为外层约束；每次 `scope` 为内层派工范围，Codex 可在外层授权内调整。
- 每次派工使用新的 `request_id`。观察超时只重新读取状态，不能重复发送原任务。
- Cursor 活动期间，Codex 不写它负责的文件；工具始终回报规范化 `cwd`、会话、轮次和进程状态。
- 模型使用 Cursor 现有默认配置；不提供未核验的模型参数，不改付费设置。

## 权限边界

MCP 服务是用户级 Node 进程。它启动单独的 Cursor 进程组，显式使用 `--sandbox enabled acp`。**Codex 的沙箱不会自动覆盖 Cursor；根目录检查和派工提示也不是 OS 安全隔离。** 原生沙箱是否覆盖当前版本的全部工具尚未做真实写入验证。

ACP `session/request_permission` 一律返回取消结果并终止会话；未知的客户端操作同样拒绝。没有允许权限的 MCP 工具，没有 `user_approved` 参数，普通计划接受不等于安全授权。安全拒绝或取消后，本服务进程锁定，不能通过 close/start 或 recover 继续；不得以重启服务绕过拒绝。

此默认值也可能拦住已授权的普通编辑/测试。如果 Cursor 原生接口要求权限批准，当前版本不能替用户完成可信批准，因此会阻塞，不能保证完整自主代码闭环。未来必须通过宿主可信人类交互解决，不能加入模型可自行填写的授权字段。

既有 Cursor 配置仍可能影响原生权限。插件拒绝带 Cursor MCP 配置的工作区和用户环境，避免附带工具取得额外权限；不会主动覆盖用户的 CLI 权限或认证。当前配置变更与实际沙箱行为仍需在部署环境单独验证。首轮只用无敏感内容的测试项目。

## 宿主原生弹窗检查：当前未通过

新版提供 `cursor_probe_host_interaction`，只用于本插件接入验证。它在宿主声明支持 MCP form elicitation 时请求一个原生测试表单；宿主未声明时返回 unsupported，不尝试其他授权路径。45 秒无人回复会取消。

在新的 Codex App 任务中启用插件，要求只调用此工具；出现弹窗后亲手选择“拒绝/取消”，再报告是否真的看到弹窗。此工具没有连接 Cursor 的代码，不启动会话、不读取项目，也不会授予任何权限。接受、拒绝、取消、错误、超时都不会解锁原会话。

**返回 accept 不证明人类批准**：宿主可能自动处理请求。探针始终返回 `grants_permissions=false`、`human_identity_verified=false`，实际原生 UI 及其人类答复仍须单独验证。现有安全拒绝逻辑完全保留。

2026-09-17 已在 App 内实际调用一次：宿主声明支持表单并返回 decline，但用户确认没有看到弹窗。当前任务采用 never 非交互审批策略；现有回执不包含具体拒绝原因。**人工授权通道未接通，整体代码委派闭环仍未通过。** 在宿主人工交互条件未改变前，不要重复探测或恢复被拒绝的 Cursor 任务；详见 [验证记录](VERIFICATION.md)。

通过这个诊断后，还需确认可绑定具体操作的可信授权机制，并实现授权内普通操作与安全升级的分流，最后才启动新的真实代码闭环验收。不要反复重跑 add 测试，也不要为通过测试扩大全局白名单。

## 故障定位

```sh
agent --version
agent status
node scripts/probe.mjs /absolute/path/to/disposable-test-project
```

探测只做真实 ACP 初始化、认证和建会话，不提交模型任务。认证超时会终止进程，不转为强制模式、不写凭据、不无限重试。

- `waiting`：查看完整 pending，Codex 答复普通问题或计划。
- `blocked`：`cursor_status.blocking` 直接显示拒绝来源、具体操作及原生原因；`cursor_result.safety_request` 保留原始请求。origin=bridge 表示插件收到权限请求后取消，不能把它混同为 Cursor 原生拒绝。没有相应新增授权和可信通道就保持停止。
- `disconnected`：先检查真实文件及进程，确认已执行内容。若 Cursor 声明支持 session/load，`cursor_recover` 最多尝试一次加载同会话，不重放原 prompt。
- `cancelled`：永久停止，不恢复。正在工作的任务用 `cursor_cancel` 取消。
- MCP 服务重启丢失内存会话，自动恢复未实现；不能把不确定状态当作未执行而重复派工。
- 结果仅保留当前轮，最大 1 MiB；下一轮前分页读取到 EOF。超限主动停止并报告失败。

## 停用、回退

先取消活动任务并关闭会话，然后在 App 插件页停用，或执行：

```sh
codex plugin remove cursor-delegate@cursor-delegate-local
# 本次开发机的 personal 安装用：
codex plugin remove cursor-delegate@personal
```

卸载不会删除源码或测试产物。需要回退插件代码时，将备份中的 `previous-plugin` 复制回该插件源码目录，重新安装。配置备份用于逐项比较恢复；不要把整份旧配置覆盖回去，以免抹掉其他插件后续变更。移除 marketplace 是可选步骤，应只移除本插件创建的独立来源。

## 开发与来源

无 npm 依赖。`npm test` 包含纯函数、模拟 ACP 子进程和真实 MCP stdio 服务测试；均不能替代真实 Cursor 和 App 验证。

已检查 [arikon 上游](https://github.com/arikon/agents-cursor-subagent-plugin) 的实际源码、规则、配置与测试，提交 `ce257353ecae9061fe45d084cb80e2d0c46207cd`。该快照无许可证文件，GitHub license 字段为 null，因此未复制、修改或分发其代码/Skill。此实现独立编写，按本仓库 MIT 许可证提供。它没有继承上游的测试覆盖或兼容性保证。

协议依据：[Cursor ACP](https://cursor.com/docs/cli/acp)、[Cursor CLI 权限](https://cursor.com/docs/cli/reference/permissions)、[Codex 插件](https://learn.chatgpt.com/codex/build-plugins)、[Codex MCP](https://developers.openai.com/codex/mcp)。没有照搬官方示例中的无条件 allow-once。

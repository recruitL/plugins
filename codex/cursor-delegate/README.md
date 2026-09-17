# Cursor Delegate（接入验证版）

Codex App → MCP 服务 → Cursor 官方 ACP。Codex 审阅普通技术问题和计划，读取实际产物并安排同会话返修；Cursor 负责代码实现。没有独立总控界面、任务数据库或额外付费服务。

**整体代码闭环尚未通过。** 旧 App 会话已完成问答和代码写入，但执行测试被权限策略阻止。新版已打通显式隔离启动、受限联网、登录链接交接、MCP 登录等待和取消；最新 App MCP 已完成真实账号认证和建会话；第一条模型请求返回 CONNECT 403，代码闭环仍未完成。分层证据见 [VERIFICATION.md](VERIFICATION.md)。

当前正在回归直接复用上游的最小方案，已验证原生登录复用和 MCP 候选入口；尚未启用。候选源码、权限差异和证据见 [UPSTREAM-REUSE.md](UPSTREAM-REUSE.md)。

## 安装与启用

当前隔离实现仅验证 macOS、Codex 0.153.4、Cursor Agent 2026.05.28-a70ca7c。需要 Node 22+ 和官方 Cursor Agent；不硬编码模型。

```sh
npm test
node scripts/install-local.mjs /absolute/path/to/fresh-test-project
```

目录必须是已授权、无敏感内容的短路径，位于共享临时目录外；当前 Cursor 的数据目录超过 84 字符会被提前拒绝。安装器可通过 `CODEX_BINARY`、`CURSOR_AGENT_COMMAND` 指定已安装的实际可执行文件，写入插件专用配置并在修改前备份，不覆盖整份 Codex 配置。安装器使用独立 `cursor-delegate-local` marketplace。

本开发机已有 `cursor-delegate@personal`，沿用 `~/plugins/cursor-delegate`，不要再并行安装第二份。更新后让 App 重载插件，再实际调用 `cursor_status`；CLI 安装成功不能替代 App 验证。

生产 MCP 服务必须配置 `CURSOR_DELEGATE_CODEX_SANDBOX`，否则拒绝启动 Cursor。`CURSOR_DELEGATE_NETWORK=cursor-api` 只允许原生代理访问已核验的 `api2.cursor.sh`；未设置时网络全部拒绝。默认 HTTP 模式 limited 只允许 GET/HEAD/OPTIONS，已实测会阻止 Cursor 必需的初始化 POST，不能用此默认模式宣称已可用。

在用户明确授权后，可在本插件用户级 MCP 环境中设置 `CURSOR_DELEGATE_API_HTTP_MODE=full`。此设置只取消 `api2.cursor.sh` 的 HTTP 方法限制（不限于 POST），其域名允许列表、文件隔离、禁止直连和 SOCKS/UDP 禁用仍保留。它不是全局沙箱 full access；但仍是网络权限扩大，不应由模型通过工具参数或任务文字自行启用。缺省保持 limited；删除此环境项并重载即可回退。安装器不会自动打开它。

## 登录与派工

1. Codex 调用 `cursor_status`、`cursor_start`。新版启动先返回 `starting`；继续 `cursor_wait` 或读取状态。
2. `awaiting_login` 时，Codex 将状态中的有效官方 `login_url` 展示给本人，在 Cursor 官方网页完成登录。不要向 Codex 提交 token，不用通用批准表单代替登录。
3. 凭据由 Cursor 原生内存存储保存，插件不读取现有钥匙串、不复制或落盘凭据。只有实际 ACP 认证与建会话成功后才进入 `ready`，此前 `cursor_prompt` 会被拒绝。
4. Codex 自行使用 `cursor_prompt → cursor_wait → cursor_answer → cursor_result` 协调普通问题和计划。读取结果到 EOF，检查真实目录中的文件和验证输出，再以新 request_id 在同一会话返修。

可以直接说：“在已授权项目内，让 Cursor 实现这个修复。你决定技术方案，检查真实改动并安排返修。”Cursor 工作时，Codex 不同时修改同一批文件。

## 权限与当前限制

- 显式外层 Codex OS 沙箱限制文件和网络；不能把 Cursor 的 `--sandbox enabled`、工作目录检查或提示词当成隔离证明。当前状态仍标记完整集成尚在验证。
- 原项目 `.cursor`、`.codex`、`.agents`、`.git` 和外层权限配置只读。Cursor 登录需要更新的会话偏好位于隔离缓存内；该偏好文件不是安全边界。凭据仍只在进程内存中。
- 显式隔离内的 `pwd`、范围内 `ls` 和指定 Node 测试文件可形成 `confined_command`，由 Codex 检查实际代码后用 decision/reason 审阅，只允许本次操作。复合命令、越界路径、额外执行参数和其他权限请求继续拒绝；没有扩大权限或代填人类批准的工具。
- 可信人类安全升级尚未接通，普通测试命令也仍可能被阻止；不要因此声称自主代码闭环已实现。官方登录链接交接也不授予代码执行权限。
- 新隔离模式暂要求新测试目录；登录最多等待五分钟。取消、失败不自动重试。内存凭据在进程退出时消失，因此隔离模式暂不自动恢复；旧原生模式的独立恢复测试不能替代这一限制。
- 新增 Agent 服务域名、完整模型流量和实际代码返修尚未验证，不自动扩域名或降低验收标准。

## 故障、停用和回退

`cursor_status` 给出真实 cwd、状态、进程及拒绝原因。观察超时只读取同一任务，不重发 prompt。`waiting` 的普通问题/计划由 Codex 回答；`blocked` 保持停止。需要停止时使用 `cursor_cancel`，它也取消登录并清除链接；`cursor_close` 释放会话。

先取消活动任务，再在 App 停用插件，或执行 `codex plugin remove cursor-delegate@personal`（独立安装器使用 `@cursor-delegate-local`）。回退时恢复该插件的备份源码和专用 `.mcp.json`，重新安装；不要覆盖整份旧 Codex 配置。卸载不会删除测试产物。

## 验证与来源

`npm test` 是确定性测试；`test:sandbox`、`test:network`、`test:cursor-bootstrap` 是显式运行的本机探针。单元测试、真实 MCP/真实 Cursor、实际 App 验证分别报告，不能互相替代。

已检查 [arikon 上游](https://github.com/arikon/agents-cursor-subagent-plugin) 的源码、规则、测试和许可证状态（ce257353ecae9061fe45d084cb80e2d0c46207cd）。该快照没有许可证，未复制其实现；此插件独立编写，采用仓库 MIT 许可。

官方入口：[Cursor ACP](https://cursor.com/docs/cli/acp)、[Codex MCP](https://developers.openai.com/codex/mcp)、[Codex 插件](https://learn.chatgpt.com/codex/build-plugins)。


登录故障定位：网页显示成功后仍以 cursor_status 为准。ready 才可派工；failed 时检查 failure_stage、diagnostic 和 authentication_completed。认证握手已完成也不代表 session/new 成功。diagnostic 仅含固定错误类别，unclassified 表示原因仍未知，不应要求用户盲目重复登录或放宽权限。过期的链接不能让已退出进程恢复；检查实际状态后才能安排新的人工登录。

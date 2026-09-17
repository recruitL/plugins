# Cursor Delegate（原生上游接入候选）

Codex App → 插件 MCP → Cursor 官方 ACP。Codex 决定技术方案、协调普通问题和计划、独立验收及安排返修；Cursor 负责实现。首版只使用一个执行会话。

**实际 Codex App 代码与返修闭环已通过：首轮独立测试 5/5，补改后 27/27，额外检查 3/3。候选已卸载停用。** 原生人工批准弹窗、全面权限拦截及系统隔离仍未验证，不宣称整体安全验收或生产可用。分层结果见 [VERIFICATION.md](VERIFICATION.md)。

直接加载固定版本的 [arikon 上游](https://github.com/arikon/agents-cursor-subagent-plugin)。上游没有许可证，因此不复制其源码；用户需保留单独检出目录。桥接没有重新实现通信和会话管理。详见 [UPSTREAM-REUSE.md](UPSTREAM-REUSE.md)。

## 安装准备

需要 Node 22+、单独的固定上游检出，以及支持 `--auto-review --sandbox enabled` 的官方 Cursor CLI。实际验证版本是 `2026.09.15-d2fe57e`；本机旧 `2026.05.28` 不支持所需参数。复用现有原生登录，不复制或覆盖认证文件；不设置文件凭据存储、不启用 force/yolo。

先生成可检查的安装目录（四个参数均为绝对路径，最后一层必须叫 cursor-delegate）：

```sh
node scripts/prepare-upstream-install.mjs \
  /absolute/authorized/test-project \
  /absolute/pinned-upstream-checkout \
  /absolute/official-cursor-cli \
  /absolute/new-staging-directory/cursor-delegate
```

准备器只生成新插件目录及测试项目内的 config/data/tmp 运行目录，不覆盖已有插件目录，不启动 Cursor，不修改宿主配置。输出包含清单、Skill、三份运行脚本和专用 `.mcp.json`；引用的上游及 CLI 必须位于持久位置。原来的 `install-local.mjs` 已停用，避免误装旧服务。

## 本机启用

**原生权限边界必须获得对应运行范围的明确授权。** 用户授权的原生联调和单次 App 测试均已结束，不涵盖一般生产使用。候选保持卸载；没有后续授权时保留源码与准备包，不启用实际 Cursor 工作。

已有 personal 安装时，按 Codex 官方 plugin-creator 更新流程操作：

1. 读取 marketplace 名称并确认现有条目确实指向 `~/plugins/cursor-delegate`。
2. 将旧插件目录及 Codex 配置备份到仅用户可读目录。配置备份仅用于比对，不整体覆盖恢复。
3. 用已检查的准备包替换该插件源码；保留其他插件和 marketplace 设置，不创建第二个同名来源。
4. 运行官方 `update_plugin_cachebuster.py`，再执行 `codex plugin add cursor-delegate@personal`。
5. 新 App 任务实际发现并调用 `cursor_start_session` 等新版工具才算 App 验证；终端 tools/list 或 CLI 安装成功不能代替它。

本仓库不内置隐式下载、自动批准或宿主审批策略修改。首次没有 marketplace 条目时，应由官方 plugin-creator 脚手架创建；不要手工覆盖整个 marketplace 文件。

## 日常派工与故障

在已有授权覆盖且验证可用的环境中，可以说：“让 Cursor 完成这个修复，你审阅方案、检查真实改动并安排返修。”Codex 使用 `cursor_start_session → cursor_send_prompt → cursor_wait/cursor_session_status → cursor_read_result`；普通问答与计划由 Codex 回答，不作为用户审批关卡。完整读取结果后检查实际 cwd、文件和测试，再在同一会话返修。Cursor 工作期间不要同时修改相同文件。

观察超时只检查同一任务，不重发 prompt。意外断线先核对进程与产物，最多显式加载同一 provider 会话一次；不能在取消或安全拒绝后自动恢复。停止活动回合用 `cursor_cancel`，释放空闲会话用 `cursor_close_session`。

若看到旧 `cursor_status/cursor_prompt`，说明 App 仍加载旧缓存，不能据此重复登录。若候选启动失败，检查上游版本与改动状态、绝对路径和 CLI 参数支持。模型列表可能要求独立 API key，不能为列出模型擅自获取付费凭据；已验证流程使用上游默认模型。

## 权限限制与回退

原生 Cursor 以本机账户权限运行；根目录检查不是 OS 沙箱。上游自动审阅可能在请求到达 MCP 前执行操作，`--sandbox enabled` 尚未证明 ACP 全面隔离。适配器只审阅到达它的指定普通命令，不能宣称覆盖所有工具。

未知操作和安全升级保持阻塞，没有可信人工升级通道。模型声称“用户已批准”不授予权限。命令名称受限也不保证测试代码没有副作用，Codex 必须检查实际代码与现有授权。

先取消活动任务，再从 App 停用插件，或 `codex plugin remove cursor-delegate@personal`。回退只恢复旧插件源码及其专用配置，重新 cachebuster/安装；不覆盖整份 Codex 配置。测试项目不会随卸载删除。

## 验证

`npm test` 是本仓库测试，其中含历史旧服务回归；它不等于上游原生或 App 验证。官方 plugin/Skill 校验、实际 MCP 初始化与工具发现、真实 Cursor 闭环和 App 内调用已有分层记录；其中的测试范围不同。详见 [VERIFICATION.md](VERIFICATION.md) 和[脱敏 App 摘要](tests/receipts/app-validation-summary-20260917.md)。

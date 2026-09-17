# 上游复用候选（未启用）

本候选直接加载 [arikon/agents-cursor-subagent-plugin](https://github.com/arikon/agents-cursor-subagent-plugin) 固定版本 ce257353ecae9061fe45d084cb80e2d0c46207cd。上游负责 ACP、会话、问答、计划、等待、结果、取消与恢复；这里不重写这些能力。上游没有许可证，因此代码留在用户单独检出目录，不复制到此仓库。

只增加两个小文件：upstream-entry.mjs 校验并加载上游，upstream-policy.mjs 更新工具说明并把安全权限答复限制为 reject-once。普通问题和计划仍使用原工具，由 Codex 决策，不要求用户审批项目流程。上游原 Skill 的普通问题/计划人工审批规则不安装。

## 当前证据

- 上游会话生命周期离线测试：54/54 通过。
- 已安装 2026.05.28 CLI 缺少 --auto-review，不能按当前上游参数启动。
- 官方 2026.09.15-d2fe57e 临时发行包 + 未修改的上游 Runtime：真实 ACP 空会话创建成功，复用已有原生登录，没有调用 authenticate、重新登录或发送模型 prompt，随后正常关闭。
- 上述空会话使用只返回空对象的 readModelAuth 注入，不读取用户 auth.json；证明原生登录可用，不证明默认上游 API-key 分支。最终入口沿用上游认证实现，尚未联调。
- 候选入口实际 MCP 初始化、列出 14 个上游工具、拒绝伪造人类批准参数：通过。未启动 Cursor，不是 App 验证。
- 权限适配单测通过；本地完整回归 39/41，通过宿主沙箱外的针对性重跑后，原先失败的登录监听所在文件 6/6 通过。未声称一次完整运行 41/41。
- 本轮插件通用校验器因环境缺少 PyYAML 未完成；插件清单和生产 MCP 配置未修改，入口语法和 git diff 检查通过。
- App 新入口、真实改代码/测试/返修、安全越界测试：未验证。

## 启用前必须明确的权限差异

本候选沿用上游 --auto-review --sandbox enabled。Cursor 的 Smart Auto 分类器可自动运行它认为安全的操作；到达 MCP 的其他权限请求不能由模型放行。它不具备可信人工授权通道。

这是本机原生 Cursor 进程，没有旧候选额外的 Codex OS 沙箱和 api2 单域名代理。根目录检查不是 OS 隔离，--sandbox enabled 也尚未证明 ACP 的命令隔离。限制 MCP 权限答复不能证明所有 Cursor 内部工具都被覆盖。因此不能把本候选宣称为满足全部安全验收；未经明确授权与验证，不替换当前已安装入口、不用它绕过此前网络拒绝。

## 候选配置

保留并备份原 .mcp.json 后，候选服务器入口为 node scripts/upstream-entry.mjs。必需环境：

- CURSOR_SUBAGENT_UPSTREAM：固定版本、无改动的上游检出绝对路径。
- CURSOR_SUBAGENT_ALLOWED_ROOTS：仅授权项目绝对路径的 JSON 数组。
- CURSOR_AGENT_COMMAND：经过核验且支持 --auto-review 的官方 Cursor CLI 绝对路径。

不设置 AGENT_CLI_CREDENTIAL_STORE=file，不覆盖认证文件，不启用 --force/--yolo。版本暂只在临时目录验证，尚未安装；不要把临时路径用于正式接入。当前生产 .mcp.json 未改。

# 上游复用（App 闭环通过，按项目用于日常委派）

本插件直接加载 [arikon/agents-cursor-subagent-plugin](https://github.com/arikon/agents-cursor-subagent-plugin) 固定版本 ce257353ecae9061fe45d084cb80e2d0c46207cd。上游负责 ACP、会话、问答、计划、等待、结果、取消与恢复；这里不重写这些能力。上游没有许可证，因此代码留在用户单独检出目录，不复制到此仓库。

运行时保留上游全部通信和会话实现。入口校验并加载固定上游；策略适配器接收完整 read/edit 请求及既有 execute 请求。file-review 负责文件范围与前后文本检查，review-gate 与 cursor-review-hook 将实际 Cursor 文件操作接入原待审阅队列，confined-command 保留命令分类。普通问题和计划由 Codex 决策，上游原 Skill 的普通项目人工审批规则不安装。

当前 App 安装版已实际验证两文件 Python 维护及同会话返修，读写审阅队列触发 18 次，独立测试最终 26/26，额外检查 2/2。详细分层结论见 [VERIFICATION.md](VERIFICATION.md)。

用户后续要求日常使用：Codex 派工和验证，Cursor 修改代码与返修。已按单个授权项目恢复安装，保留既有目录与权限限制；不再自动卸载或追加验证活动。下文的卸载记录属于此前单次测试收尾。

## 历史验证证据（不计入当前版本验收）

- 上游会话生命周期离线测试：54/54 通过。
- 已安装 2026.05.28 CLI 缺少 --auto-review，不能按当前上游参数启动。
- 官方 2026.09.15-d2fe57e 临时发行包 + 未修改的上游 Runtime：真实 ACP 空会话创建成功，复用已有原生登录，没有调用 authenticate、重新登录或发送模型 prompt，随后正常关闭。
- 上述空会话使用只返回空对象的 readModelAuth 注入，不读取用户 auth.json；证明原生登录可用，不证明默认上游 API-key 分支。最终入口沿用上游认证实现；后续完整真实联调已成功，不要求重新登录。
- 候选入口实际 MCP 初始化、列出 14 个上游工具、拒绝伪造人类批准参数：通过。未启动 Cursor，不是 App 验证。
- 权限适配单测通过；本地完整回归 39/41，通过宿主沙箱外的针对性重跑后，原先失败的登录监听所在文件 6/6 通过。未声称一次完整运行 41/41。
- 后续找到本任务已有 validation-venv，官方插件与 Skill 校验通过；没有为此安装系统依赖。源码默认配置和 Skill 已统一为上游入口；后续 App 实测已完成，候选已卸载。
- 新准备器与实际上游 MCP 打包检查：6/6 通过。独立临时 HOME 内，真实 Codex CLI 安装及缓存回读通过，没有启动 Cursor；这不是 App 验证。
- 用户明确批准本次原生联调后，真实 Cursor 写代码并测试，Codex 独立验收后同会话补充校验：初版 4/4，返修后 22/22 独立测试通过。
- 普通问答/计划使用文本回合完成，由 Codex 自行答复；没有把原生问答/计划回调模拟测试算成这次真实结果。
- 实际越界 touch 请求未获放行，伪造“用户已批准”被拒，哨兵文件不存在；随后取消，后续派工被拒。没有恢复该安全拒绝/取消后的会话。
- App 新入口：实际调用与同会话返修通过，独立测试为首轮 5/5、返修后 27/27、额外检查 3/3。候选已卸载；见 tests/receipts/app-validation-summary-20260917.md。

## 启用前必须明确的权限差异

本候选沿用上游 --auto-review --sandbox enabled。Cursor 的 Smart Auto 分类器可自动运行它认为安全的操作；Read/Write hook、原生 read/edit 权限和受支持的普通命令由 Codex 审阅；执行前依据实际 pending 请求、实际 cwd 和路径重新检查。未知/安全升级请求不能由模型放行。它不具备可信人工授权通道。

这是本机原生 Cursor 进程，没有旧候选额外的 Codex OS 沙箱和 api2 单域名代理。根目录检查不是 OS 隔离，--sandbox enabled 也尚未证明 ACP 的命令隔离。限制 MCP 权限答复不能证明所有 Cursor 内部工具都被覆盖。早期单次测试已经结束；用户随后明确授权按项目日常委派。现保留安装、目录限制和原生权限，不绕过此前拒绝。

## 候选配置

保留并备份原 .mcp.json 后，候选服务器入口为 node scripts/upstream-entry.mjs。必需环境：

- CURSOR_SUBAGENT_UPSTREAM：固定版本、无改动的上游检出绝对路径。
- CURSOR_SUBAGENT_ALLOWED_ROOTS：仅授权项目绝对路径的 JSON 数组。
- CURSOR_AGENT_COMMAND：经过核验且支持 --auto-review 的官方 Cursor CLI 绝对路径。

不设置 AGENT_CLI_CREDENTIAL_STORE=file，不覆盖认证文件，不启用 --force/--yolo。CLI 版本只在独立测试中验证，尚未替换全局 CLI；不要把临时路径用于正式接入。源码默认 .mcp.json 已指向本候选，prepare-upstream-install.mjs 生成专用配置；本机候选曾在测试结束后卸载，随后按用户要求恢复安装供日常使用。

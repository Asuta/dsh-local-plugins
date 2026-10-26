# Agent 全局设置

设置页新增 **Agent 全局设置**：

- 编辑 `$DSH_HOME/AGENTS.md`（默认用户 `.dsh/AGENTS.md`）。这就是原生 agent-instructions 读取的全局文件；未保存前不创建。项目／Agent 自身指令保留；不是覆盖系统约束的最高优先级。现有主／子 Agent 在原生下一请求指令协调时读取变化。
- 独立选择自动／手动／选区压缩的提供商和模型，或跟随当前会话。仅包装原生 BasicCompactionEngine 的 summarize 定制点，按每次调用建立不可变 config 视图；不改 Agent 模型、不监听 llm/stream、不改变主对话路由。自定义／未知引擎不假称支持。
- 刷新前端按钮调用当前窗口 location.reload，不重启后端；明确提醒可能丢失未保存设置或草稿。

## 保存与数据

指令及模型选择分别保存，均以读取时 revision 做冲突检查；串行保存＋同目录临时文件原子替换，临时文件失败清理，不留备份副本。拒绝符号链接和超出 128 KiB 的文件。压缩选择保存为 `$DSH_HOME/plugin-data/user-agent-settings/settings.json`。

UI 和模型工具 `user_agent_settings` 调用同一 Host operation；工具延迟加载，只输出内容／元数据，不发模型请求。刷新是纯用户界面操作，不提供工具。HTTP route 仅同源并要求自定义请求头，拒绝跨源及 GET 修改。

## 兼容性与验证

全局文件由已挂载的原生 agent-instructions 读取；Minimal 等未加载原生模块的预设通过 required prompt context 补充。当前 standard、ptc、cordis 使用原生路径，minimal 使用回退；回退不覆盖项目／角色指令且原生路径不重复注入。同 ID 预设的旧 revision 若改变原生加载器开关，以及条件启用的加载器，状态会有兼容性边界；切换这类自定义组合后需重新核验。压缩 adapter 基于当前原生 BasicCompactionEngine 的受检查实现形状，对当前及后续主／子 Agent 作用，卸载恢复原方法，不覆盖之后安装的其它包装。新模型选择在下一次压缩生效，进行中的压缩保持原选择。

独立 tests 在 `.user-agent-settings`：core 使用工作区隔离 fixture，覆盖 UTF-8 限制、版本冲突、并发保存、重载、无效模型失败不落盘；不改实际全局指令和用户模型配置。压缩测试使用无 I/O 假引擎，不消耗真实模型额度。真实已安装状态需另外检查。

历史重新编辑／永久截断不在本插件中实现。当前内核追加式日志缺少跨缓存、搜索与存储代际的安全不可逆重写事务，不能把 UI 隐藏当作删除。

### 最终验收（2026-10-26）

- 已安装：@local/user-agent-settings 1.0.2；Client settings.section 的 user-agent-settings 入口 active。
- 实机读取：standard、ptc、cordis 原生指令加载；minimal required-context 回退 active；压缩 adapter 已接入原生主／子 Agent 作用域，无状态错误。
- 组合回归：35 项测试及 22 项持久化断言全部通过；语法和 git diff --check 通过。隔离测试不修改真实用户指令、模型选择或会话历史。
- 验收边界：设置页面布局与点击保存尚未在已登录主窗口自动验收；刷新按钮未由 Agent 自动触发。默认仍为跟随会话，未替用户指定压缩模型。
- 未进行 Git 提交或推送。

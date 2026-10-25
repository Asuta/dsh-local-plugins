# 对话跨工作区移动：0.2.1 实现与验证

更新时间：2026-10-25，Asia/Shanghai。

## 已接入正式拖拽

支持未加载或已加载且 idle 的普通对话，无需重启 DSH。跨工作区拖放和撤销调用同一 Host 搬移操作；运行中的回复、工具、maintenance，以及正在处理的会话操作拒绝移动。

已加载对话依次执行：官方 sessions.flush 持久化检查点 → 唯一匹配的 agentLoop.lifecycle 清理 → 备份日志目录与工作区索引 → 改写 cwd、移动目录 → 失效该 id 的头部缓存 → 更新 Workspace 归属 → 原 sessionController.resolveAgent 重开并核对队列。

临时覆盖目标 Agent 的 cancel 保留 durable inbox；只抑制搬移期间该 id 的 api-session/removed，不抑制实际 Session 生命周期事件。客户端保留原 Session、scope、投影容器与输入绑定；搬移结束后刷新元数据。快速重复刷新合并为下一轮，并经过搬移完成屏障。

## 已完成实测

只操作已备份的测试对话 session-7ff31c6b-7ccd-41bf-80d4-9898709ce6cd，没有卸载当前工作对话。测试包含用户消息和一条合法的待发用户输入，不是只测空日志。

- 正向移动、原控制器重开、反向移动（撤销所用的同一接口）通过。
- 持久化原事件前缀逐条一致；inbox 内容及消息 id 一致。应用允许追加正常恢复事件，不用全日志哈希不变作为错误断言。
- 目标 attachSession 人为失败后，原目录、单一归属、live Agent、Session 和 inbox 自动恢复。
- maintenance 阶段移动被 AGENT_RUNNING 拒绝且状态未变。
- 同时提交两次移动：一次成功，另一次 MOVE_IN_PROGRESS。非法 id 拒绝。
- 其它已加载 Agent 对象身份保持不变。
- 已连接客户端临时 retain 测试报告搬移期间 sameSession、sameScope、sameProjectionStore 均为 true，removed=false；未切换用户当前聊天。
- 修复并审查整次 commands.execute 的并发计数、旧 Agent 身份检查，以及 teardown 抛错但已经 detach 时漏重开的恢复缺口。

证据：../.session-mover/live-move-results.json。客户端双向路径定时报告测试在 15 秒预算内未稳定通过，没有生成通过报告；不能据此宣称真实鼠标拖放、草稿附件或滚动位置已逐项实测。

## 历史完整性

保留 zstd 拼接多帧修复：只改写首帧 header，使用 decoder bytesWritten 定位边界，其余压缩帧原字节保留。卸载前先执行官方 flush，避免尚未达到检查点的新事件丢失。

## 兼容性与边界

生命周期 effect label、内部 resolver、Agent phase、Client manager 等是私有实现依赖。实现按当前运行时形状检查，缺少所需接口或唯一 lifecycle 时拒绝；不是公开 unload API，也不是对所有未来 DSH 版本的保证。

不支持搬移正在执行自身工具的对话。必须先停止运行中的目标；不会取消用户回复来强制移动。客户端真实鼠标拖放手感仍需在当前页面人工确认；浏览器自动化只得到认证页，已关闭该测试 tab。

## 清理

临时 verify / verify-client 路由、客户端测试 retain 与测试轮询从生产源代码移除。测试对话已搬回 test 工作区、完整卸载、恢复原始日志字节。最终安装后再次核对状态及备份哈希。验证脚本仅作为历史实验材料，不随 package files 发布，临时路由移除后不能原样重跑。

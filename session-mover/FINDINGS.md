# 对话跨工作区移动：0.3.0 实现与验证

## 0.3.0 落位排序

- 工作区标题落点：普通对话进入普通分区首位（全部置顶对话之后），置顶对话进入置顶分区首位；始终保持原置顶状态。
- 同分区行的上下半区分别插入之前／之后；跨分区落点自动进入自身分区首位。插入线显示实际有效位置，同工作区拖动仍交给原生处理。
- Host 更新 cwd／归属后用原生 Workspace.insertSessionBefore 排序；撤销 token 保存原归属和完整原始相邻顺序。回滚和撤销只调整被搬移对话，不整体覆盖工作区索引。
- 侧栏实际使用浏览器本地顺序而非 Host 原始顺序。通过原生侧栏 store 的现有实例和 setSessionOrder 动作同步，首次指定位置与原生拖拽一样进入手动排序；读取完整账户成员，包含折叠隐藏的条目。
- 搬移完成后等待工作区归属流，再按最新本地状态插入，保留期间其它对话的排序；撤销恢复原显示位置。原来按更新时间排序且没有其它手动变更时，恢复该模式。
- 不直接编辑 localStorage，不调用 pin／unpin。排序适配器不可用时拒绝 UI 搬移；这是原生 store 的受检查私有实现依赖。
- 折叠列表的“更多”行不是落点；完全隐藏的目标分区没有可准确绘制的插入线，需先展开列表。最后可见行之后的第一个隐藏成员之前仍是明确边界，允许落位。
- 新增 46 项无会话变更的自动化断言：普通／置顶标题、同分区前后、跨分区、尾部与空组、失效锚点、原始／显示相邻顺序恢复、代理服务解包、隐藏列表、最新排序合并及新会话占位。脚本位于 ../.session-mover/test-placement.mjs，不随插件包发布。
- 已连接 GUI 的 0.3.0 observer 报告 ordering.ready=true，确认当前原生 store 适配成功；不把该报告等同于真实鼠标拖拽视觉验收。
- 安装后真实 Host 五组往返通过：标题、指定之前、指定之后、普通对话落置顶行、分区尾部；每轮撤销后全部工作区原始成员顺序、全局置顶列表和冷对话日志 SHA-256 都与该轮开始前一致。证据：../.session-mover/installed-placement-results.json。
- 本次测试开始时，测试对话已经由用户移至 WebApp；因此按最新状态恢复 WebApp，而非强制搬回旧记录中的 test。未操作当前工作对话或真实置顶对话。测试期间 SESSION_BUSY 按安全设计拒绝，有限重试后通过。

## 0.2.1 历史验证记录

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

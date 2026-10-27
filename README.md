# dsh-local-plugins

一组自用的 **DSH（DeepSeek Harness）** Web 客户端插件，收在同一个仓库里。

每个子目录都是一个独立可安装的 DSH bundle：`package.json` 里用 `dsh.bundle.patch` 声明补丁层，用 `dsh.client` 声明浏览器侧入口。彼此不依赖，可以单独装、单独删。

仓库里同时放了仓库级的 Codex skill（`.agents/skills/`），改插件之前可以先读那里。

## 插件一览

| 目录 | 包名 / 版本 | 说明 | 注册位置 |
| --- | --- | --- | --- |
| [archived-sessions](./archived-sessions) | `@local/archived-sessions` 0.1.0 | 归档会话管理：在设置页里列出、恢复、永久删除已归档会话 | `settings.section` |
| [desktop-navigation](./desktop-navigation) | `@local/desktop-enhancements` 1.0.1 | 点击 Chat 里的本地路径直接在资源管理器打开或定位，并给 Recent 列表加折叠动画 | `sidebar.footer.action`、`conversation.view`（包装 Chat 入口） |
| [hide-new-session](./hide-new-session) | `@local/hide-new-session` 1.0.0 | 隐藏侧栏顶部的「新会话」按钮（纯 CSS 注入，不占用 slot） | — |
| [session-mover](./session-mover) | `@local/session-mover` 0.3.0 | 跨工作区拖拽空闲对话，保留历史与待发消息，支持精确落位、原位撤销和失败回滚 | `shell.overlay` + Host 搬移服务 |
| [sidebar-clock](./sidebar-clock) | `@local/sidebar-clock` 1.0.0 | 侧栏时钟：底部按钮 + 全页时钟（模拟表盘、数字时间、日期、本地时区） | `sidebar.footer.action`、`shell.overlay` |
| [sidebar-more](./sidebar-more) | `@local/sidebar-more` 1.0.1 | 侧栏精简：只保留插件市场与「更多」，并把置顶会话收拢成「工作区」上方的独立分区 | `sidebar.footer.action`、`sidebar.panellist.actions`、`sidebar.workspaces` |
| [user-agent-settings](./user-agent-settings) | `@local/user-agent-settings` 1.0.3 | 编辑全局 `AGENTS.md`、选择压缩模型、从设置页刷新前端 | `settings.section` |

`desktop-navigation` 的目录名和包名不一致，安装时以 `package.json` 的 `name` 为准。

`session-mover` 要求目标对话空闲：运行中的回复、工具调用或维护操作需要先停止。它依赖会话日志头、工作区实体的 `attachSession`／`detachSession` 和注册表的 canonical-cwd 索引，形状不兼容时拒绝搬移，失败会回滚到搬移前的状态。

## 目录约定

每个插件目录结构一致：

```
<plugin>/
├── package.json        # dsh.bundle + dsh.client 声明、files 白名单
├── index.js            # Host 侧入口（多为 apply() {} 空实现，纯前端插件不需要）
├── client.js           # 浏览器侧入口，window.__ModuleLoader__.load({ id, factory })
├── cordis.patch.yml    # bundle 的 insert 行，把插件插进 cordis 加载树
├── icon.svg            # 插件图标
└── locale/{zh,en}.json # 文案
```

`client.js` 是自包含的浏览器脚本：没有打包步骤，通过 `require('react')` 等已注入模块运行，样式用 `ctx.effect` 注入（不用 CSS Modules），定时器走 `ctx.interval` / `ctx.timeout` 以便随 Fiber 清理。目前只有 `desktop-navigation` 带构建步骤（`build.mjs`），其余插件的 `client.js` 就是源码。

## 仓库里的其他内容

- `.agents/skills/`：仓库级 Codex skill。四个是 DSH 内置 skill 的副本（`cordis-plugin-development`、`cordis-composition-reference`、`editing-cordis-compositions`、`agent-experience`），第五个 `dsh-skills-in-codex` 说明在 Codex 里怎么用它们、以及本仓库的坑位。
- `docs/`：结论性文档，例如消息重新编辑的可行性评估。

## 安装

DSH 目前没有针对本地目录的一键安装，实际做法是让 profile 以 `link:` 方式引用（本机就是这么用的）。

编辑你的 profile 目录，例如 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "@local/sidebar-clock": "link:<本仓库绝对路径>/sidebar-clock"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@local/sidebar-clock"
      ]
    }
  }
}
```

要点：

- `dependencies` 的键必须和插件 `package.json` 里的 `name` 完全一致；
- 用 `link:` 指向本仓库中对应的子目录，克隆到别的盘符 / 用户目录时记得改这个路径；
- `dsh.profile.bundles` 里加同一个包名，否则补丁层不会加载；
- 改完在 profile 目录跑一次 `pnpm install`，然后重启 DSH；
- 卸载就是反向操作：从两处删掉条目、清掉 `node_modules/@local/<名字>` 的 junction、`pnpm install`，再删掉插件目录。

只删目录不删 profile 会留下悬空 junction，DSH 下次启动就加载失败。完整的安装与卸载步骤见 `.agents/skills/dsh-skills-in-codex/references/profile-plumbing.md`。

## 兼容性

开发和验证环境是 **DSH 0.2.1-rc.3**（Web surface）。插件依赖 `@deepseek-ai/dsh-client-*` 的 slot 与 Builtin 约定，其中几个还挂在私有接缝上：

- `desktop-navigation` 改动 Chat StoredEntry 的可写组件属性；
- `sidebar-more` 借用 workspace 分组注册的 `renderSlot`，并镜像 `SessionNodeItem` 的行结构；
- `user-agent-settings` 包装原生 `BasicCompactionEngine.summarize`；
- `session-mover` 依赖会话日志头与工作区实体的搬移方法。

跨大版本升级后这些都要重新确认。桌面版的宿主代码连同它自带的包都压在 `app.asar` 里，`.agents/skills/dsh-skills-in-codex/scripts/asar.mjs` 可以直接读里面的文件做核对。

## 许可

个人自用代码，未附开源许可证（即默认保留所有权利）。想借用其中某个插件，请先开 issue 说一声。

`desktop-navigation` 内含 `dsh-recent` 的 MIT 授权副本，原始版权声明保留在 `vendor/LICENSE.dsh-recent`。


# dsh-local-plugins

一组自用的 **DSH（DeepSeek Harness）** Web 客户端插件，收在同一个仓库里。

每个子目录都是一个独立可安装的 DSH bundle：`package.json` 里用 `dsh.bundle.patch` 声明补丁层，用 `dsh.client` 声明浏览器侧入口。彼此不依赖，可以单独装、单独删。

## 插件一览

| 目录 | 说明 | 注册位置 |
| --- | --- | --- |
| [sidebar-pomodoro](./sidebar-pomodoro) | 侧栏番茄钟：底部按钮 + 全页专注计时，专注 / 短休息 / 长休息自动轮换，localStorage 续跑 | `sidebar.footer.action`、`shell.overlay` |
| [sidebar-clock](./sidebar-clock) | 侧栏时钟：底部按钮 + 全页时钟（模拟表盘、数字时间、日期、本地时区） | `sidebar.footer.action`、`shell.overlay` |
| [sidebar-more](./sidebar-more) | 侧栏精简：只保留插件市场与「更多」，把插件与自动化任务收进「更多」，含置顶会话处理 | `sidebar.footer.action`、`sidebar.panellist.actions` |
| [hide-new-session](./hide-new-session) | 隐藏侧栏顶部的「新会话」按钮（纯 CSS 注入，不占用 slot） | — |
| [archived-sessions](./archived-sessions) | 归档会话管理：在设置页里列出、恢复、永久删除已归档会话 | `settings.section` |

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

`client.js` 是自包含的浏览器脚本：没有打包步骤，通过 `require('react')` 等已注入模块运行，样式用 `ctx.effect` 注入（不用 CSS Modules），定时器走 `ctx.interval` / `ctx.timeout` 以便随 Fiber 清理。

## 安装

DSH 目前没有针对本地目录的一键安装，实际做法是让 profile 以 `link:` 方式引用（本机就是这么用的）。

编辑你的 profile 目录，例如 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "@local/sidebar-clock": "link:D:/Project/PlayGround/sidebar-clock"
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
- 卸载就是反向操作：从两处删掉条目、`pnpm install`，再删掉插件目录。

## 兼容性

开发和验证环境是 **DSH 0.2.1-rc.3**（Web surface）。插件依赖 `@deepseek-ai/dsh-client-*` 的 slot 与 Builtin 约定，跨大版本可能需要跟着改。

## 许可

个人自用代码，未附开源许可证（即默认保留所有权利）。想借用其中某个插件，请先开 issue 说一声。

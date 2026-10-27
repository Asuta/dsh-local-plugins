---
name: dsh-skills-in-codex
description: Use when working on the DSH plugin bundles in this repo under Codex and the imported Cordis skills (cordis-plugin-development, cordis-composition-reference, editing-cordis-compositions, agent-experience) would otherwise apply — it swaps their DSH-only tools for Codex file inspection and this repo's profile link install flow, and lists the private seams and profile plumbing that break.
---

# 在 Codex 里用这几个 DSH skill

`.agents/skills/` 下的四个 skill 原本写给 DSH（DeepSeek Harness）自己的 agent
会话。正文提到的 `plugin_manager`、`cordis_inspect_list`、`cordis_inspect_query`
在 Codex 里都不存在。它们的设计规则仍然成立，执行手段要换成本仓库的做法。
本文件只讲怎么换、在哪儿会踩坑。

## 选哪个

| 要做的 | 读 |
| --- | --- |
| 新增或修改 bundle、插件，选 slot，写 client.js | `cordis-plugin-development`，按其正文再读需要的 `references/` |
| 改 bundle patch、写 Loader 行、查某个包能否挂载 | `cordis-composition-reference`，包清单用 `rg -n` 搜 `references/packages.md` |
| 做 agent preset、决定放 Host 还是 preset | `editing-cordis-compositions` |
| 设计工具定义、skill、上下文加载 | `agent-experience` |

`cordis-plugin-development` 的 `templates/decoration/` 和 `templates/mcp/` 现在就在
磁盘上，可以直接复制到工作区。它们原本压在 `app.asar` 里，shell 读不出来；
挪到 `.agents/skills` 之后这个限制没有了。

## 工具替换

| skill 里的 | 这里怎么做 |
| --- | --- |
| `plugin_manager` `install_bundle` | 改 profile 的 `package.json`（`link:` 依赖 + `dsh.profile.bundles`），`pnpm install`，重启 DSH。见 [references/profile-plumbing.md](references/profile-plumbing.md) |
| `plugin_manager` `remove_bundle`、`set_plugin`、`set_bundle` | 同一份流程的反向操作；只想关掉某个插件时从 `dsh.profile.bundles` 里摘掉，保留 `dependencies` 的 link |
| `plugin_manager` `list_plugins`、`list_bundles` | 读 profile 的 `package.json` 和 `cordis.patch.yml`；已装状态看 `node_modules/@local/` 的 junction |
| `cordis_inspect_list` | `node scripts/asar.mjs ls dsh/node_modules/@deepseek-ai` 列 DSH 自带的包；本仓库的插件直接读目录 |
| `cordis_inspect_query` `Service`、`Event` | `node scripts/asar.mjs grep "<方法名或事件名>"`，再 `read` 命中的 `lib/index.js` 或 `lib/types/**/*.d.ts` |
| `Config.listConfigs` | 同上，读 `lib/types` 里的 Config 声明，或 grep `Schema.object(` 找运行时校验 |
| `Slots.listSubTree` | `grep "ctx.slots.register"` 或具体 slot 名，能拿到真实 slot 名、id 和注册参数 |
| `Theme` token | `grep "--dsw-alias-"` 看宿主实际定义的变量 |

DSH 装在 `D:\SoftWare\dsh`，宿主和它自带的包都在 `resources\app.asar` 里。文件读取、
`cat`/`ls`、ripgrep 的目录遍历、`require` 和 pnpm 都打不开这个包，所以用本 skill
目录下的 `scripts/asar.mjs` 直接解析归档头：

```
node scripts/asar.mjs ls  dsh/node_modules/@deepseek-ai        # 列包
node scripts/asar.mjs grep "ctx.slots.register" --max 3 --context 600  # 搜内容
node scripts/asar.mjs read dsh/node_modules/<包>/lib/index.js   # 读整个文件
```

归档里的路径都以 `dsh/` 开头。先 grep 再 read，别把整个包倒进上下文。少数带原生二进制的
包在 `app.asar.unpacked` 下，是普通文件，直接读。profile 自己的
`node_modules/@deepseek-ai` 只有 `cosmokit` 和 `schemastery`，不要以为那里有全部宿主包。

遇到这几个工具名时按上表处理，不要假装调用它们。

## 仍然照做的部分

跟工具无关的规则是真的，不要因为换了宿主就跳过：

- bundle 结构：`dsh.bundle.patch` 指 YAML，`dsh.client` 声明 `platform`、
  `immediately`、`inject`；`client.js` 用
  `window.__ModuleLoader__.load({ id, factory })`，`require('react')` 来自浏览器
  模块表，不另装 React。
- 资源一律在 `apply` 里用 `ctx.effect` / `ctx.on` 登记并返回清理函数；工厂函数
  不产生副作用；可见文案走 Client locale 服务。
- 安装前的显示检查：`locale/zh.json` 与 `locale/en.json` 的 `meta.title`、
  `meta.description`，原创或可再分发的图标，`exports` 与 `files` 覆盖到位。
  `files` 对 `link:` 安装不生效，真正生效的是目录里有什么。
- 安装成功不等于用户看得到。`application: applied` 在 Codex 里对应「profile 有
  这一行 + junction 解析得通 + 重启后该行 active + 真的看过界面」。

## 本仓库的坑

**版本耦合。** 插件挂在 DSH 私有接缝上：`desktop-navigation` 改 Chat StoredEntry
的可写组件属性，`sidebar-more` 借用 workspace 分组注册的 `renderSlot` 并镜像
`SessionNodeItem` 的行结构，`user-agent-settings` 包装
`BasicCompactionEngine.summarize`，`session-mover` 依赖会话日志头和
`attachSession` 的形状。全部按 DSH 0.2.1-rc.3 验过，升大版本后每一项都要重新确认。

**README 会漂。** 根目录 README 已经滞后：列着已删除的 `sidebar-pomodoro`，漏了
几个现存插件，`session-mover` 版本号也不对。以各目录的 `package.json` 为准。

**删插件不只是删目录。** 直接删目录会在 profile 的 `node_modules/@local/` 留下
悬空 junction，DSH 下次启动就会加载失败。profile 的 `package.json`、
`pnpm-lock.yaml` 和那个 junction 要同步清掉。

**profile 里 `pnpm install` 可能要求清空 `node_modules`。** pnpm 10 在这个
profile 上会报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，而 DSH 正跑着。
这时做最小手工对齐，不要为了跑通 install 把整个 `node_modules` 清掉。

**只有一个插件有构建步骤。** `desktop-navigation` 的 `build.mjs`。其余插件的
`client.js` 就是手写源码，直接改。以后再加带 `src/` 的插件，构建产物要与源码
一起提交。

**测试在点开头目录。** 例如 `node --test .desktop-navigation\navigation.test.mjs`。
它们用桩，不证明真机上的视觉效果。连着真实 DSH、会改真实会话的脚本不要进版本库
（`.session-mover` 下那四个 live 脚本已按此排除）。

**提交信息用中文**，按仓库根目录的 AGENTS.md。

## 验收顺序

前一步不过就不要往下走：

1. `node --check` 改过的 `client.js`；改过 `src/` 的先 build 再检查产物。
2. 跑相关 `node --test`。
3. profile 的 `package.json` 是合法 JSON、条目无重复；junction 能解析。
4. 重启 DSH，确认 Plugin Manager 里对应行 active，然后看实际界面。

视觉结论只在你真的看过界面之后才成立；安装成功和 slot 注册成功都不算。

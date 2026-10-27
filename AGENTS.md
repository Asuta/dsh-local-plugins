# AGENTS.md

本文件随仓库一起提交，记录本项目的稳定约定与验证方式。

## 项目概览

一组独立可安装的 DSH（DeepSeek Harness）Web 客户端插件，每个一级目录是一个
bundle。仓库级 Codex skill 在 `.agents/skills/`，改插件前先读
`dsh-skills-in-codex`。目录约定和安装方式见 README，以各目录的 `package.json`
为准。

## 常用命令

- 语法检查：`node --check <改过的 client.js>`
- 单元测试：`node --test .sidebar-more\pinned.test.mjs`，测试都在点开头的目录里
- 构建：`node desktop-navigation\build.mjs`（目前唯一有构建步骤的插件）

## 验证方式

UI 验证走独立的 Web 实例，不在桌面窗口里点：

- 起实例：`dsh --profile <测试profile> --port 3098 --no-open`，把打印出来的带 token
  的地址开在应用内浏览器，用选择器点、读 DOM、截图。
- 不要连正在用的桌面实例：它的端口每次不同，且需要它自己的 token，直接请求返回 401。
- 不要复用 `web` profile：它装的第三方插件在 0.2.1-rc.3 上会被跳过。新建一个只含
  `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 和待测 `@local/*` 的 profile。

桌面窗口只在两种情况下用，动手前先确认窗口不是最小化，并重新截图取坐标：

- 验证 Electron 原生能力，例如 `desktop-navigation` 的
  `remote.session.openWorkspacePath`。
- 确认桌面窗口里的真实观感。

测试若要动会话或工作区，把 `.credentials.yaml` 和 settings 复制到临时 `DSH_HOME`
再启动，避免改到真实会话——profile 是独立的，`sessions/` 和 `storages/` 是共享的。

## 坑点

- 新增 bundle 会被热加载；改已装插件的 `client.js` 必须重启才会加载新的模块代次。
- git 按 `core.autocrlf` 检出的是 CRLF，而 `.sidebar-more/pinned.test.mjs` 用带 `\n`
  的字面量匹配 `client.js`，直接跑会假失败；恢复文件后统一转回 LF。
- 只删插件目录不删 profile 会留下悬空 junction，DSH 下次启动失败。四处要一起清：
  `dependencies`、`dsh.profile.bundles`、`pnpm-lock.yaml`、
  `node_modules/@local/<名字>`。
- profile 里跑 `pnpm install` 可能要求清空整个 `node_modules`
  （`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）。这时做最小手工对齐，别清空。
  完整步骤见 `.agents/skills/dsh-skills-in-codex/references/profile-plumbing.md`。

## 文档维护

改插件集合、版本或验证方式时，同步更新 README 与 `.agents/skills/` 里的说明；
单个插件的行为变化则更新该插件目录的 README。

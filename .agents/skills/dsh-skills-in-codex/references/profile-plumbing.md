# profile 的安装与卸载

profile 目录在 `~/.dsh/profiles/<名字>`，本机是 `desktop`。目录里的
`package.json` 有两处要同时改，`dsh.profile.bundles` 里没有对应条目时补丁层
不会加载。

改之前先备份，沿用目录里已有的命名：
`package.json.bak-<原因>-<时间戳>`。

## 安装一个本地插件

1. 读插件 `package.json` 的 `name`，后面两处都要用这个字符串，不能改写成
   目录名。
2. 在 `dependencies` 加 `"@local/x": "link:D:/Project/PlayGround/x"`。
3. 在 `dsh.profile.bundles` 数组加同名项。
4. 在 profile 目录跑 `pnpm install`。
5. 验证：`node_modules/@local/x` 是能解析的 junction；重启 DSH；Plugin Manager
   里该行 active。

## 卸载

1. 备份 `package.json`。
2. 从 `dependencies` 和 `dsh.profile.bundles` 两处删掉。
3. `pnpm-lock.yaml` 的 importers 段里删这个包的三行（`specifier` 与 `version`
   各一行，加包名行）。
4. 删 `node_modules/@local/<name>` 这个 junction。用
   `[System.IO.Directory]::Delete($path, $false)`：它只删链接，不会跟进去删目标
   目录。删之前确认 `LinkType` 是 `Junction`。
5. 删工作区里的插件目录。
6. 重启 DSH。

顺序上先改 profile 再删目录，中间任何一步失败都还有可回退的状态。

## `pnpm install` 要求清空 `node_modules` 时

现象：`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，因为 pnpm 判定需要重建整个
`node_modules`。DSH 正在使用这些依赖，清空会打断它，也可能要重新下载。

这时跳过 `pnpm install`，手工完成上面第 3、4 步，让 `package.json`、
`pnpm-lock.yaml`、`node_modules` 三者一致。用户之后自己正常跑 install 时会自然
收敛，不会留下差异。

不要为了绕开提示设 `--config.confirmModulesPurge=false`。

## 只想关掉、不卸载

从 `dsh.profile.bundles` 里摘掉条目，保留 `dependencies` 里的 link。插件代码还在，
改回来就能启用，省一次安装。重启后该行不再加载。

## 常见失败

- **两处只改了一处**：补丁层不加载（漏 bundles），或模块解析不到（漏
  dependencies）。
- **名字不一致**：`dependencies` 的键必须等于插件 `package.json` 的 `name`，
  与目录名无关。
- **悬空 junction**：目录删了但 junction 还在，DSH 启动时加载失败。按卸载流程
  补齐。
- **没重启就看结果**：新装 bundle 可能靠 HMR 生效，但替换已装包的代码需要重启
  才会加载新的模块代次。

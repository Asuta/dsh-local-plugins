# 仓库级 skills

放在仓库的 `.agents/skills/` 下，供 Codex 在本项目里直接发现和加载。前四个是
从 DSH 内置 skill 抽出的副本（2026-10-27），来源是 `app.asar` 里的
`dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/`；升级 DSH 后可以用
`dsh-skills-in-codex/scripts/asar.mjs` 比对是否有变化。最后一个是本仓库自己的
使用说明。

| 目录 | 用途 |
| --- | --- |
| `cordis-plugin-development` | 设计、安装、启用、调试 bundle 与插件；含 `decoration`、`mcp` 模板 |
| `cordis-composition-reference` | bundle patch 的 Loader YAML 方言与可安装包清单 |
| `editing-cordis-compositions` | 编写和校验 agent preset 等 Cordis 组合 |
| `agent-experience` | 工具定义、skill、上下文加载的设计取舍 |
| `dsh-skills-in-codex` | 在 Codex 里怎么用上面四个：工具替换表、仓库坑位、验收顺序 |

Codex 按渐进式披露读取：先看 `SKILL.md` 的 `name` 和 `description` 判断是否
相关，命中后才读正文，再按需读 `references/` 和 `templates/`。

## 使用注意

四个上游副本的正文保持原样，没有改写。其中提到的 `plugin_manager`、
`cordis_inspect_query` 是 DSH 侧的工具，Codex 里并不存在；对应的做法由
`dsh-skills-in-codex` 给出，安装仍走根目录 README 的 `link:` +
`dsh.profile.bundles` 流程。

新增或修改 skill 时同步维护本表。用户级的同类 skill 在
`~/.codex/skills/`，两者互不覆盖。

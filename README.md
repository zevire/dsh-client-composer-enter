# dsh-client-composer-enter

> 中文（默认）：[README.md](README.md) ｜ English: [README.en.md](README.en.md)

> **面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的第三方非官方插件。**
> Enter 插入换行，Alt+Enter 发送；Shift+Enter 保持官方换行。不修改 dsh 任何源码。

dsh 的 composer 默认「裸 Enter 发送、Shift+Enter 换行」。写多行提示词时这是反的：一不留神就发出去了，想换行还得按修饰键。本插件只把**裸 Enter** 改成换行，发送交给 `Alt+Enter`；`Shift+Enter` 保持官方的换行行为，`Cmd/Ctrl+Enter` 的官方「互补」Queue/Steer 手势也**原样保留**。

已在 dsh `0.1.7-rc.2` / `0.2.0-rc.2` / `0.2.1-rc.2` / `0.2.1-rc.3`（桌面版与 Web profile）上验证。

## 行为

| 按键 | 结果 |
| --- | --- |
| `Enter` | 插入换行 |
| `Shift + Enter` | 插入换行 —— **官方默认，插件不干预** |
| `Alt + Enter` | **发送**（重放官方 `enter` 手势） |
| `Cmd/Ctrl + Enter` | 不改动 —— 官方互补 Queue/Steer 手势 |
| `Shift + Alt + Enter`、AltGr+Enter 等 | 不改动 |
| IME 组合中（`isComposing` / keyCode 229） | 交还输入法 |
| `/`、`@` 菜单或命令弹层打开 | 交还官方选择器 |
| 已认领命令 / 提交中（`data-phase` ≠ `plain`） | 交还官方提交路径 |

> `Cmd/Ctrl+Enter` 在官方快捷键表里是 `fixed.complementary`（「使用互补的 Queue/Steer 方式」）：默认「繁忙时排队」设置下，它在智能体运行时等于插话发送，空闲时等同普通发送。本插件不动它。

## 安装

本包是标准的 dsh **profile bundle**（`package.json` 声明 `dsh.bundle.patch`，`cordis.patch.yml` 插入一行 Loader 条目）。从本地检出安装：

**桌面版** —— 「设置 → 插件 → 安装」，粘贴本目录的**绝对路径**（如 `D:\Code\dsh-plugins\dsh-client-composer-enter`）；装完是**停用**状态，需在面板里启用。桌面 profile 由 Electron 独占，CLI 会拒绝 `dsh plugin --profile desktop …`。

**其它 profile（CLI）**：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-client-composer-enter
```

pnpm 会把包链接进 profile 的 `node_modules`，dsh 会把它追加进 `dsh.profile.bundles`。实测启用后即时生效，若未生效重启一次应用。

**卸载**：面板里移除，或 `dsh plugin --profile web remove dsh-client-composer-enter`。

## 配置

每次按键都会读 `localStorage`，改完无需刷新：

| 键 | 取值 | 作用 |
| --- | --- | --- |
| `dsh.composerEnter` | `off` | 回到官方按键表：Enter 发送、Shift+Enter 换行、Alt+Enter 无行为 |
| `dsh.composerEnterSendKeys` | `alt`（默认）/ `shift` / `both` | 哪个组合键发送；`shift`、`both` 恢复 0.5.0 之前的 `Shift+Enter` 发送 |

## 为什么不用改源码

官方 composer keymap 在 CRITICAL 优先级处理 Enter：裸 Enter 提交、`shiftKey` 落到纯文本编辑器的换行、`altKey` 被吞掉、`ctrlKey`/`metaKey` 走加速提交。本插件因此在 **window 捕获阶段**拦下**裸 Enter**，让原事件在编辑器看到之前就被消费，然后重放官方**已经实现**的手势：

| 你按下 | 重放成 | 官方结果 |
| --- | --- | --- |
| `Enter` | `shiftKey: true` 的 keydown | 换行 |
| `Alt+Enter` | 无修饰 keydown | 发送（遵循繁忙模式设置） |

`Shift+Enter` 不经过重放，直接走官方换行分支；`Ctrl/Cmd+Enter` 也不拦。两个关键细节：重放事件带自持标记（`__dshComposerEnterReplay`）避免自我拦截；重放**先造好并验证可标记**，再吞掉原手势 —— 宿主拒绝标记时退回官方按键表，而不是留下死键。重放还会透传原事件的 `repeat`，所以长按 `Alt+Enter` 不会连发。

## 兼容面

下表全部由 dsh 拥有；任一项改名或移除，插件只会退回官方按键表（不会破坏 composer）。

| 选择器 / 语义 | 归属 |
| --- | --- |
| `[data-composer-input][contenteditable="true"]`、`data-phase="plain"` | ui-conversation |
| `[data-trigger-menu]` | ui-input-trigger |
| `[data-composer-card] [role="listbox"]` | ui-commands 弹层 |
| keymap 的四种修饰键语义、按住键守卫（`event.repeat`） | ui-conversation composer keymap |

## 已知限制

- **设置 → 快捷键里显示的仍是官方映射**（`fixed.send` / `fixed.newline` / `fixed.complementary` 由官方只读注册）。实际生效以本插件为准。
- `Alt+Enter` 走官方 `enter` 手势，繁忙时的投递方式遵循官方设置（默认排队），插件从不插话。
- 官方没有提供可用的按键 seam（固定输入观察回调在 window 冒泡阶段，晚于编辑器的 target 阶段），所以是 DOM 层改道——这也是上面兼容表存在的原因。
- 只改文本输入区的 `Enter`；按钮、队列/插话控件、工作区选择器均不变。

## 开发

零依赖、无打包器、不联网：

```sh
node scripts/build.mjs      # 由 src/client/index.js 重新生成 lib/
node test/logic.test.mjs    # 23 个用例，跑在零依赖 DOM harness 里
```

`lib/` 是**有意提交**的：克隆下来即可安装，无需构建。CI 会重新构建并在 `lib/` 与源码不一致时失败。

## 许可

MIT，见 [LICENSE](LICENSE)。本项目与 DeepSeek 官方无隶属关系。

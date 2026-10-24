# dsh-client-composer-enter

> 中文（默认）：[README.md](README.md) ｜ English: [README.en.md](README.en.md)

> **Unofficial third-party plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**
> Enter inserts a line break. Alt+Enter sends. Shift+Enter keeps the official line break. No dsh source changes.

dsh's composer submits on a bare `Enter` and inserts a line break on `Shift+Enter`.
If you write multi-line prompts, the bare `Enter` is backwards: you send by accident.
This plugin turns **only the bare `Enter`** into a line break and moves sending to
`Alt+Enter`; `Shift+Enter` keeps the official line break, and `Cmd/Ctrl+Enter` stays
on the official complementary Queue/Steer gesture.

Tested against dsh `0.1.7-rc.2`, `0.2.0-rc.2`, `0.2.1-rc.2` and `0.2.1-rc.3` (Desktop and Web profiles).

## Behavior

| Key | Result |
| --- | --- |
| `Enter` | Insert a line break |
| `Shift + Enter` | Insert a line break — **the official default, left untouched** |
| `Alt + Enter` | **Send** (replayed as the official `enter` gesture) |
| `Cmd/Ctrl + Enter` | Untouched — the official complementary Queue/Steer gesture |
| `Shift + Alt + Enter`, AltGr+Enter, other chords | Untouched |
| IME composing (`isComposing` / keyCode 229) | Left to the input method |
| `/` or `@` menu open, command popup open | Left to the official picker |
| Claimed command / submitting (`data-phase` ≠ `plain`) | Left to the official submit path |

**About `Cmd/Ctrl+Enter`:** in the official shortcut reference this is
`fixed.complementary` — "submit the complementary way (Queue ⇄ Steer)". With the
default "queue while busy" setting it acts as *steer while the agent runs*, and as a
normal send when idle. This plugin does not change it.

## Install

The package is a standard dsh **profile bundle**: `package.json` declares
`dsh.bundle.patch`, and `cordis.patch.yml` inserts one Loader row that mounts the
browser half (and an inert host half). Install it from a local checkout:

**Desktop app** — Settings → Plugins → install, and paste the **absolute** directory of
this checkout, e.g. `D:\Code\dsh-plugins\dsh-client-composer-enter`. Entries install disabled:
enable the plugin in the panel. The desktop profile is owned by the Electron app, so
the CLI refuses `dsh plugin --profile desktop …`.

**Other profiles (CLI)** —

```sh
dsh plugin --profile web add /absolute/path/to/dsh-client-composer-enter
```

pnpm links the package into the profile's `node_modules`, and dsh appends it to
`dsh.profile.bundles`. In practice the plugin takes effect as soon as it is enabled;
restart the app if it does not.

**Uninstall** — Settings → Plugins → remove, or
`dsh plugin --profile web remove dsh-client-composer-enter`.

## Configuration

Read on every keystroke from `localStorage`, so no reload is needed after a change:

| Key | Value | Effect |
| --- | --- | --- |
| `dsh.composerEnter` | `off` | Back to the stock keymap: Enter sends, Shift+Enter breaks the line, Alt+Enter does nothing |
| `dsh.composerEnterSendKeys` | `alt` (default) / `shift` / `both` | Which chord sends; `shift` and `both` restore the pre-0.5.0 `Shift+Enter` send |

```js
localStorage.setItem('dsh.composerEnterSendKeys', 'both') // Shift+Enter sends again
localStorage.setItem('dsh.composerEnter', 'off')          // disable the plugin
localStorage.removeItem('dsh.composerEnter')             // restore
```

## Why this works without patching dsh

The shipped composer keymap (`ui-conversation`) owns the Enter semantics at CRITICAL
priority: unmodified `Enter` submits, `shiftKey` falls through to the plain-text
editor's line break, `altKey` is swallowed, `ctrlKey`/`metaKey` submits on the
accelerated path.

So this plugin intercepts the bare `Enter` gesture during the window **capture** phase,
stops the original event before the editor sees it, and re-dispatches the gesture the
official code already implements:

| You press | Replayed as | Official result |
| --- | --- | --- |
| `Enter` | keydown with `shiftKey: true` | line break |
| `Alt+Enter` | unmodified keydown | send (`enter` gesture → follows the busy-mode setting) |

`Shift+Enter` is never replayed: it reaches the editor and takes the official line-break
branch. `Ctrl/Cmd+Enter` is not intercepted either.

Two implementation details matter:

1. Replays carry an own-property stamp (`__dshComposerEnterReplay`), otherwise the
   plugin would intercept its own unmodified replay.
2. The replay is built — and proven markable — **before** the original gesture is
   swallowed. A host that refuses the stamp keeps the stock keymap instead of leaving
   a dead key.

The replay also forwards the originating key's `repeat` flag, so the shipped held-key
guard still refuses machine-gun sends when you hold `Alt+Enter`.

## Compatibility surface

Everything below is owned by dsh; a rename or removal degrades the plugin to the stock
keymap (never a broken composer).

| Selector / semantic | Owner | Purpose |
| --- | --- | --- |
| `[data-composer-input][contenteditable="true"]` | ui-conversation | confirm the target is the composer |
| `data-phase="plain"` on the same element | ui-conversation | reroute only in the plain phase |
| `[data-trigger-menu]` | ui-input-trigger | stay out of the way when a menu is open |
| `[data-composer-card] [role="listbox"]` | ui-commands popup | stay out of the way when a list is open |
| `shiftKey` → line break, unmodified → submit, `altKey` → swallowed, `ctrlKey`/`metaKey` → complementary submit | ui-conversation composer keymap | the replayed gestures |
| held-key guard (`event.repeat` → no send) | ui-conversation composer keymap | forwarded by the replay |

## Limits

- **Settings → Keyboard shortcuts still shows the stock mapping** (`fixed.send`,
  `fixed.newline`, `fixed.complementary` are registered read-only by the app). What
  actually happens is decided by this plugin.
- `Alt+Enter` goes through the official `enter` gesture, so a send while the agent is
  running follows the official setting (default: queue). The plugin never steers.
- dsh exposes no official keymap seam for this: the fixed-input observer runs in the
  window bubble phase, after the editor already handled the key. Rerouting is
  therefore DOM-level, and is the reason for the compatibility table above.
- Only the text composer's Enter changes; buttons, queue/steer controls and the
  workspace picker keep their behavior.

## Development

No dependencies, no bundler, no network:

```sh
node scripts/build.mjs      # regenerate lib/ from src/client/index.js
node test/logic.test.mjs    # 23 cases in a dependency-free DOM harness
```

`lib/` is committed on purpose: a checkout is installable without a build step. CI
rebuilds and fails if `lib/` differs from the sources.

```
src/client/index.js   the only logic source (plain ESM)
scripts/build.mjs     artifact generator + `node --check` gate
lib/client.js         browser artifact: window.__ModuleLoader__.load({ id, factory })
lib/index.js          host half: inert apply (the Loader needs a node-side row)
test/logic.test.mjs   behavior tests
test/dom-harness.mjs  the zero-dependency DOM used by the tests
cordis.patch.yml      the profile-bundle row
```

## License

MIT — see [LICENSE](LICENSE). Not affiliated with or endorsed by DeepSeek.

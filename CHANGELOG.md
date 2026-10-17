# Changelog

All notable changes to this plugin are documented here. The version tracks the
internal development line; `0.4.1` is the first public release.

## 0.4.1

First public release.

- Enter inserts a line break; `Shift+Enter` and `Alt+Enter` send through the
  official `enter` gesture; `Cmd/Ctrl+Enter` keeps the official complementary
  Queue/Steer gesture.
- Replayed gestures forward the originating `repeat` flag, so the shipped held-key
  guard still refuses repeated sends when a chord is held down.
- Replays are stamped and proven markable before the original gesture is consumed:
  a host that refuses the stamp keeps the stock keymap instead of a dead key.
- Escape hatches through `localStorage`: disable the plugin, or pick which send
  chord is active.
- Package form: standard dsh profile bundle (`dsh.bundle.patch` +
  `cordis.patch.yml`), installable from a local directory in the Plugins panel or
  with `dsh plugin --profile <p> add <path>`.
- Verified against dsh `0.1.7-rc.2`, `0.2.0-rc.2` and `0.2.1-rc.2` on the Desktop
  and Web profiles.

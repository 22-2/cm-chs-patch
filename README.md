# Japanese Word Splitting (22-2)

Adds Japanese word splitting support for the editor and Vim mode for Obsidian.md.

This is a fork of [aidenlx/cm-chs-patch](https://github.com/aidenlx/cm-chs-patch), maintained in [22-2/cm-chs-patch](https://github.com/22-2/cm-chs-patch). Its plugin ID is `japanese-word-splitting-22-2`, separate from upstream's `cm-chs-patch`, so Obsidian's community plugin updater does not identify it as the upstream plugin.

Special Thanks to [@fengkx](https://github.com/fengkx) for [jieba-wasm module](https://github.com/fengkx/jieba-wasm)
感谢 [@jiyee](https://github.com/jiyee) 实现的Vim分词支持！

注意：从 v1.8.0 开始，默认分词引擎由结巴分词更换为系统自带分词引擎，结巴分词不再是必备组件，若你需要结合 [omnisearch](https://github.com/scambier/obsidian-omnisearch) 插件使用，或仍需要使用结巴分词提供的更精确的分词结果，以及新词发现、自定义词库功能，请在设置打开选项后，按照弹窗提示进行安装（若系统不提供分词引擎，无论选项是否打开，本插件仍会提示安装结巴分词）

## Demo

| Obsidian's Default Word Splitting<br>默认分词 | Patched<br>安装插件后                     |
| --------------------------------------------- | ----------------------------------------- |
| ![ob-default-splitting](assets/before.gif)    | ![ob-patched-splitting](assets/after.gif) |

## Disclosure 安全声明

> [!WARNING]
> **直接文件系统访问**：在桌面端，本插件使用 Node.js `fs` 模块在 Obsidian Vault API 之外读写文件。这用于将结巴分词 WASM 文件（`jieba_rs_wasm_<版本号>.wasm`）存储在 Obsidian 的共享 `userData` 目录中，从而避免在每个库中重复安装：
>
> | 平台    | 路径                                                                 |
> | ------- | -------------------------------------------------------------------- |
> | macOS   | `~/Library/Application Support/obsidian/jieba_rs_wasm_<版本号>.wasm` |
> | Windows | `%APPDATA%\obsidian\jieba_rs_wasm_<版本号>.wasm`                     |
> | Linux   | `~/.config/obsidian/jieba_rs_wasm_<版本号>.wasm`                     |
>
> 在移动端，该文件通过标准 Obsidian Vault API 存储在库的配置目录（`<vault>/.obsidian/jieba_rs_wasm_<版本号>.wasm`）中，不涉及直接文件系统访问。

> [!WARNING]
> **Direct Filesystem Access**: On desktop, this plugin uses the Node.js `fs` module to read and write files outside of the Obsidian vault API. This is used to store the jieba WASM binary (`jieba_rs_wasm_<version>.wasm`) in Obsidian's shared `userData` directory so that it does not need to be duplicated in every vault:
>
> | Platform | Path                                                                  |
> | -------- | --------------------------------------------------------------------- |
> | macOS    | `~/Library/Application Support/obsidian/jieba_rs_wasm_<version>.wasm` |
> | Windows  | `%APPDATA%\obsidian\jieba_rs_wasm_<version>.wasm`                     |
> | Linux    | `~/.config/obsidian/jieba_rs_wasm_<version>.wasm`                     |
>
> On mobile, the file is stored inside the vault's config directory (`<vault>/.obsidian/jieba_rs_wasm_<version>.wasm`) using the standard Obsidian vault API, and no direct filesystem access is involved.

## Installation

1. Download `main.js` and `manifest.json` from a release of [this fork](https://github.com/22-2/cm-chs-patch/releases). Check that the manifest ID is `japanese-word-splitting-22-2`; older releases still use the upstream ID. Alternatively, build from source as described below.
2. Put both files in `<vault>/.obsidian/plugins/japanese-word-splitting-22-2`.
3. Reload Obsidian and enable **Japanese Word Splitting (22-2)** in Settings > Community plugins.

Install updates from this fork. The community plugin catalog entry for **Simplified Chinese Word Splitting** installs the upstream plugin.

### Migrating from the upstream ID

1. Disable the existing `cm-chs-patch` plugin in Obsidian, then close Obsidian.
2. Back up `<vault>/.obsidian/plugins/cm-chs-patch/data.json` if it exists.
3. Rename the plugin folder from `cm-chs-patch` to `japanese-word-splitting-22-2`, and replace `main.js` and `manifest.json` with this fork's new build. Keep `data.json` to preserve your settings.
4. Reopen Obsidian and enable **Japanese Word Splitting (22-2)**. Keep the upstream plugin disabled if it is also installed.

If an updater such as BRAT manages the old installation, remove that updater entry and configure it to use this fork before enabling updates again.

> Note: Replace `.obsidian` with your vault's configuration folder if you use a custom one. On macOS, press `Command+Shift+Dot` to show hidden folders in Finder.

## Development

### Prerequisites

- **Node.js 26+** — pinned in [`mise.toml`](mise.toml); the easiest way to provision it is [mise](https://mise.jdx.dev). If you manage Node yourself, run `corepack enable` to activate pnpm.
- **pnpm 12.9.0** — sourced from `packageManager` in [`package.json`](package.json) via corepack. No global install needed.
- **Obsidian 1.14.4+** — required for CodeMirror's public mouse hit-testing API.
- **Git** (any modern version).

### One-time setup

```bash
# 1. Clone the repository.
git clone https://github.com/22-2/cm-chs-patch.git

cd cm-chs-patch

# 2. Provision Node 26 + enable corepack (skip if you manage Node yourself).
mise install

# 3. Install dependencies.
pnpm install
```

### Scripts

| Command          | Purpose                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm dev`       | Vite watch build to `build/`; also writes `.hotreload` for the Obsidian Hot-Reload plugin             |
| `pnpm build`     | Production bundle to `build/main.js`; the version from `package.json` is stamped onto `manifest.json` |
| `pnpm typecheck` | `tsc6 --noEmit`                                                                                       |
| `pnpm lint`      | oxlint (`pnpm lint:fix` to autofix)                                                                   |
| `pnpm format`    | oxfmt check (`pnpm format:fix` to apply)                                                              |
| `pnpm release`   | release-it (maintainers only)                                                                         |

### Loading the build into Obsidian

Symlink (or copy) `build/` into a test vault as `<vault>/.obsidian/plugins/japanese-word-splitting-22-2`, then enable **Japanese Word Splitting (22-2)** in Obsidian's Community Plugins settings. With [Hot-Reload](https://github.com/pjeby/hot-reload) installed in the same vault, `pnpm dev` triggers live reloads on rebuild.

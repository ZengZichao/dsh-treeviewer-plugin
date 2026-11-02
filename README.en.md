# TreeViewer × DeepSeek Harness (dsh) plugin

Brings the cross-platform phylogenetic tree viewer **TreeViewer** into **DeepSeek Harness (dsh)**:

- **Chat tool**: describe the figure in a conversation; the agent calls the tool and returns the
  **preview image** together with the **settings JSON** that actually ran.
- **Dedicated panel**: a TreeViewer panel in the dsh main area — a parameter form generated from
  TreeViewer's own introspection on the left, a live preview on the right, settings persisted.

The plugin does not reimplement TreeViewer; it is a thin adapter that translates settings into a
`TreeViewerCommandLine` command stream, drives the CLI, and hands the image and settings back to dsh.

## Features

- Three layouts (rectangular / circular / radial) and four output formats (PNG, SVG, PDF, TIFF).
- High-level presets: branch width, branch colour, label font, label colour, support values; or pass a
  complete module pipeline per category.
- The parameter form follows the TreeViewer modules installed on the machine; no hand-maintained
  parameter table.
- Every render returns an "applied settings" JSON (input SHA-256, per-module parameters, resolution,
  output size).
- Untrusted modules with embedded source are refused by default; an allow-list is configured
  explicitly by SHA-256 or absolute path.
- Cancellation terminates the CLI child process; failures return structured errors
  (`code` / `message` / `hint`).

## Requirements

- **TreeViewer installed with its modules** (run `TreeViewer -I` once). Official builds are
  self-contained .NET 7, so no separate .NET runtime is needed; when only
  `TreeViewerCommandLine.dll` is found the plugin launches it through `dotnet`.
- **Node.js ≥ 20** (bundled with the dsh runtime).
- **dsh 0.2.1-rc.5** (the plugin declares `engines.dsh: >=0.2.1-rc.5 <0.3.0`).

## Quick install

```sh
pnpm install
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

The left rail then shows a **TreeViewer** entry, and Settings → Plugins lists the plugin with its
name and description. Confirm the composed config:

```sh
dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
```

Uninstall:

```sh
dsh plugin --profile desktop remove dsh-treeviewer
```

## Use

Ask in chat:

> Render `data/tree.nwk` with TreeViewer as a circular tree, branch width 2, support values, width 1200.

Or open the **TreeViewer** entry in the left rail, fill in the tree file and parameters, and press
Render; changing a parameter re-renders the preview automatically.

Full instructions are below.

## Documentation

| Topic | Chinese | English |
|---|---|---|
| Install and uninstall | [docs/zh/install.md](docs/zh/install.md) | [docs/en/install.md](docs/en/install.md) |
| Configuration | [docs/zh/configuration.md](docs/zh/configuration.md) | [docs/en/configuration.md](docs/en/configuration.md) |
| Tools and panel | [docs/zh/usage.md](docs/zh/usage.md) | [docs/en/usage.md](docs/en/usage.md) |
| Security model | [docs/zh/security.md](docs/zh/security.md) | [docs/en/security.md](docs/en/security.md) |
| Troubleshooting | [docs/zh/troubleshooting.md](docs/zh/troubleshooting.md) | [docs/en/troubleshooting.md](docs/en/troubleshooting.md) |

Live docs: <https://zengzichao.github.io/dsh-treeviewer-plugin/>

中文：[README.md](README.md)

## Repository layout

```
packages/treeviewer-core     Node adapter engine for TreeViewerCommandLine (no dsh dependency)
packages/dsh-treeviewer      dsh plugin: model tools, panel backend, browser panel
```

## How it works

The engine keeps one `TreeViewerCommandLine` process alive, writes commands one at a time, and waits
for its prompt. Every render is a clean pipeline:
`open` → Transformer → Further transformation → Coordinates → Plot action → `resolution` → export.
After exporting it re-reads the enabled modules and their options to build the settings JSON. Module
parameters come from CLI introspection, so the form and the tool parameters follow TreeViewer
upgrades automatically.

## Development and testing

```sh
pnpm -r check     # both packages load
pnpm -r test      # unit tests + integration tests against the real CLI
```

Integration tests skip automatically when TreeViewer is not installed; pointing
`TREEVIEWER_TEST_TBI` at a `.tbi` file with embedded source also exercises the trust flow.

## License

MIT. TreeViewer is distributed under its own license; this plugin only invokes its command line and
contains none of its code.

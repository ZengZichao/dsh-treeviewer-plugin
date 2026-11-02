# dsh-treeviewer

DeepSeek Harness plugin that brings TreeViewer into dsh.

- **Chat tools** `treeviewer_render` / `treeviewer_modules` / `treeviewer_options`: render from a
  natural-language request and return the preview image plus the settings JSON that actually ran.
- **Dedicated panel**: a TreeViewer panel in the main area with a CLI-introspected parameter form on
  the left and a live preview on the right.

The engine lives in `treeviewer-core`; this package owns only the dsh side (tool registration, panel
HTTP API, browser panel).

## Documentation

- [Install and uninstall](../../docs/en/install.md)
- [Configuration](../../docs/en/configuration.md)
- [Tools and panel](../../docs/en/usage.md)
- [Security model](../../docs/en/security.md)
- [Troubleshooting](../../docs/en/troubleshooting.md)

中文：[README.md](README.md)

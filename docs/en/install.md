---
layout: default
title: Install and uninstall
---

# Install and uninstall

This page explains how to install **dsh-treeviewer** into DeepSeek Harness (dsh) and how to confirm
it is active.

## Prerequisites

| Dependency | Requirement | Check |
|---|---|---|
| TreeViewer | Installed, with its module library | `TreeViewerCommandLine` starts and `module list available Coordinates` lists modules |
| .NET | Official builds bundle .NET 7; `dotnet` is needed only when you have a `.dll` | `dotnet --version` (optional) |
| Node.js | ≥ 20, bundled with the dsh runtime | `node --version` |
| dsh | 0.2.1-rc.5 (the plugin declares `engines.dsh: >=0.2.1-rc.5 <0.3.0`) | `dsh --version` |

TreeViewer needs `TreeViewer -I` once so its module library is installed; without modules the CLI has
nothing to load and the plugin returns `MODULES_NOT_INSTALLED`.

## Install

Install the workspace dependencies at the repository root:

```sh
pnpm install
```

Add the plugin to the target profile (`desktop` is the profile the desktop app uses; `web`/`tui` work
the same way):

```sh
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

The installer reads the plugin's `package.json`: `engines.dsh` must match the running dsh version,
otherwise the installation is refused with an incompatibility message. The engine package
`treeviewer-core` is installed into the profile's `node_modules` as well.

## Confirm the installation

```sh
dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
```

The output should contain `id: dsh-treeviewer` and its configuration block.

After starting dsh:

1. the left rail shows a **TreeViewer** entry (a small tree icon);
2. **Settings → Plugins** lists the plugin with its name and description;
3. opening the left-rail entry fills the main area with the parameter form and preview, and the status
   banner shows the detected TreeViewer version and CLI path.

A running app only loads newly installed packages after it is closed and reopened.

## Upgrade

Run `add` again; pnpm updates the local path dependency:

```sh
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

The same applies after editing the plugin source, because the profile keeps the copy installed at
install time.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-treeviewer
```

You may also delete the engine's temporary working directory (default: a `dsh-treeviewer` folder in
the system temp directory).

## Multiple profiles

Each profile manages its own plugins. The desktop app uses the `desktop` profile; `dsh web` uses the
`web` profile and serves the browser UI. Both surfaces share the same plugin code.

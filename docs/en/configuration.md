# Configuration

Plugin configuration lives in the profile's `cordis.patch.yml` (default:
`~/.dsh/profiles/<profile>/cordis.patch.yml`) and overrides the row shipped with the plugin. Restart
dsh after editing it.

## Full configuration

```yaml
- id: dsh-treeviewer
  name: dsh-treeviewer
  config:
    cliPath: ''
    workDir: ''
    trust:
      allow: []
      rememberKeys: false
    commandTimeoutMs: 300000
    introspectionTimeoutMs: 120000
    idleTimeoutMs: 300000
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `cliPath` | string | `''` | Absolute path to `TreeViewerCommandLine`. Empty probes `TREEVIEWER_CLI`, then `PATH`, then platform default install locations |
| `workDir` | string | `''` | Engine working directory for the persistent CLI, the sample tree and temporary exports. Empty means `<system temp>/dsh-treeviewer` |
| `trust.allow` | string[] | `[]` | `.tbi`/module files whose embedded source may compile: a 64-character SHA-256 hex digest or an absolute path |
| `trust.rememberKeys` | boolean | `false` | After allowing, also store the file's public key in TreeViewer's local store so later renders do not ask |
| `commandTimeoutMs` | number | `300000` | Timeout for one render command (open, export) |
| `introspectionTimeoutMs` | number | `120000` | Timeout for module/option introspection |
| `idleTimeoutMs` | number | `300000` | How long the persistent CLI may stay idle before it stops; `0` keeps it alive |

## Custom CLI path

Use this when TreeViewer is installed elsewhere or several versions coexist:

```yaml
    cliPath: 'D:/Apps/TreeViewer/TreeViewerCommandLine.exe'
```

Alternatively set an environment variable (used when `cliPath` is empty):

```sh
export TREEVIEWER_CLI=/Applications/TreeViewer.app/Contents/MacOS/TreeViewerCommandLine
```

## Trusting trees with embedded source

A `.tbi` with embedded source normally requires manual confirmation inside TreeViewer. The plugin
refuses it by default and returns `TRUST_REQUIRED` with the file's SHA-256 in the error details. Once
you have verified the file, allow-list it:

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
        - 'D:/data/trusted-module.tbi'
```

With `rememberKeys: true` the plugin answers TreeViewer's "add the file's public key to local
storage" prompt after an allowed file, so later files signed by the same key no longer ask.

## Working directory

`workDir` holds:

- the working directory of the persistent CLI process;
- the `sample.nwk` used for option introspection;
- ASCII relay files for paths the CLI cannot receive directly.

**Windows note**: TreeViewer reads stdin in the system code page, so non-ASCII paths are decoded
incorrectly. On Windows `workDir` is forced to an ASCII-only path, and non-ASCII input/output paths
are relayed through temporary files transparently.

## Timeouts and the persistent process

- Raise `commandTimeoutMs` for very large trees or high-resolution exports.
- The tools and the panel share one engine instance; operations run one at a time.
- Cancelling a request terminates the CLI child; the next call restarts it.
- `idleTimeoutMs: 0` keeps the CLI alive until dsh exits, which suits frequent rendering.

## Complete example

```yaml
- id: dsh-treeviewer
  name: dsh-treeviewer
  config:
    cliPath: 'C:/Program Files/TreeViewer/TreeViewerCommandLine.exe'
    workDir: 'D:/temp/dsh-treeviewer'
    trust:
      allow:
        - 'D:/data/trusted-module.tbi'
      rememberKeys: true
    commandTimeoutMs: 600000
    introspectionTimeoutMs: 180000
    idleTimeoutMs: 0
```

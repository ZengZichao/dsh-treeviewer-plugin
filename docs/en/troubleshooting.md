# Troubleshooting

## No entry after installation

Check in order:

1. **Restart dsh.** A running app does not load newly installed packages; close and reopen it.
2. **Is the plugin really in the current profile?**

   ```sh
   dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
   ```

   No output means it went into a different profile, or the installation was refused.
3. **Was the installation refused for version incompatibility?** The installer prints
   `Plugin dsh-treeviewer@<version> is incompatible with dsh <version>`. Upgrade dsh or install the
   plugin version that matches it; do not bypass the check with a risk exemption, because the host
   APIs the plugin relies on may have changed.
4. **Does Settings → Plugins list the plugin?** If not, the Loader never loaded it.

If the composed config contains it but the UI does not, the client bundle failed to load: reopen dsh,
and if it is still missing check dsh's logs (developer tools/console) for a `dsh-treeviewer` load
error.

## The panel shows an error state

A red banner still leaves the form usable; the error carries a code and a hint. Common cases:

| Symptom | Action |
|---|---|
| `CLI_NOT_FOUND` | Set `cliPath` or `TREEVIEWER_CLI`, see "TreeViewer not found" below |
| `MODULES_NOT_INSTALLED` | Run `TreeViewer -I` once to install the module library |
| `TRUST_REQUIRED` | Review the `.tbi`, then add its SHA-256 to `trust.allow` |
| Request failed / `Failed to fetch` | The local route is unavailable: confirm dsh was restarted and nothing else occupies the same path |

"Retry" re-probes the CLI and modules.

## TreeViewer not found (CLI_NOT_FOUND)

The plugin looks for `TreeViewerCommandLine` in this order:

1. the `cliPath` option;
2. the `TREEVIEWER_CLI` environment variable;
3. `PATH`;
4. platform defaults: `Program Files` / `Program Files (x86)` on Windows,
   `/Applications/TreeViewer.app/Contents/MacOS` on macOS, `/usr/bin` and `/opt/TreeViewer` on Linux.

When none is found it returns `CLI_NOT_FOUND` and lists the searched paths. Point it explicitly:

```yaml
    cliPath: 'D:/Apps/TreeViewer/TreeViewerCommandLine.exe'
```

If only `TreeViewerCommandLine.dll` exists, the plugin launches it through `dotnet`, which needs the
.NET 7 runtime installed.

## Modules not installed (MODULES_NOT_INSTALLED)

TreeViewer needs its module library installed once:

```sh
TreeViewer -I
```

Then verify inside the TreeViewer command line:

```
module list available Coordinates
```

It should list at least Radial / Rectangular / Circular.

## Unsupported file (UNSUPPORTED_FILE)

No installed module can read this format. Convert the tree to Newick / NEXUS, or install the matching
File type module in TreeViewer.

## Trust required (TRUST_REQUIRED)

The file embeds source whose signature is unknown. The command line cannot ask you, so the plugin
refuses by default. After reviewing the file, add the SHA-256 from the error to the configuration:

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
```

## The plot is blank (EMPTY_PLOT)

The output is roughly a 4×4 empty canvas, which means the pipeline drew nothing or the tree never
loaded. Check:

- whether `pipeline['Plot action']` is an empty array — supplying that category disables the default
  plot actions;
- whether the file loaded (`requestedStages` and `pipeline` should contain a file-type and a Load file
  module);
- whether a Transformer / Coordinates module is needed; the engine adds `Consensus` and `Rectangular`
  for categories left unspecified.

## A font crashes TreeViewer (RENDER_FAILED)

TreeViewer's font option accepts any "family size" string but only resolves the families it ships. An
unknown family (for example `Arial 12`) makes the CLI throw
`Object reference not set to an instance of an object`. The plugin converts that into
`RENDER_FAILED` and suggests `Helvetica`:

```json
{ "label_font": "Helvetica 10" }
```

## Non-ASCII paths

On Windows, TreeViewer reads stdin in the system code page, so a path containing non-ASCII characters
is decoded incorrectly when passed directly. The plugin:

- forces `workDir` to an ASCII-only path;
- relays non-ASCII input/output paths through ASCII temporary paths and copies the result back.

If it still fails, place the tree file under an ASCII-only path.

## The model does not accept images

When the active model does not declare image input, the tool does not attach the preview; it returns
the image path in the text instead, with a note. Switch to an image-capable model, or open the
returned path.

## Timeout (TIMEOUT)

Very large trees or high-DPI exports take longer. Raise `commandTimeoutMs`, or lower `width` / `dpi`.
Cancelling terminates the CLI process; the next request restarts it.

## Complex options cannot be set

`[Source code]`, `[Markdown]`, `[Default ...]` and similar options cannot be expressed fully on the
command line; the plugin shows them read-only. Set them in the TreeViewer GUI, or prepare the
module's source/format file and reference it.

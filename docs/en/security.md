---
layout: default
title: Security model
---

# Security model

The plugin runs locally, makes no network requests, and collects no data. Its only outbound action is
starting the TreeViewer command-line process.

## Source trust

TreeViewer `.tbi` files and some modules can embed C# source that is compiled when loaded. TreeViewer
asks the user to confirm the signature, but on the command line that confirmation is interactive, so
the plugin cannot decide on the user's behalf.

The plugin's policy:

1. **Deny by default.** For an embedded-source file with an unknown signature it answers `N` and
   returns `TRUST_REQUIRED`, with the file's SHA-256 and path in the error details.
2. **Explicit allow-list.** Only SHA-256 digests or absolute paths listed in `trust.allow` are
   answered with `Y`.
3. **Optional key memory.** With `trust.rememberKeys: true`, an allowed file's public key is also
   written to TreeViewer's local store, so later files signed by the same key no longer ask.

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
```

Prefer SHA-256 over paths: a path can point at replaced content, a hash cannot. Review the embedded
source before allow-listing a file.

## No shell

The engine writes commands straight to the CLI's stdin; **no shell is involved**. Values and paths
therefore never take part in shell parsing, so there is no command-injection surface. TreeViewer
itself has a `system` command that runs system commands; the plugin never emits it.

## Local HTTP API

The panel reaches the engine through routes the host registers locally:

| Route | Method | Purpose |
|---|---|---|
| `/api/treeviewer/status` | GET | CLI detection and environment |
| `/api/treeviewer/modules` | GET | Module catalogue |
| `/api/treeviewer/options` | GET | Options of one module |
| `/api/treeviewer/render` | POST | Render |
| `/api/treeviewer/image?id=<id>` | GET | Image by render id |

Constraints:

- Routes are registered through dsh's connection service (the Web and desktop carriers share the same addresses) and disappear when dsh exits;
- Images are served only by **in-memory render id**, never by arbitrary path, so the route cannot be
  used to read arbitrary files;
- Request bodies are capped at 2 MB; oversized or malformed JSON returns 413 / 400;
- Responses set `x-content-type-options: nosniff`, and SVG additionally gets a restrictive CSP.

These routes have the same capability as "run TreeViewer as the current user on this machine"; they
grant no extra privilege.

## Path handling

- The input must be an existing regular file; a missing path returns `INPUT_NOT_FOUND` and creates
  nothing.
- The engine creates output directories; output paths must not contain quotes or line breaks.
- On Windows, non-ASCII paths are relayed through temporary ASCII paths and copied back on success.
- Neither the panel nor the tools send file contents anywhere except the model-facing result.

## Cancellation and timeouts

- Tools forward dsh's `exec.signal`; cancelling terminates the CLI child immediately and the next call
  restarts it.
- `commandTimeoutMs` / `introspectionTimeoutMs` bound each command; a timeout returns `TIMEOUT`.
- After `idleTimeoutMs` of inactivity the CLI stops, and unloading the plugin releases the process.

## Dependency boundary

- The plugin depends only on the Node.js standard library and `@deepseek-ai/dsh-tools` (provided by
  dsh);
- It pulls in no native binaries that would need downloading;
- It contains and redistributes none of TreeViewer's code.

# Tools and panel

The plugin has two surfaces: model tools in a conversation, and a dedicated panel in the dsh main
area. Both call the same engine and take the same parameters.

## Chat tools

| Tool | Purpose |
|---|---|
| `treeviewer_render` | Render a tree; returns the PNG preview and the settings JSON that actually ran |
| `treeviewer_modules` | List the installed TreeViewer modules (category / name / id) |
| `treeviewer_options` | Read one module's configurable options (types, enum values, ranges, syntax hints) |

Typical flow: the agent calls `treeviewer_modules` to find modules and ids, optionally
`treeviewer_options` to learn the option keys and accepted values, then `treeviewer_render`.

### treeviewer_render arguments

| Argument | Type | Meaning |
|---|---|---|
| `input_file` | string, required | Tree file (Newick / NEXUS / `.tbi`); relative paths use the session working directory |
| `output_path` | string | Output path; empty writes to `<session>/treeviewer-renders/` |
| `format` | `png` / `svg` / `pdf` / `tiff` | Default `png` |
| `layout` | `rectangular` / `circular` / `radial` | Layout preset; default rectangular |
| `dpi` | number | Raster resolution (png / tiff) |
| `width` / `height` | number | Output pixel size (png / tiff); width alone keeps the aspect ratio |
| `branch_width` | number | Branch width preset |
| `branch_color` | string | Branch colour preset, e.g. `"#333333"` |
| `label_font` | string | Label font preset as "family size", e.g. `"Helvetica 10"` |
| `label_color` | string | Label colour preset |
| `show_bootstrap` | boolean | Add support values on internal nodes |
| `pipeline` | object | Expert override: per-category modules and parameters, see below |

### Minimal request

```json
{
  "input_file": "data/tree.nwk",
  "format": "png",
  "layout": "circular",
  "width": 1200
}
```

The rendered image is attached to the reply as an image content block, together with the settings
JSON.

### Using presets

```json
{
  "input_file": "data/tree.nwk",
  "layout": "rectangular",
  "branch_width": 2,
  "branch_color": "#2f6fdb",
  "label_font": "Helvetica 11",
  "label_color": "#111111",
  "show_bootstrap": true,
  "dpi": 300
}
```

### Expert pipeline

`pipeline` keys are module categories; each value is a module name (or id) with its parameters:

```json
{
  "input_file": "data/tree.nwk",
  "pipeline": {
    "Transformer": { "module": "Consensus" },
    "Further transformation": [
      { "module": "Sort nodes" },
      { "module": "Scale tree", "parameters": { "Scaling factor": 0.5 } }
    ],
    "Coordinates": {
      "module": "Circular",
      "parameters": { "Rotation": 45, "Inner radius": 30, "Outer radius": 220 }
    },
    "Plot action": [
      { "module": "Branches", "parameters": { "Line weight": 2, "Colour": "#cc0000" } },
      { "module": "Labels", "parameters": { "Show on": "Leaves", "Font": "Helvetica 11" } },
      { "module": "Labels", "parameters": { "Attribute": "Support", "Show on": "Internal nodes" } }
    ]
  }
}
```

Rules:

- Categories **absent** from `pipeline` fall back to defaults: Transformer→Consensus, Coordinates→
  the `layout` module (Rectangular by default), Plot action→Branches + Labels.
- Categories **present** in `pipeline` run exactly as given; no default module is added (and
  `show_bootstrap` does not append a support layer — add an explicit Labels entry as above).
- Keys may also be written `transformer` / `furtherTransformation` / `coordinates` / `plotActions`.
- Parameter keys are the names shown in TreeViewer's option panel; `treeviewer_options` lists them.
- Modules with the same name (for example two `Labels`) are enabled in array order.

### Value types

| Type | How to pass it |
|---|---|
| boolean | `true` / `false` |
| number | A number within the `min`/`max` reported by `treeviewer_options` |
| enum | A string; one of the listed values (case-insensitive) |
| color | `#RRGGBB`, `#RRGGBBAA`, `rgb(r,g,b)` or `rgba(r,g,b,a)` |
| font | `"family size"`; the family must be one TreeViewer can resolve (`Helvetica` is safe) |
| point | `"x, y"` |
| complex | `[Source code]`, `[Markdown]`, `[Default ...]` cannot be edited here |

## Settings JSON

Every successful render returns the settings that actually took effect:

```json
{
  "schema": "dsh-treeviewer/settings@1",
  "treeviewer": { "treeviewer": "2.2.0", "commandLine": "1.3.1" },
  "input": { "path": "/data/tree.nwk", "sha256": "…", "trusted": false },
  "requestedStages": [
    { "category": "Coordinates", "module": "Circular", "parameters": { "Rotation": 45 }, "implied": false }
  ],
  "pipeline": [
    { "category": "Coordinates", "name": "Circular", "id": "92aac276-…", "options": { "Outer radius": "200" } }
  ],
  "resolution": { "widthPx": 1200, "heightPx": 1016, "dpi": 96 },
  "output": { "format": "png", "path": "/data/tree.png", "bytes": 52400, "width": 1200, "height": 1016 }
}
```

`requestedStages` is what was asked for; `pipeline` is what TreeViewer reports after the render, which
makes the result reproducible and auditable.

## Panel

The **TreeViewer** entry in the left rail opens the main panel:

| Area | Content |
|---|---|
| Status banner | Detected TreeViewer version, command-line version and CLI path; on failure it shows the error and a retry button |
| Tree file | Absolute or relative path (relative paths use the session working directory) |
| Layout / format | Coordinates module (Rectangular / Circular / Radial …) and export format |
| Size | Pixel width (png / tiff) and DPI |
| Output directory | Empty writes into the engine working directory |
| Style | Branch width, label font, show support values |
| Modules | Parameter form for the coordinates module, multi-select plot actions with their own forms |
| Preview | Result, size, bytes, duration, and an expandable "applied settings" JSON |

Behaviour:

- Changing a dropdown, checkbox or number re-renders after a ~0.9 s debounce; the Render button is
  always available.
- Text fields (tree file, width, DPI, output directory, font) trigger a re-render on blur.
- The form is stored in browser localStorage and restored next time.
- Complex options such as `[Source code]` are shown read-only; set them in TreeViewer itself.
- `svg` / `pdf` / `tiff` show an "open file" link instead of an embedded preview.

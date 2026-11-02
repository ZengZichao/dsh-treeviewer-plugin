# 工具与面板用法

插件提供两种使用方式：对话中的模型工具，以及 dsh 主区域的专用面板。两者调用同一个引擎，
参数含义一致。

## 对话工具

| 工具 | 作用 |
|---|---|
| `treeviewer_render` | 出图，返回预览图（PNG）与本次实际生效的设置 JSON |
| `treeviewer_modules` | 列出本机已安装的 TreeViewer 模块（类别 / 名称 / id） |
| `treeviewer_options` | 读取某个模块的可调参数（类型、枚举值、取值范围、语法提示） |

典型流程：Agent 先用 `treeviewer_modules` 找到模块与 id，必要时用 `treeviewer_options`
查看参数键与取值，再调用 `treeviewer_render`。

### treeviewer_render 参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `input_file` | string，必填 | 树文件（Newick / NEXUS / `.tbi`）。相对路径按会话工作目录解析 |
| `output_path` | string | 输出路径。留空写到 `<会话目录>/treeviewer-renders/` |
| `format` | `png` / `svg` / `pdf` / `tiff` | 默认 `png` |
| `layout` | `rectangular` / `circular` / `radial` | 布局预设，默认矩形 |
| `dpi` | number | 光栅分辨率（png / tiff） |
| `width` / `height` | number | 输出像素尺寸（png / tiff）；只给宽度时高度按比例 |
| `branch_width` | number | 枝宽预设 |
| `branch_color` | string | 枝颜色预设，如 `"#333333"` |
| `label_font` | string | 标签字体预设，格式为「字族 字号」，如 `"Helvetica 10"` |
| `label_color` | string | 标签颜色预设 |
| `show_bootstrap` | boolean | 在内部节点额外显示支持值 |
| `pipeline` | object | 专家透传：按类别指定模块与参数，见下文 |

### 最简用法

```json
{
  "input_file": "data/tree.nwk",
  "format": "png",
  "layout": "circular",
  "width": 1200
}
```

返回的图片会作为图片内容块附在回复里，同时附带设置 JSON。

### 使用预设

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

### 专家流水线

`pipeline` 的键是模块类别，值是模块名（或 id）与参数：

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

规则：

- `pipeline` 中**未出现**的类别使用默认模块补齐：Transformer→Consensus、Coordinates→由 `layout`
  决定（默认 Rectangular）、Plot action→Branches + Labels。
- `pipeline` 中**出现**的类别完全按给定内容执行，不会追加默认模块（`show_bootstrap` 也不会
  自动追加支持值图层；需要时按上面的例子显式加一个 Labels）。
- 类别也可写成 `transformer` / `furtherTransformation` / `coordinates` / `plotActions`。
- 参数键就是 TreeViewer 参数面板显示的名称，可通过 `treeviewer_options` 查询。
- 同名的模块（例如两个 `Labels`）按数组顺序依次启用。

### 参数类型说明

| 类型 | 传值方式 |
|---|---|
| boolean | `true` / `false` |
| number | 数字，取值范围见 `treeviewer_options` 的 `min`/`max` |
| enum | 字符串，必须是提示中的可选值之一（大小写不敏感） |
| color | `#RRGGBB`、`#RRGGBBAA`、`rgb(r,g,b)` 或 `rgba(r,g,b,a)` |
| font | `"字族 字号"`，字族必须是 TreeViewer 能解析的（推荐 `Helvetica`） |
| point | `"x, y"` |
| complex | `[Source code]`、`[Markdown]`、`[Default ...]` 不能在插件里编辑 |

## 设置 JSON

每次成功出图都会返回「实际生效的设置」，形如：

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

`requestedStages` 是请求内容，`pipeline` 是从 TreeViewer 读回的实际模块与参数，可用于复现或审计。

## 面板

左侧栏的 **TreeViewer** 入口打开主面板：

| 区域 | 内容 |
|---|---|
| 状态条 | 探测到的 TreeViewer 版本、命令行版本与 CLI 路径；不可用时显示错误与重试按钮 |
| 树文件 | 绝对或相对路径（相对路径按会话工作目录解析） |
| 布局 / 格式 | 坐标模块（Rectangular / Circular / Radial 等）与导出格式 |
| 尺寸 | 像素宽度（png / tiff）与 DPI |
| 输出目录 | 留空写入引擎工作目录 |
| 样式 | 枝宽、标签字体、显示支持值 |
| 模块 | 坐标模块参数表单 + 绘制动作多选及各自的参数表单 |
| 预览 | 渲染结果、尺寸、体积、耗时；可展开「已应用的设置」JSON |

交互说明：

- 修改下拉框、复选框或数值后，约 0.9 秒防抖自动重新出图；也可随时点「出图」。
- 树文件、宽度、DPI、输出目录、字体等文本框在失焦后触发重新出图。
- 表单保存在浏览器 localStorage，下次打开沿用。
- `[Source code]` 等复杂参数以只读形式显示，需要在 TreeViewer GUI 中设置。
- `svg` / `pdf` / `tiff` 在预览区显示「打开文件」链接，不嵌入预览。

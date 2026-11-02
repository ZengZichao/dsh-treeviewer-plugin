# 故障排查

## 安装后看不到入口

按顺序检查：

1. **是否重启了 dsh**。已运行的应用不会加载新安装的包，关闭后重新打开。
2. **插件是否真的装进了当前 profile**：

   ```sh
   dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
   ```

   没有输出说明装到了别的 profile，或安装被拒绝。
3. **安装是否因版本不兼容被拒绝**。安装命令会提示
   `Plugin dsh-treeviewer@<version> is incompatible with dsh <version>`。此时升级 dsh 或安装
   与该 dsh 匹配的插件版本；不要用风险豁免绕过，插件依赖的宿主接口可能已经变化。
4. **设置 → 插件** 中是否列出了本插件；如果没有，说明 Loader 没有加载它。

如果配置树里有、界面上没有，通常是客户端包加载失败：重新打开 dsh，若仍为空，检查 dsh 的日志
（开发者工具/控制台）中是否有 `dsh-treeviewer` 相关的加载错误。

## 面板显示错误状态

状态条出现红色错误时，面板仍会显示表单；错误里带有错误码与提示。常见情况：

| 现象 | 处理 |
|---|---|
| `CLI_NOT_FOUND` | 设置 `cliPath` 或环境变量 `TREEVIEWER_CLI`，见下方「找不到 TreeViewer」 |
| `MODULES_NOT_INSTALLED` | 运行一次 `TreeViewer -I` 安装模块库 |
| `TRUST_REQUIRED` | 审查该 `.tbi` 后把其 SHA-256 加入 `trust.allow` |
| 请求失败 / `Failed to fetch` | 本地路由不可用：确认 dsh 已重启，且没有其它组件占用同一路径 |

点「重新检测」可重新探测 CLI 与模块。

## 找不到 TreeViewer（CLI_NOT_FOUND）

插件按以下顺序查找 `TreeViewerCommandLine`：

1. 配置项 `cliPath`；
2. 环境变量 `TREEVIEWER_CLI`；
3. `PATH`；
4. 各平台默认位置：Windows 的 `Program Files` / `Program Files (x86)`，macOS 的
   `/Applications/TreeViewer.app/Contents/MacOS`，Linux 的 `/usr/bin`、`/opt/TreeViewer`。

都找不到时返回 `CLI_NOT_FOUND`，错误详情列出搜索过的路径。显式指定：

```yaml
    cliPath: 'D:/Apps/TreeViewer/TreeViewerCommandLine.exe'
```

如果只找到 `TreeViewerCommandLine.dll`，插件会通过 `dotnet` 启动它，需要本机安装 .NET 7 运行时。

## 模块未安装（MODULES_NOT_INSTALLED）

TreeViewer 首次使用需要安装模块库：

```sh
TreeViewer -I
```

然后在 TreeViewer 命令行中验证：

```
module list available Coordinates
```

应至少列出 Radial / Rectangular / Circular。

## 文件不支持（UNSUPPORTED_FILE）

当前安装的模块里没有能读取该格式的模块。转换树文件为 Newick / NEXUS，或在 TreeViewer 中安装
对应的 File type 模块。

## 需要信任（TRUST_REQUIRED）

文件内嵌了源码且签名未知。命令行无法替你确认，插件默认拒绝。确认文件可信后把错误里的
SHA-256 加入配置：

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
```

## 出图是空白（EMPTY_PLOT）

输出是一张 4×4 左右的空画布，说明流水线没有绘制动作，或树并没有真正加载。检查：

- `pipeline['Plot action']` 是否为空数组；显式给出该类别时不会补默认绘制模块；
- 树文件是否加载成功（`requestedStages` 与 `pipeline` 里是否有文件类型与 Load file 模块）；
- 是否需要先加 Transformer / Coordinates；引擎会为缺省类别补 `Consensus` 与 `Rectangular`。

## 字体导致 TreeViewer 崩溃（RENDER_FAILED）

TreeViewer 的字体参数接受任意「字族 字号」，但渲染期只解析它自带的字族。未知字族
（例如 `Arial 12`）会让 CLI 抛出 `Object reference not set to an instance of an object`。
插件会把它转换成 `RENDER_FAILED` 并提示改用 `Helvetica`：

```json
{ "label_font": "Helvetica 10" }
```

## 中文/非 ASCII 路径

Windows 上 TreeViewer 按系统代码页读取标准输入，直接传入含非 ASCII 字符的路径会读错。插件会：

- 把 `workDir` 换成纯 ASCII 路径；
- 把非 ASCII 的输入/输出路径转成 ASCII 临时路径，成功后拷回目标位置。

如果仍失败，尝试把树文件放在纯 ASCII 路径下。

## 模型不支持图片

当前模型未声明图片输入时，工具不会附加预览图，而是在文本里返回图片路径并说明原因。
换用支持图片的模型，或直接打开返回的路径查看。

## 超时（TIMEOUT）

巨型树或高 DPI 导出较慢。调大 `commandTimeoutMs`，或降低 `width` / `dpi`。取消操作会终止
CLI 进程，下一次请求会自动重启。

## 复杂参数无法设置

`[Source code]`、`[Markdown]`、`[Default ...]` 等复杂参数不能通过命令行完整表达，插件以只读
形式展示。请在 TreeViewer GUI 中设置，或把该模块的源码/格式文件准备好后再引用。

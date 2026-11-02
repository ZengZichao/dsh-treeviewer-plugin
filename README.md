# TreeViewer × DeepSeek Harness（dsh）插件

把跨平台系统发育树绘图软件 **TreeViewer** 接入 **DeepSeek Harness（dsh）**：

- **聊天工具**：在对话里描述出图需求，Agent 调用工具，把**预览图**与本次实际生效的**设置 JSON** 回传到对话。
- **专用面板**：dsh 主区域的 TreeViewer 面板，左侧参数表单（由 TreeViewer 自动自省生成）、右侧实时预览，设置持久化。

插件不重写 TreeViewer，只做薄适配层：把设置翻译成 `TreeViewerCommandLine` 的命令流，驱动 CLI 出图，
再把图片和设置返回给 dsh。

## 功能

- 三种布局（矩形 / 环形 / 放射状），PNG、SVG、PDF、TIFF 四种输出。
- 高层预设：枝宽、枝颜色、标签字体、标签颜色、支持值；也可按类别透传完整模块流水线。
- 参数表单随本机安装的 TreeViewer 模块自动变化，无需手工维护参数表。
- 出图结果附「实际生效的设置」JSON（输入文件 SHA-256、每个模块的参数、分辨率、输出尺寸）。
- 默认拒绝加载未受信任的内嵌源码模块，白名单按 SHA-256 或绝对路径显式配置。
- 取消会终止 CLI 子进程；失败返回结构化错误（`code` / `message` / `hint`）。

## 环境要求

- **TreeViewer 已安装且模块已装好**（首次运行一次 `TreeViewer -I`）。官方发行包是自包含 .NET 7，
  不需要额外安装 .NET 运行时；只找到 `TreeViewerCommandLine.dll` 时会通过 `dotnet` 启动。
- **Node.js ≥ 20**（dsh 运行时已自带）。
- **dsh 0.2.1-rc.5**（插件声明 `engines.dsh: >=0.2.1-rc.5 <0.3.0`）。

## 快速安装

```sh
pnpm install
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

安装后左侧栏出现 **TreeViewer** 入口，设置 → 插件中也能看到本插件的名称与说明。
确认配置树：

```sh
dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
```

卸载：

```sh
dsh plugin --profile desktop remove dsh-treeviewer
```

## 使用

聊天里直接说：

> 用 TreeViewer 把 `data/tree.nwk` 画成环形树，枝宽 2，显示支持值，宽 1200。

或打开左侧栏的 **TreeViewer** 面板，填写树文件与参数后点「出图」，修改参数会自动重新预览。

完整说明见下方文档。

## 文档

| 主题 | 中文 | English |
|---|---|---|
| 安装与卸载 | [docs/zh/install.md](docs/zh/install.md) | [docs/en/install.md](docs/en/install.md) |
| 配置项 | [docs/zh/configuration.md](docs/zh/configuration.md) | [docs/en/configuration.md](docs/en/configuration.md) |
| 工具与面板用法 | [docs/zh/usage.md](docs/zh/usage.md) | [docs/en/usage.md](docs/en/usage.md) |
| 安全模型 | [docs/zh/security.md](docs/zh/security.md) | [docs/en/security.md](docs/en/security.md) |
| 故障排查 | [docs/zh/troubleshooting.md](docs/zh/troubleshooting.md) | [docs/en/troubleshooting.md](docs/en/troubleshooting.md) |

在线文档：<https://zengzichao.github.io/dsh-treeviewer-plugin/>

English: [README.en.md](README.en.md)

## 项目结构

```
packages/treeviewer-core     TreeViewerCommandLine 的 Node 适配引擎（无 dsh 依赖）
packages/dsh-treeviewer      dsh 插件：模型工具、面板后端、浏览器面板
```

## 工作方式

引擎维护一个常驻的 `TreeViewerCommandLine` 进程，逐条写入命令并等待提示符；每次出图都是一条干净的流水线：
`open` → Transformer → Further transformation → Coordinates → Plot action → `resolution` → 导出。
出图后重新读取已启用模块与其参数，生成设置 JSON。模块参数通过 CLI 自省获得，因此 TreeViewer 升级后
表单与工具参数会随之更新。

## 开发与测试

```sh
pnpm -r check     # 两个包都能加载
pnpm -r test      # 单元测试 + 真实 CLI 集成测试
```

集成测试在本机未安装 TreeViewer 时自动跳过；`TREEVIEWER_TEST_TBI` 指向一个内嵌源码的 `.tbi`
时会额外验证信任流程。

## 许可

MIT。TreeViewer 按其自身许可发布，本插件只通过其命令行调用，不包含其代码。

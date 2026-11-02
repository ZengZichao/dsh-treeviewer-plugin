# 安装与卸载

本页说明如何把 **dsh-treeviewer** 装进 DeepSeek Harness（dsh），以及如何确认它已经生效。

## 前置条件

| 依赖 | 要求 | 检查方式 |
|---|---|---|
| TreeViewer | 已安装，且已装好模块库 | `TreeViewerCommandLine` 能启动，`module list available Coordinates` 有输出 |
| .NET | 官方发行包自带 .NET 7；只在拿到 `.dll` 时才需要 `dotnet` | `dotnet --version`（可选） |
| Node.js | ≥ 20，dsh 运行时已自带 | `node --version` |
| dsh | 0.2.1-rc.5（插件声明 `engines.dsh: >=0.2.1-rc.5 <0.3.0`） | `dsh --version` |

TreeViewer 第一次使用时需要运行一次 `TreeViewer -I` 安装全部模块，否则 CLI 没有可用模块，
插件会返回 `MODULES_NOT_INSTALLED`。

## 安装

在仓库根目录安装工作区依赖：

```sh
pnpm install
```

把插件加入目标 profile（`desktop` 是桌面应用使用的 profile；`web`/`tui` 同理）：

```sh
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

安装过程会读取插件的 `package.json`：`engines.dsh` 必须与当前 dsh 版本匹配，否则安装会被拒绝并
提示版本不兼容。插件依赖的引擎包 `treeviewer-core` 会一并安装到 profile 的 `node_modules`。

## 确认安装

```sh
dsh --profile desktop --dump-config | grep -A4 dsh-treeviewer
```

输出中应出现 `id: dsh-treeviewer` 及其配置块。

启动 dsh 后：

1. 左侧栏出现 **TreeViewer** 入口（图标是一棵小树）；
2. **设置 → 插件** 列表中能看到本插件及其中英文名称与说明；
3. 点开左侧入口，主区域显示参数表单与预览区，顶部状态条显示探测到的 TreeViewer 版本与 CLI 路径。

关闭并重新打开 dsh 后插件才会被加载；正在运行的应用不会自动发现新安装的包。

## 升级

重新执行一次 `add` 即可，pnpm 会更新本地路径依赖：

```sh
dsh plugin --profile desktop add ./packages/dsh-treeviewer
```

修改过插件源码后同样需要重新 `add`（或重新安装），因为 profile 中保存的是安装时的副本。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-treeviewer
```

卸载后可一并删除引擎的临时工作目录（默认位于系统临时目录下的 `dsh-treeviewer`）。

## 多个 profile

每个 profile 独立管理插件。桌面应用只使用 `desktop` profile；`dsh web` 使用 `web` profile，
可以在浏览器中打开界面。两种界面共用同一套插件代码。

# 配置

插件的配置写在 profile 的 `cordis.patch.yml`（默认位于 `~/.dsh/profiles/<profile>/cordis.patch.yml`），
覆盖插件自带 patch 中的同名条目。修改后需要重启 dsh。

## 完整配置

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

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `cliPath` | string | `''` | `TreeViewerCommandLine` 的绝对路径。留空时依次探测环境变量 `TREEVIEWER_CLI`、`PATH`、各平台默认安装位置 |
| `workDir` | string | `''` | 引擎工作目录，用于存放常驻 CLI、样本树与临时导出。留空为 `<系统临时目录>/dsh-treeviewer` |
| `trust.allow` | string[] | `[]` | 允许加载其内嵌源码的 `.tbi` / 模块文件：64 位 SHA-256 十六进制，或绝对路径 |
| `trust.rememberKeys` | boolean | `false` | 放行后是否把该文件的公钥写入 TreeViewer 本地库，后续不再询问 |
| `commandTimeoutMs` | number | `300000` | 单次出图命令（打开文件、导出）的超时 |
| `introspectionTimeoutMs` | number | `120000` | 模块/参数自省的超时 |
| `idleTimeoutMs` | number | `300000` | 空闲多久后关闭常驻 CLI；`0` 表示不自动关闭 |

## 指定 CLI 路径

TreeViewer 装在非标准位置，或同时存在多个版本时：

```yaml
    cliPath: 'D:/Apps/TreeViewer/TreeViewerCommandLine.exe'
```

留空时也可以设置环境变量：

```sh
export TREEVIEWER_CLI=/Applications/TreeViewer.app/Contents/MacOS/TreeViewerCommandLine
```

## 信任内嵌源码的树文件

包含内嵌源码的 `.tbi` 在 TreeViewer 中默认需要人工确认。插件默认拒绝，并返回
`TRUST_REQUIRED`，错误详情里带有该文件的 SHA-256。确认文件可信后加入白名单：

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
        - 'D:/data/trusted-module.tbi'
```

`rememberKeys: true` 时，插件在放行后会回答 TreeViewer 的「是否把公钥加入本地库」，
之后同一作者的签名文件不再触发询问。

## 工作目录

`workDir` 用于：

- 常驻 CLI 进程的工作目录；
- 参数自省时使用的样本树 `sample.nwk`；
- 无法直接传给 CLI 的路径的 ASCII 中转文件。

**Windows 注意**：TreeViewer 读取标准输入时使用系统代码页，含中文的路径会被错误解码。
因此 Windows 上 `workDir` 会被强制换成仅含 ASCII 的路径；输入/输出路径中的非 ASCII 字符
由引擎自动通过中转文件处理，对调用方透明。

## 超时与常驻进程

- 打开巨型树或导出高分辨率图片较慢时，调大 `commandTimeoutMs`。
- 工具与面板共享同一个引擎实例，操作串行执行。
- 取消请求会终止 CLI 子进程；下一次调用自动重启。
- `idleTimeoutMs: 0` 会让 CLI 常驻到 dsh 退出，适合频繁出图的场景。

## 完整示例

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

# treeviewer-core

TreeViewerCommandLine 的 Node 适配引擎，无 dsh 依赖，可独立使用。

- 常驻 CLI 进程 + 提示符驱动协议（交互提问按策略应答，取消即杀进程）；
- 模块目录与参数自省（类别、名称、id、类型、枚举、范围、颜色、语法提示）；
- 一次出图 = 一条干净的流水线：open → Transformer → Further transformation → Coordinates →
  Plot action → resolution → png/svg/pdf/tiff；
- 输出校验（存在性、格式魔数、空画布）与「实际生效的设置」JSON；
- 源码信任策略（默认拒绝未知 `.tbi`，按 SHA-256 白名单放行）；
- 结构化错误 `{ ok:false, error:{ code, message, hint?, details? } }`。

```js
import { TreeViewerEngine } from 'treeviewer-core'

const engine = new TreeViewerEngine()
const result = await engine.render({
  inputFile: 'tree.nwk',
  output: { format: 'png', path: 'tree.png', width: 1200 },
  presets: { layout: 'circular', showBootstrap: true },
})
console.log(result.imagePath, result.appliedSettings)
await engine.dispose()
```

文档：[配置](../../docs/zh/configuration.md)、[用法](../../docs/zh/usage.md)、[安全](../../docs/zh/security.md)。

English: [README.en.md](README.en.md)

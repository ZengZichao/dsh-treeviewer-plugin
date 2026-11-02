# dsh-treeviewer

DeepSeek Harness 插件：把 TreeViewer 接入 dsh。

- **聊天工具** `treeviewer_render` / `treeviewer_modules` / `treeviewer_options`：自然语言出图，返回预览图与本次实际生效的设置 JSON。
- **专用面板**：主区域内的 TreeViewer 面板，左侧参数表单（由 CLI 自省生成），右侧实时预览。

引擎位于 `treeviewer-core`，本包只负责 dsh 侧装配（工具注册、面板 HTTP 接口、浏览器面板）。

## 文档

- [安装与卸载](../../docs/zh/install.md)
- [配置](../../docs/zh/configuration.md)
- [工具与面板](../../docs/zh/usage.md)
- [安全模型](../../docs/zh/security.md)
- [故障排查](../../docs/zh/troubleshooting.md)

English: [README.en.md](README.en.md)

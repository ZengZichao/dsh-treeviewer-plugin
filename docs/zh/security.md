---
layout: default
title: 安全模型
---

# 安全模型

插件在本机运行，不联网，不收集任何数据。它唯一的对外动作是启动 TreeViewer 的命令行进程。

## 源码信任

TreeViewer 的 `.tbi` 文件与部分模块可以内嵌 C# 源码，加载时会编译执行。TreeViewer 自身要求
用户确认签名，但命令行下这个确认是交互式的，无法由插件代替用户判断。

插件的策略：

1. **默认拒绝**。遇到签名未知的内嵌源码文件时回答 `N`，并返回 `TRUST_REQUIRED`，
   错误详情包含该文件的 SHA-256 与路径；
2. **显式白名单**。只有 `trust.allow` 中列出的 SHA-256 或绝对路径才会回答 `Y`；
3. **可选记住公钥**。`trust.rememberKeys: true` 时，对已放行的文件还会把其公钥写入 TreeViewer
   本地库，使同一签名的后续文件不再询问。

```yaml
    trust:
      allow:
        - '3f2c9a4d0b7e5f1a8c6d4e2b0a9f7c5d3e1b8a6f4c2d0e9b7a5f3c1d8e6b4a2f'
```

建议使用 SHA-256 而不是路径：路径可以指向被替换过的内容，哈希不会。加入白名单前请自行审查
该文件中的源码。

## 没有 shell

引擎把命令逐条写入 CLI 的标准输入，**不经过 shell**。参数值与路径因此不会参与 shell 解析，
不存在命令注入面。TreeViewer 本身带有可执行系统命令的 `system` 命令，插件从不生成它。

## 本地 HTTP 接口

面板通过宿主注册的本地路由访问引擎：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/treeviewer/status` | GET | CLI 探测与环境信息 |
| `/api/treeviewer/modules` | GET | 模块目录 |
| `/api/treeviewer/options` | GET | 单个模块的参数 |
| `/api/treeviewer/render` | POST | 出图 |
| `/api/treeviewer/image?id=<id>` | GET | 按渲染 id 取图 |

约束：

- 路由通过 dsh 的连接服务注册（Web 与桌面两种载体共用同一组地址），随 dsh 退出而消失；
- 图片只按**内存中的渲染 id** 提供，不接受任意文件路径，因此不能用来读取任意文件；
- 请求体上限 2 MB，超大或非法 JSON 分别返回 413 / 400；
- 响应带 `x-content-type-options: nosniff`，SVG 额外附带限制性 CSP。

这些接口的能力与“在本机以当前用户身份运行 TreeViewer”相同，不额外提权。

## 路径处理

- 输入必须是已存在的普通文件；不存在的路径返回 `INPUT_NOT_FOUND`，不会创建文件。
- 输出目录由引擎创建，输出路径必须在命令中不含引号或换行。
- Windows 上含非 ASCII 字符的路径会先转换为临时 ASCII 路径再传给 CLI，成功后把结果拷回目标路径。
- 面板与工具都不会把文件内容回传给模型以外的第三方。

## 取消与超时

- 工具透传 dsh 的取消信号 `exec.signal`；取消时立即终止 CLI 子进程，下一次调用自动重启。
- `commandTimeoutMs` / `introspectionTimeoutMs` 限制单条命令的等待时间，超时返回 `TIMEOUT`。
- 空闲超过 `idleTimeoutMs` 后 CLI 自动退出，插件卸载时也会释放进程。

## 依赖边界

- 插件只依赖 Node.js 标准库与 `@deepseek-ai/dsh-tools`（由 dsh 提供）；
- 不引入需要下载原生二进制的依赖；
- 不包含、也不重新分发 TreeViewer 的代码。

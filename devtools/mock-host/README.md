# 独立插件调试宿主

本地 Node.js 服务与浏览器外壳，模拟 DBX Host API 1.0 的部分功能，用真实插件 UI 和 Sidecar 联调。不启动 DBX，也不读取 DBX 的连接数据库。

## 文件管理插件

在仓库根目录执行 `npm run dev:standalone`，打开终端输出的地址。六协议配置通过外部预置文件导入，使用说明见 [独立调试指南](../../docs/STANDALONE-DEBUG.md)。

## 运行其他插件

```bash
node devtools/mock-host/cli.mjs \
  --project /absolute/path/to/plugin \
  --backend backend/target/debug/example-plugin \
  --ui-root ui \
  --data-dir /absolute/path/to/local-debug-data \
  --port 5190
```

UI 入口由 Manifest 的 `entrypoints.ui.entry` 相对其 `root` 解析。`--ui-root` 可以替换实际构建输出目录。入口需为内联 HTML，或通过 `readAssetUrl` 加载包内资源；沙箱不直接访问 Vite 模块服务器。

后端需实现 `stdio-framed` v1，并在初始化时返回与 Manifest 一致的插件 ID、版本，Manifest 的 API 版本范围必须接受 `1.0.0`。工具依赖当前项目的 Node.js 22+、Vite、Vue 3、Tailwind/daisyUI、Lucide、semver 和 singlefile 插件；暂未单独发布 npm 包。

可选 `--build-config commands.json`：

```json
{
  "backend": ["cargo", "build", "--locked", "--manifest-path", "backend/Cargo.toml"],
  "ui": ["npm", "run", "build"],
  "watch": ["node", "node_modules/vite/bin/vite.js", "build", "--watch"]
}
```

命令以参数数组执行，不经过 shell，工作目录为插件目录。启动时执行 backend/ui；点击“重建后端”仅执行 backend。未配置构建命令时，仅启动或重启指定的可执行文件。

可选 `--preset-file connections.json`，或使用浏览器“导入连接”选择同格式 JSON：

```json
{
  "connections": [
    {
      "providerId": "example.connection",
      "values": { "display_name": "Example", "endpoint": "http://localhost:8080" },
      "readOnly": false
    }
  ]
}
```

字段名和类型必须符合目标 Manifest。导入创建新 ID，不覆盖现有连接；没有自动变量替换。协议预置、路径生成及项目构建命令由工具外部负责。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `cli.mjs` | 参数、构建进程、UI 构建监听及退出清理 |
| `sidecar.mjs` | 初始化、分帧、并发请求、超时、事件、二进制通道与进程退出 |
| `connections.mjs` | Manifest 字段绑定、验证及原子配置存储 |
| `server.mjs` | 本地 HTTP/SSE、浏览器会话、连接生命周期及工作台路由 |
| `browser-bridge.mjs` | iframe 内 `window.dbxPlugin` 及严格 CSP |
| `assets.mjs` | 包内资源路径、符号链接边界与大小限制 |
| `ui/` | 连接表单、Tab、主题和调试控制外壳 |
| `tests/` | 通用 echo Sidecar 与协议、存储、隔离回归测试 |

工具不导入插件前端或后端代码，不识别文件管理方法名，不包含六协议连接参数。`devtools/file-manager.mjs` 和 `docs/tests/mock-connections.mjs` 是此插件的外部适配入口。

## 支持的 API

- `ready`、`context`、`locale`、`theme`、`request`、`invoke`、`notify`。
- `onInit`、`onContext`、`onEvent`、`onBinary`、`sendBinary`。
- `readAsset`、`readAssetUrl`、`encodeBase64`、`decodeBase64`、`openWorkbench`。
- RPC：`host.getContext`、`backend.invoke`、`backend.notify`、`backend.sendBinary`、`ui.readAsset`、`host.openWorkbench`。

事件、二进制和工作台导航分别检查 `host.events`、`host.binary`、`host.workbench` 权限。`openFilesystem` 等未实现方法明确返回错误，不伪造成功。

桥接 JSON 参数上限 2 MiB，UI 二进制上限 8 MiB；Sidecar JSON 帧上限 8 MiB、二进制 64 MiB。显式桥接请求超时按宿主基线约束到 1–120000ms。超时不等于后端已取消操作，工具不会自动重放请求。

上下文和权限通过 JSON 快照跨 iframe 传递，避免 Vue Proxy 克隆错误。每次重载生成新的通道标识，旧请求响应不会误投递给新页面。事件按插件广播，连接级事件过滤仍由插件负责，与共享 Sidecar 模型一致。

## 存储与运行边界

- 仅监听 `127.0.0.1`，端口冲突自动选择空闲端口；校验 Host、Origin、SameSite 浏览器会话及 CSRF。
- 配置和凭据写入开发数据目录中的 `connections.json`，目录权限 `0700`、文件权限 `0600`。这是本地明文存储，不是 Secret Store 或 Keychain。
- 凭据只在显式编辑表单和后端生命周期中使用，不进入连接列表摘要、iframe context 或服务日志。Sidecar stderr 被消费但不输出，防止后端日志意外泄露凭据。
- iframe 保持 `sandbox="allow-scripts"`，不允许访问父页面、任意网络或本地路径。原生 Sidecar 仍以当前用户权限运行，工具不提供操作系统级沙箱。
- 页面切换保留 iframe；关闭最后一个关联 Tab 会断开连接。刷新整个浏览器会丢失页面状态，但保存的连接仍保留。
- 修改 Manifest、UI 入口或工具自身代码后需重启服务。插件 UI 改动触发构建，手动重载应用；后端崩溃后需显式重启、重新连接。
- 重建失败不会重新启动旧二进制。服务退出时断开连接，关闭 stdin，必要时终止 Sidecar。

## 测试

```bash
npm run test:mock-host
```

测试使用通用 `example.echo` Sidecar，不依赖文件管理 RPC、Docker 或 DBX。浏览器与六协议真实验收应另外运行；模拟宿主通过不代表 DBX 的安装、签名、Secret Store、生命周期或 Tab 恢复已通过验收。

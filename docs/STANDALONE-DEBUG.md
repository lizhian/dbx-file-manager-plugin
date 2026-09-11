# 不启动 DBX 调试插件

## 启动

需要 Node.js 22+、Rust；远程文件服务使用[现有 Docker 六协议环境](tests/README.md)。

```bash
npm ci
npm run dev:standalone
```

打开终端输出的地址，默认 `http://127.0.0.1:5190`，端口占用时自动更换。
首次启动会构建 Rust 调试版本、插件页面和调试外壳；不需要打包或安装 `.dbxp`。

## 使用

1. 点击“导入测试连接”，导入本地六协议配置；也可新建连接或导入 JSON。
2. 在连接表单填写参数，可测试、保存；点击侧边栏连接名称打开文件页面。
3. 各连接独立 Tab，切换保留页面和草稿，重复打开同一连接激活已有 Tab。
4. 插件前端改动会自动构建，点击“重载页面”应用；后端改动点击“重建后端”，完成后重新连接。
5. 在启动终端按 Ctrl+C 停止服务。已有 Docker 容器不会被自动停止、删除或重建。

上传和下载使用插件 Rust 后端提供的 macOS 原生文件对话框，文件操作真实发生在连接的服务上。
配置及凭据以明文保存在 `runtime/mock-host/connections.json`，该目录不提交 Git；不要存放生产凭据。

## 独立边界

`devtools/mock-host/` 是通用模拟宿主；文件管理构建入口与六协议预置在该目录外部。插件业务代码不感知调试模式，仍调用 `window.dbxPlugin`，模拟工具不进入正式安装包。

当前支持 Host API 1.0 子集及 framed v1。模拟服务验证真实前后端业务，不替代 DBX 的安装、Secret Store 和宿主 Tab 恢复验收。

通用运行参数、模块说明和接口范围见[模拟宿主 README](../devtools/mock-host/README.md)。

```bash
npm run test:mock-host
npm test
npm run build
```

## 本次验证

2026-09-08，macOS ARM64：12 项模拟宿主测试、12 项插件前端测试通过。
六协议通过真实浏览器桥接完成上传下载比对、目录操作、图片解码、文本预览与保存、冲突检测；六个 Tab 的草稿隔离和重复打开去重通过。
S3 另验证了页面按钮触发的 macOS 原生文件选择及下载保存，下载字节与源文件一致。
连接表单测试与保存、关闭重开 Tab、主题切换、页面重载、后端重建和重新连接通过；验收远程目录已清理。

## URI scheme 错误与构建配对

若出现 `URI must use this provider's root-relative scheme`，检查模拟宿主启动参数中的 `--backend`。
统一前端使用 `opendal:/`，不能与 `runtime/generic-package-review/` 等历史解包目录中的旧后端混用；即使两者版本号同为 0.2.0，内部路径契约也可能不同。
开发联调使用 `npm run dev:standalone`，或指定 `--backend backend/target/debug/dbx-plugin-dbx-file-manager-plugin` 并配置源码构建命令。
修正启动配置后重启模拟宿主、刷新浏览器并重新连接。仅重载页面，或对未配置 build-config 的历史后端点击“重建后端”，不会更新可执行文件。
验收历史安装包时，backend 和 ui-root 必须都来自同一个解包目录。

2026-09-11：5243 实例改为当前源码后端并配置 backend/ui 构建；保留原有连接，补齐缺少的五种本地测试连接。
浏览器验证六种专用连接与通用入口的连接、列表全部通过；六协议工作台读写集成测试通过。

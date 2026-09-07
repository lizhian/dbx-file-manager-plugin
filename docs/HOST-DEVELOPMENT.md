# 宿主开发环境

使用 [t8y2/dbx](https://github.com/t8y2/dbx) 的 `dev/plugin-framework-current` 分支作为插件开发宿主。
依赖安装要求以宿主仓库的 README 为准。

需要代理时，在当前终端先执行（新终端需重新设置）：

```bash
export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890 all_proxy=socks5://127.0.0.1:7890
export no_proxy=localhost,127.0.0.1,::1,consul.internal NO_PROXY=localhost,127.0.0.1,::1,consul.internal
```

排除本机地址和测试域名，避免本地测试与开发服务被代理返回的 502 干扰。

## 1. 克隆宿主

在本插件仓库根目录执行，宿主源码保留在 Git 忽略的 `runtime/dbx` 中供后续复用。
已有该目录时直接复用，不重复克隆或覆盖：

```bash
mkdir -p runtime
git clone --branch dev/plugin-framework-current --single-branch https://github.com/t8y2/dbx.git runtime/dbx
cd runtime/dbx
```

以下命令均在宿主仓库根目录执行，不是在本插件仓库中执行。
使用 Node.js 22.13+ 和宿主 `package.json` 指定的 pnpm 版本，先安装依赖：

```bash
pnpm install --frozen-lockfile
```

## 2. 快速检查

跳过 DuckDB：

macOS 先规范化临时目录，避免该分支 MCP 测试将 `/var` 与 `/private/var` 判为不同路径：

```bash
export TMPDIR="$(node -p 'require("fs").realpathSync(require("os").tmpdir())')"
```

```bash
make cargo-check-fast
make cargo-test-fast
```

## 3. 启动开发模式

启动 Tauri 开发模式，跳过内嵌 DuckDB 编译（保留 DuckDB sidecar 支持）。
指定独立数据目录，避免与日常 DBX 共享连接和设置：

```bash
export DBX_DATA_DIR="$PWD/../dbx-data"
make dev-fast
```

## 4. 允许安装开发包

在启动的宿主中进入：

**插件中心 → 设置 → 第三方与开发者选项 → 允许安装未签名开发包**

打开该开关后，即可安装本地未签名 `.dbxp` 开发包。
仅在开发环境启用，并只安装可信来源的包。

兼容性注意：本次克隆的 `c26ff3f` 提交提供 Host API 1.0，当前文件管理插件要求 1.1。
开启未签名包开关不会绕过 API 版本检查；宿主成功构建不等于当前插件可以直接安装。

需要本地 FTP、SFTP、S3、WebDAV 或 HDFS 服务时，按需阅读[测试环境说明](tests/README.md)。

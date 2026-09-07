# OpenDAL 文件管理器

基于 OpenDAL 的独立 DBX 文件管理插件，支持 FTP、SFTP、S3、WebDAV、WebHDFS 和 HDFS Native，
通过 DBX 宿主文件管理器提供目录浏览、文件预览、上传下载、复制、重命名和删除功能。

- 插件标识：`io.github.lizhian.file-manager`
- 发布者：`lizhian`
- 当前版本：`0.1.1`

**当前为开发版本，迁移验收尚未完成。** 功能验收以 macOS Apple Silicon（ARM64）为主，
跨平台构建成功不代表完整功能验收通过。

## 下载与使用

从 [GitHub Releases](https://github.com/lizhian/dbx-file-manager-plugin/releases) 下载 `.dbxp` 安装包。
构建目标覆盖 macOS x64/ARM64、Linux x64/ARM64 和 Windows x64。

需要已适配 Host API `>=1.1.0, <2.0.0` 的 DBX 宿主。
安装包未签名，需通过本地开发安装方式使用，详见[宿主集成说明](docs/MAIN-INTEGRATION.md)。

FTP 使用明文传输；SFTP 需要 Unix 和本地 OpenSSH，Windows 暂不支持。
SFTP 私钥使用本地文件路径，首次连接时信任新主机密钥。

## 开发与文档

本地开发需要 Node.js 22+ 和 Rust；协议测试环境需要 Docker Compose，
打包另需匹配的 DBX 插件 CLI。

- [Docker 本地测试环境](docs/tests/README.md)：六协议服务启动与连接参数。
- [宿主集成](docs/MAIN-INTEGRATION.md)：宿主基线、补丁与联调。
- [打包与发布](docs/RELEASING.md)：版本管理、构建与发布流程。
- [契约与限制](docs/CONTRACT.md)：插件能力及实现边界。
- [实现与验证说明](docs/IMPLEMENTATION.md)：实现概况、已验证范围和待完成事项。

## 许可证

采用 [Apache-2.0](LICENSE) 许可证，源码归属与来源见 [NOTICE](NOTICE)。

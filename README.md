# OpenDAL 文件管理器

面向 macOS Apple Silicon 的 DBX 插件，支持 FTP、SFTP、S3（MinIO）、WebDAV、WebHDFS 和 HDFS Native。

使用官方 **Host API 1.0**，无需修改宿主。插件提供自定义文件页面，复用宿主连接配置、凭据存储与 Tab，每个连接一个 Tab。

功能：目录浏览、新建目录、重命名、删除、上传下载、图片预览、UTF-8 文本预览与编辑保存。

**当前宿主 `c26ff3f` 存在 Workbench 上下文克隆错误，安装兼容但连接页面无法加载。**
本仓库未修改宿主；阻塞与已完成验证见[开发说明](docs/PLUGIN-DEVELOPMENT.md)。

## 开发

```bash
npm ci
npm test
npm run package
```

需要 Node.js 22+、Rust、macOS Apple Silicon。产物位于 `dist/`，在宿主启用未签名开发包后安装。

- [使用、构建与限制](docs/PLUGIN-DEVELOPMENT.md)
- [宿主开发环境](docs/HOST-DEVELOPMENT.md)
- [Docker 六协议测试环境](docs/tests/README.md)

插件 ID：`io.github.lizhian.file-manager`，版本 `0.2.0`。采用 [Apache-2.0](LICENSE)，来源见 [NOTICE](NOTICE)。

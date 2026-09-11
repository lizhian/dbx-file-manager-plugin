# OpenDAL 通用连接

新增连接类型“OpenDAL 通用”，填写连接名称、服务和参数。旧六协议连接保持原样，不需要迁移。

**当前只能使用测试凭据：加密存储尚未实现。** 参数已绑定宿主 Secret Store，不进入普通配置、工作台上下文和连接摘要；但当前宿主 `c26ff3f` 的 SQLite `connection_secrets` 表存储明文，Secret Store 不等于加密。模拟服务也维持明文开发存储。正式加密需上游升级存储，或另行设计插件自管配置入口；当前 Host API 1.0 的声明式表单没有保存前加密钩子。

## 参数

按所选服务的 [Configuration reference](https://opendal.apache.org/services/) 填写，每行 `key=value`：

```text
endpoint=http://127.0.0.1:9000
region=us-east-1
bucket=dbx
access_key_id=dbx-access-key
secret_access_key=dbx-secret-key
root=/
```

以上为已有本地 MinIO 的 `s3` 测试配置。`memory` 可不填参数，数据只保留在当前后端会话内；断开、闲置会话回收或重启后会丢失。

- 按第一个 `=` 分隔；键两侧空格忽略，值中的空格和 `=` 保留。忽略空行，支持 LF/CRLF。
- 空键、重复键、缺少 `=` 会报行号，不回显值；参数总量限 256 KiB。不展开变量、不解析引号或转义。
- 使用 OpenDAL 字段名，例如 S3 为 `access_key_id`，SFTP 为 `key`（本机私钥路径）；不是旧表单字段名。
- map 类型字段使用单行 JSON。例如 HDFS Native 的 `options={"dfs.client.use.datanode.hostname":"true"}`。0.57 的 map 反序列化缺口由构建层兼容，支持 HDFS Native `options` 和 S3 `assume_role_session_tags`。
- 保留 OpenDAL 0.57；官网可能比该版本更新。完整名单及当前包的可用性见[服务清单](OPENDAL-SERVICES.md)。不可用项会标注原因并拒绝连接。

## 文件操作

支持列表的服务沿用树形文件表格。不支持列表的服务会弹框说明；路径框可输入相对于连接根目录的路径，用旁边图标进入目录、预览或下载文件。

不能通过目录列表探测的服务只报告“配置已构建、尚未验证访问”，需使用已知文件验证。每项操作按实际能力及安全前置条件执行；例如不能判断目标存在性、完成临时文件发布或安全清理时，不开放上传。只读连接的写操作禁用，能力不足则弹框说明。

文本及图片预览限制与原连接相同。没有 stat 的服务按流读取，下载只报告已传字节；不能安全保存时文本只读。切换路径仍确认未保存修改。

## 开发与验证

`services.json` 是唯一服务目录。更新后执行 `node scripts/services.mjs`，同步 Manifest、Cargo features 和支持文档；`npm run validate` 检查是否一致。运行时不请求官网。

通用参数仅在构建层转换为 Operator，复用现有 Session、URI 校验、文件操作和传输；不扩展宿主 API。WebDAV 复用已有流式适配，配置兼容适配不进入文件操作层。

```bash
npm test
npm run validate
cargo test --locked --manifest-path backend/Cargo.toml
no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1 cargo test --locked --manifest-path backend/Cargo.toml live_generic_six_protocols -- --ignored --nocapture
```

联调参见[独立调试指南](STANDALONE-DEBUG.md)。实测只覆盖本地六协议、Memory、Fs 和能力受限后端，不代表已对全部云服务验证。

本次验证：48 项后端测试、18 项前端测试、12 项模拟宿主测试及 Secret Store 字段隔离测试通过；通用入口六协议与原六协议实测通过。浏览器验证了通用表单、Memory 文本预览保存与 PNG 解码、HTTP 无列表路径读取、只读预览、能力不足弹框、不可用服务拒绝连接及多 Tab 上下文隔离和切换保留预览。目录包含 66 个服务，macOS ARM 包编译其中 57 个，其余标明不可用原因。测试连接已清理，真实宿主验收仍受下述问题阻塞。

## 宿主加密阻塞证据

只读检查 `runtime/dbx` 的 `c26ff3f`：`crates/dbx-core/src/storage.rs:1027` 明确注明连接密钥以明文保存；同文件 `save_connection` 路径将 `connection_secrets` 写入 SQLite，普通连接 JSON 中则清空对应值。文件权限限制不能替代加密。

`node scripts/check-host.mjs` 仍可复现已有 Workbench 上下文克隆阻塞。未修改宿主源码；当前不宣称完成正式宿主安装、参数加密落盘和工作台联调验收。

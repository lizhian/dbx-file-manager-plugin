# OpenDAL 通用连接

连接类型“OpenDAL 通用”填写连接名称、服务和参数，新建时默认选择 s3；编辑已有连接保留原服务。下拉框仅显示服务名，全部 66 个服务均可选择。旧六协议连接保持原样，不需要迁移。

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
- map 类型字段使用单行 JSON。例如 HDFS Native 的 `options={"dfs.client.use.datanode.hostname":"true"}`。0.59 的 map 反序列化缺口由构建层兼容，支持 HDFS Native `options` 和 S3 `assume_role_session_tags`。
- 固定 OpenDAL 0.59.1（升级时最新稳定版）；Rust 最低要求 1.91。完整名单及当前包的可用性见[服务清单](OPENDAL-SERVICES.md)。不可用原因在测试连接或打开连接时返回，下拉选项不显示支持状态。

## 文件操作

支持列表的服务沿用树形文件表格。不支持列表的服务显示说明；路径框可输入相对于连接根目录的已知文件路径并按回车预览，文件行中提供下载按钮。

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

本次验证：48 项后端测试、18 项前端测试、12 项模拟宿主测试及 Secret Store 字段隔离测试通过；通用入口六协议与原六协议实测通过。浏览器验证了通用表单、Memory 文本预览保存与 PNG 解码、HTTP 无列表路径读取、只读预览、能力不足弹框、不可用服务拒绝连接及多 Tab 上下文隔离和切换保留预览。目录包含 66 个服务，macOS ARM 包编译其中 58 个，其余标明不可用原因。测试连接已清理，真实宿主验收仍受下述问题阻塞。

## 宿主加密阻塞证据

只读检查 `runtime/dbx` 的 `c26ff3f`：`crates/dbx-core/src/storage.rs:1027` 明确注明连接密钥以明文保存；同文件 `save_connection` 路径将 `connection_secrets` 写入 SQLite，普通连接 JSON 中则清空对应值。文件权限限制不能替代加密。

`node scripts/check-host.mjs` 仍可复现已有 Workbench 上下文克隆阻塞。未修改宿主源码；当前不宣称完成正式宿主安装、参数加密落盘和工作台联调验收。

## 服务支持检测

`service_support.rs` 统一读取服务目录，检查平台与安装包支持，并在构建 SFTP Operator 前通过当前进程 PATH 执行 `ssh -V`，超时两秒，丢弃标准输出和错误输出。HDFS Native 不要求 JVM。
OpenDAL 0.59.1 通过 registry 的 schemes() 只读接口核对已注册服务，在创建 Operator 前拒绝未注册项；不使用虚假配置创建探测 Operator。

测试和打开连接共用检测路径，保存配置不触发检测。错误码保持 `service_unavailable`，详情 `reason` 为 `platform`、`dependency`、`version`、`runtime_dependency` 或 `unregistered`；运行依赖错误另带 `dependency` 和 `detail`（missing、not_executable、timeout、failed）。未知服务及错误配置仍为 configuration，远端认证失败仍为 permission_denied。

2026-09-11：54 项 Rust 非 live 测试、3 项 live 测试、32 项前端测试和 3 项连接表单测试通过，构建及清单校验通过。模拟宿主验证六种专用入口和通用 S3 的连接、列表；compfs、hdfs、gcs-grpc 可保存，但测试及打开均返回一致的支持错误。未自动安装依赖或扩大编译服务范围。

OpenDAL 升级记录：0.57.0 → 0.59.1；服务清单中的 gcs-grpc 已从“版本未提供”改为包含在当前构建。services-huggingface 是 hf 的特性别名，services-redis-native-tls 是传输选项，不额外创建连接服务项。

0.59.1 升级验证：57 项 Rust 测试（含三项真实环境测试）全部通过；32 项前端测试、3 项连接表单测试及清单校验通过。WebDAV 流式层已迁移为 Service/Layer::apply_service，启动构建前显式调用 install_default() 安装 HTTP 传输与服务注册；嵌套参数兼容仍保留。gcs-grpc 已编译并验证 registry 注册，未连接真实 Google Cloud 环境。

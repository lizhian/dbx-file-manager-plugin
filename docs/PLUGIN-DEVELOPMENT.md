# 文件管理插件

## 当前验收状态

`0.2.0` 已构建并安装到原版 `c26ff3f` 宿主，插件中心显示兼容，安装后的 UI 与构建产物一致。
40 项 Rust 单元测试、12 项前端测试通过；独立六协议实测覆盖上传、列表、文本保存、重命名、下载比对、图片识别与清理，全部通过。
浏览器以模拟桥接验证文本保存请求、PNG 解码，以及桌面和 390px 窄屏布局，无横向溢出；这不代替原生宿主验收。

**宿主集成尚未完成**：从连接打开 Tab 后，宿主显示 `The object can not be cloned.`。
`PluginWorkbenchHost.vue` 将 Vue 响应式 `props.context` 传给 `PluginHostBridge`，后者在 `pluginHostBridge.ts:455` 直接调用 `structuredClone`；Proxy 无法克隆。
异常发生在创建 iframe 前，插件代码尚未运行，无法由插件修复。宿主源码保持未修改；原生上传下载对话框、多 Tab 内容隔离与实际图片渲染尚未完成宿主验收。

已有宿主源码时，可只读复现：`node scripts/check-host.mjs`，当前返回非零及 `BLOCKED`。
发给上游作者的完整复现、根因和修复建议见[宿主阻塞报告](UPSTREAM-HOST-BLOCKERS.md)。
需要上游修复 Workbench 上下文克隆后才能完成原生验收；本文“使用”描述预期使用流程，不表示当前宿主已可用。

## 使用

新增“OpenDAL 通用”入口，按服务与 `key=value` 参数配置；见[通用连接说明](OPENDAL-GENERIC.md)及[服务支持清单](OPENDAL-SERVICES.md)。注意：当前宿主 Secret Store 实为明文 SQLite，参数加密存储尚未实现，通用入口仅用于测试凭据。

面向 macOS Apple Silicon，兼容官方 DBX Host API 1.0，不需要宿主补丁。
在插件中心允许安装未签名开发包并安装 `dist/*.dbxp`，然后在宿主新建 FTP、SFTP、S3、WebDAV、WebHDFS 或 HDFS Native 连接。
从连接列表打开：一个连接一个宿主 Tab，重复打开激活已有 Tab；连接与凭据由宿主管理。

当前宿主 `c26ff3f` 的连接保存流程会清空插件 `external_config`（`ConnectionDialog.vue` 的通用清理分支）。
为免修改宿主，本插件将协议专属配置字段也绑定到宿主 Secret Store；两个布尔配置采用“是/否”选项。
后端仍兼容旧 `external_config`，同名 Secret Store 值优先。旧连接首次编辑时需重新核对协议专属配置。

页面支持目录浏览、分页、新建目录、重命名、删除、上传下载、图片预览和 UTF-8 文本编辑。
上传/下载弹出 macOS 原生文件对话框。协议不支持或只读连接的操作会禁用。

文件列表采用宿主 `feat/issue-16-opendal-file-manager-mvp` 分支的单栏树形表格：单击目录展开、双击进入，顶部返回上级与刷新，行尾提供复制、重命名、下载和删除。单击文件默认预览，下载使用行尾按钮或右键菜单；文本和图片保留各自的文件图标，文本编辑仍保留未保存确认与远端冲突检测。
右上角“传输列表”弹出传输记录，支持取消，以及打开本次页面下载的文件或所在文件夹。打开本地文件使用原生选择器授权令牌，页面重载或令牌过期后需重新下载才能使用这两个入口。窄屏表格可横向滚动。

## 构建与测试

需要脱离 DBX 联调真实前后端时，运行 `npm run dev:standalone`，参见[独立调试指南](STANDALONE-DEBUG.md)。

需要 Node.js 22+、Rust 1.91+ 和 macOS 自带 OpenSSH。依赖安装使用锁文件，官方原生打包 CLI 随 npm 可选依赖安装。

```bash
npm ci
npm test
npm run build
npm run validate
cargo test --locked --manifest-path backend/Cargo.toml
npm run package
```

构建输出 `dist/io.github.lizhian.file-manager-0.2.1-darwin-arm64.dbxp`。
若需要代理，参见[宿主开发指南](HOST-DEVELOPMENT.md)。无需设置 `DBX_PLUGIN_SDK_ROOT`；后端已经固定官方 SDK Git 提交。

复用[六协议环境](tests/README.md)执行真实读写测试：

```bash
no_proxy=localhost,127.0.0.1,::1 NO_PROXY=localhost,127.0.0.1,::1 \
  cargo test --locked --manifest-path backend/Cargo.toml live_workbench_six_protocols -- --ignored --nocapture
```

测试使用随机目录，覆盖上传、列表、文本保存、重命名、下载比对、图片识别和清理；失败可能留下带 `dbx-workbench-` 前缀的测试目录。
`npm run dev` 可启动前端开发服务器，但文件操作需要宿主注入桥接；独立浏览器不是可连接远程服务的替代入口。

## 代码入口

- `frontend/src/`：Vue 自定义页面、连接内状态和 API 1.0 桥接；不导入宿主源码。
- `backend/src/workbench.rs`：预览快照、分块文本保存、本地文件选择授权；`operations.rs` / `transfer.rs` 复用协议操作和流式传输。
- `manifest.json`：六种原有连接及 OpenDAL 通用连接字段与统一 Workbench；`tests/schema/manifest.schema.json` 保持官方 `c26ff3f` Schema 原样。
- `ui/`：构建生成的内联 HTML，避免沙箱加载外部脚本；`scripts/package.mjs` 调用官方原生 CLI。

自定义 RPC 使用 `workbench/*`，返回 `{ok,value}` 或 `{ok:false,error}`，避免宿主字符串错误丢失冲突类型。
请求必须携带宿主连接 ID 和匹配的 provider ID；本地路径只由原生对话框授权令牌传递，预览与草稿令牌绑定连接代次。
图片/文本通过 512 KiB 分块传输，避免宿主单次 JSON 请求 2 MiB 上限。

## 首版限制

- 文本限 UTF-8；2 MiB 内可完整预览和编辑，超限仅只读预览前 1000 行（最多 20 MiB，超长行提前截断），不可保存。PNG/JPEG/GIF/WebP 限 20 MiB。HTML/XML/SVG 只作为文本显示，不执行、不渲染。
- 保存优先使用条件 ETag；不支持条件写的协议先比较完整内容，再写入，无法消除其他客户端在检查与写入之间的竞争。覆盖操作需要明确确认。
- 文本直接写入远端；写入超时或断连时结果可能不确定，应重新下载检查，不盲目重试。
- 预览/草稿保留在内存，30 分钟过期；不写磁盘。宿主关闭 Tab 无法拦截，关闭前需要保存。
- 仅删除文件和空目录；目录重命名可能采用复制后删除，失败时需检查两端。支持同目录文件复制，不支持目录复制、递归上传下载、断点续传、图片编辑、Kerberos 或 HDFS HA。
- FTP 明文；SFTP 依赖 OpenSSH，首次接受未知主机密钥，仅在可信环境使用。

## 统一 Operator 会话（2026-09-11）

连接入口负责校验宿主 provider 绑定并构建 OpenDAL Operator；会话不再保存协议、服务名或 provider ID。
Session 集中保存 Operator、不可变原始能力快照，以及只读、代次、超时、并发和游标状态，提供统一能力判断、路径转换和文件操作执行入口。
所有页面及文件 RPC 使用 `opendal:/` 导航根；实际存储根仍由配置写入 Operator，避免重复拼接。
旧协议导航 URI 不再接受，既有连接配置与 provider ID 不变；传输记录仍携带经过入口校验的宿主 provider ID。
页面统一展示路径输入框，根据能力禁用操作，不再按连接类型分支。

连接创建同步检查远端；没有列表能力或检查返回 Unsupported 时，明确返回 `configuration_only`，不假称已验证。其他检查错误阻止发布会话。
取消上传统一尝试 OpenDAL abort，仅 Unsupported 时尝试 close，再清理临时文件。

## 连接配置汇聚（2026-09-11）

`config.rs` 的 `ConnectionRequest::normalize()` 是连接入口 adapter：负责宿主字段兼容、认证选择、端点转换及 Hadoop XML 读取，输出统一的 `Configuration { service, parameters }`。
六种专用入口不再直接调用 OpenDAL 服务 builder。通用入口将 Secret Store 中的 `key=value` 参数解析为相同结构。
`generic.rs` 的 `Configuration::build()` 是唯一构建路径；委托 `service_support.rs` 检查平台、打包和运行依赖并初始化 OpenDAL registry，再校验根目录、应用嵌套配置与 WebDAV 流式适配。
规范化配置含凭据，不实现 Debug、不写入日志；宿主 Secret Store 优先级、旧 external_config 兼容、S3 禁用环境凭据加载及认证方式互斥保持不变。

验证：53 项 Rust 测试全部通过（含三个真实环境测试，覆盖六协议专用入口、通用入口和分页回归）。

## 统一前端（2026-09-11）

七种连接入口共用通用 OpenDAL 页面及带类型的能力模型。路径栏统一支持目录访问、已知文件预览和下载；没有 list 能力时显示说明，不弹出阻塞对话框。
目标目录选择器支持树形选择和直接输入，复用同一套相对路径转换，避免中文、空格目录重复编码。
复制、移动、重命名共用执行流程，移动前确认未保存草稿；各按钮分别检查所需能力，copy 不依赖 rename，文本编辑统一检查 edit、只读状态和预览限制。

验证：30 项前端测试通过，覆盖七种连接入口的无列表能力页面、已知路径下载入口、目标目录编码与草稿保护；构建和 Host API 1.0 清单校验通过。独立浏览器以重建后的后端验证 S3 目录列表及统一工具栏。

## S3 默认寻址修复（2026-09-11）

S3 专用表单原默认 `path_style=false`，而通用 OpenDAL S3 默认使用路径式寻址，导致同样的 IP 端点表现不同。
例如端点 `http://127.0.0.1:9000`、存储桶 `dbx` 在虚拟主机模式下会访问 `http://dbx.127.0.0.1:9000`，连接失败。
专用表单默认值现改为“是”，与通用入口一致；已保存连接仍保留用户选择，IP 端点的旧连接需手动将“路径式寻址”改为“是”。
回归测试覆盖表单默认值经宿主映射后的 Secret Store 字段，以及显式选择虚拟主机模式不会被覆盖。
浏览器模拟宿主验证六种专用连接和通用 S3 的连接测试、目录列表全部通过；这不替代原生 DBX 宿主验收。

## 空默认值兼容（2026-09-11）

宿主会将未声明的字段默认值序列化为 null，保存 secret 时可能通过 String(null) 写入字面值 "null"。
连接文本、密码、文本域字段现显式使用空字符串默认值；已有非空默认值保持不变。服务下拉默认 s3，因为宿主要求 select 默认值必须属于选项，空字符串不适合作为该控件的选项。
生成脚本同步维护这些默认值；使用宿主原始 buildPluginConnectionConfig 验证七个入口不再生成字面值 "null" secret。
已保存的 "null" 不会自动删除，需编辑连接并清空相应字段后保存。新默认值随下一次安装包更新生效。

# DBX 插件宿主阻塞报告与修复建议

建议 Issue 标题：`[Plugin API 1.0] 连接 Workbench 无法加载，且保存连接时丢失 external_config`

## 1. 请求摘要

我们正在开发一个独立文件管理插件，希望使用官方插件接口，不维护宿主补丁：

- 插件实现自定义 Workbench 文件页面和 Rust/OpenDAL 后端。
- 宿主管理连接配置、凭据、连接生命周期及 Tab。
- 每个文件连接对应一个宿主 Tab，重复打开同一连接激活已有 Tab。
- 首版面向 macOS Apple Silicon，支持 FTP、SFTP、S3/MinIO、WebDAV、WebHDFS、HDFS Native。

目前发现两个宿主实现问题：

| 问题 | 用户可见结果 | 当前状态 |
| --- | --- | --- |
| 响应式上下文无法克隆 | 连接 Tab 显示 `The object can not be cloned.`，自定义页面无法加载 | 无可靠插件侧绕过方案，阻塞原生界面验收 |
| 保存连接时清空 `external_config` | 根目录、端点、Bucket 等协议配置保存后丢失 | 插件临时改用 Secret Store 绑定绕过，但不应成为长期方案 |

**建议优先作为 API 1.0 的兼容性缺陷修复。** 这两个问题不需要新增文件管理专用 API，也不需要让插件获得宿主 DOM 或 Tauri 权限。若上游另有接口演进计划，可独立安排，不必让当前修复依赖新版本 API。

## 2. 复现环境

| 项目 | 值 |
| --- | --- |
| 宿主仓库 | <https://github.com/t8y2/dbx> |
| 宿主分支 | `dev/plugin-framework-current` |
| 宿主提交 | `c26ff3f6d4bd643be8dedd659c3236af4a5bd556` |
| 宿主插件 API | `1.0.0` |
| 插件 | `io.github.lizhian.file-manager`，版本 `0.2.0` |
| Manifest 要求 | `host_api: ">=1.0.0, <2.0.0"` |
| 平台 | macOS Apple Silicon / ARM64 |
| 启动方式 | `make dev-fast` |
| 安装方式 | 插件中心启用“允许安装未签名开发包”，安装本地 `.dbxp` |
| 宿主修改 | 无；未应用项目历史宿主补丁 |

以下源码链接固定到上述提交，避免分支更新后行号变化。结论针对该提交，不代表上游后续版本一定仍存在问题。

## 3. 阻塞一：连接 Workbench 上下文无法克隆

### 3.1 用户操作与现象

1. 安装包含 `connection-provider` 和 `workbench` 贡献的插件。
2. 让连接 provider 的 `workbench` 字段指向插件自定义工作台。
3. 在宿主新建有效连接，保存并连接。
4. 从侧边栏打开该连接。

预期：宿主创建连接 Tab，将非敏感连接上下文交给插件页面，页面可以等待 `window.dbxPlugin.ready` 并调用插件后端。

实际：宿主创建了 Tab，但内容区显示：

```text
The object can not be cloned.
```

问题发生在宿主桥接初始化阶段，而不是读取 FTP/S3 数据时。更换协议、安装签名或减少文件大小不能解决此错误。

### 3.2 数据流与根因

```text
openPluginConnection(connectionId)
  → 生成普通 context 对象
  → openPluginWorkbench 将 context 存入响应式 tabs
  → Vue 读取嵌套状态时返回 Proxy
  → ContentArea 将 context 作为 prop 传入 Workbench
  → PluginWorkbenchHost.createBridge()
  → new PluginHostBridge(..., props.context, ...)
  → structuredCloneSafe(context)
  → structuredClone(Vue Proxy)
  → DataCloneError
```

关键位置：

- [queryStore.ts:2459](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/stores/queryStore.ts#L2459)：创建或复用 Workbench Tab，保存上下文。
- [queryStore.ts:2524](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/stores/queryStore.ts#L2524)：从保存的连接打开工作台，传入连接 ID、provider ID 和连接类型。
- [ContentArea.vue:2387](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/components/layout/ContentArea.vue#L2387)：传递 `activeTab.pluginWorkbench.context`。
- [PluginWorkbenchHost.vue:55](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/components/plugins/PluginWorkbenchHost.vue#L55)：把 `props.context` 传入桥接构造函数。
- [pluginHostBridge.ts:57](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/lib/plugins/pluginHostBridge.ts#L57)：构造时克隆上下文。
- [pluginHostBridge.ts:454](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/lib/plugins/pluginHostBridge.ts#L454)：实际克隆逻辑。

当前辅助函数：

```ts
function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
```

`structuredClone` 不支持 Proxy。该函数的回退仅处理“不存在 structuredClone API”，没有处理“API 存在但输入不可克隆”。Vue 的 TypeScript 类型仍然表现为普通上下文接口，无法在编译时暴露这个问题。

克隆意图本身合理：桥接需要一份与宿主状态解耦的数据快照。缺失的是响应式状态到跨边界数据的转换，而不是应该取消所有克隆。

### 3.3 最小复现与对照

在有 Vue 的环境中执行：

```ts
import { reactive, toRaw } from "vue";

const plain = { connectionId: "test" };
const proxy = reactive(plain);

structuredClone(plain);        // 通过
structuredClone(proxy);        // DataCloneError
structuredClone(toRaw(proxy)); // 当前这个简单对象通过
```

我们也直接加载了上述提交的真实 `PluginHostBridge`，仅改变传入对象的响应式状态，得到：

```text
plain: PASS
Vue Proxy: DataCloneError / #<Object> could not be cloned.
toRaw: PASS
```

WebKit 与 Node/Chromium 的错误文案不同，但异常类别和触发原因一致。

本插件仓库已有只读复现脚本，在 `runtime/dbx` 为该宿主源码、且执行过 `npm ci` 的情况下运行：

```bash
node scripts/check-host.mjs
```

当前返回非零，输出：

```text
BLOCKED: host cannot initialize a connection workbench: #<Object> could not be cloned.
```

### 3.4 建议修复

**在宿主 Workbench 桥接入口统一生成普通数据快照，不把 Vue Proxy 交给 structuredClone 或 postMessage。**

建议实现一个专用于上下文的 `snapshotWorkbenchContext`，而不是只在某一个 Vue 组件临时处理：

1. 将上下文定义为跨边界的数据对象，不包含 DOM、函数、组件实例、连接对象或凭据。
2. 对对象和数组递归去响应式化，构造独立的普通对象快照。
3. 对不支持的值提供明确错误，不能静默丢字段或吞掉异常后返回空上下文。
4. 在构造函数及 `updateContext` 使用同一转换函数；检查 Tab 创建、复用路径中直接 `structuredClone(options.context)` 的调用。
5. 将验证通过的快照交给 `sendInit`、`host.getContext` 和上下文更新消息。

以下为基于 JSON 数据契约的参考实现方向，**尚未应用到宿主**。如果已有插件依赖 Date/Map 等非 JSON 类型，上游应先确认兼容性并补充对应类型支持，不能直接照搬收紧类型范围。

```ts
import { toRaw } from "vue";

type JsonValue = null | boolean | number | string
  | JsonValue[] | { [key: string]: JsonValue };

function snapshotContextValue(
  input: unknown,
  ancestors = new WeakSet<object>(),
): JsonValue {
  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return input;
  }
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input !== "object") throw new Error("Invalid plugin context value");

  const raw = toRaw(input);
  if (ancestors.has(raw)) throw new Error("Circular plugin context");
  const proto = Object.getPrototypeOf(raw);
  if (!Array.isArray(raw) && proto !== Object.prototype && proto !== null) {
    throw new Error("Plugin context requires plain data");
  }
  ancestors.add(raw);
  try {
    if (Array.isArray(raw)) {
      return Array.from(raw, value =>
        value === undefined ? null : snapshotContextValue(value, ancestors));
    }
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, snapshotContextValue(value, ancestors)]),
    );
  } finally {
    ancestors.delete(raw);
  }
}
```

该方案递归创建新对象，因此不再需要对输出执行一次 `structuredClone`。入口仍应验证根节点为上下文对象，并沿用现有大小限制。对象中省略 `undefined`、数组中转为 `null` 的规则应写入契约；超限或循环引用应明确报错。

仅增加 `toRaw(context)` 可解决本次简单上下文，但 `toRaw` 不是递归深拷贝，不能保证嵌套对象中没有其他 Proxy。不建议把“根节点 toRaw 后不报错”作为完整验收标准。

### 3.5 为什么插件无法自行修复

宿主 `loadWorkbench` 在 `createBridge()` 抛错后进入错误展示分支，未进入可工作的 iframe 页面。插件无法在自己的脚本中拦截一个发生在宿主初始化阶段的异常。

以下方式不应作为正式方案：

- 在插件中调用 `toRaw`：执行时机太晚，且插件不拥有宿主响应式对象。
- 从 iframe 修改父页面或替换宿主 `structuredClone`：违反沙箱边界。
- 在开发者工具注入补丁：改变宿主运行行为、重启失效，无法分发。
- 改用不带连接上下文的单一工作台：改变产品模型，不能满足每连接一个宿主 Tab。

## 4. 阻塞二：插件连接配置在保存时被清空

### 4.1 现象与复现

使用官方声明式字段绑定，例如：

```json
{
  "key": "root",
  "label": "远程根目录",
  "type": "text",
  "binding": "config",
  "default": "/"
}
```

1. 在宿主连接表单填写非默认根目录，例如 `/ftp/dbx/`。
2. 保存连接，再编辑或读取已保存的非敏感配置。
3. 预期 `external_config.root` 保留原值；实际观察到 `external_config` 为 `null`，协议字段丢失。

类似问题也影响 S3 的 endpoint、region、bucket，以及 HDFS 的配置目录等。字段验证通过不代表字段最终被持久化。

### 4.2 根因

[ConnectionDialog.vue:4045](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/components/connection/ConnectionDialog.vue#L4045) 先通过 `buildPluginConnectionConfig` 正确生成插件配置。

但同一 `connectionConfigForSubmit` 函数随后进入通用数据库归一化分支，在 [ConnectionDialog.vue:4273](https://github.com/t8y2/dbx/blob/c26ff3f6d4bd643be8dedd659c3236af4a5bd556/apps/desktop/src/components/connection/ConnectionDialog.vue#L4273) 执行：

```ts
} else if (!isDoltDriverProfile(config.driver_profile)) {
  config.external_config = undefined;
}
```

普通插件连接不属于前面的特定数据库分支，也不是 Dolt，因此命中清理逻辑。声明式字段构建结果在提交前被清空。

### 4.3 建议修复

最小兼容修改是让通用清理分支排除插件连接：

```ts
} else if (
  config.db_type !== "plugin" &&
  !isDoltDriverProfile(config.driver_profile)
) {
  config.external_config = undefined;
}
```

需要同时审计该提交函数中的其他数据库专属清理逻辑，确保不误删插件字段。不要直接从插件分支提前 `return`，否则可能跳过后面的公共超时、隧道或其他必要归一化。

保持原有归属：

- `binding: "config"` 的普通协议参数留在 `external_config`，保留布尔、数值等原始类型。
- `binding: "secret"` 的密码和令牌仍通过 Secret Store 保存，不混入普通配置。
- UI 上下文只包含连接引用及允许披露的非敏感导航信息，不包含 `connection_secrets`。

### 4.4 当前插件绕过措施与迁移

为在不改宿主的约束下继续开发，我们临时把协议专属配置也绑定到 Secret Store，两个布尔字段改成字符串形式的“是/否”选项。后端将它们还原为原来的配置类型，同时仍接受旧 `external_config`。

这不是推荐长期契约：普通配置和凭据语义被混合，连接编辑与后续迁移也更复杂。

宿主修复后，插件可以恢复正常 `config` 绑定，但应保留过渡读取逻辑。迁移要由插件明确实施，在新位置保存成功前不删除旧值；不能假定改回 Manifest 绑定后数据会自动搬迁。

## 5. 建议回归测试与验收

| 场景 | 验收标准 |
| --- | --- |
| 普通 context 初始化 | 桥接初始化成功，内容保持一致 |
| Vue reactive / readonly context 初始化 | 不产生 DataCloneError，输出为独立普通数据 |
| 普通对象内嵌响应式对象、数组 | 递归转换正确，postMessage 成功 |
| `updateContext` 传入响应式对象 | 更新成功，不要求重建 iframe |
| 修改原始状态或返回的上下文 | 不意外修改桥接内部快照 |
| 不支持的值、循环引用、超限上下文 | 可定位的错误；不能静默丢数据或退化为空上下文 |
| 实际连接打开 Workbench | iframe 加载，`window.dbxPlugin.ready` 完成，能调用后端 |
| 两个连接分别打开 | 两个宿主 Tab，连接上下文不串用 |
| 同一连接重复打开 | 激活已有 Tab，不增加重复 Tab |
| Tab 切换、关闭重开、宿主重启恢复 | 上下文正确，无克隆异常；页面状态保留策略明确 |
| 新建、编辑、保存并连接 | `external_config` 中的字符串、布尔和数值不丢失、不变型 |
| 保存后重新加载/重启 | 普通配置持久化正确，凭据仍留在 Secret Store |
| 普通数据库及 Dolt 连接 | 不回归原有配置清理行为 |

建议在现有 `pluginHostBridge.spec.ts` 增加真实 Vue Proxy 输入测试。现有相关用例主要使用普通字面量对象，不能覆盖本次实际调用模式。

连接保存测试应覆盖完整 `connectionConfigForSubmit` 路径或真实连接对话框交互，而不仅测试 `buildPluginConnectionConfig`，因为字段是在后续公共分支中被清空的。

我们现有的验证结果：40 项 Rust 单元测试、12 项前端测试，以及独立六协议读写测试通过。浏览器模拟桥接下文本保存请求、图片解码和窄屏布局检查通过。这些结果只能说明插件相关部分已有测试覆盖，**不能替代修复后的真实宿主验收**。

## 6. 接口版本与交付建议

建议上游将修复作为宿主补丁版本发布，继续兼容 Host API 1.0，并提供包含修复的提交 SHA、版本号或测试包。

请明确以下现有接口约定，避免插件依赖宿主实现细节：

- Workbench context 是数据快照，允许的类型及大小限制是什么。
- 宿主负责从内部响应式状态转换为桥接数据，插件不需要了解 Vue。
- 连接 Tab 按插件、贡献点及连接 ID 区分，重复打开的行为保持稳定。
- `config` 字段在新建、编辑和连接恢复中保持类型与值，`secret` 字段由 Secret Store 管理。

若要额外新增关闭 Tab 前的未保存确认、原生文件选择等能力，可以作为后续 API 增强讨论；它们不是本次克隆错误和配置丢失的根因，也不应成为这次修复的前置条件。

修复完成后，我们将恢复正常字段绑定的测试，并在原版宿主完成六协议文件管理、自定义页面、连接 Tab、图片预览、文本保存及原生传输流程的端到端验收。

本报告仅描述已核对提交上的问题和建议，未修改宿主源码，也未声称上述参考实现已通过宿主完整回归测试。

# Docker 本地文件服务

## 1. 准备

安装并启动 Docker（含 Compose），确保本机有 Bash 和 `ssh-keygen`。
无需构建插件，也不需要 Node.js 或 Rust。首次拉取镜像和启动预计 3–10 分钟，取决于网络。

以下命令从仓库根目录开始。先确认下表端口空闲；已有服务请直接复用，不要停止或覆盖。
更换 Compose 项目名不会避免端口冲突。复用 SFTP 时需使用原服务已授权的私钥。
Hadoop 和 WebDAV 使用 amd64 镜像，Apple Silicon 需启用 Docker 的 x86_64 模拟支持。

## 2. 启动

```bash
cd docs/tests
env -u DBX_FM_SFTP_KEY_PATH bash setup.sh
docker compose -p local-file-test up -d
docker compose -p local-file-test ps -a
```

等待六个常驻容器显示 `healthy`，`s3-init` 显示 `Exited (0)`。
启动异常时运行 `docker compose -p local-file-test logs --tail=80`。
健康检查仅表示服务就绪，实际读写需用对应客户端验证。
配置已让 FTP 前台运行，避免镜像默认 PID 监控导致首次启动后退出。

## 3. 连接

客户端运行在本机；所有端口仅绑定 `127.0.0.1`。
下列相对路径以刚进入的 `docs/tests` 目录为基准。

| 协议 | 地址 | 连接参数 |
| --- | --- | --- |
| FTP | `ftp://127.0.0.1:2121` | 用户 `dbx`，密码 `dbx-password`，根目录 `/ftp/dbx/`，被动模式 |
| SFTP | `ssh://127.0.0.1:2222` | 用户 `dbx`，私钥 `runtime/sftp/id_ed25519`，根目录 `/config`，不支持密码登录 |
| S3 / MinIO | `http://127.0.0.1:9000` | Access Key `dbx-access-key`，Secret Key `dbx-secret-key`，Bucket `dbx`，Region `us-east-1`，启用 path-style |
| WebDAV | `http://127.0.0.1:8080` | Basic 认证，用户 `dbx`，密码 `dbx-password`，根目录 `/` |
| WebHDFS | `http://127.0.0.1:9870` | 用户 `dbx`（`user.name=dbx`），根目录 `/` |
| HDFS Native | `hdfs://127.0.0.1:19000` | 根目录 `/`，客户端加载 `config/hadoop/client`，启用 `dfs.client.use.datanode.hostname=true` |

FTP 还占用被动端口 `21100–21109`；Hadoop DataNode 占用 `9864`、`9866`。
SFTP 私钥和 Hadoop 配置目录在客户端中建议填写绝对路径，可用 `pwd` 获取当前目录。
WebHDFS 与 HDFS Native 共用同一套 Hadoop 数据。

## 4. 验证读写

在同一目录运行，预计 20–60 秒：

```bash
bash smoke.sh
```

自检需要本机 `curl` 7.75+（AWS 签名支持）和 OpenSSH `sftp`；无需 Node.js 或 Rust。
HDFS 原生客户端借用 Hadoop 镜像，通过 `--network host` 访问发布端口；
Docker Desktop 4.34+ 需启用 host networking，Linux Docker / 本次验证的 OrbStack 可直接使用。
脚本仅适用于上表默认端口、测试账号和本目录私钥，不用于任意复用环境。

最后应显示 `PASS: all six protocols, content comparison and cleanup`。
它实际写入、读回并逐字节比对小文件，清理本次随机命名的文件；失败返回非零退出码。
SFTP 首次信任仅写入临时 known_hosts，不修改用户 SSH 配置。

实测：2026-09-07，macOS / OrbStack，启动后及停止重启后两轮六协议小文件读写、内容比对与清理均通过。
这不代表大文件性能或长期稳定性验证。

## 5. 停止

在同一目录执行，保留容器数据；再次使用启动命令即可恢复：

```bash
docker compose -p local-file-test stop
```

仅用于本地测试：凭据公开、FTP 明文、Hadoop 未启用 Kerberos。
未配置统一持久化：FTP、S3、WebDAV 和 Hadoop 数据随容器删除而丢失；
SFTP 的 `/config` 由镜像自动创建匿名卷，删除容器不一定清除该卷，也不保证新建容器自动复用。
本地生成的 SFTP 密钥不要提交或共享。

# OpenDAL 服务支持清单

由 `services.json` 生成，执行 `node scripts/services.mjs` 更新。

OpenDAL 0.57.0，目标 aarch64-apple-darwin。“已编译”表示构建包含该服务，不代表已对全部云服务实测。SFTP 仍需要系统 OpenSSH。

| 服务与配置参考 | 状态 | 原因 |
| --- | --- | --- |
| [aliyun-drive](https://opendal.apache.org/services/aliyun-drive/) | 已编译 | - |
| [alluxio](https://opendal.apache.org/services/alluxio/) | 已编译 | - |
| [azblob](https://opendal.apache.org/services/azblob/) | 已编译 | - |
| [azdls](https://opendal.apache.org/services/azdls/) | 已编译 | - |
| [azfile](https://opendal.apache.org/services/azfile/) | 已编译 | - |
| [b2](https://opendal.apache.org/services/b2/) | 已编译 | - |
| [cacache](https://opendal.apache.org/services/cacache/) | 已编译 | - |
| [cloudflare-kv](https://opendal.apache.org/services/cloudflare-kv/) | 已编译 | - |
| [compfs](https://opendal.apache.org/services/compfs/) | 当前平台不支持 | 需要 Linux io_uring |
| [cos](https://opendal.apache.org/services/cos/) | 已编译 | - |
| [d1](https://opendal.apache.org/services/d1/) | 已编译 | - |
| [dashmap](https://opendal.apache.org/services/dashmap/) | 已编译 | - |
| [dbfs](https://opendal.apache.org/services/dbfs/) | 已编译 | - |
| [dropbox](https://opendal.apache.org/services/dropbox/) | 已编译 | - |
| [etcd](https://opendal.apache.org/services/etcd/) | 依赖未包含 | 未包含 Protobuf 编译器 |
| [foundationdb](https://opendal.apache.org/services/foundationdb/) | 依赖未包含 | 未包含 FoundationDB 客户端原生库 |
| [foyer](https://opendal.apache.org/services/foyer/) | 已编译 | - |
| [fs](https://opendal.apache.org/services/fs/) | 已编译 | - |
| [ftp](https://opendal.apache.org/services/ftp/) | 已编译 | - |
| [gcs](https://opendal.apache.org/services/gcs/) | 已编译 | - |
| [gcs-grpc](https://opendal.apache.org/services/gcs-grpc/) | 当前版本未提供 | OpenDAL 0.57 未提供该服务 |
| [gdrive](https://opendal.apache.org/services/gdrive/) | 已编译 | - |
| [ghac](https://opendal.apache.org/services/ghac/) | 已编译 | - |
| [github](https://opendal.apache.org/services/github/) | 已编译 | - |
| [goosefs](https://opendal.apache.org/services/goosefs/) | 已编译 | - |
| [gridfs](https://opendal.apache.org/services/gridfs/) | 已编译 | - |
| [hdfs](https://opendal.apache.org/services/hdfs/) | 依赖未包含 | 未包含 JVM 与 libhdfs；可使用 hdfs-native |
| [hdfs-native](https://opendal.apache.org/services/hdfs-native/) | 已编译 | - |
| [hf](https://opendal.apache.org/services/hf/) | 已编译 | - |
| [http](https://opendal.apache.org/services/http/) | 已编译 | - |
| [ipfs](https://opendal.apache.org/services/ipfs/) | 已编译 | - |
| [ipmfs](https://opendal.apache.org/services/ipmfs/) | 已编译 | - |
| [koofr](https://opendal.apache.org/services/koofr/) | 已编译 | - |
| [lakefs](https://opendal.apache.org/services/lakefs/) | 已编译 | - |
| [memcached](https://opendal.apache.org/services/memcached/) | 已编译 | - |
| [memory](https://opendal.apache.org/services/memory/) | 已编译 | - |
| [mini-moka](https://opendal.apache.org/services/mini-moka/) | 已编译 | - |
| [moka](https://opendal.apache.org/services/moka/) | 已编译 | - |
| [mongodb](https://opendal.apache.org/services/mongodb/) | 已编译 | - |
| [monoiofs](https://opendal.apache.org/services/monoiofs/) | 当前平台不支持 | 需要 Linux io_uring |
| [mysql](https://opendal.apache.org/services/mysql/) | 已编译 | - |
| [obs](https://opendal.apache.org/services/obs/) | 已编译 | - |
| [onedrive](https://opendal.apache.org/services/onedrive/) | 已编译 | - |
| [opfs](https://opendal.apache.org/services/opfs/) | 当前平台不支持 | 需要浏览器 WASM 运行环境 |
| [oss](https://opendal.apache.org/services/oss/) | 已编译 | - |
| [pcloud](https://opendal.apache.org/services/pcloud/) | 已编译 | - |
| [persy](https://opendal.apache.org/services/persy/) | 已编译 | - |
| [postgresql](https://opendal.apache.org/services/postgresql/) | 已编译 | - |
| [redb](https://opendal.apache.org/services/redb/) | 已编译 | - |
| [redis](https://opendal.apache.org/services/redis/) | 已编译 | - |
| [rocksdb](https://opendal.apache.org/services/rocksdb/) | 依赖未包含 | 未包含 RocksDB 原生构建依赖 |
| [s3](https://opendal.apache.org/services/s3/) | 已编译 | - |
| [seafile](https://opendal.apache.org/services/seafile/) | 已编译 | - |
| [sftp](https://opendal.apache.org/services/sftp/) | 已编译 | - |
| [sled](https://opendal.apache.org/services/sled/) | 已编译 | - |
| [sqlite](https://opendal.apache.org/services/sqlite/) | 已编译 | - |
| [surrealdb](https://opendal.apache.org/services/surrealdb/) | 已编译 | - |
| [swift](https://opendal.apache.org/services/swift/) | 已编译 | - |
| [tikv](https://opendal.apache.org/services/tikv/) | 依赖未包含 | 未包含 TiKV gRPC 原生构建依赖 |
| [tos](https://opendal.apache.org/services/tos/) | 已编译 | - |
| [upyun](https://opendal.apache.org/services/upyun/) | 已编译 | - |
| [vercel-artifacts](https://opendal.apache.org/services/vercel-artifacts/) | 已编译 | - |
| [vercel-blob](https://opendal.apache.org/services/vercel-blob/) | 已编译 | - |
| [webdav](https://opendal.apache.org/services/webdav/) | 已编译 | - |
| [webhdfs](https://opendal.apache.org/services/webhdfs/) | 已编译 | - |
| [yandex-disk](https://opendal.apache.org/services/yandex-disk/) | 已编译 | - |

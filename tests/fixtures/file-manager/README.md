# Portable six-protocol fixtures

Imported from `lizhian/dbx`, branch
`feat/issue-16-opendal-file-manager-mvp`, commit
`149488ba1a6244d5ca9528eedf90481bc99fbf3d`, directory `deploy/file-manager`.
This documentation is adapted for the independent plugin. Historical source-branch
pass claims are deliberately not carried forward. No runtime keys, generated
targets or product-specific Tauri contract tests were imported.

## Existing services: reuse only

The live harness connects to services; it never manages Docker.
On the current development machine, reuse healthy
`dbx-opendal-{ftp,sftp,s3,webdav}-1`. Do not restart or remove them.
The user started only NameNode/DataNode in isolated project `dbx-plugin-migration`
using this directory's XML bind files. Do not repair the original checkout's
untracked bind paths and do not run `compose down` against either existing project.

| Protocol | Default endpoint | Root / public test credentials |
| --- | --- | --- |
| FTP | 127.0.0.1:2121 | /ftp/dbx/, dbx / dbx-password |
| SFTP | 127.0.0.1:2222 | /config, dbx, explicit existing key-file path |
| S3 | http://127.0.0.1:9000 | /root/, bucket dbx, us-east-1, path style, dbx-access-key / dbx-secret-key |
| WebDAV | http://127.0.0.1:8080 | /, Basic dbx / dbx-password |
| WebHDFS | http://127.0.0.1:9870 | /, simple user dbx |
| HDFS Native | hdfs://127.0.0.1:19000 | /, config/hadoop/client absolute path |

All published ports bind to loopback. FTP also uses passive ports 21100-21109.
Hadoop uses DataNode ports 9864/9866. Its advertised loopback hostname means the
client must run on the Docker host, not in an unrelated container.
Hadoop and WebDAV use amd64 emulation on Apple Silicon.
The imported Hadoop health checks allow 60 failures before declaring unhealthy;
a hung DataNode can temporarily retain a green label. Inspect failing streaks,
recent heartbeat/write activity and an actual data-plane test before accepting
readiness. Do not restart shared services based only on a label.

## Fresh isolated development only

After verifying no existing services use these ports, a developer may explicitly
provision a new environment (not needed for the current reuse run):

```bash
cd tests/fixtures/file-manager
./setup.sh
docker compose -p my-isolated-file-manager up -d
docker compose -p my-isolated-file-manager ps
```

Do not run these provisioning commands against a reused environment. An explicit
`DBX_FM_SFTP_KEY_PATH` makes setup validate the existing key path without copying it
or generating another key. Compose still mounts its own local public-key fixture;
external private-key reuse is intended for an already configured SFTP server.
Private keys remain in ignored runtime storage and are never imported or packaged.
A partially existing local key pair is an error, not permission to overwrite it.

The imported NameNode command originally formatted metadata on every start.
The fixture source now formats only when its VERSION file is absent. Existing
containers retain their original creation-time command: changing this YAML does
not make restarting an older NameNode safe. Inspect Config.Cmd before any recovery;
do not restart/recreate a healthy NameNode merely to recover a hung DataNode.
Restarting only the isolated DataNode preserves the current NameNode metadata.

## Framed plugin live contract

From the plugin repository root:

```bash
DBX_FILE_MANAGER_BINARY="$PWD/backend/target/debug/dbx-plugin-dbx-file-manager-plugin" \
DBX_FM_SFTP_KEY_PATH="/absolute/path/to/existing/id_ed25519" \
node scripts/live-contract.mjs
```

The harness passes only the key path to the sidecar. It never reads/copies the key.
All fixture overrides use environment variables:

- `DBX_FM_PROTOCOLS`: comma-separated subset; default all six, partial runs labeled.
- `DBX_FM_FTP_HOST/PORT/USERNAME/PASSWORD/ROOT`.
- `DBX_FM_SFTP_HOST/PORT/USERNAME/ROOT`, `DBX_FM_SFTP_KEY_PATH`.
- `DBX_FM_S3_ENDPOINT/REGION/BUCKET/ROOT/ACCESS_KEY/SECRET_KEY/SESSION_TOKEN`.
- `DBX_FM_WEBDAV_ENDPOINT/ROOT/USERNAME/PASSWORD`.
- `DBX_FM_WEBHDFS_ENDPOINT/ROOT/USER`.
- `DBX_FM_HDFS_NAME_NODE_URI`, `DBX_FM_HDFS_ROOT`, `DBX_FM_HADOOP_CONFIG_DIRECTORY`.

These names denote individual variables (for example `DBX_FM_FTP_HOST`).
Do not place real credentials in manifests, shell history, logs, or tracked files.
Only run against disposable fixtures: the harness creates and deletes a unique
`dbx-plugin-contract-<UUID>` directory, never shared root data. Cleanup failures
are reported rather than hidden; inspect only the reported test directory.

If a failed run leaves its unique directory, the cleanup helper accepts only the
exact protocol and run UUID printed by that run:

```bash
node scripts/cleanup-live-run.mjs ftp <run-uuid>
```

Use the same binary/key environment as the run. The helper refuses unknown file
names, directories, or paths outside that unique test directory. It never removes
the connection root or manages containers.

## Historical OpenDAL probe

`tests/` is a standalone Rust crate pinned to OpenDAL 0.57.0.
It connects directly to protocol services and bypasses the plugin/host:

```bash
DBX_FM_SFTP_KEY_PATH="/absolute/path/to/existing/id_ed25519" \
cargo run --locked --manifest-path tests/fixtures/file-manager/tests/Cargo.toml
```

This small-fixture probe uses in-memory copy fallback and permissive SFTP known
hosts. It is not proof of bounded transfer memory, host secret handling, UI,
installation, rollback, authentication alternatives, or production conformance.
Its SFTP key path can be overridden; other probe endpoints are the fixed defaults
above. Prefer the framed harness for plugin acceptance.

## Native-Java Hadoop alternative

The existing amd64 Hadoop DataNode stalled again during large-file acceptance:
JMX and JVM attach both stopped responding. Its containers and data were not
restarted or removed. The separate profile below runs Hadoop 3.4.3 classes with
host-architecture Temurin Java 11 (aarch64 in the recorded run), copied from the
pinned Hadoop distribution image. Hadoop's optional amd64 JNI libraries cannot
load on ARM; the fixture uses the Java fallback. This is not Kerberos/HA or native
compression acceptance.

From the plugin repository root:

```bash
docker compose -p dbx-plugin-native-hadoop \
  -f tests/fixtures/file-manager/compose.hadoop-native.yaml up -d --build --wait
export DBX_FM_WEBHDFS_ENDPOINT=http://127.0.0.1:19870
export DBX_FM_HDFS_NAME_NODE_URI=hdfs://127.0.0.1:19100
```

Only this new project's NameNode and DataNode are started. RPC/HTTP/data ports
19100, 19870, 19866 and 19864 are loopback-only and distinct from existing
fixtures. Both services use named, project-scoped volumes; formatting is guarded
by the NameNode VERSION file. Do not run `down -v` against data you need to retain.
The original NameNode container still has its old unconditional-format startup
command despite the guarded source file: do not restart it.

Use the environment above with `scripts/live-contract.mjs` and
`scripts/transfer-resource-contract.mjs`, plus the usual absolute binary and
existing SFTP key path. The accepted binary is extracted from `dist/append-gates`.
The full-six run and all historical failures are in
[transfer acceptance](../../../docs/TRANSFER-ACCEPTANCE.md).

Runtime image in the recorded passing run:
`sha256:659f34ecc906acb355d6008e96370917bf613e524fcd8e84c3af3c463377c58e`.
NameNode/DataNode started at `2026-09-06T20:28:24Z` / `2026-09-06T20:28:30Z`.
Long-running stability still requires more than one finite acceptance run.

## Pending evidence

See [verification](../../../docs/VERIFICATION.md). Schema and fixture checks do
not imply a live pass. Bearer/delegation authentication, SSH config/agent,
Kerberos/HA, cancellation races, faults, and three-platform packaged E2E need
separate gates. The original profile uses container data and the native-Java
alternative uses named volumes; never delete reused data as a cleanup shortcut.

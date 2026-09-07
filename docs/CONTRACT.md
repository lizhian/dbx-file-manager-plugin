# Contract and coordination

## Version boundary

Host baseline: `../dbx-file-manager-host` at
`c26ff3f6d4bd643be8dedd659c3236af4a5bd556` plus uncommitted coordinated extensions.
The host integration uses API 1.1.0 as of 2026-09-06. Manifest requires
`>=1.1.0, <2.0.0` (Rust semver comparator syntax), deliberately rejecting API 1.0.
The vendored authoring schema is baseline plus the exact ten-capability enum
extension. No released commit is claimed for those working-tree changes.
Manifest v1 and sidecar framing protocol v1 are unchanged.

## Providers and storage

Plugin ID `io.github.lizhian.file-manager`; publisher `lizhian`; version `0.1.0`.
Each protocol `ftp`, `sftp`, `s3`, `webdav`, `webhdfs`, `hdfs-native` has connection
ID `<plugin>.<protocol>`, filesystem ID `<connection>.files`, database_type equal
to protocol, schemes `[protocol]`, root_uri `protocol:/`.
Navigation roots are not remote endpoints: SFTP connects via `ssh://`, HDFS Native
via `hdfs://`; neither changes its host navigation scheme.

Public `host`, `port`, `username` use their matching common bindings when relevant.
`display_name` binds `name`. `config` binds a flat `external_config[field.key]`:

| Provider | Flat external_config keys | Secret Store keys |
| --- | --- | --- |
| FTP | root | password |
| SFTP | root, authentication | private_key |
| S3 | root, endpoint, region, bucket, path_style | access_key, secret_key, session_token |
| WebDAV | root, endpoint, authentication | password, bearer_token |
| WebHDFS | root, simple_user, endpoint, use_delegation_token | delegation_token |
| HDFS Native | root, name_node_uri, hadoop_config_directory | none |

No nested protocol configuration or discriminator object. Password and key fields
explicitly bind `secret`, never `config` or public `password`; no secret defaults.
SFTP `authentication` is a string enum `ssh_config/ssh_agent/private_key`.
WebDAV string enum is `basic/bearer`. Manifest has no conditional field syntax:
mode-dependent secrets/usernames remain optional in the form and the backend
must validate the active mode before attempting connection. Inactive values must
not select a second authentication mode. This behavior still needs live auth-matrix tests.

The backend contract defines `private_key` as the **absolute local OpenSSH
key-file path**, stored as a secret, not embedded key material. The harness passes
an explicit environment path without reading/copying it. Key-content upload would
require a separate secure lifecycle design. S3 endpoint and Hadoop config directory
are required to match the current backend decoder. HDFS config must be an accessible
absolute directory with Hadoop XML on the machine executing the sidecar.

S3 default compatibility: the host form explicitly defaults `path_style` to false
and that explicit value is honored. For direct lifecycle callers that omit it,
the backend preserves the source MVP default true. The source reference is
`file_connection_config.rs` at the recorded file-manager commit (`default_true`
for pathStyle/path_style). Direct callers should set the boolean explicitly to
avoid differing defaults; fixtures intentionally set true for MinIO.

The newer runtime implementation uses existing common top-level ConnectionConfig
`query_timeout_secs` and `idle_timeout_secs` (both default 60 seconds), not manifest
external_config fields. Query timeout 0 is unlimited; idle timeout 0 makes the
operator eagerly recyclable while keeping an in-memory logical connection
descriptor for transparent rebuilding. Same-config connect is idempotent; changed
config replaces/drains the old generation and invalidates its cursors. These
enhancements are absent from the preserved pre-runtime-gates package.

## Host-owned behavior

No workbench contribution, UI entrypoint, or packaged `ui/`. Host owns connection
forms, Secret Store, tunneling, local pickers, file manager, confirmations, readonly
and production protections. Sidecar owns OpenDAL, path validation, protocol fallback,
and transfer IO. FTP/SFTP must honor lifecycle `runtime.host/port`; unsupported
protocol transport combinations fail explicitly. Tunnel acceptance remains pending.
Permission is only `host.events`; framed JSON and local-file transfer IO do not
require the iframe `host.binary` capability. The sidecar is not an OS sandbox.

## Negotiated API 1.1 operations

Static ceilings: `list/stat/read/write/delete/rename/mkdir/copy/upload/download`.
Connection dynamic capability maps narrow this ceiling; readonly removes writes.
There is no invented `dynamic` capability. Baseline API 1.0 supported only
`read/write/delete/rename/mkdir`; list was implicit. New declarations require 1.1.

- Lifecycle `connection/test/connect/disconnect`: `{provider:{id,databaseType}, connection, runtime?}`.
- Filesystem requests: `{providerId,connectionId,...}` with filesystem provider ID.
- `filesystem/list`: `uri,cursor?,limit` -> `{entries,nextCursor?}`.
- `filesystem/stat`: `uri` -> plain Entry (`name,uri,kind,size?,...`), not a wrapper.
- `filesystem/read`: `uri,maxBytes` -> `{dataBase64,truncated,...}`; 4 MiB ceiling.
- `filesystem/write`: `uri,dataBase64,create,overwrite,etag?`; 4 MiB ceiling.
- `filesystem/createDirectory`: `uri`; `filesystem/delete`: `uri,recursive:false`.
- `filesystem/copy/rename`: `sourceUri,targetUri,overwrite:false` -> `{success,...}`.
- `filesystem/capabilities`: canonical `{capabilities:[known strings],...details}`.
  Flat booleans may also be present, but are not the canonical acceptance contract.
- `filesystem/transfer/startUpload/startDownload`: `uri,localPath,overwrite:false`
  -> full queued snapshot including `transferId`. Then query
  `filesystem/transfer/status` and validate matching scope. Tests require the full
  DTO directly from the sidecar; no host normalization can conceal a mismatch.
- `filesystem/transfer/status/cancel`: `transferId` -> snapshot.
- `filesystem/transfer/list` -> `{transfers:[]}`.
- Event `filesystem/transfer/progress`: snapshot containing `transferId,providerId,
  connectionId,direction,uri,state,bytesTransferred,totalBytes,error`.
  State is queued/running/completed/failed/cancelled; totalBytes and error nullable.
- RPC errors retain integer `code`, `message`, `data:{code,recovery?}`. Never print
  arbitrary remote error messages or connection payloads in test output.

Only trusted host-owned transfer routes may supply local paths. Generic plugin
invoke/notify must reject the transfer namespace; no iframe gets this authority.
Framed subprocess tests bypass host authorization and cannot prove this host gate.

## Deviations and remaining negotiation

### Optional host download lease

The current main-integration host and new `dist/download-lease-gates` Sidecar
negotiate the handshake capability `filesystem.download-temp-v1`. This is an
optional additive protocol-v1 extension, not a new Manifest filesystem capability.
The SDK pin, Manifest version and Host API minimum remain unchanged.

- Only the trusted native download entrypoint creates the lease. Caller-supplied
  `hostDownloadLeaseId` and `downloadTemporaryDirectory` are removed first.
- The host creates a random `.dbx-download-lease-*` sibling directory and retains
  its exact path and an open identity handle in that Sidecar session. Unix creation
  permissions are 0700; Windows behavior still requires native verification.
- `startDownload` receives both fields. The Sidecar validates a UUID lease ID and
  a non-symlink directory immediately under the destination's canonical parent.
  Uploads, incomplete pairs, relative paths and unrelated parents are rejected.
- Sidecar snapshots/events echo only `hostDownloadLeaseId`, never the directory.
  Host status/list DTO projection omits the internal ID. The normal progress event
  may include the opaque ID; it grants no path authority.
- The Sidecar stages inside the lease directory and retains its existing atomic
  publication/no-clobber behavior for the final destination. It closes its file
  before sending terminal progress. The host cleans only its own directory after
  matching connection/provider/lease terminal progress, a wire start rejection,
  or confirmed process exit. Host request timeout alone never authorizes deletion.
- The host checks directory identity and rejects a substituted directory/symlink;
  failed cleanup is logged and retained for a later session-exit retry. It does not
  report that cleanup failure as a task success guarantee. This is not a security
  boundary against malicious same-user processes racing directory replacement.
- A new host with an old Sidecar strips lease fields and uses the old behavior.
  A new Sidecar with an old host uses its original sibling tempfile behavior.
  Neither combination gains forced-stop cleanup without both ends supporting it.

Leases are in memory. Killing the host itself, OS crashes, unexpected parent
renames and durable recovery across host restarts remain outside this checkpoint.
See DOWNLOAD-LEASE-ACCEPTANCE.md for the actual tested scope and artifacts.

The original migration plan used illustrative `com.dbx.file-manager` IDs and
`transfer/startUpload` names. This repository uses the user-assigned `io.github`
IDs and negotiated `filesystem/transfer/*`. API 1.1 supersedes the initial request
to advertise only five baseline capabilities. No unversioned backward-compatibility
claim is made. Error recovery, fallback/atomicity details, cancellation races,
auth alternatives, overwrite confirmation and UI capability negotiation require
integration evidence before release. Additional operations beyond the ten-capability
ceiling must be negotiated and versioned before appearing in the manifest.

## Protocol implementation limits

- OpenDAL 0.57 WebDAV writes are one-shot. The plugin uses a bounded reqwest PUT
  stream for uploads with redirects disabled, one queued chunk and chunks at most
  64 KiB; OpenDAL still handles remote listing/copy/rename and other operations.
  Cancellation aborts and joins the request before staged cleanup.
- FTP upload staging uses visible UUID names because the source FTP backend cannot
  reliably stat dotfiles. WebHDFS uses append streaming instead of unsupported
  multi-block writes. Neither workaround buffers the whole transfer in plugin code.
- Remote no-clobber/atomicity guarantees remain conservative; a preflight check
  does not make all server mutations atomic. Consult dynamic fallback details.
- SFTP uses OpenSSH Accept trust-on-first-use and Unix-only key-file paths.
  Strict host-key provisioning needs a separate security gate.
- URI confinement is lexical. Remote chroot/ACL policy is still required against
  remote symlink escape and server-side aliases.
- Bounded host pagination does not prove bounded server-response memory: OpenDAL
  FTP/WebDAV listing implementations may materialize an entire server response.
  Large-directory memory and production load acceptance remain pending.

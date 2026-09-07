# Host-owned download lease checkpoint

Date: 2026-09-07. The previously reproduced forced-Sidecar-stop download tempfile
leak is addressed for cooperating new hosts/plugins on the tested macOS WebDAV
path. This is not full migration, native-picker or cross-platform acceptance.

## Implementation and ownership

See CONTRACT.md, optional host download lease. The host records the temporary
directory before sending the start RPC, scopes it to one Sidecar instance, and
keeps a filesystem identity handle through cleanup. Only an exact matching terminal
snapshot, actual wire rejection, or confirmed process death releases it. Timeout
and cancelled host waiters do not prove that a Sidecar stopped writing.

The session consumes cleanup notifications before forwarding terminal progress;
late start responses are handled even if their original RPC waiter timed out.
Shutdown and unexpected output closure reclaim leases only after kill/reap or
confirmed exit. Output-close handling marks the session stopping before cleanup,
preventing a new lease from entering between exit cleanup and the final status.

The host adds a direct `same-file = "1"` dependency for portable open-handle
identity comparison. Version 1.0.6 was already in Cargo.lock; the lock change only
adds it to dbx-core's dependency list. OpenDAL remains exclusively in the plugin.
The export allowlist explicitly includes `download_leases.rs`; runtime data and
credentials are not swept into the patch. No frontend or vendor edits were made.

## Packages

| Candidate | Bytes | SHA-256 |
| --- | --- | --- |
| `dist/download-lease-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp` | 7,314,564 | `224a1d2564bd0d4bbd77c74c0fe9c656440f531c5d8bc2c681206ad33f766d15` |
| `dist/download-lease-lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp` | 7,316,208 | `c94b374aba461964b962f0a4923dcdd3be7ee94db647424feafb6b4c4f80f7f1` |

Both are unsigned native-CLI builds. The second is a test-only version compiled
from `dist/download-lease-fixture-source`, an explicit source allowlist copy.
Every backend source file was hash-compared with the original; structured
Manifest/Cargo/lock comparisons confirmed only root package version changes.
The source repository stays version 0.1.0. Old candidates are retained unchanged.

The exact-member, checksum, license and normalized Manifest verifier passed both
packages. `verify-package.mjs` now accepts an optional source-directory argument
to compare a test version against its real source, not a relabeled main Manifest.
Cargo still prints the known unexpanded SDK-template diagnostic during discovery;
both actual locked release builds finish successfully.

## Verified results

- Plugin unit tests: 35 passed; the ignored live listing regression was enabled
  separately and passed. Clippy `--all-targets -- -D warnings` and fmt passed.
- New tests cover lease echo without local paths, no-clobber publication,
  cancellation/timeouts, incomplete lease pairs and unrelated parent rejection.
- Host plugin tests: 84 passed, two existing live tests ignored by default. Four
  lease tests cover scope, late wire error, process exit, replaced directory,
  symlink substitution and Unix mode. A real subprocess test covers capability
  negotiation, ignoring caller-supplied authority, timeout retention and shutdown.
- The subprocess fixture initially closed stdout by redirecting `cat`; it returned
  `session_closed`, not timeout. The fixture was corrected to keep stdout open;
  the assertion remains specific to timeout and the regression passed.
- Core/Web/Tauri joint check passed with `--no-default-features --features
  dbx/sqlite-bundled`. This does not establish the full default-feature workspace.
- Node suite: 53 passed. The actual extracted 0.1.0 release binary passed all six
  protocols' lifecycle, remote operations, 5 MiB/zero-byte transfers, readonly
  and cleanup using the isolated native-Java Hadoop fixture. This also exercises
  backward-compatible direct operation without host-provided lease fields.
- [New 0.1.0 to old 0.1.1 forced download upgrade](evidence/host-transfer-lifecycle-6578e884-08b0-46a9-8372-ae686062efa8.json)
  passed: lease ownership survives replacement even if the replacement does not
  implement the extension. It does not prove old-process forced cleanup.
- [New/new forced four-case matrix](evidence/host-transfer-lifecycle-763196b5-64fd-463f-bdb4-2b5397d69fea.json)
  passed upload/download upgrade/rollback with target/Secret preservation,
  old-process-before-publication ordering, no temporary remnants and checksum retry.
- [New/new graceful four-case control](evidence/host-transfer-lifecycle-b63453dc-a91c-4dbe-9119-25543f5810a3.json)
  passed all four combinations, retaining cancellation event assertions.
- An earlier four-case attempt is retained as failed evidence:
  [build-lock timeout](evidence/host-transfer-lifecycle-456d71fa-3881-4639-8943-d0f42325689e.json).
  Its last case waited 3m26s for another Cargo check and exceeded the 180s ready
  deadline before transfer execution; the eventual Rust timeout cleaned its
  profile/remote directory. The rerun passed without increasing deadlines.

Historical red evidence remains in FORCED-STOP-RECOVERY.md. The named matrices
record their host source fingerprints; subsequent source changes need another run.
The final output-close admission fix and its reruns are tracked below as appended
evidence, not assumed covered by an older source fingerprint.

Final host plugin regression after that fix: 84 passed, two live ignored.
[Final forced four-case matrix](evidence/host-transfer-lifecycle-010fa62a-9e5f-4f62-a8da-a6cbe5062e38.json)
passed all four cases. Recorded host production-source hashes were compared with
the current files and matched; every recorded profile and old/new PID was absent
after the run. The current export contains 223 files, 1,761,119 bytes, SHA-256
`243ab9efa03f7506b708ea3efabe4f4d677595178327fd1b9d77c409248b8ca5`, result tree
`fed142faf13b9580f3e9a24d269dc851e5daffe7`. Application, reverse and unchanged-index
checks passed. Incremental host scope is six files (+311/-7), including the new
lease module and its tests; it exceeds a small local-fix budget and is a coordinated
host/plugin contract change. No commits or pushes were made.

[Final graceful four-case control](evidence/host-transfer-lifecycle-fe2f649a-c116-4989-8222-668b6e4d3360.json)
also passed on the final source fingerprint. It preserves real cancellation
events and verifies original targets, Secrets, temporary cleanup and checksum
retry for upload/download during both upgrade and rollback.

## Remaining boundaries

- The host must remain alive to retain the in-memory lease. Durable host-crash
  recovery is not implemented; no prefix-based scavenger is introduced.
- Existing already-running old plugins cannot retroactively gain this contract.
  Linux/Windows packages from earlier checkpoints remain old code and require
  rebuilding and native host verification. Windows lock/ACL behavior is unverified.
- Filesystem identity is checked before cleanup, not a complete defense against
  malicious same-user namespace races. Unexpected parent moves/substitutions may
  deliberately retain a directory instead of risking unknown data deletion.
- Cleanup errors are logged and retained for retry, not yet surfaced as structured
  UI recovery state. Forced process death also does not emit a Sidecar cancellation
  event; host/UI terminal task presentation needs separate acceptance.
- Large/concurrent resource measurements, other real protocol interruptions,
  authentication/tunnels, native pickers and full workspace/release gates remain.

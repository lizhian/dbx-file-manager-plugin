# Lifecycle acceptance checkpoint

## Matching-source upgrade fixture

Prepared a new macOS ARM64 0.1.1 fixture from the current upload-slot-fix source,
so future native upgrades need not install the older pre-fix 0.1.1 fixture.
The original source remains 0.1.0. The isolated source copy is
`dist/upload-fairness-lifecycle-source`; `backend/src` is byte-identical, and
only the root plugin versions in Manifest, Cargo.toml and Cargo.lock differ.

Package: `dist/upload-fairness-lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp`.
Size 7,315,864 bytes; SHA-256
`a0afe15daab57f5114dddfee1d11286ccad97749def90223388b3889b592c8db`.
This was compiled through the native CLI, not repackaged by changing only the
Manifest. Verification against the 0.1.1 source copy passed exact members,
manifest parity, licenses and checksums. Verification against the original 0.1.0
source correctly rejected the version mismatch; the verifier was not weakened.
Initial packaging stopped on missing AJV in the filtered copy; locked `npm ci`
with scripts disabled supplied its dependencies, and the repeated build passed.

Using current `upload-fairness-gates` 0.1.0 plus this matching-source 0.1.1,
all eight active-transfer host cases passed: upload/download, upgrade/rollback,
graceful/forced stop, with target/Secret preservation, temporary cleanup, process
publication ordering and retry checks. Reports:

- [Forced matrix](evidence/host-transfer-lifecycle-c9a4a396-3f57-438e-8ada-3b7196cb0c72.json)
- [Graceful matrix](evidence/host-transfer-lifecycle-44392741-7c4d-4e0b-9abb-a9d4d8a01068.json)

This remains an unsigned test fixture, not a released plugin version. Native GUI
installation and upload were not performed; their confirmation remains pending.
Older fixture packages and their evidence below remain unchanged.

## Upload scheduling fix revalidation

The macOS ARM64 `upload-fairness-gates` 0.1.0 candidate was revalidated against
the fixed-main host using the existing download-lease 0.1.1 lifecycle fixture.
All eight combinations passed: upload/download, upgrade/rollback, graceful
cancellation/forced process termination. Actual old-PID-before-publication,
original target and Secret preservation, temporary cleanup and checksum-verified
retry were checked. All eight temporary profiles were independently confirmed
absent afterward; reports confirm remote cleanup and process shutdown.

- First package SHA-256:
  `1e6d2f076949c8288359d18efd3343293c9a7e921ed75da86a6e92e7a6409f26`.
- Second package SHA-256:
  `c94b374aba461964b962f0a4923dcdd3be7ee94db647424feafb6b4c4f80f7f1`.
- [Forced four-case report](evidence/host-transfer-lifecycle-5af0bfe0-401e-4200-a39a-fdd0867bc4d2.json)
- [Graceful four-case report](evidence/host-transfer-lifecycle-b9880706-5908-469a-81de-45ff6be415f5.json)

The existing 0.1.1 package predates upload-slot scheduling; it is a test fixture,
not a newly released version. Thus upgrade tests stop the new 0.1.0 implementation
and rollback tests reconnect to it. This verifies real host API lifecycle, not
native GUI package installation or GUI upload. Source and packages were unchanged
during this revalidation. Platform scope remains macOS ARM64 only.

Date: 2026-09-07. FTP Web lifecycle and shutdown-before-publication acceptance
passed. Active WebDAV upload/download upgrade and rollback through the trusted
host API also passed in the later checkpoint below. This is not full phase 7
acceptance: other protocols, forced-stop recovery, broader concurrent mutations,
native UI entrypoints and optional legacy-data migration remain separate.

The subsequent [forced-stop checkpoint](FORCED-STOP-RECOVERY.md) passes real
WebDAV upload upgrade/rollback, but reproduces download temporary-file retention
after both replacements. Graceful four-case controls still pass. Forced download
cleanup is now a known defect, not merely an unexecuted check; phase 7 remains open.
The later [download lease checkpoint](DOWNLOAD-LEASE-ACCEPTANCE.md) addresses this
path for a new cooperating host and plugin, with passing macOS WebDAV forced and
graceful matrices. Older packages, host-crash recovery and platform gates remain open.

## Active-transfer host checkpoint

The opt-in `real_file_manager_active_transfer_lifecycle` test in the host's
`crates/dbx-core/src/plugins/filesystem_integration.rs` uses the real `AppState`,
Storage, versioned installer, connection pools and trusted file-transfer API.
The Node controller is `scripts/host-transfer-lifecycle-contract.mjs`; it uses a
namespace-restricted loopback WebDAV proxy and four fresh host profiles.
No local-path API was exposed through HTTP or a generic plugin invocation.

Four combinations passed twice: active upload/upgrade, download/upgrade,
upload/rollback and download/rollback. Each uses a 32 MiB source, an existing
destination and a running transfer with verified nonzero partial progress.

1. The controller confirms the old PID belongs to this test's temporary profile,
   then pauses only that Sidecar with SIGSTOP.
2. The host begins replacement. A marker emitted after pool removal proves that
   the installer reached runtime quiescence, rather than merely starting package
   validation. The activation record must still name the old version while the
   old process is paused.
3. After SIGCONT, the host must receive the transfer's cancellation event, close
   the old pool, terminate/reap the old Sidecar and then publish the new version.
   The controller polls actual activation records and independently checks PID
   liveness; a new activation while the old PID is alive fails the test.
4. In-flight proxy data is drained before inspecting cleanup. The saved connection
   and Secret survive, the old destination remains unchanged, and no remote upload
   or local download temporary file remains. A new PID reconnects and completes
   a checksum-verified retry.
5. Each case deletes its exact remote directory, removes its saved connection,
   uninstalls the plugin and removes the temporary host profile. Cleanup is
   recorded on failure too; existing services and profiles are not modified.

Inputs are the `dist/append-gates` 0.1.0 package (SHA-256
`3257a59b2ff14359eeac06451ba6c2c119c0e1565c657d53b0001da8aad9f118`) and the existing
test-only 0.1.1 package below. That 0.1.1 fixture contains the earlier backend,
not a newly published version. Only test code and the controller changed here;
host production code and both packages stayed unchanged.

Evidence: [initial four-case pass](evidence/host-transfer-lifecycle-7c10a658-a909-476c-8d51-16f6ccf311e1.json)
and [repeat with source fingerprints](evidence/host-transfer-lifecycle-c8994869-82db-44b6-b601-96830f5e2969.json).
All four repeat cases record cancellation, publication ordering, Secret/target
preservation, successful retry, remote cleanup and profile removal. The final
fixture SHA-256 was compared with the report after the run and matched.

The first failed run is retained separately. Its test helper had published the
pool without registering runtime configuration, unlike the actual Web/Tauri
connection entrypoints. After matching that setup, the same production code
passed. The initial run's exact remote directory was independently confirmed
absent; the failure was not reclassified as a passing run.

Supporting regression: 77 host plugin tests passed, with two live tests ignored
by default. The original FTP saved-gateway test was enabled separately and passed;
the new test was enabled by this four-case controller. The independent plugin
repository's Node suite passed 50 tests. The existing macOS large unwind-table
linker warning remains visible; builds/tests exited zero.

Run from the plugin repository with Node 22 and Rust on PATH:

```bash
node scripts/host-transfer-lifecycle-contract.mjs \
  /absolute/path/to/dbx-file-manager-main \
  "$PWD/dist/append-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp" \
  "$PWD/dist/lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp"
```

The host must contain the current integration patch. `CARGO_TARGET_DIR` can point
to its existing build cache. This SIGSTOP fixture is Unix-only and was exercised
on macOS ARM64. It calls the trusted host API with generated local files; it does
not test a native picker, desktop menu, or installation gesture. The paused process
is resumed so it can clean up; forced termination of an unresponsive active
transfer is still a distinct, unverified failure path.

## Inputs

- Host base and patch: [MAIN-INTEGRATION.md](MAIN-INTEGRATION.md).
- Tested Web executable SHA-256:
  `71aabe5d997701a2195b7f1a5bd3bc6d19582ffa984d2cc15e24e9e5c83f3a64`.
  The authenticated version endpoint reported 0.6.5.
- Original 0.1.0 candidate:
  `dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`,
  SHA-256 `7b94a3332c0aaae426dcfed27f2072e67d38a5052bbea5d8925c70ee24abc94e`.
- Test-only 0.1.1 candidate:
  `dist/lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp`,
  SHA-256 `ba52185e178f9a881e6f8839b56f2aad4d376adb696a2bee5b7ab3fb5152c663`,
  size 7,303,816 bytes. This is not a published release or the new source version.

The test-only candidate was built by the native DBX plugin CLI from a temporary
source copy, not made by relabeling the old executable. Only the versions in
manifest.json, backend/Cargo.toml and the root Cargo.lock package entry were
changed to 0.1.1. All ten backend source files and all other dependency values
were verified unchanged. The actual sidecar handshake enforces agreement with
the installed manifest version. Release build and packaging exited 0.

The CLI uses its own build target directory; it did not replace the original
backend target executable. Cargo printed a diagnostic while discovering a
template Cargo.toml in the SDK Git checkout, then completed the actual locked
release build. No SDK checkout files were edited to hide that diagnostic.

Provenance: [candidate inputs](evidence/lifecycle-candidate-0.1.1.json).
The original source metadata, source version 0.1.0 and original candidate hash
were checked unchanged after creating the test candidate.

## Repeatable test

`scripts/host-lifecycle-contract.mjs` requires Node 22+, a built Web executable,
the two candidates, `sqlite3`, POSIX `ps`, and the existing disposable FTP fixture
at 127.0.0.1:2121. It creates its own temporary data directory, random access
password, unused port and UUID-scoped remote directory. It never accepts an
existing server URL or existing user profile as its mutation target.

```bash
node scripts/host-lifecycle-contract.mjs \
  /absolute/path/to/target/debug/dbx-web \
  "$PWD/dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp" \
  "$PWD/dist/lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp"
```

The two package arguments above are absolute when run from the plugin repository.
The script uses the real authenticated HTTP routes and real installed sidecars;
it does not replace the installer, storage, filesystem gateway or runtime with mocks.

## Verified behavior

1. Install 0.1.0, save a plugin connection, restore its named Secret, connect and
   write/read a UUID-scoped remote file. Direct SQLite inspection confirmed that
   persistent `connections.config_json` does not contain the fixture password.
2. Reject uninstall while the saved connection references the plugin. The same
   sidecar PID remains alive and the remote file remains readable.
3. Upgrade to 0.1.1. The returned package hash and previous version match; the old
   PID is gone when the request completes. Reconnecting starts a new process and
   reads the same remote bytes. The entire saved connection and Secret are unchanged.
4. Roll back to 0.1.0, terminate the replaced PID, reconnect and preserve both the
   saved connection/Secret and remote file.
5. Reject a truncated archive and reject an unsigned package under strict policy.
   The final test asserts the archive/signature-specific errors, not just any HTTP
   400 that could be caused by an already-installed version. The old version and
   PID remain usable after both failures.
6. Kill only the tested sidecar after verifying its parent PID is the isolated
   backend, then reconnect and read the remote file through a fresh sidecar.
7. Gracefully stop and restart the isolated Web backend with the same test data
   directory, log in again, reload the same saved connection/Secret and reconnect.
8. Delete only the test's file and empty UUID directory, verify absence with stat,
   remove its saved connection, uninstall the plugin and confirm the sidecar is gone.

Earlier evidence: [strict lifecycle rerun](evidence/host-lifecycle-8ebc85e7-a95c-492f-8b38-2ac6cb8de07e.json).
The earlier [first run](evidence/host-lifecycle-044213a8-b9eb-4eb3-9318-22ab2ed2f604.json)
also passed; the final rerun adds rejection-reason assertions. Both runs report
`remoteCleanupRequired: false`, and their temporary backend processes are stopped.
The original Web previews and pending native-acceptance instance are untouched.

## Shutdown-before-publication regression

The harness now pauses only its own sidecar with SIGSTOP after checking the parent
PID. While the real upgrade request runs, it reads the installed activation records
and then checks whether the old process is still alive. This gives the disconnect
timeout a stable observation window without modifying plugin code or production
timeouts. It does not infer ordering from a successful HTTP response alone.

The old Web executable failed this test:
[red ordering regression](evidence/host-lifecycle-115c4342-29c6-4485-9c91-e98a03ad5cf6.json).
Remote cleanup still succeeded on that failed run.

The installer now calls a host hook only after package validation and before
legacy relocation, version storage and activation publication. Its returned guard
stays alive through publication. Invalid archives, signatures, duplicate versions
and missing rollback targets do not call the hook. A failed hook leaves the old
activation intact and does not store the candidate version.

AppState supplies the common hook for Web, Tauri and marketplace installs. It
holds the host activation mutex, closes plugin connection pools and previous
external-driver pools, stops the old sidecar, verifies its process handle is gone,
and drains any late old handles before returning the guard. Cached activation
also takes that mutex. Connection/action metadata resolution is bound to a session
under the mutex, but the RPC itself does not hold it across asynchronous work.
Installer writer locks are always acquired before this host mutex.

Rollback validates its target before stopping the current runtime. Uninstall uses
the same writer/activation ordering and performs its saved-reference check inside
the hook. The standalone installer APIs remain usable without a runtime owner.

Final evidence: [green ordering and lifecycle run](evidence/host-lifecycle-b8b0b3a9-20b4-4a94-9fe4-d6ccf1d12652.json).
It reports `oldProcessStoppedBeforePublication: true`, preserves a healthy PID
when no rollback target exists, and passes all earlier lifecycle checks. The
intentional paused-process test triggers the existing three-second pool-close
timeout; the sidecar is then killed and reaped before publication. The temporary
backend exited and `remoteCleanupRequired` is false.

Supporting checks: 12 installer tests, 77 plugin tests (one live test separately
enabled), the actual cached-activation barrier plus 5 MiB file-manager integration,
357 connection-related tests with four ignored, Core/Web/Tauri compilation and all
five frontend gates passed. The updated Web executable was also built and exercised.

The incremental host change spans eight files (+414/-175) across the installer,
host coordination and entrypoint adapters. Full worktree scope includes the earlier
framework import: 221 files and 32,169 changed lines. The default small staged-refactor
budget therefore warns; no full-worktree budget pass is claimed. Vendor code and
wire schemas were not changed by this lifecycle fix.

## Packaging correction

The old validator hardcoded version 0.1.0, preventing future releases from passing
validation. A new-version regression failed first. Validation now uses the pinned
manifest schema and requires the Manifest, Cargo.toml and root Cargo.lock package
versions to agree. Tests cover a coherent 0.1.1 version and each mismatch. All 39
metadata/framing tests passed; this change does not change the source version.

## Remaining gates

- [Signed package and custom-marketplace acceptance](SIGNED-ACCEPTANCE.md) now
  covers valid trusted signatures, tampering, key admission and catalog bindings
  with the real sidecar. This does not establish official Store release approval.
- Active-transfer replacement on the other five protocols, forced-stop cleanup,
  concurrent activate/install/uninstall, saved-connection edits and broader teardown
  failures need more coverage. WebDAV's resumed-process case does not cover every
  concurrency interleaving or an unresponsive transfer's recovery.
- Old `db_type: file` configuration/Secret migration, native UI entrypoint acceptance
  and Linux/Windows host lifecycle remain unverified. Linux ARM64 sidecar/package
  checks are documented separately in PLATFORM-ACCEPTANCE.md.
- 0.1.1 deliberately retains the same filesystem implementation. This test does
  not establish cross-schema or behavioral-version data migration compatibility.

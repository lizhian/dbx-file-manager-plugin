# Forced-stop transfer recovery

Date: 2026-09-07 (Asia/Shanghai). Historical checkpoint: **download cleanup failure reproduced**.
The subsequent [host-owned lease implementation](DOWNLOAD-LEASE-ACCEPTANCE.md)
passes the new macOS WebDAV forced-stop matrix; these old candidate failures remain
valid evidence. Phase 5/7 acceptance remains incomplete. This is real host/Sidecar
execution, not a mock of process shutdown or a full native UI acceptance.

## Test boundary

The existing active-transfer controller now accepts `--force-stop`,
`--direction=all|upload|download` and `--action=all|upgrade|rollback`. Defaults
preserve all four graceful cases. Invalid selectors and missing/relative inputs
are rejected before host startup. The CLI usage-message regression introduced
during this change was caught by the existing test and corrected; the final
Node suite passes 53 tests.

Both modes pause only a PID whose command belongs to the generated temporary
host profile. They observe partial transfer progress, pool drain and the unchanged
old activation. Graceful mode sends SIGCONT so cancellation can execute; forced
mode never resumes the process on the success path. The actual host times out
closing the pool, kills/reaps the process, and then publishes the new activation.
The controller independently rejects publication while the old PID remains alive.

A forcibly terminated process cannot emit a graceful cancellation event. Forced
reports explicitly record `cancelled: null`; no cancellation notification or UI
terminal-state acceptance is inferred from process termination. Both modes retain
the same destination/Secret, temporary-file and checksum-retry assertions.

After network buffers drain, the fixture reconnects through a new PID and records
`post-stop.json` before asserting that local and remote temporary-file lists are
empty. Failures retain this inspection and the host error in the report. Cleanup
can remove only the fixture's known files, including the upload temporary URI
derived from its returned UUID transfer ID. It never scans unrelated directories
or deletes files from a user-selected download directory.

## Results

| Stop mode | Operation | Upgrade | Rollback |
| --- | --- | --- | --- |
| Graceful | Upload | Passed | Passed |
| Graceful | Download | Passed | Passed |
| Forced | Upload | Passed | Passed |
| Forced | Download | Failed: local temporary remains | Failed: local temporary remains |

Evidence:

- [Forced uploads](evidence/host-transfer-lifecycle-b5263072-204e-4102-9a3e-4ad901d5ff29.json):
  both replacements preserve the original remote destination and Secret, use a
  new PID, leave no temporary file in the observed namespace, and pass the retry.
  This WebDAV server's interrupted PUT outcome is not evidence that all protocols
  clean remote uploads after a process kill.
- [Initial forced download failure](evidence/host-transfer-lifecycle-02767256-efbc-40d0-aa1f-2e1601bf139f.json):
  upgrade fails with `Download temporary file leaked`.
- [Repeated forced download upgrade](evidence/host-transfer-lifecycle-1926ed26-4021-4019-af88-39a8f950bbdd.json)
  and [forced download rollback](evidence/host-transfer-lifecycle-02e9bafa-1934-49ec-954c-42e4336d82c2.json):
  each was running at 79,689 of 33,554,432 bytes when stopped. Both preserve the
  original local destination and saved Secret, reap the old PID before publication
  and reconnect with a new PID, but retain one `.dbx-download-*` file. Each command
  exits one and its Rust test exits 101. Retry is not claimed because the cleanup
  assertion stops the exercise first.
- [Graceful four-case control](evidence/host-transfer-lifecycle-9bf692ed-897a-4d46-9048-aea63076447e.json):
  all four pass without weakening cancellation, cleanup or checksum assertions.
- [Final same-source graceful control](evidence/host-transfer-lifecycle-239ca1e4-afd9-4837-b7cd-13ec03e44d59.json):
  all four pass again with the exact fixture/controller hashes of the repeated
  forced-download failures below. This isolates stop mode from source changes.

All reports record source and package hashes. The repeated forced-download runs
use host fixture SHA-256
`5f63f59b79d6e715b4126e3870ee15ce377dd9bb5f3d6a173640e12a0a7a0130`
and controller SHA-256
`7ab1c635e7af20f06dcadf3eb24ed3669fc29fcb2caab4b484eee845d6c04423`.
Inputs remain the existing `dist/append-gates` 0.1.0 and test-only
`dist/lifecycle-gates` 0.1.1 packages. No backend, production-host, schema, SDK,
manifest or package changed in this checkpoint.

The fixture cleaned its exact remote directory and removed each temporary host
profile, including the retained local download file, after collecting failure
evidence. Recorded profiles and old/new PIDs were independently checked absent.
This fixture cleanup is **not** the missing product recovery behavior. Existing
services, user profiles and credentials were not restarted, removed or changed.

## Reproduction

Run in this repository with Node 22 and Rust on PATH and the existing disposable
WebDAV fixture listening on loopback port 8080:

```bash
export PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="$(pwd)/../dbx/target"
node scripts/host-transfer-lifecycle-contract.mjs \
  --force-stop --direction=download --action=upgrade \
  "$(cd ../dbx-file-manager-main && pwd)" \
  "$PWD/dist/append-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp" \
  "$PWD/dist/lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp"
```

Use `--action=rollback` for the second failing case. Omit `--force-stop` for the
graceful control. Each run creates a fresh UUID namespace and isolated profile.
The current forced-download commands are expected to fail until recovery is fixed.

## Cause and required follow-up

`backend/src/transfer.rs::download_file` creates a named sibling tempfile inside
the Sidecar. Its cleanup is `temporary.close()` or the tempfile's destructor;
publication uses `persist`/`persist_noclobber`. These cannot execute after SIGKILL.
The host's `PluginSession::shutdown` kills/reaps the child and fails pending RPCs,
but has no record of that randomly named download temporary file. Reconnecting a
new Sidecar restores the connection, not the lost tempfile owner.

A fix needs an explicit ownership/recovery boundary, not a longer cancellation
timeout or a blanket `.dbx-download-*` deletion pass. Before implementing it:

1. Establish a host-owned temporary-file lease or durable recovery record before
   writing bytes; record exact file identity and the authorization scope.
2. Allow recovery only after confirming the owning process cannot still write.
   Refuse substituted files/symlinks and never infer ownership from a name prefix.
3. Preserve the original destination; distinguish incomplete cleanup from a
   publication whose outcome is uncertain. Do not label a killed task completed.
4. Define compatibility for plugins without the recovery contract and across
   upgrade/rollback; these historical candidate binaries cannot gain it merely
   because the host or test changes.
5. Re-run the same forced-download regressions, graceful controls, permissions
   and replacement-race tests on the actual newly packaged binaries. Verify other
   protocols/platforms separately; no full phase completion is inferred here.

Host plugin regression: 79 passed, two live tests ignored by default (the controller
explicitly exercises the lifecycle live test). The existing large unwind-table
linker warning remains. Rustfmt of the changed fixture and Node syntax/tests pass.

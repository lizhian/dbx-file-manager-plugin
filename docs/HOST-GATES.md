# Host verification checkpoint

Date: 2026-09-07 (Asia/Shanghai). Host: `../dbx-file-manager-main`, fixed main
base `14e1d4f25b7f352a0ed50edf019e698e80bcf5d9`. This checkpoint does not
complete the migration or the full Rust workspace gates.

## Scope and provenance

- Rust: `rustc 1.98.1 (48a229cea 2026-09-01)`; Node 22.13.0 first on PATH.
- Previous exported tree: `83b969b5843e7de5af490388b6aef4a77a88ca2c`.
- Exported tree at this checkpoint: `764d1659c478a2b03291e4f9d5605eccc746e48e`.
- Tree comparison: four host files, 45 insertions and 13 deletions.
- Changes: MCP test expectations, explicit non-truncating plugin lock opens,
  two lock regressions, and a single-element loop removed from a host test.
- The MCP production source before `#[cfg(test)]` was compared byte-for-byte
  with pinned main and is unchanged. No launcher-resolution behavior changed.
- No plugin backend, manifest, candidate package, frontend or vendor edits.
- Cargo.lock SHA-256 remained
  `0da7c24700978f124bbdc832d7d048f066d7bc6262ec58bce5854c3a57bccd11`.
- Exported host patch SHA-256:
  `8ced85715014a9ac0d7624b040ae6952429e3dfec0195e8c48e0acc7ae984379`;
  1,744,558 bytes, 222 files. Temporary-index application and worktree reverse
  checks passed; the real index and historical c26 patch were unchanged.

## MCP failure diagnosis

The later [forced-stop checkpoint](FORCED-STOP-RECOVERY.md) changes only the
opt-in lifecycle test and exports a newer patch. The hashes above remain this
checkpoint's provenance; MAIN-INTEGRATION.md identifies the latest export.

Six historical failures came from comparing canonical runtime paths with lexical
fixture paths. On macOS, `/var` aliases `/private/var`. The runtime intentionally
canonicalizes the npm/pnpm commands and pnpm directories, while retaining the
selected Node launcher's directory for PATH construction.

The unchanged test executable reproduced the POSIX pnpm-shim assertion failure
with the default `/var/folders/...` TMPDIR. Running all 32 MCP tests with that
same executable and only TMPDIR changed to its canonical `/private/var/...`
location passed. The earlier serial Node-22-only attempt had still failed six.
This isolates the path alias rather than establishing a Node/pnpm version bug.

Test fixes preserve lexical fixture inputs and canonicalize only the expected
canonical outputs. An intermediate attempt incorrectly canonicalized the Node
launcher-directory expectation too: 31 passed and one failed. Inspection of
`run_package_manager_command` showed the launcher directory is deliberately
retained; its original assertion was restored. No assertion was removed and no
environment override is required for the final passing run.

Recorded checks using the default aliased TMPDIR:

- MCP module, serial: 32 passed, zero failures.
- Tauri library, default test concurrency: 289 passed, zero failures/ignored;
  rerun after the plugin lock changes also passed all 289 tests.
- The full default-feature Rust workspace is not covered by these results.

## Plugin lock checks

`installer::open_install_lock` and `PluginRepositoryStore::open_lock` now state
`.truncate(false)` explicitly. This preserves the existing OpenOptions behavior
and avoids turning a lock open into a content write before lock acquisition.

Two new tests create and exclusively lock an actual temporary file, write a
sentinel, reopen it, and assert both unchanged contents and refusal of a second
exclusive lock. After dropping the first handle, the second can acquire the
lock. This checks the real filesystem lock, not a mocked coordinator.

The plugin regression suite passed 79 tests. Two existing live tests remained
ignored by default; they were not rerun as part of this checkpoint. The linker
reported an oversized `__eh_frame` compact-unwind warning, but tests exited zero.

## Reproduction commands

Run in the integrated host, using the existing shared target directory:

```bash
export PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="$(pwd)/../dbx/target"
cargo test --locked --offline -p dbx --lib --no-default-features --features sqlite-bundled commands::mcp::tests -- --test-threads=1
cargo test --locked --offline -p dbx --lib --no-default-features --features sqlite-bundled -- --quiet
cargo test --locked --offline -p dbx-core --no-default-features --features sqlite-bundled plugins:: -- --quiet
rustfmt --check --edition 2021 src-tauri/src/commands/mcp.rs crates/dbx-core/src/plugins/installer.rs crates/dbx-core/src/plugins/marketplace.rs crates/dbx-core/src/plugins/host.rs
git diff --check
```

Targeted rustfmt and the worktree whitespace check passed. These commands use
`sqlite-bundled`, not the workspace's complete default-feature combination.

## Outstanding workspace gates

`cargo clippy --workspace --locked --all-targets -- -D warnings` was actually
attempted with default features. An initial offline attempt could not download
the locked `aws-credential-types 1.3.0`; retrying with network access downloaded
the missing locked dependencies without changing Cargo.lock.

The first compiler run reported 11 Core library and 14 Core library-test errors.
After the three plugin fixes, a rerun with `--message-format=json` reported nine
library and 11 library-test errors (the latter includes the nine shared errors).
It still exits 101. Unique remaining primary locations:

| File under `crates/dbx-core/src/` | Line(s) | Clippy diagnostic |
| --- | --- | --- |
| `connection.rs` | 5748 | `result_large_err` |
| `database_export.rs` | 1020 | `chunks_exact_to_as_chunks` |
| `db/postgres.rs` | 205, 475, 984 | `chunks_exact_to_as_chunks` |
| `db/redis_driver.rs` | 3883 | `chunks_exact_to_as_chunks` |
| `db/wkb.rs` | 328 | `chunks_exact_to_as_chunks` |
| `schema.rs` | 8881 | `chunks_exact_to_as_chunks` |
| `state_persistence.rs` | 260 | `manual_slice_fill` |
| `table_import.rs` | 9363 | `useless_format` |
| `table_structure_sql/indexes.rs` | 10 | `needless_late_init` |

No plugin diagnostic remained in the rerun's reported errors. Compilation stops
at Core, so this is not proof that every later workspace target is warning-free.
The remaining modules were not edited or lint-suppressed during this checkpoint.

`cargo fmt --all -- --check` also exits one: its complete output identifies 35
files with formatting differences and 15 missing example files, all under
`vendor/wry`. `git diff HEAD -- vendor` is empty. No vendor reformat or manifest
cleanup was performed, and the full format gate is not replaced by targeted fmt.

The default-feature `cargo test --workspace --locked` gate, platform host/GUI
acceptance, and the remaining migration-plan requirements are still incomplete.
The native desktop interface was queried again and explicitly reported a locked
Mac; manual unlock is required before native picker/transfer acceptance. No
alternate GUI control was used to bypass that boundary.

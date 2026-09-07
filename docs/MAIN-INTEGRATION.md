# Main integration checkpoint

Date: 2026-09-07 (Asia/Shanghai). This records the migration plan's baseline
integration work; it does not replace the remaining desktop/platform/release gates.

## Fixed inputs

Clean native follow-up: the exported tree below was rebuilt without diagnostics;
actual native FTP download passed with the retained historical 0.1.0 plugin.
See NATIVE-ACCEPTANCE.md for binary hash, UI evidence, independent checksum and
remaining new-package/upload/platform limits. No source or patch changes were
needed for this follow-up.

- Selected upstream main: `14e1d4f25b7f352a0ed50edf019e698e80bcf5d9` (DBX 0.6.5).
- Plugin framework: `c26ff3f6d4bd643be8dedd659c3236af4a5bd556`.
- File-manager host patch: `host-api-1.1.patch`, SHA-256
  `c4dd2736fbe68b3987808b4a85a2dbaa9ecd03eec650660dee849e54b4f60137`.
- Plugin candidate: `dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`,
  SHA-256 `7b94a3332c0aaae426dcfed27f2072e67d38a5052bbea5d8925c70ee24abc94e`.
- Integration worktree: sibling `../dbx-file-manager-main`, branch
  `codex/file-manager-main-integration`, tracking `upstream/main`.

The original checkout, the previously verified `../dbx-file-manager-host` worktree,
and its preview service remain separate and unchanged. The upstream main reference
advanced to `2eaf7f9914bd4c91eabf452edc6d102f0d20c818` during this integration;
the selected input above is pinned, not silently changed during verification.

## Change boundary

The gate decision is a staged integration, not a rewrite. `git merge --no-commit
--no-ff` brought in the seven framework commits; ten conflict files required
resolution. The file-manager host patch was then applied with `git apply --3way
--index`. Its toolbar test conflict was resolved while retaining both the main
profiling icon and the plugin result-view icon assertions.

Preserved main behavior:

- ConnectionPoolRegistry publication/identity handling, Redis health checks and
  the main batch-transaction capability model. Plugin pools participate in runtime
  availability checks and remain unsupported for SQL batch transactions.
- Grouped editor workspace, detached-window handling, profiling and JOIN editing.
- Main's full native connection form, including SQLite worker placement, Dremio
  mode selection and note settings. Plugin fields use a separate conditional branch;
  the large indentation-related duplicate form was not retained.

Plugin adaptations:

- Workbench/filesystem tabs now use `registerOpenTab`, so they join the focused
  editor group atomically and reactivation finds the existing owner.
- Plugin Center uses the main special-page portal and the focused group's tab strip.
  Keyboard, middle-click, close-button and close-other routing use that structure.
- The main SQL profile controls coexist with plugin result-view contributions.
- Host API 1.1 and all previous file-manager safety/transfer changes are retained.

The large overall diff includes imported framework source. Manual integration is
scoped to conflicts, the new group-navigation call sites and their regression tests.
No OpenDAL dependency or protocol-specific UI branch is added to the host. No
original file-manager branch merge, user-data migration, force reset or push occurs.
The integration merge remains uncommitted; resolved files are staged, with later
verification fixes possibly unstaged. No merge commit is claimed.

## Recorded checks

- Frozen dependency install succeeded with lifecycle scripts disabled. Platform
  wrapper warnings refer to unbuilt non-host CLI binaries, not dependency resolution.
- Mongo shell workspace package built successfully.
- TypeScript and focused core compilation passed.
- Group navigation/store regression checks: 50 passed, including plugin tab
  ownership/reuse and plugin-center keyboard/close behavior.
- Core plugin tests: 73 passed, one live test initially ignored. The ignored real
  file-manager test was then explicitly enabled against the extracted release
  payload and passed 1/1, including 5 MiB transfers and saved-policy validation.
- Full frontend check passed all five gates after updating four stale surface
  assertions and warming the real docs-export fixture (test phase 80.01s).
- Hello Workbench example built and packaged with its actual release packaging script.
- Hello package lifecycle smoke passed: install, assets, action, test, connect,
  invoke, filesystem, events, disconnect and uninstall.
- Tauri no-default-features/sqlite-bundled compilation passed after adding the
  main baseline's Turkish locale to the imported close-tab menu match. The native
  menu locale regression also passed (1/1).
- The filesystem wrapper now receives its owning tab ID from ContentArea instead
  of capturing global focus. Its inactive-pane regression failed before the fix
  and passed afterwards (4/4 wrapper tests).
- Real browser acceptance caught an invalid plugin-center translation key; the
  tab now uses the existing toolbar translation. A label/aria-label regression
  failed first and the subsequent full frontend check passed.
- Reactive plugin metadata is detached during open-tab serialization. A new
  structuredClone test reproduced the IndexedDB DataCloneError; the serialization
  and wrapper tests now pass (18/18). Full frontend checks passed again, including
  the new test (test phase 78.16s). Browser restart acceptance remains separate.
- Re-publishing a handle to the same sidecar/provider/connection must not close
  its shared remote binding. The real AppState test now publishes twice, checks
  capabilities, explicitly disconnects the current handle, reconnects, then runs
  the existing 5 MiB transfer and saved-policy checks. It reproduced
  `not_connected` before the fix and passed 1/1 afterwards.
- After the pool fix, core plugin tests passed 73 with one opt-in test ignored
  (that test was separately enabled above). The connection-related test filter
  passed 357 with four ignored; it includes agent and connection-model tests.
- A second real regression reproduced the Web/Tauri detached-drain race: the old
  background disconnect could arrive after reconnect. Plugin pools now finish
  their bounded close before that API returns; other driver pools still close in
  the background. Four detached-drain/reconnect cycles followed by the existing
  operation/transfer contract pass. The 357 connection-related and 73 plugin
  tests passed again after this change, with their same ignored counts.

## Final browser checkpoint

The Web executable was rebuilt after both connection-pool fixes (5m 14s, exit 0;
the existing macOS compact-unwind linker warning is nonfatal). Only the isolated
4237 backend was gracefully restarted, keeping its data directory and the actual
installed release candidate. The prior 4236 preview and all fixture containers
were untouched.

After login, three consecutive page loads at `http://127.0.0.1:5178/` each restored
`ftp:/ftp/dbx/main-ui-acceptance-20260907/`, enabled the file-manager controls and
showed no alerts. These include genuine full-page reloads, not simulated store
restoration. The first serialization failure and both connection lifetime failures
were observed in this same workflow before their fixes; the final pass uses the
rebuilt backend, not the earlier executable. Screenshot:
[restored file tab](evidence/main-refresh-restored.png).

The test then navigated to the parent and deleted only its own empty test directory
through the normal confirmation dialog. The parent listing is empty, its URI is
`ftp:/ftp/dbx/`, and there are no alerts or remaining dialogs. The saved disposable
FTP connection and installed candidate remain in the isolated preview for use;
neither original user connections nor runtime files were migrated or removed.

This proves the tested FTP Web install/form/browse/create/delete/navigation/reload
path. It does not prove the native file picker, all six protocols' host forms,
multi-pane browser layouts, disconnect-timeout recovery or platform release gates.

## Reproducible main patch

`host-main-14e1d4f-api-1.1.patch` contains the framework import and the main-host
adaptations, including the fixes above. It is not a commit or a released host.

- Base: `14e1d4f25b7f352a0ed50edf019e698e80bcf5d9`.
- SHA-256: `41da72268c9d3957235af3b92a8ecbf97027d841d2800682256cef45ae733e7d`.
- Size: 1,778,181 bytes; 224 changed files, mostly imported framework code.
- Result tree: `3c9afa4fe701fa42ecfc3849d0960f5f8e6cc6e2`.
- Includes plugin configuration-default preservation and its real store regression;
  see [native defaults fix](NATIVE-DEFAULTS-FIX.md). Export apply/reverse checks
  passed; the real index and historical c26 patch were unchanged.
- Companion `.patch.json` records verification metadata. A temporary index loaded
  from the base accepted the patch and produced that tree; a reverse check against
  the source worktree also passed. The real index and old c26 patch were unchanged.
- `scripts/export-main-host-patch.mjs` reproduces the export and checks. It includes
  only an explicit allowlist of additional untracked source files (the native
  fixture example, lifecycle coordinator and download lease owner), never runtime data or credentials.

The previous export added the opt-in active-transfer lifecycle test; four real
WebDAV upload/download upgrade/rollback combinations passed twice. Details are
in [lifecycle acceptance](LIFECYCLE-ACCEPTANCE.md). The latest export additionally
fixes MCP path expectations, makes plugin lock opens explicitly non-truncating,
and adds lock regression coverage. Scope and checks are in
[host verification](HOST-GATES.md); plugin package payloads are unchanged.
The subsequent test-only export adds forced-stop observation and isolated failure
cleanup. Real forced WebDAV uploads pass, but downloads retain a local temporary
file after upgrade/rollback. This is an open defect, not a passing lifecycle gate;
see [forced-stop recovery](FORCED-STOP-RECOVERY.md).
The latest export implements optional host-owned download leases and real
subprocess regressions. New macOS packages pass the forced-transfer matrix;
historical binaries retain the old behavior. See
[download lease acceptance](DOWNLOAD-LEASE-ACCEPTANCE.md) for artifacts and limits.
The subsequent [transfer-state checkpoint](TRANSFER-STATE-ACCEPTANCE.md) stops
polling lost task IDs as running and prevents one status error from blocking
other tasks. The live fixture verifies replacement-process `not_found` responses.
The latest [connection ownership checkpoint](CONNECTION-OWNERSHIP.md) prevents
superseded attempt cleanup from disconnecting a newer Sidecar binding, including
before the new pool is published. The actual native app still needs this rebuild;
its observed connection error is not declared resolved by the host regression alone.

Apply only in a clean checkout of the base above, without the c26 patch already
applied. For the documented sibling repository layout:

```bash
git apply --check ../dbx-file-manager-plugin/docs/host-main-14e1d4f-api-1.1.patch
git apply ../dbx-file-manager-plugin/docs/host-main-14e1d4f-api-1.1.patch
```

The old `host-api-1.1.patch` is retained unchanged for provenance; it is not an
alternative containing these fixes. Do not stack the two patches or infer that
either applies to a moving upstream/main reference.

## Known gate failures

- The historical six MCP failures are resolved by test-only canonical-path
  expectations: the default macOS TMPDIR uses the `/var` alias while commands
  resolve to `/private/var`. The same executable passed with only a canonical
  TMPDIR override before the fix; after it, 32 MCP and 289 Tauri library tests
  passed without that override. Production MCP code remains identical to main.
- Default-feature workspace Clippy was attempted, and three plugin diagnostics
  were fixed. It still fails at Core with nine library and 11 library-test errors
  outside those plugin fixes. Exact locations and scope are in HOST-GATES.md;
  no full-workspace Clippy or default-feature test pass is claimed.
- `cargo fmt --all -- --check` found two integration formatting differences and
  extensive differences in the existing vendor/wry source. The two integration
  files were formatted; a targeted rustfmt check of all five touched Rust files
  passed. Vendor source was not reformatted. The all-workspace format gate remains
  unresolved rather than being replaced by the targeted check. The latest rerun
  found 35 formatting-difference files and 15 missing examples, all in unchanged
  vendor/wry. All four files changed in the host-gate checkpoint pass targeted fmt.
- The configured official marketplace catalog failed parsing because an artifact
  omitted required `signingKeyId`. Manual installation of the locally built
  unsigned candidate succeeded after explicit opt-in in the isolated instance.
  No signature requirement or repository validation was weakened.

The Node executable directory must lead PATH for the parent and child processes:

```bash
PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$PATH" node scripts/run-check.mjs
```

Core checks used `CARGO_TARGET_DIR` pointing to the existing shared development
target and `--no-default-features --features sqlite-bundled`. The first docs-export
test run exceeded its cold-build hook budget; explicitly building/running the
fixture warmed its separate default target, and the full rerun passed without
raising the timeout or removing the test.

## Pending at this checkpoint

- [Lifecycle acceptance](LIFECYCLE-ACCEPTANCE.md) now covers actual two-version
  FTP Web upgrade/rollback, crash/restart, Secret preservation, failed-install
  protection, reference-aware uninstall, old-process shutdown before publication
  and nondisruptive missing rollback. Native runtime and broader concurrent-transfer
  lifecycle gates remain incomplete. The Core/Web/Tauri check, 77 plugin tests,
  explicit live integration and all frontend gates passed after this fix.
- [Native acceptance preparation](NATIVE-ACCEPTANCE.md) built and started the
  isolated desktop executable and validated its fixture. Actual native interaction
  is waiting for manual Mac unlock; no picker or native transfer pass is claimed.
- Full default-feature Rust workspace, real desktop dialogs, upgrade/rollback,
  remaining security, data compatibility and cross-platform release acceptance.
- Broader host connection-mode, multi-pane and disconnect-timeout/failure-path
  acceptance beyond the successful normal FTP reconnect workflow above.

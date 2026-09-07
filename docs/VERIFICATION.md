# Verification record

Upload-scheduling candidate follow-up: macOS ARM64 real host API active transfer
upgrade/rollback passed all eight graceful/forced upload/download combinations.
Profiles and processes were cleaned. The same extracted release Sidecar passed
full-six 16/256 MiB resource/checksum checks. No source, package or services were
changed for these reruns. See LIFECYCLE-ACCEPTANCE.md and TRANSFER-ACCEPTANCE.md;
native GUI installation/upload gates are still separate.

Current platform gate: macOS ARM64 only per the user's 2026-09-07 scope update;
Linux/Windows evidence below is historical, not a pending requirement.

Latest Mac production fix: uploads waiting for the per-connection mutation lock
no longer reserve global transfer slots. Red/green regression, 36 backend tests
plus separately enabled live, fmt/Clippy and 53 Node tests passed. The new
`upload-fairness-gates` candidate passed package verification, six-protocol basic
contract and two WebDAV concurrent upload/download and interruption runs. See
TRANSFER-ACCEPTANCE.md for artifact identity, failed control and limitations.

Dates: 2026-09-06 to 2026-09-07 (Asia/Shanghai). Scope: plugin metadata, fixture
portability, framed test harness and local unsigned package preparation.
Migration as a whole remains incomplete; see MIGRATION.md.

## Recorded local checks

Concurrent completion checkpoint: expanded the real interruption harness to
complete and checksum 15 simultaneous WebDAV downloads and sample Sidecar RSS.
Two macOS runs passed, including all existing interruption/cleanup checks; 53
Node tests passed. No production code or package changed. See
TRANSFER-ACCEPTANCE.md for measurements and the warmed-process/sampling limits.

Current Windows lease-code refresh passed six cross-compilation/link/PE stages
and explicit low-level packaging. Source hashes match the current Linux refresh;
exact package verification passed. No Windows test or executable was run, and
`runtimeVerified` remains false. See PLATFORM-ACCEPTANCE.md for provenance.

Latest Linux refresh: current download-lease code passed the full 17-stage ARM64
pipeline, including 53 Node tests, 35 backend tests plus separately enabled live,
fmt/clippy, actual CLI packaging and extracted-package six-protocol/resource/
WebDAV interruption checks. Current source hashes and the copied package were
independently rechecked. See PLATFORM-ACCEPTANCE.md for exact artifact identity
and remaining Linux host/GUI and Windows runtime gates.

- `node scripts/validate-manifest.mjs`: passed against vendored schema and semantic contract.
- `node --test tests/*.test.mjs`: 28 tests passed at initial harness checkpoint.
  Includes a real Node subprocess for framing only, not the OpenDAL binary.
- Latest metadata/harness regression suite: 37 tests passed, including canonical
  API shape rejection, portable SDK/lock pin and premature process-exit handling.
- Final Node 22.13.0 verification passed 37/37 with an explicit PATH:
  `PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$PATH" node --test tests/*.test.mjs`.
  Separate parent and spawned `node --version` probes both confirmed `v22.13.0`.
- `bash -n tests/fixtures/file-manager/setup.sh`: passed.
- `docker compose -f tests/fixtures/file-manager/compose.yaml config --quiet`: passed.
- Vendored schema byte-identical to the host working-tree schema.
- LICENSE SHA-256 matches original DBX source commit verbatim.
- Six Docker services observed healthy by read-only `docker ps`; service health
  does not establish a successful plugin operation.

## Latest transfer checkpoint

See [transfer acceptance](TRANSFER-ACCEPTANCE.md) for the 2026-09-07 checkpoint:
fixed 4 MiB append aggregation, buffered/unbuffered cancellation/deadline tests,
32 passing backend unit tests plus the separately enabled live test, and 40 Node
tests. The latest `dist/append-gates` package passed the full-six 16/256 MiB
RSS/checksum matrix using a separate native-Java Hadoop cluster. Its full-six
5 MiB/zero-byte contract, host gateway, FTP runtime and nine-stage Web lifecycle
also passed. Original WebHDFS failures and the subsequent emulated JVM stall are
preserved in TRANSFER-ACCEPTANCE.md; no existing container was restarted.
The subsequent unchanged-payload WebDAV interruption harness passed eight live
cases plus a five-connection/15-task global-eight/per-connection-two admission and
recovery check, with repeated runs and all owned resources cleaned. The latest
Node suite passed 47 tests. The proxy's initial path-handling failures and targeted
repair are preserved in TRANSFER-ACCEPTANCE.md. Native interaction, concurrent
memory and real interruption of the other five protocols remain open.

## Pending checks

Clean-host follow-up: the locked offline sqlite-bundled native build exited zero
in 4m55s, without diagnostic instrumentation. Actual native FTP download passed
to a new local file with independently verified bytes/hash, and the isolated app
was quit normally. See NATIVE-ACCEPTANCE.md and
`evidence/native-clean-host-20260907/result.json`. This supersedes the clean-host
download gap in earlier checkpoints, not GUI upload/new-package/platform gates.

Latest result supersedes the unresolved diagnosis below: the configuration-load
caller and three changed fields were captured, and preserving plugin defaults
restored native FTP download. The local bytes/hash were independently verified.
See [native defaults fix](NATIVE-DEFAULTS-FIX.md) for evidence and the recorded
13,195-test frontend pass. Clean-host native acceptance and GUI upload/install
remain pending; the following paragraphs retain earlier checkpoints.

Native RPC tracing has now observed a successful host-issued disconnect after
initial connection and listing, before another user action. Configuration default
normalization is a hypothesis, not an established cause. A caller/field-name trace
build completed but was not run because the Mac relocked. Temporary source traces
were removed and verified byte-identical to the pre-diagnostic baseline; the main
patch hash is unchanged. See NATIVE-RPC-DIAGNOSIS.md for diagnostic binary provenance
and the stopped native instance. No new native transfer pass is claimed.

The isolated native host was rebuilt again with connection generation ownership
and tested against the unchanged installed 0.1.0 plugin. File listing and native
save-path selection worked, but final download still returned `Connection is not
connected` and no local output exists. NATIVE-ACCEPTANCE.md records the new binary,
same-profile checks and screenshot/AX evidence. This narrows diagnosis rather
than establishing a native pass; GUI installation approval remains pending.

Connection ownership checkpoint: real host superseded-attempt cleanup was found
to disconnect a newer plugin binding and now passes with generation ownership.
Plugin tests: 86 passed/two ignored; broader Core `connection` filter: 529 passed/
12 ignored; Node: 53 passed. Old/new independent read-only native-fixture probes
both pass. See CONNECTION-OWNERSHIP.md for evidence, lifecycle reruns and the
unresolved native UI attribution/approval boundary.

Actual native UI is now partially exercised: the rebuilt isolated .app opened
the existing fixture, both native pickers opened/cancelled without transfer output,
and the save picker returned the intended local path to the app confirmation.
The real download failed with `Connection is not connected` using the historical
installed 0.1.0 payload, including after refresh. No native transfer pass is claimed.
The new-candidate installation comparison awaits explicit GUI installation approval;
the unsigned option remains off. See NATIVE-ACCEPTANCE.md and its screenshots.

The transfer-state checkpoint fixes locally known tasks remaining running after
their status returns `not_found`, and prevents per-task errors starving later
updates. Component/helper tests: 27 passed; real forced upload/download replacement
cases all return the verified error shape and pass cleanup/retry. Four frontend
static gates pass; the first full test attempt encountered worker timeouts, while
the unchanged complete suite rerun with two workers passed all 1,336 files and
13,192 tests. See TRANSFER-STATE-ACCEPTANCE.md for both results and limitations.

New host-owned download leases now pass the macOS WebDAV forced replacement
matrix. Backend tests: 35 passed plus the enabled live listing test; Clippy/fmt
passed. Host plugin suite: 84 passed, two live ignored by default; joint
Core/Web/Tauri check passed. New release payload passed six-protocol 5 MiB/zero-byte
contract. See DOWNLOAD-LEASE-ACCEPTANCE.md for new package hashes and remaining
host-crash, legacy, namespace-race, UI and platform limitations.

The forced-stop lifecycle extension now verifies that the host reaps the old PID
before publication even during an unresponsive transfer. WebDAV uploads pass, but
downloads fail cleanup after both upgrade and rollback: a local named tempfile
remains. The failure is reproducible, graceful controls pass, and the test-owned
profiles/remotes/PIDs were cleaned. Node tests pass 53/53 and host plugin tests
79/79 (two live ignored by default). See [forced-stop recovery](FORCED-STOP-RECOVERY.md);
no production fix or full phase-7 pass is claimed.

The latest host-gate checkpoint resolved the six MCP test failures as canonical
path expectation mismatches: 32 MCP tests and 289 Tauri library tests passed.
Explicit non-truncating lock opens and two filesystem lock regressions bring the
plugin suite to 79 passing tests, with two live tests ignored by default.
Default-feature workspace Clippy and full formatting were actually attempted
and still fail outside these fixes; see [host gates](HOST-GATES.md) for commands,
diagnostics, source-tree provenance and limits. The plugin payload is unchanged.

Windows GNU x64 cross-compilation subsequently passed check/clippy, release and
test-executable linking, PE format and static-import inspection twice. An unsigned
candidate was staged with the official low-level packager and passed the exact
member/manifest/checksum verifier. No Windows program or test was executed;
`runtimeVerified` remains false. The host Node suite passed 52 tests. Details and
source/package provenance are in PLATFORM-ACCEPTANCE.md.

The macOS host's active-transfer lifecycle checkpoint subsequently passed all four
WebDAV upload/download upgrade/rollback cases twice, with cancellation and PID /
activation-order assertions. The host plugin regression passed 77 tests (two live
tests ignored by default and exercised separately); the Node suite passed 50.
Only test/controller code changed. See LIFECYCLE-ACCEPTANCE.md for evidence and
the remaining forced-stop, other-protocol and native UI boundaries.

Linux ARM64 now has a native 17-stage sidecar/package checkpoint: 49 Node tests,
32 Rust tests plus the separately enabled live test, format/clippy, actual CLI
package, six-protocol small/large transfers, FTP runtime and WebDAV interruption
and 8/2 concurrency all passed. See [platform acceptance](PLATFORM-ACCEPTANCE.md)
for toolchain/container details, hashes, raw logs and remaining desktop/Windows
gates. This supplements the earlier platform-pending entries below; it does not
turn them into a full platform-matrix pass.

- Long-running Hadoop fixture stability remains a limitation. After the recorded
  hung-DataNode incident was recovered, the unchanged runtime-gates package passed
  a fresh full-six release test. Earlier failures remain recorded below.
- Original standalone OpenDAL fixture probe: not rerun at this checkpoint.
- Full interactive UI, local-picker authorization, upgrade, rollback and the platform
  matrix remain separate acceptance gates. The AppState install/uninstall smoke
  below is recorded without treating it as full product acceptance.
- Full authentication matrix, cancellation/failure cleanup, memory/concurrency,
  tunnels, cloud services and platform matrix: pending.
- GitHub workflow execution, publication/signing: not run; no publishing workflow.

The live script does not silently skip unready protocols. A subset is labeled a
partial run and failed/missing services produce nonzero status. Subsequent runs
must record their actual result here, including any failures and residual gates.

## Actual framed live runs

The local debug sidecar was exercised directly with all six healthy endpoints,
using an explicit existing SFTP key-file path (no key copy). Canonical API 1.1
responses are asserted directly: capabilities array, plain stat Entry and full
transfer-start snapshot. Host normalization is not involved.

- Run 1: 0/6, exit 1. Harness incorrectly tried reconnect without disconnect;
  this was corrected. Also exposed upload/list defects, so not a backend pass.
- Run 2: 2/6, exit 1. SFTP and HDFS Native passed all exercised operations,
  5 MiB upload/download, read-only reconnect and cleanup. FTP upload reported
  partial_transfer with not_found cause; WebHDFS upload reported unsupported;
  S3 limit=1 pagination omitted an entry; WebDAV list returned backend error.
  The failures were reported for correction.
- Run 3: 5/6, exit 1. FTP, SFTP, S3, WebHDFS and HDFS Native passed the full
  exercised contract, now including zero-byte inline files and zero-byte transfers.
  WebDAV list was fixed; its 5 MiB upload returned unsupported. No assertion was
  removed to hide that failure.
- Run 4 (WebDAV-only): 1/1, exit 0 after bounded streaming PUT implementation.
  This targeted run alone is not the six-protocol gate.
- Run 5 (full six, 2026-09-07): 6/6, exit 0. Includes all canonical RPC shapes,
  lifecycle, bounded preview, one-item pagination, copy/rename, no-overwrite and
  traversal rejection, 5 MiB/zero-byte transfers, progress/checksum, readonly and
  cleanup. Debug executable SHA-256:
  `d143707f7965bd2e548277727f20df7d32b4ae951bc4380ded1c2514a790b45e`.
- Run 6 (extracted pre-runtime-gates package release binary): 6/6, exit 0, same
  full harness. This verifies the actual release payload, not only the debug build.
- Cleanup: all seven leftover test directories from runs 1/2 were safely removed
  using exact protocol + run UUID, not recursive root deletion. Run 3 cleanup
  succeeded for every protocol. Existing Docker services were not restarted/deleted.

Failures were not skipped or weakened into passing assertions. The passing run
applies to the tested snapshot, not automatically to later backend changes.

## Unsigned package checkpoint

`node scripts/package.mjs`: passed locked release build and packaging (exit 0).
The initial npm launcher attempt failed because its injected local SDK patch would
change Cargo.lock. The repository wrapper invokes the installed native CLI without
that injection; the exact Git SDK pin and lock are retained. Cargo may print an
upstream unexpanded-template diagnostic while discovering the pinned Git checkout;
the recorded successful build still completes with exit 0.

Preserved pre-runtime-gates candidate:
`dist/pre-runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`

- Size: 7,284,186 bytes.
- SHA-256: `1359d6b4fc4e99a04c2a7a02b3b0dfa8595ef38c0bec629315143302449b1119`.
- `node scripts/verify-package.mjs <candidate>`: passed exact six-file allowlist,
  all checksums, manifest parity and LICENSE/NOTICE preservation.
- CLI normalization is limited to target executable path and omission of default
  `protocol_versions: [1]`; the host restores `[1]` when absent.
- No UI, tests, runtime keys or signature in the archive. The release binary's
  dynamic link inventory contains only Apple system libraries/frameworks.
- Query timeout, idle expiry and idempotent connection enhancements are not in
  this checkpoint. A later candidate must be rebuilt and retested, not overwrite
  this checkpoint's evidence. Host install/UI acceptance remains separate.

## Host integration evidence

The integration run reported the following for the exact pre-runtime-gates package:

```bash
cd ../dbx-file-manager-host
target/debug/examples/file_manager_plugin_smoke \
  ../dbx-file-manager-plugin/dist/pre-runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp
```

PASS: actual PackageInstaller install, test/connect, capabilities, mkdir/write/stat,
copy and duplicate structured error, rename, bounded preview/page limit, FTP 5 MiB
upload/download byte equality, saved readonly update rejecting delete, UUID fixture
cleanup, disconnect/stop/uninstall. This is a real AppState/package smoke, not full
interactive UI acceptance or three-platform conformance.

Reported frontend evidence: 73 focused tests, vue-tsc, local lint and Web build
passed; following bridge updates, 19 bridge tests/lint and vue-tsc passed.
Earlier Node 26 full checks had 12,349 pass and 94 fail. Invoking pnpm through
mise, or changing only the parent Node executable with mise, did not reliably
change child processes; those preliminary runs are not full Node 22 evidence.

The actual full Node 22 command, with parent/child version probes both confirming
22.13.0, was run in the host checkout:

```bash
PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$PATH" node scripts/run-check.mjs
```

Initial result: connection-types, format, lint and typecheck passed; **12,438 tests
passed, 8 failed**. The four outdated source-extraction suites were then corrected
to match the framework's actual delegation and imported dependencies, retaining
failure/retry and clear-before-close assertions. Their 33 tests passed. After the
provider-polling regression fix, the same explicit-PATH full check passed all five
gates: connection-types, format, lint, typecheck and tests (test phase 103.99s).
The genuine Node 22 targeted localStorage check also passed 57 tests; the form
fix's old string assertion and two behavioral regressions passed.

Interactive Web UI progress: pre-runtime package installed, six providers visible,
FTP Test reports success after correcting a host form bug that discarded plugin
external_config. Two regression tests for the form guard passed. Interactive
mkdir succeeded and was visible. The local screenshot
`dist/evidence/web-desktop-preview.png` records an actual preview with the
pre-runtime package; it is not evidence of preview on the newer candidate.

The isolated Web instance also verified that uninstall is refused while a saved
connection references the plugin, with the test connection name in the refusal.
After explicitly removing the sole test connection, uninstall succeeded. The
runtime-gates 0.1.0 candidate was then freshly installed through the UI and the
single fake test configuration restored. This was uninstall/reinstall, not an
in-place same-version replacement, upgrade, or rollback test.

With the runtime-gates candidate, current-URI browsing, text preview, copy and
rename succeeded. A rename draft was left open for 11 seconds and survived the
10-second registry poll before successful submission. Delete confirmations and
actual deletion of both test files and the exact UUID-like test directory were
verified; the final UI listed zero rows at `ftp:/`, and a read-only Docker listing
confirmed the fixture root was empty. The initial preview file was seeded via the
real inline-write HTTP API, not via a browser upload control. Some post-emulation
delete controls were activated with DOM click dispatch; this is not native picker
or physical desktop-input acceptance.

Screenshots under ignored `dist/evidence/` record real rendering, not mock data:
`web-runtime-desktop-preview.png` (1496x841) and
`web-runtime-tablet-preview.png` (768x900) show the actual file preview with no
page-level overflow. The 390x844 mobile check did **not** pass: the unchanged host
`App.vue` root enforces `min-w-[760px]` inside an overflow-hidden viewport, clipping
the workspace. A zero `document.scrollWidth` overflow result alone is insufficient;
the screenshot and ancestor bounds exposed the clipping. This existing host-wide
layout constraint was not silently removed or labeled mobile-ready.

A second real product bug was identified: the 10-second registry refresh replaced
equal-valued provider objects, causing an array-identity watcher to reset dialogs
and previews. Independent scalar watch sources replaced that watcher; a regression
test preserves the draft across same-value provider replacement. The manager's
16 tests passed. The automatic dialog closure is not attributed only to browser
automation or animation timing.

## Reproducible host patch

`docs/host-api-1.1.patch` captures the 39 changed/new host files against
`c26ff3f6d4bd643be8dedd659c3236af4a5bd556`. `git apply --cached --check` passed
against an independent temporary index populated from that baseline. The real
index remained unchanged, and no commit or push was made. The patch includes
untracked new modules/tests; it is not a tracked-files-only diff. It is excluded
from the native plugin package.

SHA-256: `c4dd2736fbe68b3987808b4a85a2dbaa9ecd03eec650660dee849e54b4f60137`.

After the final request-budget changes, this joint host compilation check passed
(exit 0, 3m54s), using the shared development target directory:

```bash
CARGO_TARGET_DIR=/path/to/shared/target \
  cargo check --offline -p dbx -p dbx-web --no-default-features \
  --features dbx/sqlite-bundled
```

Earlier core checks recorded 73 passing tests and one opt-in live test ignored;
the latest real sidecar integration was then explicitly enabled and passed 1/1.
The HTTP structured error-envelope test passed 1/1. These do not establish a
full default-feature Rust workspace test run or a real Tauri dialog workflow.

The final Web executable was rebuilt with `cargo build --offline -p dbx-web
--no-default-features --features dbx-core/sqlite-bundled` (exit 0, 4m18s), then
the isolated preview service was restarted. Login, restored FTP connection and
empty root listing succeeded. Real HTTP generic invoke rejected the native
transfer namespace with `host_only_method`, and rejected delete after the saved
fixture policy changed to read-only with `read_only`. Both returned structured
HTTP 400 errors; the fixture policy was restored in a finally block. The build
reported the known non-fatal macOS `__eh_frame` linker warning.

The final independent backend rerun used `cargo test --locked --offline
--manifest-path backend/Cargo.toml -- --include-ignored`: 31 passed, zero failed
or ignored. Package allowlist/checksum verification and all 37 metadata/harness
tests also passed again after documentation and patch export.

The host remains seven commits unique and 219 commits behind the inspected
`upstream/main` reference. `git merge-tree --write-tree HEAD upstream/main`
reported ten conflict files without changing either checkout or branch. This is
evidence of remaining integration work, not a completed merge.

## Additional runtime gates

`node scripts/runtime-contract.mjs` adds real FTP checks for concurrent first
connect, same-config idempotence, changed readonly generation/cursor invalidation,
idle resume and query=0/idle=0 operation acceptance. It passed against the newer
runtime debug implementation under Node 22.13.0 (exit 0). These settings are common
ConnectionConfig fields, never new manifest external_config keys. Actual timeout
expiration and eviction internals need deterministic backend tests as well.

The new runtime debug executable also passed the complete six-protocol live
contract under Node 22.13.0, 6/6, exit 0. SHA-256:
`f6d52872ada8c0d51159ec3d7485749d864ae452e7267d7a1289bade6759ecd3`.

Backend integration evidence reports 31 tests passed with `cargo test -- --include-ignored`,
including actual timeout/unlimited-query behavior, idle cache eviction/rebuild,
active task protection, generation replacement and concurrent connect deduplication.
Clippy and the locked debug build passed. This supplements, but does not replace,
the real protocol and packaged-payload tests.

## Runtime-gates candidate

Built with `node scripts/package.mjs --output-dir dist/runtime-gates` using an
explicit Node 22 process. Locked release build exited 0. Candidate:
`dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`

- Size: 7,302,942 bytes.
- SHA-256: `7b94a3332c0aaae426dcfed27f2072e67d38a5052bbea5d8925c70ee24abc94e`.
- Package verification passed the same exact allowlist, normalization, attribution
  and SHA-256 checks as the earlier candidate.
- Extracted release-binary FTP runtime smoke passed, exit 0, with parent/child
  Node 22 PATH verified. The next full-six run returned 4/6, exit 1: FTP, SFTP, S3
  and WebDAV passed; WebHDFS event collection and HDFS Native writes timed out.
- After isolated DataNode recovery, the exact same extracted release payload
  passed the full six-protocol harness, **6/6, exit 0**, including 5 MiB/zero-byte
  transfers, readonly, pagination, structured failures and remote cleanup.
- Actual AppState PackageInstaller smoke for this latest package also passed
  (exit 0): the same FTP 5 MiB, structured errors, readonly and cleanup coverage
  described above. This does not hide the separate Hadoop fixture failures.
- The pre-runtime-gates candidate is retained unchanged for evidence comparison.
  Its AppState and UI evidence is tracked separately from the older snapshot.

## Hadoop fixture incident

The release rerun first timed out collecting WebHDFS transfer events. The collector
was extended from 60 to 90 seconds to observe the backend's unchanged 60-second
timeout plus bounded cleanup. This changes only the test collector, not backend
deadlines or expected results. The subsequent targeted WebHDFS run failed even
the initial small write with structured `timeout`, not merely the 5 MiB transfer.

A new standalone HDFS Native sidecar also timed out writing a small file. Crucially,
the unchanged pre-runtime-gates package failed the same HDFS Native control on the
same endpoint. This prevents attributing the incident solely to the new runtime.

Read-only fixture evidence: NameNode continued allocating blocks, but DataNode
write logs stopped around 16:30:39 UTC. At 16:36:33 UTC its last NameNode contact
was 16:30:38 UTC; failing health-check streak was 58 with repeated three-second
timeouts. The configured 60 retries temporarily left Docker's label `healthy`.
CPU/memory were not saturated. Container-label health is not a data-plane check.

No backend/package changes were made in response to this incident. Following
explicit recovery authorization, diagnostics were preserved under
`docs/evidence/hadoop-before-recovery-20260907/` before restarting only the isolated
DataNode:

```bash
docker compose -p dbx-plugin-migration -f tests/fixtures/file-manager/compose.yaml \
  restart --no-deps datanode
```

The existing NameNode's startup command unconditionally formatted metadata, so
restarting it would violate data preservation. It was deliberately left running;
its StartedAt remained `2026-09-06T15:40:52.345562601Z`. DataNode restarted at
`2026-09-06T16:40:10.892883043Z`, returned to zero failing checks and fresh heartbeat.
The four original dbx-opendal containers were not restarted, removed or recreated.

The fixture source now guards NameNode formatting on absence of its VERSION file.
This source correction does not change an already-created container's command;
the warning is documented in the fixture README. No volumes or containers were
removed. The post-recovery HDFS Native targeted test passed, followed by full-six
release acceptance using the unchanged package SHA above.

Both leftover HDFS Native directories were cleaned using their exact run UUIDs:
`a2daec46-8f90-4051-86ec-449fde12ff34`, `a5efc596-ff3e-46c6-bee7-e4577831c4e8`.
No root-wide or recursive remote cleanup was used. Repeated production load and
the underlying fixture hang's cause remain outside the passed acceptance scope.

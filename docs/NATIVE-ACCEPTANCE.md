# Native acceptance checkpoint

## External upload observed

During the next read-only checkpoint, `verify-upload` changed from `not_found`
to a successful remote-content verification: 147,456 bytes, SHA-256
`817ecc1e00aa5730d600173a45336198952b6eb5ed2838ee8f83c4d9bcc2b83e`.
The agent did not submit the GUI upload. Treat this as an externally completed
fixture upload, not as authorization for subsequent GUI writes or installation.

The native window was on Plugin Center / Installed, showing 0.1.0. Independent
inspection found only version 0.1.0 and the original activation record; the
installed executable still hashes to
`c251a3b7538674b3abf768f27d13d44e5db40d74a4c8e55668a20be7a4d31ac2`.
This is the historical runtime-gates package, not the latest scheduling-fix pack.
An attempt to return to the file tab received a user-changed-app notice; the
agent refreshed state and stopped further UI actions to avoid competing with
the user. No native completion screenshot or initiation trace was captured in
this checkpoint. The remote checksum alone does not establish the complete
GUI workflow or latest-package acceptance. No repeated upload or cleanup ran.

The pending-state paragraph below describes the earlier preparation checkpoint;
its statement that the file is unuploaded is superseded by this observation.

Pending native actions: GUI upload authorization has not been received. The
selected fixture file remains unuploaded. For a future authorized upgrade, the
latest 0.1.1 fixture is now `dist/upload-fairness-lifecycle-gates/`, built from the
current scheduling-fix code. See LIFECYCLE-ACCEPTANCE.md for its hash and passing
host API matrices. It has not been installed in the native profile; do not infer
GUI permission from automatic goal continuation.

Latest checkpoint: clean-host native FTP download passed, independently checked
by size and SHA-256. GUI upload and new-package acceptance remain open. Earlier
failure and lock observations below are historical.

## Clean-host native download

- Rebuilt from the exported source tree `3c9afa4fe701fa42ecfc3849d0960f5f8e6cc6e2`
  without diagnostic tracing, using the preparation command below plus `--locked`.
  Build exited zero in 4m55s with the existing compact-unwind linker warning.
- Native binary SHA-256:
  `e5d387a792b140c5f2285cf67fddbb2e8064faf1838d77e6b8e384de852cccb7`.
  The previous diagnostic app was quit normally and its process absence checked
  before replacing the test executable. Original profile/plugin/server retained.
- The new process restored its FTP connection and file listing. Coordinate clicks
  failed with `noWindowsAvailable`; accessibility actions and keyboard navigation
  worked. The native Save dialog selected `files/download-clean.txt`, which was
  verified absent before the attempt. No overwrite or data deletion was needed.
- Actual confirmation completed the download. Fresh full AX state and screenshot
  show completion. Independent hash and byte comparison passed: 147,456 bytes,
  SHA-256 `817ecc1e00aa5730d600173a45336198952b6eb5ed2838ee8f83c4d9bcc2b83e`.
  The directory contained only the three expected fixture files, no temp entries.
- The app was quit normally afterward, with process absence verified. All fixture
  data remains available. No GUI installation or upload was performed.
- [Machine-readable evidence](evidence/native-clean-host-20260907/result.json),
  [screenshot](evidence/native-clean-host-20260907/download-completed.png), and
  [AX state](evidence/native-clean-host-20260907/download-completed.txt).
- This proves the clean debug host plus existing runtime-gates 0.1.0 plugin and
  development frontend's FTP download. It does not prove the new lease candidate,
  fully bundled release build, GUI upload/Replace/read-only or platform matrix.

Date: 2026-09-07. **Partially exercised, not accepted.** The Mac desktop-control interface initially
reported that the Mac was locked and automatic unlock failed. No native picker
or native transfer has been exercised at this checkpoint. Manual unlock is needed
before continuing computer-use actions.

Later 2026-09-07 update: the native-control inventory now returns available apps
and browsers instead of the lock error. The previous lock is historical, not a
current verified blocker. No native picker pass follows from that inventory;
revalidate/rebuild the isolated instance below before performing UI acceptance.

The original process predates the lifecycle coordinator; it was replaced in the
native UI checkpoint below. Historical preparation details remain for provenance.

## Actual native UI checkpoint

- Rebuilt the latest integrated host with the documented TAURI_CONFIG and locked
  sqlite-bundled build. Build exited zero after 6m13s; the known compact-unwind
  warning remained. The main-host patch input is
  `dab939c5267a5fa896b39d4907447054f88f4cded8b563c72912bc731bd5cf39`.
- The native-control API could not resolve the raw executable. A test-only app
  wrapper was created at `dist/native-ui/DBX Plugin Acceptance.app` in the plugin
  repository. Its launcher fixes DBX_DATA_DIR to the existing JHXNyZ profile and
  sets Node 22 first on PATH. Its Info.plist uses `com.dbx.plugin-acceptance`; no
  tracked app configuration or installed user DBX application was changed.
- Packaged test executable SHA-256:
  `044a17a40db0970796131497d1d9a813777690903e360ad3fc39ed853cd07cb6`.
  Old PID 77541 was verified against its command and profile environment before
  receiving SIGTERM. New app PID 9063 was independently verified against the
  wrapper executable and the same DBX_DATA_DIR after launch.
- The actual native window loaded the existing `Native FTP acceptance` connection
  and its `download-source.txt`, including file size, modification date and native
  upload/download controls. The main layout was visually inspected and nonblank.
- Opened the native save picker, then cancelled. Opened the native upload picker,
  navigated only to the generated profile's `files` directory, then cancelled.
  The UI showed no transfer; independent `verify-download` and `verify-upload`
  probes failed with absent local file and remote `not_found`, respectively.
  These expected negative probes prove that no test upload/download was created.
- Selected `files/download.txt` through the native save picker. The application's
  confirmation displayed the exact disabled local path and remote source URI.
  The final Download action returned **Connection is not connected**. A refresh
  and retry reproduced the same error. Explicit disconnect/reconnect subsequently
  showed the same error while loading the file page. No download file exists.
- The installed plugin tab still identifies the historical runtime-gates 0.1.0
  candidate, not the new download-lease payload. This is a real native-chain
  failure with that input; its root cause is not yet established and no claim is
  made that the new candidate fixes it without performing the comparison.
- The settings page exposes local `.dbxp` installation. Its unsigned-development
  switch is **off** and was left off. Native UI installation is awaiting explicit
  action-time confirmation to enable the option and install the local test-only
  0.1.1 package in `dist/download-lease-lifecycle-gates/` (SHA-256
  `c94b374aba461964b962f0a4923dcdd3be7ee94db647424feafb6b4c4f80f7f1`).
  That package runs native code with the current user's permissions. This approval
  does not imply approval for a later GUI upload of a file.

The new native app and frontend at `http://127.0.0.1:5179/` remain available for
continuation. Existing preview servers and Docker services were not restarted;
the original profile/remote fixture were not recreated or deleted. Plugin code,
host source and existing candidate packages were unchanged during this checkpoint.

Screenshots in `docs/evidence/native-ui-20260907/`:

| File | Observation |
| --- | --- |
| `save-picker.png` | Real macOS save sheet before cancellation |
| `open-picker.png` | Real macOS open sheet in the isolated fixture directory |
| `download-confirm.png` | App confirmation with native-selected local path |
| `download-not-connected.png` | Actual failed download and error text |
| `install-policy-off.png` | Unsigned-development policy remains disabled |

The pending upload, new-candidate comparison, successful download, Replace,
read-only/production checks and cleanup are not accepted. Do not infer a native
transfer pass from opening a picker, seeing a file listing or building the app.

Subsequent diagnosis: standalone read-only probes of both old and new Sidecars
passed idle-expiry and reconnect checks. A separate real host regression reproduced
the same error when discarding an older connection attempt after a new binding
connected; host-side generation ownership now fixes that case. See
CONNECTION-OWNERSHIP.md. The running .app does not yet contain this later fix,
and GUI installation approval is still pending. Neither result proves the native
download is fixed without rebuilding and repeating its actual UI workflow.

## Ownership-fix native rerun

The same original profile and installed runtime-gates 0.1.0 plugin were then
tested with a rebuilt host containing the connection-generation fix. This was
a host-only comparison; no pending GUI plugin-installation approval was assumed.

- Source patch input:
  `dc9caecf1c91b12aade90516395801fe2fdf3cae92011a2101de5f4bcc22d6ca`.
- Locked isolated Tauri build exited zero in 5m35s with the existing compact-unwind
  warning. New copied native executable SHA-256:
  `6ac6ad2dcdb1f5b4a607229ee74eb695ff511d98546dcd84f05081d0d88efe49`.
- Previous test PID 9063 was verified by command path and DBX_DATA_DIR before
  receiving SIGTERM. New PID 13951 was independently verified against the same
  isolated profile and the new bundled executable after launch.
- The installed Sidecar stayed unchanged at SHA-256
  `c251a3b7538674b3abf768f27d13d44e5db40d74a4c8e55668a20be7a4d31ac2`.
  The native UI showed the unsigned-development switch off before this rerun;
  it was not toggled and no plugin installation or upload was performed.
- The file page loaded the original FTP seed. The real macOS save sheet selected
  `files/download.txt`, and the app confirmation displayed that exact disabled
  local path. Clicking Download still returned **Connection is not connected**.
  Independent filesystem inspection confirmed that the destination was absent.
- Screenshot and accessibility readback:
  [failed download](evidence/native-ownership-host-20260907/download-result.png)
  and [AX state](evidence/native-ownership-host-20260907/download-result.txt).
  Their SHA-256 values are
  `b43b5fc9992968eaeae876cd9d62b4ea4bba2e8e465f580842786248d810eeae`
  and `69dadd7b7e024434e441ce3d0d24d252eefa2b14ec3621bd00b6bc5bd3fef422`.
- The test-only launch wrapper now captures stdout/stderr to `native-host.log`
  inside the isolated profile with umask 077. Existing startup output did not
  provide a sufficient per-request connection trace; raw logs are not published.

This contradicts the hypothesis that the verified superseded-attempt defect was
the only cause of the native failure. Its real regression fix remains valid, but
the native download issue remains unresolved. Next diagnosis needs an exact
native lifecycle/request trace or the explicitly approved new-plugin comparison,
not another unverified reconnect change. The app remains open on the failure
dialog and the original fixture remains intact for reproduction. No full native
transfer acceptance or goal completion is claimed.

## Isolated runtime

Latest diagnosis update: [native RPC tracing](NATIVE-RPC-DIAGNOSIS.md) directly
observed the host issuing `connection/disconnect` after successful connection and
listing, before a new user action. The caller remains unidentified. The Mac locked
again; the diagnostic app was stopped after recording evidence and all temporary
source instrumentation was removed. Its profile remains intact. Current .app/shared
target binaries are diagnostic builds, so follow the provenance in that document
before the next native run rather than treating them as clean acceptance artifacts.

- Host: sibling `../dbx-file-manager-main`, pinned base and integration patch as
  recorded in [MAIN-INTEGRATION.md](MAIN-INTEGRATION.md).
- Candidate: `dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`,
  SHA-256 `7b94a3332c0aaae426dcfed27f2072e67d38a5052bbea5d8925c70ee24abc94e`.
- Native build uses product name `DBX Plugin Acceptance` and identifier
  `com.dbx.plugin-acceptance` via TAURI_CONFIG, without changing repository app
  configuration or launching the installed user's DBX application.
- Native frontend server: `http://127.0.0.1:5179/`. This is the Tauri development
  frontend, not the Web acceptance instance at port 5178.
- Current generated profile:
  `/private/var/folders/rf/7mp04hs95159ttvwb9l7rl_c0000gn/T/dbx-native-profile-JHXNyZ`.
- Remote fixture directory: `/ftp/dbx/dbx-native-b97db4e7-b4fd-4572-a166-e139b6d810f7/`
  on the existing disposable FTP service at `127.0.0.1:2121`.
- The native process was started with DBX_DATA_DIR set to that profile. Startup
  completed; fallback data import reported `SkippedNoSource`. Visual readiness is
  not established by this log.

No original profile, key, runtime directory or container was copied or modified.
The candidate was installed by the real PluginPackageInstaller into the generated
profile. Only the public disposable FTP credentials were saved through Storage.
The saved `Native FTP acceptance` connection is rooted at its UUID directory.

## Reproduce preparation

Run these commands in the main integration checkout. Keep Node 22 first on PATH.
The target directory may be set to the existing shared build cache; it is not an
input containing user connection data.

```bash
TAURI_ENV_ARCH=aarch64 pnpm exec vite --config apps/desktop/vite.config.ts \
  --host 127.0.0.1 --port 5179 --strictPort
```

```bash
TAURI_CONFIG='{"productName":"DBX Plugin Acceptance","identifier":"com.dbx.plugin-acceptance","build":{"devUrl":"http://127.0.0.1:5179"}}' \
  cargo build --offline -p dbx --no-default-features --features sqlite-bundled --bin dbx

cargo run --offline -p dbx-core --no-default-features --features sqlite-bundled \
  --example file_manager_desktop_fixture -- prepare \
  ../dbx-file-manager-plugin/dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp
```

Preparation prints the new profile path. Set PROFILE to that exact path, then run
the built desktop executable with `DBX_DATA_DIR="$PROFILE"`. Reuse the current
profile during this acceptance run; do not recreate fixtures just because an
observation timed out or the Mac is locked.

## Evidence collected

- Native executable build passed (4m 13s). The nonfatal macOS compact-unwind
  linker warning is unchanged from the Web builds.
- Fixture example compiled and prepared a fresh profile using the actual package.
- Three fixture tests passed: loopback/UUID configuration scope, explicit valid
  marker requirement, and deterministic payload size/hash.
- `verify-seed` read the real remote file and confirmed 147,456 bytes, SHA-256
  `817ecc1e00aa5730d600173a45336198952b6eb5ed2838ee8f83c4d9bcc2b83e`.
- Before UI transfers, `verify-download` failed for an absent destination and
  `verify-upload` failed with remote `not_found`, as expected. The verifiers do
  not invent a successful native-transfer result from preparation alone.
- A second independent profile ending in `Av9Y2i` was created only to exercise
  cleanup. Both initial cleanup and repeated cleanup succeeded; a remote stat
  confirmed its UUID directory was absent. The primary native fixture is retained.

## Remaining UI acceptance

1. Unlock the Mac and select the already-running isolated desktop process, not
   the installed DBX application. Inspect its actual rendered state.
2. Open the `Native FTP acceptance` connection's FTP files through Plugin Center.
   Verify `download-source.txt` is listed, and native upload/download controls
   are present. Capture the actual native app and picker states.
3. Open and cancel both native file dialogs. No transfer, remote object or local
   output should be created by cancellation.
4. Download `download-source.txt` using the native save picker to
   `$PROFILE/files/download.txt`, then confirm the host operation and verify the
   terminal task state and exact output bytes.
5. Select `$PROFILE/files/upload.txt` through the native open picker. Before the
   final upload action, obtain any action-time approval required by the UI tool.
   The only destination is the disposable loopback FTP UUID directory, with
   target name `upload.txt`. Confirm the host operation and verify the remote bytes.
6. Exercise existing-destination protection and explicit Replace separately;
   verify readonly/production guards and failure states without bypassing them.
7. Capture results and clean up only this fixture after the isolated native app
   is stopped. Keep failed evidence; do not use recursive deletion or touch other
   FTP directories.

Verification commands use the built `file_manager_desktop_fixture` example:

```bash
file_manager_desktop_fixture verify-seed "$PROFILE"
file_manager_desktop_fixture verify-download "$PROFILE"
file_manager_desktop_fixture verify-upload "$PROFILE"
file_manager_desktop_fixture cleanup "$PROFILE"
```

The executable is under the selected Cargo target directory's `debug/examples/`;
it need not be installed on PATH. Verification uses a separate temporary Storage,
not writes to the running desktop's DB. Cleanup has an explicit two-file allowlist
and only removes the UUID directory when empty, then checks absence with stat.

This 144 KiB fixture targets picker/host/sidecar integration. It cannot establish
bounded memory under large transfers, concurrency 8/2, active-transfer cancellation,
disconnect-timeout behavior, six-protocol native coverage or cross-platform gates.

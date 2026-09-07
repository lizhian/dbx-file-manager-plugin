# OpenDAL File Manager

Independent DBX plugin `io.github.lizhian.file-manager`, publisher `lizhian`, version `0.1.1`.

**Development release; migration acceptance remains incomplete.** Six connection providers share the DBX
host-owned file manager. No custom workbench or UI entrypoint is contributed.
The unused generated UI template has been removed and is not packaged.

Public source repository: https://github.com/lizhian/dbx-file-manager-plugin.
Local build artifacts, runtime data, IDE settings and raw acceptance evidence
(including screenshots and host logs) are not committed. Documentation retains
historical measurements and artifact hashes; links into `docs/evidence/` refer
to the local acceptance archive unless explicitly included. See
[evidence handling](docs/evidence/README.md). Publishing source is not a plugin
release or a claim that all migration gates have passed.

Functional acceptance focuses on **macOS Apple Silicon (ARM64)**. Tag releases
now build all five official platform/architecture targets, as separately requested.
Cross-platform builds are not a claim of full functional acceptance.

## Download and release

Download `.dbxp` files from [GitHub Releases](https://github.com/lizhian/dbx-file-manager-plugin/releases).
Pushing a matching `vX.Y.Z` tag builds macOS x64/ARM64, Linux x64/ARM64 and Windows
x64, then publishes all packages, per-target `.artifact.json` files and
`release-candidates.json`. Naming follows the official DBX CLI:
`io.github.lizhian.file-manager-<version>-<target>.dbxp`.
Packages are unsigned and require the adapted Host API 1.1 host plus explicit
local-development installation. Windows SFTP remains unsupported.
See [release workflow](docs/RELEASING.md) for versioning and retry instructions.

## Development baseline

- Current integration checkout: sibling `../dbx-file-manager-main`, pinned main
  `14e1d4f25b7f352a0ed50edf019e698e80bcf5d9` (0.6.5), with the framework and API 1.1
  changes merged but uncommitted. See [main integration](docs/MAIN-INTEGRATION.md)
  for exact checks, browser-discovered fixes and remaining gates.
- Host checkout: sibling `../dbx-file-manager-host`, baseline
  `c26ff3f6d4bd643be8dedd659c3236af4a5bd556`, plus coordinated, uncommitted Host API 1.1 changes.
- Manifest v1, Sidecar Protocol v1, `stdio-framed`.
- Host API requirement: `>=1.1.0, <2.0.0`. The baseline alone is not sufficient.
- Backend SDK dependency is portable Git source `https://github.com/t8y2/dbx.git`,
  pinned to `c26ff3f6d4bd643be8dedd659c3236af4a5bd556` with Cargo.lock retained.
  No developer-specific absolute SDK path is required. Host API 1.1 additions are
  host/backend contract changes; SDK framing remains protocol v1.
- Node.js 22+ for metadata/harness tests; Rust and the matching DBX plugin CLI
  for building and packaging. SFTP requires Unix and local OpenSSH.

For the current integration, use the separate
[pinned-main host patch](docs/host-main-14e1d4f-api-1.1.patch) and follow the baseline
and verification instructions in [MAIN-INTEGRATION.md](docs/MAIN-INTEGRATION.md).
It includes the framework import, so no second framework patch is needed.

The earlier [Host API 1.1 patch](docs/host-api-1.1.patch) includes the host
implementation, UI, regression tests and package smoke example. It applies to a
clean DBX checkout at the exact `c26ff3f6d4bd643be8dedd659c3236af4a5bd556`
baseline, not arbitrary `main`. For sibling checkout directories:

```bash
git apply --check ../dbx-file-manager-plugin/docs/host-api-1.1.patch
git apply ../dbx-file-manager-plugin/docs/host-api-1.1.patch
```

The exported patch was checked against that baseline using a temporary Git index;
the working checkout's real index was not changed. It is retained as a historical
framework checkpoint and does not include the later main-integration fixes.
Do not apply it on top of the separate main patch. See `docs/VERIFICATION.md` for verification
commands and limits before treating the patched host as a release.

## Local checks

```bash
npm ci --prefix tests --ignore-scripts --no-audit --no-fund
node scripts/validate-manifest.mjs
node --test tests/*.test.mjs
bash -n tests/fixtures/file-manager/setup.sh
docker compose -f tests/fixtures/file-manager/compose.yaml config --quiet
```

These checks validate metadata, packaging declarations, fixture configuration and
the test harness, not a running DBX host or six protocol implementations.

## Live sidecar contract

Build the backend separately with `cargo build --locked --manifest-path backend/Cargo.toml`.
The harness does not build the backend, generate keys, or create/restart/delete containers.

```bash
DBX_FILE_MANAGER_BINARY="$PWD/backend/target/debug/dbx-plugin-dbx-file-manager-plugin" \
DBX_FM_SFTP_KEY_PATH="/absolute/path/to/existing/id_ed25519" \
node scripts/live-contract.mjs
```

It defaults to all six protocols and exercises actual framed lifecycle and
filesystem RPCs, pagination, bounded preview, no-overwrite, traversal rejection,
copy/rename, 5 MiB and zero-byte upload/download with progress and checksum, read-only reconnect,
and cleanup of its unique test directory. A failure produces a nonzero exit.
`DBX_FM_PROTOCOLS=ftp,s3` selects a partial run and cannot establish six-protocol
acceptance. See [fixture instructions](tests/fixtures/file-manager/README.md).

For the additional connection lifecycle gate, use the same executable environment
with `node scripts/runtime-contract.mjs`. It exercises concurrent/idempotent
connection creation, readonly reconfiguration, cursor invalidation and idle resume
against FTP. Timeout and idle settings remain top-level common host configuration,
not additional protocol fields in the manifest.

## Packaging boundary

`node scripts/package.mjs` runs the installed native DBX plugin CLI to build the
backend and stage the manifest, native binary,
`assets/`, `LICENSE`, and `NOTICE`. It excludes UI, tests, runtime files, and
documentation. Packaging/install/upgrade/rollback need separate acceptance evidence;
a valid manifest does not prove an installable or functional package.
Regular CI remains read-only. Tag CI grants Release write access only to the
publish job after the complete build matrix passes; no signing keys are used.

After building a candidate, verify its exact contents and checksums:

```bash
node scripts/verify-package.mjs dist/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp
```

This requires `unzip`. The CLI uses platform names such as `darwin-arm64`, not
Rust target triples. Package verification does not install or activate the plugin.
Install `@dbx-app/plugin-cli` globally, or set `DBX_PLUGIN_CLI_BINARY` to the native
CLI executable. This wrapper bypasses the npm launcher's automatic local SDK patch,
which otherwise conflicts with the locked Git SDK dependency. It removes only
`DBX_PLUGIN_SDK_ROOT` from the child environment; it never edits the SDK pin or lock.
The underlying native command remains `dbx-plugin package .` with locked release build.

The historical locally tested Mac ARM 0.1.0 candidate is
`dist/upload-fairness-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`
(7,315,673 bytes; SHA-256
`1e6d2f076949c8288359d18efd3343293c9a7e921ed75da86a6e92e7a6409f26`).
It includes append aggregation, download temporary leases and the upload-slot
scheduling fix. Earlier `append-gates`, `download-lease-gates`, `runtime-gates`
and other directories remain historical checkpoints, not current releases.
Full-six 16/256 MiB measurements, concurrent upload/download results,
package identities and Hadoop environment limits are in
[transfer acceptance](docs/TRANSFER-ACCEPTANCE.md) and `docs/VERIFICATION.md`.
The matching-code local 0.1.1 test package is under
`dist/upload-fairness-lifecycle-gates/` (SHA-256
`a0afe15daab57f5114dddfee1d11286ccad97749def90223388b3889b592c8db`).
It was built from `dist/upload-fairness-lifecycle-source/`, with only root plugin
versions changed at that checkpoint. The main source is now 0.1.1 for the tag
release. Local candidates are not automatically uploaded; Release assets are
rebuilt by GitHub Actions at the tag commit.
The matching pair passed eight real host API active-transfer upgrade/rollback
cases; GUI installation/upload remain separate. See
[lifecycle acceptance](docs/LIFECYCLE-ACCEPTANCE.md).
Trusted-signature and local custom-repository test results are recorded in
[signed acceptance](docs/SIGNED-ACCEPTANCE.md); these use temporary test keys,
not an official repository signature or release authorization.

## Safety and status

FTP is plaintext. SFTP is Unix-only; its private-key **file path** is a secret
binding, not uploaded key content. Hadoop configuration is a local absolute path
on the sidecar machine, not a remote filesystem path. Fixture credentials are
public throwaway values; never use them outside isolated local services.
The native sidecar is not an OS sandbox.
SFTP retains the source implementation's OpenSSH `Accept` known-host strategy:
new host keys are trusted on first use. Strict host-key provisioning remains a
security-hardening gate and is not established by the local fixture test.

See [contract and deviations](docs/CONTRACT.md),
[migration gates](docs/MIGRATION.md), and [verification record](docs/VERIFICATION.md).
Native picker/transfer preparation and pending steps are tracked separately in
[native acceptance](docs/NATIVE-ACCEPTANCE.md).
The pinned baseline gate is complete; the remaining migration phases still need
their full product, native-runtime and release gates evidenced.

Historical Linux/Windows candidates and their limited evidence are retained in
[platform acceptance](docs/PLATFORM-ACCEPTANCE.md). They predate the latest upload
scheduling fix. New tag builds cover all five targets; full runtime acceptance
still focuses on Mac ARM and must not be inferred from a successful build.

Apache-2.0; source attribution and commit provenance are retained in
[LICENSE](LICENSE) and [NOTICE](NOTICE).

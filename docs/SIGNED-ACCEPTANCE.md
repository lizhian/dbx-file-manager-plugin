# Signed package acceptance

Date: 2026-09-07. Real signed-package and custom-marketplace acceptance passed on
the macOS ARM64 Web host. This is test-fixture trust, not official DBX Store approval
or a production release. Native UI and other platform gates remain separate.

## Trust and isolation

The helper creates a fresh Ed25519 key pair using Node's crypto API for each run.
The private seed is passed only to the official DBX packager's signing subprocess
environment. It is not written to a key file, package, source repository or report.
Only the key ID and public key are recorded. No existing private keys are read.

Signed copies are generated from the unchanged real 0.1.0 and test-only 0.1.1
candidates using `dbx-plugin-packager sign`. Each run starts a new password-protected
Web backend with its own temporary data directory and a custom repository server
bound only to 127.0.0.1. Trust changes apply only to that generated profile.

The temporary trusted key and repository are removed at completion. The fixture
remote directory is deleted and verified absent, and both test servers stop.
The pending native profile, existing Web previews and original trust stores are
not modified by these runs.

## Reproduce

Build the packager from the main integration checkout:

```bash
cargo build --offline --locked --manifest-path plugins/sdk/packager/Cargo.toml \
  --bin dbx-plugin-packager
```

Run from the independent plugin repository with Node 22 first on PATH. Use actual
absolute executable paths under the Cargo target directories selected at build time:

```bash
DBX_LIFECYCLE_SIGNED=1 \
DBX_PLUGIN_PACKAGER_BINARY=/absolute/path/to/debug/dbx-plugin-packager \
node scripts/host-lifecycle-contract.mjs \
  /absolute/path/to/debug/dbx-web \
  "$PWD/dist/runtime-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp" \
  "$PWD/dist/lifecycle-gates/io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp"
```

The harness also requires POSIX `ps`, `sqlite3`, `zip`, `unzip` and the disposable
FTP fixture. It uses `scripts/signed-package-fixture.mjs`; it does not replace the
host's signature verifier, installer, marketplace downloader or sidecar runtime.

## Verified behavior

- A signed package with an unknown key is rejected even when development-mode
  installation is requested. No plugin is installed by that failed request.
- A key ID cannot silently be reused for different public-key bytes.
- A trusted, signed 0.1.0 package installs with strict signature policy. The host
  reports the exact trusted key ID and signed package hash; its real sidecar connects.
- The custom repository serves a real signed 0.1.1 artifact. Catalog publisher,
  permissions and signing-key-ID mismatches are independently rejected with the
  expected binding errors. The existing PID and remote file remain usable.
- A correct catalog upgrades to 0.1.1 through the marketplace route. The old
  sidecar is paused by the test, and the activation-record/PID probe confirms it
  exits before the new version is published. Reconnection and rollback succeed.
- A signature-byte mutation is rejected by cryptographic verification, even in
  development mode. The ZIP entry and CRC are rebuilt, so this is not merely an
  archive-corruption test. Removing the trusted key rejects subsequent admission;
  it does not retroactively stop an already-running installed plugin.
- Connection/Secret retention, missing-rollback protection, bad archive rejection,
  strict unsigned-package rejection, crash recovery, host restart, reference-aware
  uninstall and scoped remote cleanup also pass in this signed workflow.

Final report, 14 passing stages:
[signed marketplace lifecycle](evidence/host-lifecycle-5a7c280d-db56-40de-917c-67af207e5df4.json).
It includes the host executable hash, unchanged unsigned input hashes, test public
key and signed-copy hashes. Fresh keys mean signed-copy hashes differ between runs.

The earlier [signed run](evidence/host-lifecycle-12693629-df4c-4f97-84f3-25667f320438.json)
passed before adding permissions/key-ID catalog cases. The subsequent
[unsigned regression](evidence/host-lifecycle-ea0803a3-a296-4cfe-9842-f4a3ccd495e3.json)
passed all nine existing stages. All 39 metadata/framing tests also passed.

These checks do not establish official repository availability, source review,
production key distribution/rotation, OS sandboxing, active-transfer cleanup during
upgrade, native picker interaction, or a Linux/Windows release matrix.

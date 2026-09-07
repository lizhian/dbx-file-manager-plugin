# Platform acceptance

**Scope update, 2026-09-07:** the user requires macOS ARM64 validation only.
Linux/Windows are excluded from further validation and completion gates. Reports
below are historical, not outstanding work orders. They predate the latest
upload-slot scheduling fix and do not cover that production change.

Date: 2026-09-07 (Asia/Shanghai). Overall migration remains incomplete.

## Windows x64 download-lease refresh

Current plugin source, including download lease fields and validation, passed
the six-step Windows GNU cross pipeline with unchanged source fingerprints.
The source manifest, Cargo metadata and every backend Rust file match the Linux
lease refresh below. No Windows program or test was executed.

- Candidate: `dist/windows-x64-lease-cross/io.github.lizhian.file-manager-0.1.0-windows-x64.dbxp`.
- Package: 11,746,306 bytes; SHA-256
  `68249d9aadf3985399a24cf599e4fc9c94683085ef86ecc0e28ec66c947371f6`.
- Executable: 33,073,044 bytes; SHA-256
  `3c1a231949d9c8efca6318f187c9bdc4f8b9980598ab2fd9ea4a82cb66f3c886`.
- `check --all-targets`, clippy with warnings denied, release link, test link,
  PE32+/AMD64 inspection and static imports all exited zero. The known SDK
  template scan diagnostic remains in logs; it did not fail these commands.
- Packaging used the same previously verified DBX low-level packager binary;
  its hash is in provenance. The packager controller verified current source
  hashes against the cross report, then verified the executable identity before
  staging. Exact package members, manifest parity, license and checksums passed.
- The separate container mounted the already-verified filtered Linux source
  snapshot read-only, artifacts and existing build caches. No key, runtime data,
  Docker socket or host network was mounted. It exited zero and was removed.
- Old platform packages are unchanged. Source version is still 0.1.0; this is a
  separate unsigned review artifact, not an upgrade release or publication.

Evidence: [cross report](evidence/windows-lease-cross-453239be/cross-report.json),
[packaging provenance](evidence/windows-lease-cross-453239be/cross-provenance.json),
and [artifact metadata](evidence/windows-lease-cross-453239be/io.github.lizhian.file-manager-0.1.0-windows-x64.artifact.json).
Raw logs and the executable remain under
`dist/windows-lease-cross-check/artifacts/453239be-b640-4435-bd3f-b0791cb7b491/`.

`runtimeVerified` deliberately remains false. Native Windows non-SFTP protocol
operations, local publication/path behavior, host installation and GUI/lifecycle
are still required. SFTP remains excluded on Windows by the existing Unix-only
implementation boundary; cross-compilation does not change that scope.

## Linux ARM64 download-lease refresh

The current plugin source, including the optional download-temporary-lease
contract, was rebuilt and exercised in the same pinned Linux tooling image.
The earlier Linux candidate below is retained, not overwritten.

- Candidate: `dist/linux-arm64-lease-gates/io.github.lizhian.file-manager-0.1.0-linux-arm64.dbxp`.
- Package: 7,885,559 bytes; SHA-256
  `203115a444e275045111b611d5b9d93c556ef54609527c196a4511c9dfc6db3e`.
- Extracted executable SHA-256:
  `424448d5d65178580dae7a7e6c0c4d8c31134d7275b29d7a676e555bf6fc23ba`.
- All 17 pipeline stages passed: 53 Node tests, 35 Rust tests and the separately
  enabled live test, fmt, clippy, actual native CLI release packaging, exact
  package verification, ELF/loader inspection, six-protocol 5 MiB/zero-byte and
  16/256 MiB bidirectional transfers, FTP runtime, eight WebDAV interruptions and
  five-connection/15-task admission, cancellation cleanup and retries.
- Rust coverage includes leased publication/no-clobber, invalid lease authority,
  and lease cancellation/timeout. Direct protocol scripts remain Sidecar tests;
  they do not exercise Linux host ownership or forced-stop lease reclamation.
- Manifest, Cargo metadata and every backend Rust source hash match the current
  repository after the run. The archived package was verified again on the host.
  No production source, manifest version, SDK pin or existing package changed.
- The filtered snapshot and artifact root are `dist/linux-arm64-lease-check/`;
  raw step logs are under `artifacts/3686c995-6c11-4b45-a4a5-5d82272337c2/`.
  The container `dbx-file-manager-linux-arm64-lease-check` exited zero and was
  removed. Existing fixture services were not restarted; the old unrelated
  Hadoop DataNode remains unhealthy and was not used.
- The existing SFTP fixture key was mounted read-only, never copied into source
  or artifacts. Tooling/cache mounts and native Hadoop endpoints match the
  isolation instructions below, using a separate snapshot/artifact directory.
- The known SDK-template placeholder diagnostic still appears during Cargo
  discovery, while the actual test, lint and package commands exit zero.

Evidence: [pipeline/source report](evidence/linux-arm64-lease-3686c995/platform-report.json),
[resource report](evidence/linux-arm64-lease-3686c995/transfer-resource-22069b7b-53cc-4b60-a574-c30c00ec98ff.json),
and [interruption/concurrency report](evidence/linux-arm64-lease-3686c995/transfer-interruption-b64a8407-770c-492f-9b5b-8f2698f51174.json).

Linux host installation, GUI, native dialogs and active-transfer upgrade/rollback
remain unverified. This unsigned GNU/Linux ARM64 package is not a release, an
Alpine/musl package, or a claim of support for every Linux distribution. Windows
now has a current-code cross candidate above, but still needs actual runtime acceptance.

## Windows x64 cross-compilation checkpoint

**No Windows executable or test was run on Windows in this checkpoint.** This
checks compilation, linking, binary format and packaging only. SFTP remains
excluded by the existing Unix-only dependency/configuration branch; the remaining
five protocol implementations compile for `x86_64-pc-windows-gnu`.

The isolated Linux ARM64 tooling container used Rust 1.98.0 and Debian MinGW-w64
GCC 12.2. It added the Windows GNU Rust standard library without changing the
macOS toolchain, plugin source or Cargo.lock. No private key or service data was
mounted. Tooling image:
`sha256:522ff7748dd69d2b0cb9a26e9f5fa092c9f505cd7499407f4de2902b9445a311`.

Six steps passed twice: `cargo check --all-targets`, clippy with warnings denied,
release compilation/linking, `cargo test --no-run`, PE format inspection and
static import inspection. The test executables were linked, not executed.
The emitted backend is a PE32+ AMD64 console executable rather than a Linux
binary with a Windows filename. The static import table names Windows system
DLLs; that does not prove availability on a particular Windows release or rule
out optional dynamically loaded dependencies.

Cross-compiled candidate:
`dist/windows-x64-cross/io.github.lizhian.file-manager-0.1.0-windows-x64.dbxp`.

- Package size: 11,751,890 bytes.
- Package SHA-256: `7c77d132ef5eca41d6bf2ef6b319e7d69c7851647474c183e618289cc8f6946c`.
- Executable size: 33,067,835 bytes.
- Executable SHA-256: `69c3ff00eee58e4359ad42e0802e5227e33dad464acf8dbef46a11a4d823456d`.
- [Cross report](evidence/windows-cross-995e2178/cross-report.json) retains source
  fingerprints and every step's exit code; `sourceUnchanged` is true and
  `runtimeVerified` is false.
- [Packaging provenance](evidence/windows-cross-995e2178/cross-provenance.json)
  and [artifact metadata](evidence/windows-cross-995e2178/io.github.lizhian.file-manager-0.1.0-windows-x64.artifact.json)
  bind the package to the checked executable.

The normal CLI correctly refuses to build a native package for a platform other
than its build host. `scripts/package-windows-cross.mjs` therefore uses the
separate, official low-level packager with explicitly staged Windows content;
it does not claim a native Windows CLI run. Before packaging, it verifies the
successful cross report, current source hashes, executable hash/size and PE
header. It stages only the executable, manifest, plugin icon and license/notice,
then runs the existing exact-member/checksum/manifest package verifier. The
source manifest and existing macOS/Linux packages are untouched.

`scripts/windows-cross-check.mjs` is repeatable inside the container defined by
`tests/platform/windows-cross/Dockerfile`, after building the Linux tooling image
described below. Mount a prefiltered source snapshot at `/source` read-only,
an output directory at `/artifacts`, a crate cache at `/cargo-cache` and a separate
Windows target cache at `/cargo-target`; no key mount or host networking is
needed. The runner creates and removes its own temporary workspace. Both runs'
raw logs and executables remain under `dist/windows-cross-check/artifacts/`;
the accepted repeat run is `995e2178-a26d-48e8-aee3-17db206795a1`. Verbose objdump
output is kept in its log rather than replayed to the console.

Packaging invocation, with absolute paths, from the plugin repository:

```bash
node scripts/package-windows-cross.mjs \
  "$PWD/dist/windows-cross-check/artifacts/995e2178-a26d-48e8-aee3-17db206795a1" \
  "$PWD/dist/a-new-windows-candidate-directory" \
  /absolute/path/to/dbx-plugin-packager
```

The output directory must not already exist. The new PE-format and container
entry guards have unit tests; the latest host Node suite passed 52 tests. GNU
cross-compilation does not establish Windows installation, protocol runtime,
Secret handling, local-path behavior, UI or upgrade/rollback acceptance. Those
runtime gates remain open. MSVC was not used; it is not an additional requirement
for this GNU candidate. This unsigned candidate is not a release.

## Linux ARM64 checkpoint

The plugin was compiled and executed natively inside a Debian 12 ARM64 container,
not cross-compiled and assumed to run. Tooling image:
`sha256:756b23ec2be0519898350eed485249b277865843c288ea2bd8eaacfbdd379317`.
Rust `1.98.0 (88d9e12ae 2026-08-18)`, Node `22.13.0`, DBX plugin CLI `0.1.0`.
Both Docker base images are pinned by manifest digest. The macOS toolchain was
1.98.1; the Linux run retained the same locked dependencies and plugin sources.

Candidate: `dist/linux-arm64-gates/io.github.lizhian.file-manager-0.1.0-linux-arm64.dbxp`.

- Size: 7,878,874 bytes.
- Package SHA-256: `bdb38bba9fbc8730db9b7612e40bf8c3e70ccdcbd45d97281dcd8be035596f6e`.
- Extracted executable SHA-256: `4b7eca155b536f6af52ebfa1502b64ce941ae9f94e71e6ca45e9bdc85b58f819`.
- `file` confirmed ARM aarch64 ELF with `/lib/ld-linux-aarch64.so.1` interpreter.
- `ldd` resolved the loader, libc, libm and libgcc_s. This is a GNU/Linux package,
  not a musl/Alpine build or proof of compatibility with every glibc version.
- SFTP additionally requires the external OpenSSH client. The image provides it;
  the plugin package does not bundle an SSH executable.
- The package remains an unsigned development candidate requiring the matching
  Host API 1.1 integration; it is not approved for publication or a stock-host
  compatibility claim.

All 17 recorded pipeline stages exited zero:

| Gate | Result |
| --- | --- |
| Metadata and Node tests | Manifest validation and 49 tests passed |
| Backend | 32 tests passed; one live test enabled separately and passed |
| Rust quality checks | Format and clippy with warnings denied passed |
| Actual CLI package | Locked release build, exact member allowlist, metadata and checksums passed |
| Six-protocol contract | Filesystem behavior, 5 MiB and zero-byte transfers, readonly and cleanup passed |
| FTP runtime | Registry, connection replacement, idle resume and reconnect checks passed |
| Six-protocol resources | 16/256 MiB upload/download checksums, progress and sampled RSS passed |
| WebDAV interruption | Eight real-network interruption cases and five-connection 8/2 admission/recovery passed |

Evidence:

- [Pipeline report and source hashes](evidence/linux-arm64-e7406916/platform-report.json).
- [Resource measurements](evidence/linux-arm64-e7406916/transfer-resource-2178c724-505f-415e-94e1-3c18044fe4b2.json).
- [Interruption and concurrency](evidence/linux-arm64-e7406916/transfer-interruption-b0ea4ef0-eead-47c2-bf6b-72078ee26920.json).

Raw per-step logs remain under
`dist/linux-arm64-check/artifacts/e7406916-543d-4063-9b3e-3a6ed3394a2d/`.
The copied pipeline report's log names refer to that directory. The original
package and extracted payload are preserved there as well as in the convenient
`dist/linux-arm64-gates/` location. Package verification was repeated after copying.
Cargo emitted the already-known unexpanded SDK-template discovery diagnostic;
the actual build, test and clippy commands all exited zero.

The 256 MiB sampled peak RSS ranged from about 13.5 to 36.0 MiB across these
sequential transfers. WebHDFS upload took 35.44 seconds on the separate native-Java
Hadoop fixture. These local samples are not concurrent memory/load acceptance or
production performance guarantees.

## Isolation and reproduction

`scripts/linux-platform-check.mjs` requires explicit Linux container context. It
copies a prefiltered read-only source snapshot into a fresh temporary workspace,
runs the checks, exports per-step logs and structured reports, and removes its
temporary workspace. It hashes all backend Rust sources, Cargo metadata and the
manifest before and after testing; `sourceUnchanged` was true. The Docker tooling
image contains tools only, not the repository or its runtime data.

The actual run mounted the staged source and existing fixture key read-only.
Only the artifact directory and two new container cache volumes were writable.
The key was not copied into the snapshot, image or package. The test container was
removed after completion; remote fixture directories and test processes were
cleaned. Existing services were not restarted, and the macOS package was unchanged.

From the plugin repository, with all six disposable fixtures available and the
native-Java Hadoop profile running:

```bash
docker build -t dbx-file-manager-linux-check:rust-1.98-node-22 tests/platform/linux
mkdir -p dist/linux-arm64-check/source dist/linux-arm64-check/artifacts
git ls-files --cached --others --exclude-standard -z -- \
  backend assets scripts tests .github .gitignore LICENSE NOTICE manifest.json dbx-plugin.toml \
  | tar --null -T - -cf - | tar -xf - -C dist/linux-arm64-check/source

: "${DBX_FM_SFTP_KEY_PATH:?Set an absolute path to the existing fixture key}"
docker run --rm --name dbx-file-manager-linux-arm64-check --network host \
  --mount "type=bind,src=$PWD/dist/linux-arm64-check/source,dst=/source,readonly" \
  --mount "type=bind,src=$PWD/dist/linux-arm64-check/artifacts,dst=/artifacts" \
  --mount "type=bind,src=$DBX_FM_SFTP_KEY_PATH,dst=/run/dbx-fixture-key,readonly" \
  --mount type=volume,src=dbx-file-manager-linux-arm64-cargo,dst=/cargo-cache \
  --mount type=volume,src=dbx-file-manager-linux-arm64-target,dst=/cargo-target \
  -e DBX_FM_SFTP_KEY_PATH=/run/dbx-fixture-key \
  -e DBX_FM_WEBHDFS_ENDPOINT=http://127.0.0.1:19870 \
  -e DBX_FM_HDFS_NAME_NODE_URI=hdfs://127.0.0.1:19100 \
  dbx-file-manager-linux-check:rust-1.98-node-22
```

Inspect the staged snapshot before mounting it: no runtime directories, private
keys, signing files, build targets or node_modules should be present. A previously
tracked secret is not excluded by Git's ignore rules; do not include one. Use a
fresh staging directory when source files have been removed, to avoid stale copies.
Never mount the whole working repository or Docker socket as a shortcut. This run
used OrbStack host networking; other Docker environments must provide equivalent
loopback reachability, including FTP passive ports and advertised Hadoop ports.
New cache volumes are retained for subsequent builds, not automatically pruned.

## Remaining platform gates

- Linux DBX host installation/lifecycle and desktop GUI, including native dialogs,
  have not been tested by this sidecar-only container pipeline.
- macOS native picker/transfer acceptance remains separate from its existing Web,
  backend and package evidence.
- Windows non-SFTP runtime and host validation remain outstanding; GNU x64
  cross-compilation is recorded above. Other CPU architectures
  have no evidence from these runs.
- Actual interruption for the five non-WebDAV protocols, concurrent resource/load
  tests, native active-transfer upgrades, remaining host-workspace failures and
  release/signing review are not closed by this checkpoint.

No platform phase is marked complete solely because the Linux package builds or
these direct protocol tests pass. No commits, pushes or publication were performed.

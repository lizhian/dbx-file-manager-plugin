# Transfer acceptance

Date: 2026-09-07 (Asia/Shanghai). Status: incomplete.

## Upload slot scheduling fix

Follow-up revalidation of the same new Mac ARM candidate passed all six protocols'
16/256 MiB bidirectional transfers, checksums, progress, sampled RSS and cleanup:
[resource report](evidence/transfer-resource-fb8cdea3-1524-47e8-89c1-816db86c99ff.json).
Eight real host active-transfer replacement cases also passed, including forced
termination; see LIFECYCLE-ACCEPTANCE.md. These are scoped to the recorded candidate
and do not establish GUI upload or full workflow acceptance.

Uploads retain one mutation lock per connection, so five connections should
provide five active upload streams, not eight. The initial eight-stream harness
expectation was incorrect; the corrected five-stream regression still failed on
the previous release. Waiting uploads acquired global permits before the mutation
lock, reserving all eight slots across only four connections.

`backend/src/transfer.rs` now acquires the global permit after the mutation lock,
preserving serialization, limits, cancellation and publication protection. The
new unit regression holds the mutation lock and queues two uploads: before the
fix six global slots remained; afterward all eight remain free. Both uploads
must complete after lock release. Full backend: 36 passed / one ignored, with
live separately enabled and passed. Clippy/fmt and 53 Node tests passed.

New candidate: `dist/upload-fairness-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`.
Size 7,315,673 bytes, SHA-256
`1e6d2f076949c8288359d18efd3343293c9a7e921ed75da86a6e92e7a6409f26`.
Its extracted executable passed package verification, six-protocol basic/5 MiB/
zero-byte contract and two full interruption/concurrency runs. Each run checks
eight interruptions, cancellation/retry, 15 downloads and 15 uploads, all hashes,
RSS and cleanup. First upload batch: peak 42,647,552 bytes, 30 in-flight samples.
Each uploaded object is independently downloaded for checksum comparison.

- [Corrected pre-fix failure](evidence/transfer-interruption-98c434ea-cbab-41e5-96c1-061dc18c0f6f.json)
- [First fixed run](evidence/transfer-interruption-8b05634c-16ea-403b-a821-07fb8a335f89.json)
- [Repeat fixed run](evidence/transfer-interruption-1aeedf3a-acf9-49ee-83ac-f35f0746d065.json)

Earlier failures `2af2ead0` and `6c1f4493` retain the initial eight-stream
expectation; all failed-run reports record cleanup. Scope is now Mac ARM only per
user direction. Existing platform packages are unchanged and lack this fix.
Native new-package lifecycle, GUI upload and other protocol interruption gates
remain open. Sampled warmed-process RSS is not a sustained-load guarantee.

## Concurrent completion and memory sampling

The interruption harness now follows cancellation and sequential recovery with
a second batch of 15 downloads across five connections. It holds eight active
HTTP streams at the proxy before releasing them, then lets active and queued
work finish. All 15 local results must match the 32 MiB seed checksum. It checks
terminal snapshots, file cleanup and Sidecar RSS while work is still running.
The configured RSS-growth ceiling is 128 MiB for this 480 MiB aggregate workload;
this is a regression budget, not a universal production memory limit.

Two real macOS runs passed against the extracted, unchanged
`dist/download-lease-gates` candidate. Both also reran all eight interruption
cases, admission/cancellation and five-connection recovery checks. The first
completion batch recorded a baseline of 23,658,496 bytes and peak 39,632,896 bytes
with 14 samples, 12 while running. All 15 checksums matched. Both reports verify
remote/local cleanup, Sidecar exit and proxy closure.

- [First run](evidence/transfer-interruption-d93ac598-743f-4656-b079-a17d75dbd31c.json)
- [Repeat run](evidence/transfer-interruption-b5923ca5-352c-40cb-8db3-d482408a0ff9.json)

The report records the executable and harness hashes; these match the tested
inputs. The existing 53 Node tests also pass. No plugin production code or
candidate package changed. The proxy/server's own memory is not included in
Sidecar RSS. The baseline is a warmed process after earlier transfers, and
sampling can miss short peaks. This is bounded WebDAV download evidence, not
cold-start, sustained-load, concurrent-upload, six-protocol or Windows evidence.
Earlier Linux reports used the older harness and do not include this new batch.

Active WebDAV upload/download upgrade and rollback now have four real host-API
cases, repeated successfully with the unchanged macOS package. They verify pool
drain, cancellation, old-PID-before-publication ordering, target/Secret retention
and retry. See [lifecycle acceptance](LIFECYCLE-ACCEPTANCE.md); forced-stop recovery,
other protocols and native picker/desktop interactions remain separate.

The latest [Linux ARM64 platform checkpoint](PLATFORM-ACCEPTANCE.md) repeats the
full-six 16/256 MiB measurements and eight WebDAV interruption/five-connection
concurrency checks with a native Linux executable. The macOS evidence below stays
scoped to its original package and runtime; neither establishes desktop GUI or
Windows acceptance.

## Live WebDAV interruption and concurrency

The unchanged `dist/append-gates` release Sidecar now has real HTTP fault-injection
evidence, beyond Memory-accessor tests. `scripts/transfer-interruption-contract.mjs`
places a loopback-only proxy between it and the existing WebDAV fixture. The proxy
pauses after forwarding part of a 32 MiB body. Its writes and COPY/MOVE destinations
are restricted to the current run's UUID namespace; connections/profiles remain
ephemeral. No existing server is reconfigured or restarted.

Eight cases passed: upload and download, each with explicit cancellation, a
one-second task deadline, a transport reset, and connection disconnect. Every case
requires nonzero partial application progress before interruption, the expected
terminal state and error code, a matching terminal event, incomplete HTTP-body
closure, original-destination preservation despite overwrite authorization, no
temporary upload/download files, and successful checksum-verified retry. The
disconnect cases reconnect before retry; other cases reuse the existing session.

The same script also opens five real connections and starts 15 downloads. It
observes eight running and seven queued tasks, at most two running per connection,
eight paused HTTP responses and eight local temporary files. All 15 tasks cancel;
all temporary files disappear, and all five connections successfully download and
verify the full source again. This proves the exercised admission/recovery behavior,
not concurrent peak-memory scaling or all possible cancellation races.

Evidence:

- [Eight interruption cases](evidence/transfer-interruption-f241209a-6131-40ca-bf49-5dce8110b3cf.json).
- [Interruption plus concurrency](evidence/transfer-interruption-eef5291d-3c1e-4c00-8e83-70681437d9d8.json).
- [Repeat run](evidence/transfer-interruption-738aa8e3-4461-43e5-99a3-855669cb3396.json).
- [Final namespace-guarded run](evidence/transfer-interruption-5c9bf402-3ae8-4dd7-b6f9-1b58d9138200.json).

The latest Node suite passed 47 tests, including seven proxy regressions. Run from
the plugin repository with the usual absolute `DBX_FILE_MANAGER_BINARY` and Node
22 PATH, then `node scripts/transfer-interruption-contract.mjs`. This harness is
WebDAV-specific. It does not establish actual FTP/SFTP/S3/Hadoop interruption,
native UI, active-transfer upgrades, cleanup-denial behavior or a platform matrix.
Production Rust source and the accepted package were not changed in this checkpoint.

### Harness failures retained

The initial proxy incorrectly parsed double-slash HTTP paths and then rewrote a
double-slash MOVE destination as an authority. The latter put the known 32 MiB
test payload at the fixture's `/source.bin` instead of the run directory. It was
removed only after length, SHA-256 and modification-time verification, using an
ETag-conditional DELETE; the exact run directory was separately cleaned through
the Sidecar. [Follow-up cleanup record](evidence/transfer-proxy-cleanup-f20ca8fe.json)
supplements, rather than overwrites, the original failed artifact. Path-preserving
URL updates, double-slash regressions and the write-namespace guard now cover this.

Earlier runs also required a paused readable to close before draining bytes
already queued ahead of EOF. The recorded queue was nonempty, so that assertion
did not establish a plugin defect. The corrected test first obtains the terminal
RPC state, then releases in-flight bytes and verifies incomplete HTTP closure and
absence of late temporary files. It accepts either Node's abort flag or an already
destroyed socket, while always requiring `sourceComplete == false`; these flags
can update in different event-loop turns. Failed records remain available, and
their cleanup outcomes are not converted into passing acceptance claims.

## Latest append-buffer checkpoint

The latest candidate is `dist/append-gates/io.github.lizhian.file-manager-0.1.0-darwin-arm64.dbxp`
(7,300,605 bytes), package SHA-256
`3257a59b2ff14359eeac06451ba6c2c119c0e1565c657d53b0001da8aad9f118`.
Extracted release binary SHA-256:
`a08a4c99019bb66055ecb08098ecb525a1a71798a0a726954518664e90f055e8`.
Older candidates and failed runs below are retained, not relabeled as passes.

Upload and streaming-copy writers now aggregate fixed 4 MiB chunks for backends
with `write_can_append && !write_can_multi`. Local/remote read loops still use
64 KiB buffers. This bounds aggregation independently of total file size and
reduces WebHDFS APPEND round trips in both temporary upload and copy publication.
It does not change default overwrite protection, deadlines or cancellation.

The count-based regression asserts exact 4 MiB batches and final partial chunks,
including copy publication and standalone copy fallback. Cancellation tests now
exercise eight combinations: cancel/deadline, FTP close/non-FTP abort, and
buffered/unbuffered writers. Memory accessors model capabilities here; they do not
prove actual protocol cancellation or resident-memory bounds.

Validation: 32 backend tests passed, the one ignored live test was explicitly
enabled and passed, clippy/format passed, and 40 Node tests passed. Actual package
contents/checksums passed. The new payload also passed the full six-protocol
5 MiB/zero-byte contract and FTP registry/runtime smoke. The pinned-main saved
gateway test passed with `--lib --no-default-features --features sqlite-bundled`.
The initial host command without `sqlite-bundled` failed to link the system
SQLite extension symbols; this was a command configuration error, not a passing
test or a reason to change host code.

Nine-stage Web lifecycle acceptance passed with the new 0.1.0 candidate and the
existing test-only 0.1.1 fixture:
[lifecycle evidence](evidence/host-lifecycle-c2d22c5a-21cf-4b6d-ac50-e795c0b6f75d.json).
The 0.1.1 fixture still contains the older backend; this validates version switching
and rollback to the new 0.1.0 payload, not a newly built 0.1.1 release or signed
acceptance of this new candidate.

### Resource result on native-Java Hadoop

[Full-six resource pass](evidence/transfer-resource-44e05d67-7237-4e08-8768-15b5612fed7c.json)
used the unchanged four original protocol endpoints and the separate native-Java
Hadoop fixture described in the fixture README. All six 16/256 MiB round trips
passed, including checksums, monotonic progress, sampled RSS, remote/local cleanup
and child-process closure. This is macOS ARM64 plugin evidence, not Linux plugin
or native desktop UI acceptance.

| Protocol | 256 MiB upload time | Upload peak RSS | Download peak RSS |
| --- | --- | --- | --- |
| FTP | 0.48 s | 26.8 MiB | 28.9 MiB |
| SFTP | 1.12 s | 15.0 MiB | 19.1 MiB |
| S3 | 1.86 s | 41.2 MiB | 43.0 MiB |
| WebDAV | 0.52 s | 16.8 MiB | 19.5 MiB |
| WebHDFS | 32.44 s | 45.8 MiB | 46.4 MiB |
| HDFS Native | 4.11 s | 60.0 MiB | 60.3 MiB |

### Failure and fixture diagnosis

- [Old release reproduced failure](evidence/transfer-resource-419bd02d-a2a0-4ec8-bc18-93c0613d455c.json):
  16 MiB uploaded, publication timed out at 120 seconds, returning `partial_transfer`
  with cause `timeout`. The improved harness now retains these sanitized codes.
- [Intermediate 1 MiB buffer](evidence/transfer-resource-a1dc8e42-2647-4684-b71f-d500600d9bc7.json):
  16 MiB upload completed in 12.19 seconds; 256 MiB publication still timed out.
  This intermediate package is retained under `dist/transfer-gates/`, SHA-256
  `b4a9b248a4f2ea344713472cf792f1783942e5304f430f0138198696d87db0ab`.
- [4 MiB buffer on old Hadoop](evidence/transfer-resource-6abdb224-7dc0-487b-be0c-b21e74d4bca7.json):
  16 MiB completed in 3.37 seconds, but 256 MiB publication stalled and timed out.
  DataNode logs stopped during an APPEND around 48 MiB into the copy destination.
  Its JMX health checks subsequently timed out repeatedly, while Docker's label
  remained temporarily `healthy` because the old configuration allows 60 retries.
  Both `jstack` and `jcmd` failed to attach to its JVM within 10.5 seconds.
- The stalled service uses amd64 Java under emulation. No existing container was
  restarted. A distinct `dbx-plugin-native-hadoop` project uses Hadoop 3.4.3 Java
  classes on Temurin 11.0.32 aarch64, new ports and separate volumes. The same
  4 MiB candidate passed the full-six matrix there. This comparison does not
  distinguish an emulation issue from a JVM-version issue or prove the old JVM's
  exact failure cause.

The original NameNode is still untouched; its historical startup command formats
metadata and must not be restarted. The old stalled DataNode remains preserved.
Do not treat it as an available endpoint based solely on Docker's health label.

## Deterministic interruption coverage

This section and the original measurements below describe the earlier checkpoint;
the latest counts, candidate and remaining gates are recorded above and below.

`backend/src/tests.rs` now pauses the second raw remote write after the first
buffer has been acknowledged. The four upload cases cover explicit cancellation
and deadline expiry with both FTP's close-before-delete cleanup and the non-FTP
abort-before-delete path. Assertions check:

- Nonzero partial progress, distinct cancelled/failed states and stable error codes.
- The existing destination remains byte-identical despite overwrite authorization.
- No remote temporary object remains after task termination.
- All global and per-connection permits return.
- A subsequent upload on the same session succeeds and its checksum-equivalent
  byte comparison matches the complete source.

These are Memory-accessor fault-injection tests, not actual FTP/S3 transport
cancellation evidence. Existing tests also cover active download cancellation,
queued deadlines, shutdown cleanup, and global-eight/per-connection-two limits.

Commands run in `backend/`:

```sh
cargo test --locked --offline
cargo test --locked --offline live_native_listing_regression -- --ignored --nocapture
cargo clippy --locked --offline --all-targets -- -D warnings
cargo fmt -- --check
```

Results: 31 unit tests passed, one live test ignored by default and then explicitly
enabled and passed; clippy and formatting passed. Cargo still prints the known
unexpanded Rust-template manifest discovery diagnostic in its pinned SDK checkout,
but each command above exited zero. No SDK cache or dependency pin was changed.
The separate Node 22 metadata/framing suite passed all 39 tests.

## Original release-payload measurements

New harness: `scripts/transfer-resource-contract.mjs`. It uses the existing
protocol fixture configuration and framed RPC client. Local payload generation
and checksum calculation stream fixed-size chunks; file bodies never enter JSON.
Every protocol gets a fresh Sidecar process. Sizes are 16 MiB and 256 MiB, each
uploaded and downloaded, with SHA-256 parity and monotonic status/event checks.
Resident memory is sampled with `ps`; sampling waits at least 20 ms plus probe/RPC
time. The 256 MiB case requires at least three samples and less than 64 MiB extra
peak RSS relative to the corresponding 16 MiB case.

Tested binary: extracted `dist/runtime-gates` darwin-arm64 release payload.
SHA-256: `c251a3b7538674b3abf768f27d13d44e5db40d74a4c8e55668a20be7a4d31ac2`.
Its package remains unchanged, SHA-256
`7b94a3332c0aaae426dcfed27f2072e67d38a5052bbea5d8925c70ee24abc94e`.

| Protocol | 16/256 MiB round trips | 256 MiB upload peak RSS | 256 MiB download peak RSS |
| --- | --- | --- | --- |
| FTP | Passed | 27.5 MiB | 27.6 MiB |
| SFTP | Passed | 14.7 MiB | 17.9 MiB |
| S3 | Passed | 44.4 MiB | 45.4 MiB |
| WebDAV | Passed | 17.0 MiB | 19.6 MiB |
| WebHDFS | Failed at first 16 MiB upload | Not established | Not established |
| HDFS Native | Passed in separate targeted run | 41.0 MiB | 41.1 MiB |

Evidence:

- [Initial FTP/WebDAV pass](evidence/transfer-resource-485baedb-891f-4e28-b148-226b524e3beb.json).
- [Full-six attempt, failed at WebHDFS](evidence/transfer-resource-946a2b30-0f2f-4cba-9912-afd4f60c797a.json).
- [HDFS Native targeted pass](evidence/transfer-resource-e9591f87-eb4e-41df-8533-cf9a5dc5d2a0.json).

The full-six attempt exited one, not a six-protocol pass. The first four protocols
completed; HDFS Native was not reached in that run and was tested separately.
The WebHDFS upload returned terminal `failed` after roughly two minutes. This
harness revision did not retain its structured failure code, so a timeout or
specific remote error is not established by the saved artifact. DataNode logs
showed ongoing 64 KiB APPEND requests; per-request overhead is a diagnosis lead,
not a proven root cause. The original five-MiB contract does not close this gap.

All three runs confirmed exact test-directory cleanup and child-process closure.
The failed WebHDFS run also confirmed cleanup. No NameNode/DataNode or existing
four-protocol service was restarted, and no private key content was read/copied.

Example, from the plugin repository (uses disposable local fixtures):

```sh
export PATH="$HOME/.local/share/mise/installs/node/22.13.0/bin:$PATH"
export DBX_FILE_MANAGER_BINARY="$PWD/dist/runtime-gates/extracted/bin/darwin-arm64/dbx-plugin-dbx-file-manager-plugin"
DBX_FM_PROTOCOLS=ftp,webdav node scripts/transfer-resource-contract.mjs
```

Full selection is `ftp,sftp,s3,webdav,webhdfs,hdfs-native`. SFTP requires
`DBX_FM_SFTP_KEY_PATH` pointing to an existing fixture key; only its path is passed.
Failed runs produce a JSON report and nonzero exit rather than silently skipping
protocols. Cleanup first cancels/waits for any still-active task, deletes only
known run-specific objects and refuses to remove a nonempty test directory.

## Remaining gates

- Longer-running Hadoop stability and the exact old JVM stall cause; the new
  native-Java fixture's successful finite run is not a production reliability claim.
- Actual interruption and active-transfer replacement on the other five protocols,
  cleanup-denial cases and forced-stop recovery; WebDAV's graceful path cannot
  substitute for these.
- Concurrent multi-connection memory/load measurements and longer-running samples.
- Native picker authorization, desktop upload/download, and platform matrix.

Sampled RSS in these local sequential runs supports bounded behavior over the
tested sizes, not a proof for arbitrary file sizes, missed transient peaks,
concurrent workloads, other platforms or native UI. No phase is marked complete
based on these measurements alone.

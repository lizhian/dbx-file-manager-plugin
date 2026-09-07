# Native RPC diagnosis checkpoint

Date: 2026-09-07. Latest status: caller and changed fields identified; preserving
plugin configuration fields fixes the native FTP download. See
[confirmed cause and verification](NATIVE-DEFAULTS-FIX.md). Clean-host acceptance
remains open. No plugin installation or GUI upload approval was inferred.
The observations below preserve the earlier diagnosis checkpoints.

## Observation

A temporary diagnostic build traced only `io.github.lizhian.file-manager` RPCs
whose connection ID matches the generated `dbx-native-*` fixture. It logged
method names, request IDs and sanitized structured error codes, not full request
parameters, credentials, Secrets or file contents.

The actual isolated native app restored its saved FTP file tab and listed the
seed successfully. Before any new download/close-connection click, the trace
showed:

```text
request=2  connection/connect       -> ok
request=3  filesystem/capabilities  -> ok
request=4  filesystem/capabilities  -> ok
request=5  filesystem/list          -> ok
request=6..20 filesystem/transfer/list -> ok
request=21 connection/disconnect   -> ok
```

Transfer-list polling continued afterward without reconnecting. The excerpt
[native RPC trace](evidence/native-rpc-auto-disconnect-20260907.txt) contains only
allowlisted trace lines; repetitive transfer-list polls and unrelated native logs
were omitted. It was captured before deliberately stopping the diagnostic app.
This is evidence of a host-issued disconnect, not just a Sidecar idle-expiry
inference. It does not yet identify which host/frontend lifecycle path requested it.

The RPC-trace native binary SHA-256 is
`30fdab64c335b1bc66d5ed3139d2592d16210ce91138d5c803195c07bf4d18d8`.
It used the unchanged original JHXNyZ profile, unchanged 0.1.0 plugin and frontend
5179. The attempt to open a download picker afterward was blocked because the
native-control API reported the Mac locked. No lock bypass was attempted.

## Follow-up hypothesis

Read-only SQL inspection found the fixture's persisted `driver_profile`,
`driver_label` and `url_params` unset. The frontend's actual `normalizeConnection`
fills a profile/label and an empty URL-parameter string. Native
`sync_connection_configs` compares full configurations via
`connection_configs_pool_equivalent` and requests pool teardown on inequality.

This is a concrete configuration-drift hypothesis, not a confirmed cause of
request 21. No comparison rule, fixture configuration or connection behavior was
changed to hide the failure. A caller trace and changed-field-name trace are
prepared to distinguish configuration sync from other teardown paths.

## Prepared diagnostic

`dist/native-rpc-diagnostic/dbx` is a test-only build, not a release candidate.
It adds disconnect caller backtraces and top-level changed configuration field
names (never their values) under `DBX_NATIVE_RPC_DIAGNOSTIC` for the native fixture.

- Build completed successfully in 4m29s; the known compact-unwind warning remains.
- Binary SHA-256:
  `39642a3150f9c5929e8bf31ff61dc10e946af3c75225e2cc14fcd8e790de401a`.
- `dist/native-rpc-diagnostic/inputs.json` records the three diagnostic source
  hashes. `source.patch` records exactly 38 added diagnostic lines relative to
  tree `e60b98606613640212cb1812dac5bad5c621f1e4`.
- This second diagnostic build was **not launched**: the Mac was still locked
  when rechecked after compilation. No caller backtrace or field-difference result
  is claimed. It can be used after manual unlock with the same isolated profile.

## Cleanup and continuation

All temporary tracing was removed from runtime.rs, host.rs and native
commands/connection.rs with scoped patches. `git diff --exit-code` against the
pre-diagnostic tree confirmed those files are identical, and a targeted search
found no diagnostic markers left. The launch wrapper's diagnostic environment
variable was removed. Existing business fixes and user changes were preserved.

Diagnostic app PID 15818 was checked against its exact .app executable, fixture
DBX_DATA_DIR and diagnostic environment variable before SIGTERM. Its original
profile and remote seed were retained. The app is now stopped, not waiting in a
live picker. The frontend server and existing containers were left untouched.

The .app executable and shared target/debug/dbx currently contain diagnostic
builds; do not call them clean acceptance artifacts. Use the explicitly archived
diagnostic binary only for tracing, or rebuild the clean current source for normal
native acceptance. Startup no longer enables tracing by default.

The main-host patch was exported and reverified after cleanup with unchanged hash
`dc9caecf1c91b12aade90516395801fe2fdf3cae92011a2101de5f4bcc22d6ca`.
No commits, pushes, plugin installs, profile resets or signing-policy changes were
performed. Next native action requires manual Mac unlock; the separate unsigned
plugin installation confirmation remains unanswered.

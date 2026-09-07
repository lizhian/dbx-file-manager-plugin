# Plugin connection ownership checkpoint

Date: 2026-09-07. A real host regression exposed and fixed superseded connection
attempts disconnecting a newer plugin binding. This is a verified host defect,
not yet proof that every observed native UI failure has the same cause.

## Read-only native comparison

GUI installation confirmation has not been received. The unsigned-development
switch and installed package in the original native profile were not changed.

`scripts/native-connection-probe.mjs` runs independent Sidecar processes against
the existing UUID-scoped FTP seed, with `read_only: true`. It reads only the
generated `fixture.json` marker, not the native profile database or stored Secrets.
It uses the public disposable fixture credential and never sends a filesystem
mutation or transfer request. Both processes are closed before the report ends.

The old installed binary and new extracted candidate each passed five reads:
initial connect, after a one-second idle timeout elapsed, after `connection/test`,
after repeated connect, and after disconnect/reconnect. Each read checks the
147,456-byte seed and its exact SHA-256. This rules out inevitable standalone
idle-expiry failure in these inputs; it does not test native runtime configuration
or connection publication races.

Evidence: [first comparison](evidence/native-connection-probe-57b981e2-5f23-4e12-9de7-2775f0b3f8b0.json)
and [repeat](evidence/native-connection-probe-c164db65-dca5-4da6-a8c2-d1650f57ca09.json).
Probe source SHA-256:
`2bfa55328f21bca8c0a56db420f096d90acaa72b4ac9007ffcfe444443f04ea4`.
Binary hashes are recorded independently in each report; neither existing binary
nor native profile was replaced by this comparison.

## Red regression

The real saved-host-gateway test was extended before the fix to:

1. Begin/connect an older attempt.
2. Begin/connect and publish a newer attempt for the same logical binding.
3. Attempt to publish the older result and confirm it is rejected as superseded.
4. Query filesystem capabilities through the still-published current route.

Step 4 failed with:

```text
Discarding a superseded attempt disconnected the current plugin binding: Connection is not connected
test result: FAILED. 0 passed; 1 failed
```

`insert_connection_pool_for_attempt` disposes a rejected pool by closing its handle.
Previously any handle with the same Sidecar connection ID could send disconnect,
including an old attempt whose binding had already been reused. The existing
normal-publication shared-handle check did not cover rejected candidates.

The failing path uses the real new candidate, AppState, saved connection, pool
attempt tracking and Sidecar. It fails before creating remote test objects, so
this failure did not leave an upload/download directory to recover.

## Fix

`PluginConnectionHandle` now carries a binding generation. `PluginHost` keeps weak
references to per-plugin/provider/connection binding owners; unused entries are
pruned on connect. Successful connect advances ownership, and older handles fail
the availability check. Connect and disconnect for a binding share a lifecycle
mutex, without holding the host-wide activation mutex across RPC I/O.

Disconnect verifies ownership after acquiring that mutex. A superseded handle
does nothing. A current owner retires its generation once before the RPC, so its
clones cannot issue repeated disconnects after timeout/failure. Different logical
bindings have independent locks/owners. No Sidecar wire schema or plugin package
change is required.

The live test also checks rejection after the new connect has finished but before
its pool is published, when checking only the routing table would be insufficient.
Existing tests still verify that the actual current owner disconnects its binding.
Unit tests cover delayed stale cleanup, clone idempotency and independent owners.

## Verification

- Extended real saved-host-gateway test: passed, including both supersession
  orderings and its existing FTP operations/5 MiB transfers/cleanup.
- Host plugin suite: 86 passed, two live tests ignored by default.
- Broader `connection` filter across Core library: 529 passed, 12 ignored.
  This is broader than the older 357-test module-only checkpoint, not the same
  test selection or a full workspace pass.
- Node suite: 53 passed. Probe syntax check, targeted Rustfmt and worktree
  whitespace checks passed. No frontend, plugin backend or candidate changed.
- [Forced active-transfer matrix](evidence/host-transfer-lifecycle-7b2bfe33-bda1-45ef-bdf2-2cfa6df9fad0.json):
  upload/download upgrade/rollback all passed with process ordering, old-task
  `not_found`, target/Secret preservation, temporary cleanup and checksum retry.
- [Graceful active-transfer matrix](evidence/host-transfer-lifecycle-945501ee-81cb-4a82-bdc0-30167aabffef.json):
  all four combinations passed, preserving cancellation-event assertions and
  the same process/publication, target, Secret, cleanup and checksum checks.

At this checkpoint `host.rs` SHA-256 is
`4b71e48e612b3dac12743a9e5779fa70941b9d16143a9ca6b25c81a56f6b6273`
and the live fixture SHA-256 is
`aad655ea84940544a94c29e154489ce45b2c6e8449ce26f26dcfedfe8e8a6970`.
The controller records the fixture and several host-source hashes; its older
source allowlist does not include host.rs, so the explicit hash here and exported
result tree supply that additional provenance. No candidate binary changed.

Relevant commands, run in the integrated host with Node 22 and shared target:

```bash
cargo test --locked --offline -p dbx-core --lib --no-default-features --features sqlite-bundled plugins:: -- --quiet
cargo test --locked --offline -p dbx-core --lib --no-default-features --features sqlite-bundled connection -- --quiet
DBX_FILE_MANAGER_PLUGIN_DIR=/absolute/path/to/dbx-file-manager-plugin DBX_FILE_MANAGER_PLUGIN_BINARY=/absolute/path/to/extracted/sidecar cargo test --locked --offline -p dbx-core --lib --no-default-features --features sqlite-bundled real_file_manager_sidecar_through_saved_host_gateway -- --ignored --nocapture
```

Main-host patch: 223 files, 1,773,982 bytes, SHA-256
`dc9caecf1c91b12aade90516395801fe2fdf3cae92011a2101de5f4bcc22d6ca`, tree
`e60b98606613640212cb1812dac5bad5c621f1e4`. Apply/reverse checks passed without
changing the real index or historical patch. Incremental host changes: two files,
153 insertions and two deletions, including tests. No commit or push was made.

## Remaining boundaries

The running native app predates this host fix and still uses the historical
plugin. It has not been rebuilt/restarted or reaccepted at this checkpoint.
Updating the host and repeating the same native download is still necessary
before attributing or closing the UI defect. GUI package installation is still
awaiting the user's explicit confirmation; no alternative installer was used on
that profile. Full platform, native picker/upload, workspace and release gates
remain incomplete.

Later actual native comparison: the host was rebuilt with this fix, copied into
the isolated .app and restarted against the unchanged historical plugin/profile.
The same native download still returned `Connection is not connected`, with no
destination file. See NATIVE-ACCEPTANCE.md, ownership-fix native rerun, for the
new binary hash and direct UI evidence. The host regression does not close that
native defect; the former "not rebuilt" status above describes this checkpoint's
earlier state only. No GUI installation approval was inferred or executed.

The serialized binding lifecycle does not add durable task recovery or change
Sidecar behavior after an RPC timeout. In-flight wire requests and other protocol
implementations retain their existing timeout semantics and need separate tests.

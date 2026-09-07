# Native plugin configuration normalization fix

Latest follow-up: a fresh host build without diagnostic instrumentation also
passed the native FTP download. See [clean-host result](evidence/native-clean-host-20260907/result.json)
and [screenshot](evidence/native-clean-host-20260907/download-completed.png).
The earlier diagnostic checkpoint below is retained for attribution.

Date: 2026-09-07. Native FTP download passed with the fixed frontend and
diagnostic host. Full native acceptance remains incomplete.

## Cause and boundary

The caller trace established this chain:

```text
load_connection_configs
 -> remove_connection_pools_for_connection_ids
 -> remove_connection_pools_detached
 -> PluginConnectionHandle::disconnect
```

The changed fields were exactly `driver_profile`, `driver_label`, and `url_params`.
The frontend supplied database defaults for fields absent in the saved plugin
connection. Reloading the saved configuration therefore invalidated its live pool.
The file tab continued polling after the host disconnected the connection.

`apps/desktop/src/stores/connectionStore.ts` now preserves those three fields for
plugin connections, including absent and null values. Native database defaults
are unchanged. Backend equality, persisted fixture data and plugin code were not
weakened or changed to make the test pass.

## Evidence

- [Allowlisted RPC evidence and source hashes](evidence/native-defaults-fix-20260907/result.json)
- [Completed native download screenshot](evidence/native-defaults-fix-20260907/download-completed.png)
- [Native accessibility state](evidence/native-defaults-fix-20260907/download-completed.txt)
- The existing profile and installed historical runtime-gates 0.1.0 Sidecar were
  retained. After a normal quit/relaunch loaded the frontend fix, no automatic
  disconnect occurred in the recorded post-restart window.
- The native Save dialog selected the fixture's `files/download.txt`; the app
  reported completion. Independent fixture verification, repeated during this
  documentation checkpoint, passed: 147,456 bytes, SHA-256
  `817ecc1e00aa5730d600173a45336198952b6eb5ed2838ee8f83c4d9bcc2b83e`.
- The new real Pinia-store regression covers absent, null and custom plugin
  fields, plus PostgreSQL defaults. Before the fix two cases failed; afterward
  all three passed. Source hashes were rechecked against the evidence record.
- At export time, reran `node node_modules/vitest/vitest.mjs run
  apps/desktop/src/stores/__tests__/connectionStore.pluginDefaults.spec.ts
  --maxWorkers=2` in the integrated host with Node 22.13.0: three tests passed.
  `git diff --check` passed, and no diagnostic marker was found in production
  `crates/dbx-core/src` or `src-tauri/src`. The native window still displayed the
  completed download when inspected; the diagnostic app was not closed during
  this documentation/export checkpoint.
- Previous execution recorded 23 focused tests and the full frontend suite:
  1,337 files / 13,195 tests passed with two workers. Type checking, connection
  descriptors (81 / 104 profiles), and formatting (2,404 files) passed. Lint
  exited zero with existing warnings. These full checks were not rerun merely
  for the documentation/export update.

## Remaining gates

The tested native binary contains temporary diagnostic instrumentation; its hash
is recorded in the evidence. Production Rust sources had the tracing removed.
A clean native rebuild and FTP download revalidation subsequently passed (linked
above); this is not full native artifact acceptance. Neither download validates new download-lease packages,
GUI upload, overwrite, read-only workflows, or Linux/Windows native behavior.
Pending GUI install/upload approval is not implied by this result. Historical
failed attempts in the other records remain valid for their original inputs.

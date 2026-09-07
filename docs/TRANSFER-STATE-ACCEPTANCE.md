# Transfer state reconciliation

Date: 2026-09-07. This checkpoint fixes frontend polling after a Sidecar loses
its transfer records. It does not establish a completed transfer, successful file
publication, or cleanup merely from a missing task response.

## Reproduction and fix

The original `useFilesystemTransfers.refresh` caught errors outside the entire
status loop. A known running task returning `not_found` therefore stayed running
forever and prevented subsequent tasks from refreshing. A transient timeout in
the first task also blocked later tasks during that poll.

Two new component regressions reproduced both defects before implementation:
17 passed and two failed. The task stayed `running` instead of `failed`, and the
later task stayed `running` instead of observing its actual `completed` response.

The composable now handles each status error independently:

- An explicit `not_found` from that task's scoped status query ends the local
  record as failed, preserving its byte count and backend message. No automatic
  retry, overwrite authorization, completed callback or cleanup claim is added.
- Other errors remain retryable and visible while later tasks still refresh.
- A failed list request, including list-level `not_found`, never infers individual
  task loss. Successful lists still trigger status checks for omitted local tasks.
- Existing generation/unmount guards reject stale errors after connection changes.
- Existing terminal-state merge rules prevent delayed progress/list data from
  resurrecting a locally failed task.

Four new component cases cover disappearance, independent timeout recovery,
list failure and old-connection errors. The task row uses the existing failed
state and error display; no template, styles, translation, toolbar or picker
behavior changed. A lost task no longer offers an active progress bar or cancel
button. This is component-rendered DOM evidence, not native desktop interaction.

## Actual host evidence

The existing opt-in host lifecycle fixture now asks the replacement Sidecar for
the old transfer ID before any retry, and requires the real `not_found` code.
[Four forced-stop cases](evidence/host-transfer-lifecycle-176f8197-a8db-4b01-9d93-880efd22660e.json)
passed upload/download upgrade/rollback, including `oldTaskNotFound: true` in each
inspection, target/Secret preservation, temporary cleanup and checksum retry.
The recorded fixture hash matches current source; profiles and old/new PIDs were
independently confirmed absent after completion.

The test uses the unchanged download-lease 0.1.0/0.1.1 candidates. No Rust host
production logic or plugin backend changed in this checkpoint. This connects the
frontend regression's error shape to the actual host path, but is not a native
UI end-to-end claim. Losing page state on a version-key remount and host-wide
durable transfer history remain outside this change.

## Verification

- Component suite: 20 tests passed. Together with `hostFilesystem.spec.ts`,
  27 tests passed using the normal Vitest runner.
- `node scripts/run-check.mjs`: connection-types, format, lint and typecheck
  passed. Its first all-tests attempt failed: 1,317 test files passed, three
  failed; 12,978 tests passed, two failed, one skipped, and 16 worker errors.
  Several worker starts timed out; the runner reported 5,207.68 seconds for tests.
  This result is retained as failed, not blamed on a proven external cause.
- The three failed files (`filesystemApi.spec.ts`, `dataGridHeaderBackground.test.ts`,
  `exportSmoke.spec.ts`) were rerun with `--maxWorkers=2`: all three files and four
  tests passed, without source edits or timeout increases.
- Full `vitest run --maxWorkers=2` rerun: **1,336 files and 13,192 tests passed**,
  zero failures/skips, exit zero in 192.96 seconds. No tests, timeouts, worker
  defaults or repository configuration were changed to obtain this result.
  Happy DOM printed fetch-abort messages during teardown, but Vitest reported no
  unhandled errors in the final summary. The first attempt remains failed evidence;
  reduced concurrency passing does not independently prove its root cause.
- Worktree whitespace checks passed. Targeted Rustfmt passed for the live fixture.

Commands run in the integrated host with Node 22.13.0 first on PATH:

```bash
node node_modules/vitest/vitest.mjs run apps/desktop/src/components/plugins/PluginFileManager.spec.ts apps/desktop/src/lib/plugins/hostFilesystem.spec.ts
node scripts/run-check.mjs
node node_modules/vitest/vitest.mjs run --maxWorkers=2
```

The main-host patch was exported again with apply/reverse/index checks: 223 files,
1,767,338 bytes, SHA-256
`dab939c5267a5fa896b39d4907447054f88f4cded8b563c72912bc731bd5cf39`, result tree
`7035c26ba7ca1f8717ed7420a0fdbfd9c42d3072`. Relative to the prior exported tree,
only three files changed (+108/-6): the composable, its component tests and the
Rust live fixture. No unrelated untracked source was removed; historical patches
and package payloads remain intact. No commits or pushes were made.

## Native boundary

The native-control inventory was queried again and returned available apps and
browsers rather than a locked-Mac error. The earlier lock is no longer a verified
current blocker. The isolated native executable/profile still needs revalidation
and rebuilding before UI acceptance; the user's installed DBX was not launched.
Full platform, native-picker and workspace gates remain separate.

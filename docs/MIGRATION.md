# Migration tracking

**Current platform scope (user decision, 2026-09-07): macOS ARM64 only.**
Linux and Windows validation is no longer a completion gate. Preserve historical
artifacts but do not schedule further validation for those platforms. This
overrides older platform requirements below; six protocols and Mac workflows remain.

Source plan: original DBX checkout,
`docs/pips/plans/2026-09-02-file-manager-plugin-migration.md` (2026-09-02).
Source implementation: `149488ba1a6244d5ca9528eedf90481bc99fbf3d`.
Framework/SDK baseline: `c26ff3f6d4bd643be8dedd659c3236af4a5bd556`.
Current host integration: pinned main `14e1d4f25b7f352a0ed50edf019e698e80bcf5d9`
plus the framework and API 1.1; see [MAIN-INTEGRATION.md](MAIN-INTEGRATION.md).

**The pinned baseline gate is complete; product migration is not.** Partial
implementation, static checks and a live subprocess pass do not satisfy all
product gates. Work may be prepared in parallel;
acceptance must respect the original phase order. No GitHub publish or commits.

| Phase | Status | Prepared / scoped work | Gate still needed |
| --- | --- | --- | --- |
| 0 Baseline | Complete for pinned input | Pinned-main merge resolved; Hello lifecycle, core plugin and full frontend checks passed; FTP restart/reconnect passed; verified main patch exported | No claim of commit/release; broader MCP test and vendor formatting failures remain phase 8 gates |
| 1 Host contract | Incomplete | API 1.1 and extended capability schema | Rust/TS/schema/SDK agreement, old-host rejection, error/recovery preservation, trusted path access, bounds and timeouts |
| 2 Sidecar skeleton | Incomplete | Framed backend metadata and OpenDAL implementation | Package activation/restart, registry races/generation/expiry, multi-connection behavior, no host OpenDAL dependency |
| 3 Six connections | Incomplete | Six provider pairs, flat fields, secret bindings, EN/zh warnings | Save/edit/test each mode in host, Secret Store/log redaction, tunnel endpoint handling, invalidation |
| 4 Remote operations | Incomplete | Ten static caps, actual framed contract harness | Six-protocol evidence, path safety, defaults/fallback/partial success, host operation acceptance |
| 5 Desktop transfers | Incomplete | 4 MiB append aggregation, full-six 16/256 MiB resource pass, eight real WebDAV interruption cases and five-connection 8/2 admission/recovery pass; see TRANSFER-ACCEPTANCE.md | Native picker authorization, concurrent memory, other protocols' real interruption/cleanup, symlink/no-clobber/Replace, longer Hadoop stability |
| 6 Host file UI | Incomplete | Plugin contributes no custom UI | Full shared UI workflow, readonly/production gates, progress, fallback warnings, tabs/reconnect and platform smoke |
| 7 Compatibility | Incomplete | FTP Web lifecycle and four real active WebDAV upload/download upgrade/rollback cases passed; PID publication barrier, Secret/target preservation and cleanup/retry verified | Other protocols' active replacement, forced-stop/broader concurrency, native UI entrypoints and optional old config/Secret migration |
| 8 Acceptance/release | Incomplete | Local/Web checks, Linux ARM64 native sidecar/package and live/resource checks, Windows GNU x64 cross-linked candidate with package verification; see PLATFORM-ACCEPTANCE.md | Desktop platform matrix including Linux GUI and Windows runtime/host validation, remaining host workspace gates, active-transfer failures and release review |

## Module responsibilities

Latest scoped platform evidence: current download-lease code now has a rebuilt
Linux ARM64 candidate with all 17 Sidecar/package pipeline stages passing; see
PLATFORM-ACCEPTANCE.md. Clean-host macOS native FTP download also passed (see
NATIVE-ACCEPTANCE.md). Neither closes the remaining full host GUI, new-package
native lifecycle, GUI upload or Windows runtime gates in the phase table.

- `manifest.json` and `dbx-plugin.toml`: provider declarations and package boundary.
- `backend/`: OpenDAL configuration, lifecycle, remote operations and transfer IO.
- `scripts/` and `tests/`: metadata validation, portable fixtures and framed tests.
- DBX host repository: forms, Secret Store, tunnel endpoints, shared file UI,
  local pickers, confirmations, plugin installation and lifecycle protections.
- `docs/`, `LICENSE`, `NOTICE`: acceptance evidence, limitations and provenance.

The unused generated UI template is removed. SDK portability uses Git source
pinned to c26ff3f6d4bd643be8dedd659c3236af4a5bd556. Reproduce local checks and
package verification with the commands in README.md; fixture instructions describe
service reuse without changing shared containers.

## Stop conditions

Do not introduce a file-manager database enum, dedicated host protocol branches,
OpenDAL into the host install, a plugin-owned file manager UI, or arbitrary local
paths through the generic sandbox bridge. Do not infer phase completion from a
successful manifest/schema check. Record protocol differences and accepted changes
in CONTRACT.md before making acceptance claims.

No automatic migration or deletion of saved connections/secrets is enabled here.
Rollback is a separate tested package/lifecycle operation, not reverting unrelated
work in the concurrent dirty worktree.

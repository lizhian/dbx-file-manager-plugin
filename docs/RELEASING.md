# Tag releases

The workflow follows the official DBX CLI naming and five-target matrix from
the DBX plugin release template. It uses a local workflow so tag validation,
project dependencies, Windows build prerequisites and complete-asset publication
can be controlled without relying on the unavailable upstream `plugin-sdk-v1` tag.
The pinned backend SDK is unchanged.

| Target | GitHub runner | Asset suffix |
| --- | --- | --- |
| macOS ARM64 | macos-15 | darwin-arm64.dbxp |
| macOS Intel | macos-15-intel | darwin-x64.dbxp |
| Linux ARM64 | ubuntu-24.04-arm | linux-arm64.dbxp |
| Linux x64 | ubuntu-24.04 | linux-x64.dbxp |
| Windows x64 | windows-2022 | windows-x64.dbxp |

Full names are `<manifest.id>-<manifest.version>-<target>.dbxp`, for example
`io.github.lizhian.file-manager-0.1.1-darwin-arm64.dbxp`. Each has matching
`.artifact.json` metadata (target, URL basename, SHA-256 and byte size).
`release-candidates.json` aggregates plugin identity and all five artifacts.

## Publish a version

1. Update `manifest.json`, `backend/Cargo.toml` and the root plugin entry in
   `backend/Cargo.lock` to the same SemVer version. Do not change SDK dependencies.
2. Run metadata tests and commit the source/version changes.
3. Push the commit, then create and push an annotated tag, for example:

```sh
git tag -a v0.1.1 -m "Release v0.1.1"
git push origin main
git push origin v0.1.1
```

Each future version uses its own tag and Release; older Releases remain available.
The tag must match the manifest exactly. Tags with a prerelease suffix (such as
`v0.2.0-rc.1`) produce GitHub prereleases. No OS-version runtime matrix is implied.

## Gates and retries

Metadata tests run before the five native builds. Each job uses published
`@dbx-app/plugin-cli@0.1.0`, performs a locked Rust release build, then verifies
archive members, manifest parity, license/notice and checksums. The publish job
requires every target, verifies all packages again and only then creates a draft,
uploads all 11 assets and publishes it. It has `contents: write`; build jobs have
read-only repository access. Tag values are passed through environment variables.

If a build fails, no new Release is published. Correct transient runner/network
problems by rerunning failed jobs on that tag. If upload fails, the draft remains
and rerunning the publish job replaces its assets before publishing. Do not move
an already published tag to silently change source; use a new patch version for
source changes. The workflow uses no signing secret and does not publish to the
official DBX plugin store.

For a workflow-only fix, keep the original tag immutable and dispatch the updated
workflow from `main` with input `tag=v0.1.1`. Every job explicitly checks out that
existing tag, and version checks still apply to the tagged source. For example:

```sh
gh workflow run release.yml --ref main -f tag=v0.1.1
```

Windows pins the absolute MSVC linker path because Git Bash also ships a
`link.exe` that is not a C/C++ linker. The initial v0.1.1 run exposed this PATH
collision; a workflow-only retry does not change the tagged plugin source.
Windows also disables checkout CRLF conversion before fetching the source, so
LICENSE and NOTICE remain byte-identical across targets. A subsequent aggregation
check caught CRLF conversion despite a successful Windows-local verification;
the fix preserves original bytes instead of relaxing the package verifier.

## Support boundary

These are unsigned development packages, not evidence of completed migration
acceptance. Installation requires the adapted DBX Host API 1.1 host and the local
unsigned-development option. SFTP requires Unix OpenSSH; Windows SFTP is not
implemented. Mac ARM has the main functional evidence. Linux/Windows build success
does not establish their remote-protocol, native UI or lifecycle acceptance.

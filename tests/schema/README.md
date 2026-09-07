# Schema provenance

`manifest.schema.json` is DBX `plugins/manifest.schema.json` from baseline
`c26ff3f6d4bd643be8dedd659c3236af4a5bd556`, with the coordinated Host API 1.1
filesystem capability enum change from the host working tree on 2026-09-06.
The change adds list/stat/copy/upload/download to the baseline five capabilities.
It is not represented as a released schema commit. Keep this copy byte-identical
to the agreed host schema and record further changes here. Apache-2.0; see NOTICE.

Ajv 2020 validates authoring syntax; scripts/validate-manifest.mjs validates this
plugin's semantic contract. Host runtime validation is still the security boundary.

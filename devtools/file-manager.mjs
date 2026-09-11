import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevelopment } from './mock-host/cli.mjs';
import { testConnections } from '../docs/tests/mock-connections.mjs';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(project, 'runtime/mock-host');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const presetFile = resolve(dataDir, 'test-connections.json');
await writeFile(presetFile, JSON.stringify(testConnections(project), null, 2), { mode: 0o600 });
await startDevelopment({ project, backend: 'backend/target/debug/dbx-plugin-dbx-file-manager-plugin', uiRoot: 'ui', dataDir, presetFile,
  commands: { backend: ['cargo', 'build', '--locked', '--manifest-path', 'backend/Cargo.toml'], ui: ['npm', 'run', 'build'], watch: ['node', 'node_modules/vite/bin/vite.js', 'build', '--watch'] } });

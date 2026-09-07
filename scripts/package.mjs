import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This release targets macOS Apple Silicon only');
const env = { ...process.env };
// The backend pins the official SDK by Git revision, not crates.io.
delete env.DBX_PLUGIN_SDK_ROOT;
const require = createRequire(import.meta.url);
const binary = join(dirname(require.resolve('@dbx-app/plugin-cli-darwin-arm64/package.json')), 'bin/dbx-plugin');
const result = spawnSync(binary, ['package', '.'], { stdio: 'inherit', env });
process.exitCode = result.status ?? 1;

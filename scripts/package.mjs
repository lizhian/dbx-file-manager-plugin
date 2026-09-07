import { execFileSync, spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const project = fileURLToPath(new URL('../', import.meta.url));
  let binary = process.env.DBX_PLUGIN_CLI_BINARY;
  if (!binary) {
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    const require = createRequire(join(npmRoot, '@dbx-app/plugin-cli/package.json'));
    const platform = `${process.platform}-${process.arch}${process.platform === 'linux' ? '-gnu' : ''}`;
    const packageJson = require.resolve(`@dbx-app/plugin-cli-${platform}/package.json`);
    binary = join(dirname(packageJson), 'bin', process.platform === 'win32' ? 'dbx-plugin.exe' : 'dbx-plugin');
  }
  accessSync(binary, constants.X_OK);
  execFileSync(process.execPath, [join(project, 'scripts/validate-manifest.mjs')], { stdio: 'inherit' });
  const env = { ...process.env };
  // The npm launcher injects a crates-io SDK patch that conflicts with our locked Git pin.
  delete env.DBX_PLUGIN_SDK_ROOT;
  delete env.DBX_PLUGIN_CLI_BINARY;
  const child = spawn(resolve(binary), ['package', project, ...process.argv.slice(2)], { env, stdio: 'inherit' });
  child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error.message);
  console.error('Install @dbx-app/plugin-cli globally, or set DBX_PLUGIN_CLI_BINARY to its native executable.');
  process.exitCode = 1;
}

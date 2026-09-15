import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { platform, arch } from 'node:process';

const target = process.env.DBX_PLUGIN_TARGET;
const suffix = platform === 'linux' ? '-gnu' : '';
const packageName = `@dbx-app/plugin-cli-${platform}-${arch}${suffix}`;
const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const require = createRequire(join(npmRoot, 'package.json'));
const binary = join(dirname(require.resolve(`${packageName}/package.json`)), 'bin', platform === 'win32' ? 'dbx-plugin.exe' : 'dbx-plugin');
const env = { ...process.env };
delete env.DBX_PLUGIN_SDK_ROOT;
execFileSync(binary, ['package', '.', ...(target ? ['--target', target] : [])], { stdio: 'inherit', env });

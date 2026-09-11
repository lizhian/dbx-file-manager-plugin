import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createMockHost } from './server.mjs';

const toolRoot = dirname(fileURLToPath(import.meta.url));
export async function startDevelopment(options) {
  const children = new Set();
  const project = resolve(options.project || '.');
  const dataDir = resolve(project, options.dataDir || 'runtime/mock-host');
  const commands = options.commands || {};
  function spawnCommand(args) {
    if (!Array.isArray(args) || !args.length || args.some(arg => typeof arg !== 'string')) throw new Error('Build command must be an argument array');
    const child = spawn(args[0] === 'node' ? process.execPath : args[0], args.slice(1), { cwd: project, stdio: ['ignore', 'inherit', 'inherit'], detached: process.platform !== 'win32' });
    children.add(child); child.once('exit', () => children.delete(child));
    return child;
  }
  const run = args => new Promise((accept, reject) => {
    const child = spawnCommand(args);
    child.on('error', () => reject(new Error('Cannot start build command')));
    child.on('exit', code => code === 0 ? accept() : reject(new Error(`Build failed (exit ${code})`)));
  });
  function stopChildren() {
    for (const child of children) {
      try { if (process.platform === 'win32') child.kill(); else process.kill(-child.pid, 'SIGTERM'); } catch {}
    }
  }
  let host;
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; stopChildren(); await host?.close(); };
  process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
  try {
    if (commands.backend) await run(commands.backend);
    if (commands.ui) await run(commands.ui);
    const shellDir = resolve(dataDir, 'shell');
    await build({ configFile: false, root: resolve(toolRoot, 'ui'), plugins: [vue(), tailwind(), viteSingleFile()],
      build: { outDir: shellDir, emptyOutDir: true, target: 'es2022' } });
    host = await createMockHost({ ...options, project, dataDir, shellHtml: resolve(shellDir, 'index.html'),
      buildBackend: commands.backend ? () => run(commands.backend) : undefined });
    if (commands.watch) {
      const watch = spawnCommand(commands.watch);
      watch.on('error', () => console.error('UI build watcher failed to start'));
      watch.on('exit', code => { if (!stopping) console.error(`UI build watcher exited (${code}); restart the development service`); });
    }
    console.log(`Mock host: ${host.origin}`);
    console.log('Local development only. Connection credentials are stored as plaintext in the configured data directory.');
    return { ...host, close: stop };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  const names = { '--project': 'project', '--backend': 'backend', '--ui-root': 'uiRoot', '--data-dir': 'dataDir', '--port': 'port', '--preset-file': 'presetFile', '--build-config': 'buildConfig' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1]) throw new Error('Usage: node cli.mjs --project DIR --backend EXECUTABLE [--ui-root DIR] [--data-dir DIR] [--port NUMBER] [--preset-file JSON] [--build-config JSON]');
    options[names[args[i]]] = args[i + 1];
  }
  if (!options.backend) throw new Error('--backend is required');
  if (options.port) options.port = Number(options.port);
  if (options.buildConfig) options.commands = JSON.parse(await readFile(options.buildConfig, 'utf8'));
  await startDevelopment(options);
}

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('services.json', root), 'utf8'));
const check = process.argv.includes('--check');
const labels = { compiled: '已编译', platform: '当前平台不支持', version: '当前版本未提供', dependency: '依赖未包含' };
if (new Set(catalog.services.map(s => s.id)).size !== catalog.services.length) throw new Error('Duplicate service');
for (const s of catalog.services) {
  if (!labels[s.status] || (s.status !== 'compiled' && !s.reason)) throw new Error(`Invalid service: ${s.id}`);
}
const id = 'io.github.lizhian.file-manager';
const manifestFile = new URL('manifest.json', root);
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
const contribution = {
  type: 'connection-provider', id: `${id}.opendal`, label: 'OpenDAL 通用', icon: 'assets/plugin.svg', database_type: 'opendal',
  description: '按 OpenDAL Configuration reference 配置服务。参数交由 Secret Store；当前宿主和模拟服务均明文存储，仅使用测试凭据。',
  capabilities: ['test', 'connect', 'disconnect'],
  fields: [
    { key: 'display_name', label: '连接名称', type: 'text', binding: 'name', required: true, default: 'OpenDAL' },
    { key: 'service', label: '服务', type: 'select', binding: 'secret', required: true,
      options: catalog.services.map(s => ({ value: s.id, label: `${s.id}（${labels[s.status]}${s.reason ? `：${s.reason}` : ''}）` })) },
    { key: 'parameters', label: '参数', type: 'textarea', binding: 'secret', required: false,
      placeholder: 'key1=value1\nkey2=value2', description: '每行 key=value，按第一个 = 分隔，值中的空格保留。配置参考：https://opendal.apache.org/services/；不要添加引号或变量表达式。当前宿主及模拟服务明文存储，仅使用测试凭据。' },
  ], workbench: `${id}.main`,
};
const index = manifest.contributions.findIndex(c => c.id === contribution.id);
if (index < 0) manifest.contributions.push(contribution); else manifest.contributions[index] = contribution;
const cargoFile = new URL('backend/Cargo.toml', root);
const cargo = await readFile(cargoFile, 'utf8');
const features = ['executors-tokio', 'reqwest-rustls-tls', ...catalog.services.filter(s => s.status === 'compiled' && s.id !== 'sftp').map(s => `services-${s.id}`)];
const nextCargo = cargo.replace(/^opendal = \{ version = "=0\.57\.0", default-features = false, features = \[.*\] \}/m,
  `opendal = { version = "=0.57.0", default-features = false, features = ${JSON.stringify(features)} }`);
const docs = '# OpenDAL 服务支持清单\n\n由 `services.json` 生成，执行 `node scripts/services.mjs` 更新。\n\n'
  + `OpenDAL ${catalog.opendalVersion}，目标 ${catalog.target}。“已编译”表示构建包含该服务，不代表已对全部云服务实测。SFTP 仍需要系统 OpenSSH。\n\n`
  + '| 服务与配置参考 | 状态 | 原因 |\n| --- | --- | --- |\n'
  + catalog.services.map(s => `| [${s.id}](${s.reference}) | ${labels[s.status]} | ${s.reason || '-'} |`).join('\n') + '\n';
for (const [url, content] of [[manifestFile, JSON.stringify(manifest, null, 2) + '\n'], [cargoFile, nextCargo], [new URL('docs/OPENDAL-SERVICES.md', root), docs]]) {
  if (check) {
    if (await readFile(url, 'utf8').catch(() => '') !== content) throw new Error(`Outdated service catalog output: ${fileURLToPath(url)}`);
  } else await writeFile(url, content);
}
console.log(`PASS: ${catalog.services.length} OpenDAL services (${catalog.services.filter(s => s.status === 'compiled').length} compiled)`);

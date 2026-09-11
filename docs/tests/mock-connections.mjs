import { resolve } from 'node:path';

export function testConnections(project) {
  const prefix = 'io.github.lizhian.file-manager.';
  const make = (protocol, values) => ({ providerId: prefix + protocol, values: { display_name: `${protocol.toUpperCase()} Local`, ...values } });
  return { connections: [
    make('ftp', { host: '127.0.0.1', port: 2121, username: 'dbx', password: 'dbx-password', root: '/ftp/dbx/' }),
    make('sftp', { host: '127.0.0.1', port: 2222, username: 'dbx', authentication: 'private_key', private_key: resolve(project, 'docs/tests/runtime/sftp/id_ed25519'), root: '/config/' }),
    make('s3', { endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', bucket: 'dbx', path_style: 'true', access_key: 'dbx-access-key', secret_key: 'dbx-secret-key', root: '/' }),
    make('webdav', { endpoint: 'http://127.0.0.1:8080', authentication: 'basic', username: 'dbx', password: 'dbx-password', root: '/' }),
    make('webhdfs', { endpoint: 'http://127.0.0.1:9870', simple_user: 'dbx', use_delegation_token: 'false', root: '/' }),
    make('hdfs-native', { name_node_uri: 'hdfs://127.0.0.1:19000', hadoop_config_directory: resolve(project, 'docs/tests/config/hadoop/client'), root: '/' }),
  ] };
}

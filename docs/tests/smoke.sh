#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for command in curl sftp docker cmp mktemp; do
  command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; exit 1; }
done
[[ -r runtime/sftp/id_ed25519 ]] || { echo "Run setup.sh first" >&2; exit 1; }

temporary="$(mktemp -d "${TMPDIR:-/tmp}/file-service-smoke.XXXXXXXX")"
name="$(basename "$temporary").txt"
source_file="$temporary/source.txt"
printf 'Local file service smoke test: %s\n' "$name" > "$source_file"
curl_options=(--fail --silent --show-error --connect-timeout 5 --max-time 30 --noproxy '*')
sftp_options=(-F /dev/null -b - -P 2222 -i "$PWD/runtime/sftp/id_ed25519"
  -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10
  -o StrictHostKeyChecking=accept-new -o "UserKnownHostsFile=$temporary/known_hosts")
ftp_url="ftp://127.0.0.1:2121//ftp/dbx/$name"
s3_url="http://127.0.0.1:9000/dbx/$name"
webdav_url="http://127.0.0.1:8080/$name"
webhdfs_url="http://127.0.0.1:9870/webhdfs/v1/$name"
native_path="/$name.native"
ftp_created=0 sftp_created=0 s3_created=0 webdav_created=0 webhdfs_created=0 native_created=0

hdfs() {
  docker run --rm -i --network host --platform linux/amd64 \
    --entrypoint hdfs apache/hadoop:3.4.3 dfs \
    -D fs.defaultFS=hdfs://127.0.0.1:19000 \
    -D dfs.client.use.datanode.hostname=true \
    -D ipc.client.connect.timeout=10000 -D ipc.client.connect.max.retries=1 \
    -D dfs.client.socket-timeout=10000 "$@"
}

# Only remove this run's unique filenames, never a shared directory.
cleanup() {
  local status=$? failed=0
  trap - EXIT
  set +e
  if (( ftp_created )); then
    curl "${curl_options[@]}" -u dbx:dbx-password -Q "DELE /ftp/dbx/$name" \
      ftp://127.0.0.1:2121//ftp/dbx/ >/dev/null || failed=1
  fi
  if (( sftp_created )); then
    printf 'rm /config/%s\n' "$name" | sftp "${sftp_options[@]}" dbx@127.0.0.1 >/dev/null || failed=1
  fi
  if (( s3_created )); then
    curl "${curl_options[@]}" --aws-sigv4 aws:amz:us-east-1:s3 \
      -u dbx-access-key:dbx-secret-key -X DELETE "$s3_url" >/dev/null || failed=1
  fi
  if (( webdav_created )); then
    curl "${curl_options[@]}" -u dbx:dbx-password -X DELETE "$webdav_url" >/dev/null || failed=1
  fi
  if (( webhdfs_created )); then
    curl "${curl_options[@]}" -X DELETE "$webhdfs_url?op=DELETE&user.name=dbx" >/dev/null || failed=1
  fi
  if (( native_created )); then
    hdfs -rm -f "$native_path" >/dev/null || failed=1
  fi
  if (( failed )); then
    echo "Cleanup failed; inspect only $name and $native_path. Local files: $temporary" >&2
    exit 1
  fi
  rm -f "$temporary/source.txt" "$temporary/received.txt" "$temporary/known_hosts" "$temporary/known_hosts.old"
  rmdir "$temporary"
  if (( status == 0 )); then echo 'PASS: all six protocols, content comparison and cleanup'; fi
  exit "$status"
}
trap cleanup EXIT

ftp_created=1
curl "${curl_options[@]}" -u dbx:dbx-password -T "$source_file" "$ftp_url"
curl "${curl_options[@]}" -u dbx:dbx-password "$ftp_url" -o "$temporary/received.txt"
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: FTP write/read'

sftp_created=1
sftp "${sftp_options[@]}" dbx@127.0.0.1 <<EOF
put "$source_file" /config/$name
get /config/$name "$temporary/received.txt"
EOF
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: SFTP write/read'

s3_created=1
curl "${curl_options[@]}" --aws-sigv4 aws:amz:us-east-1:s3 \
  -u dbx-access-key:dbx-secret-key -T "$source_file" "$s3_url"
curl "${curl_options[@]}" --aws-sigv4 aws:amz:us-east-1:s3 \
  -u dbx-access-key:dbx-secret-key "$s3_url" -o "$temporary/received.txt"
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: S3 write/read'

webdav_created=1
curl "${curl_options[@]}" -u dbx:dbx-password -T "$source_file" "$webdav_url" >/dev/null
curl "${curl_options[@]}" -u dbx:dbx-password "$webdav_url" -o "$temporary/received.txt"
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: WebDAV write/read'

webhdfs_created=1
curl "${curl_options[@]}" -L -T "$source_file" "$webhdfs_url?op=CREATE&user.name=dbx&overwrite=false"
curl "${curl_options[@]}" -L "$webhdfs_url?op=OPEN&user.name=dbx" -o "$temporary/received.txt"
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: WebHDFS write/read'

native_created=1
hdfs -put - "$native_path" < "$source_file"
hdfs -cat "$native_path" > "$temporary/received.txt"
cmp "$source_file" "$temporary/received.txt"
echo 'PASS: HDFS Native write/read'

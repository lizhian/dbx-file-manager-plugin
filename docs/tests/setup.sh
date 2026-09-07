#!/usr/bin/env bash
set -euo pipefail

# Adapted from DBX source 149488ba1: reuse explicit keys without copying them.
if [[ -n "${DBX_FM_SFTP_KEY_PATH:-}" ]]; then
  if [[ "${DBX_FM_SFTP_KEY_PATH}" != /* || ! -f "${DBX_FM_SFTP_KEY_PATH}" || ! -r "${DBX_FM_SFTP_KEY_PATH}" ]]; then
    echo "DBX_FM_SFTP_KEY_PATH must be an accessible absolute file path" >&2
    exit 1
  fi
  echo "Using the explicitly configured existing SFTP key; no files changed"
  exit 0
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
sftp_dir="${script_dir}/runtime/sftp"

if ! command -v ssh-keygen >/dev/null 2>&1; then
  echo "Missing required command: ssh-keygen" >&2
  exit 1
fi

mkdir -p "${sftp_dir}"
chmod 700 "${script_dir}/runtime" "${sftp_dir}"

if [[ -e "${sftp_dir}/id_ed25519" && ! -f "${sftp_dir}/id_ed25519.pub" ]] || [[ -e "${sftp_dir}/id_ed25519.pub" && ! -f "${sftp_dir}/id_ed25519" ]]; then
  echo "Incomplete SFTP key pair; refusing to overwrite existing files" >&2
  exit 1
fi
if [[ ! -e "${sftp_dir}/id_ed25519" && ! -e "${sftp_dir}/id_ed25519.pub" ]]; then
  ssh-keygen \
    -q \
    -t ed25519 \
    -N "" \
    -C "dbx-opendal-test" \
    -f "${sftp_dir}/id_ed25519"
fi

chmod 600 "${sftp_dir}/id_ed25519"
chmod 644 "${sftp_dir}/id_ed25519.pub"

echo "Generated OpenDAL SFTP key under ${sftp_dir}"

FROM node:22.13.0-bookworm-slim@sha256:f5a0871ab03b035c58bdb3007c3d177b001c2145c18e81817b71624dcf7d8bff AS node
FROM rust:1.98-bookworm@sha256:82150a52ec202c1b14d7817e14516c392bb7f5cfebd88f1ed531cb37ebd39922

RUN apt-get update && apt-get install -y --no-install-recommends cmake pkg-config libssl-dev openssh-client procps unzip file && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && npm install -g @dbx-app/plugin-cli@0.1.0 --ignore-scripts --no-audit --no-fund
RUN rustup component add rustfmt clippy
ENV DBX_PLATFORM_CONTAINER=1 CARGO_HOME=/cargo-cache CARGO_TARGET_DIR=/cargo-target CARGO_BUILD_JOBS=4
CMD ["node", "/source/scripts/linux-platform-check.mjs"]

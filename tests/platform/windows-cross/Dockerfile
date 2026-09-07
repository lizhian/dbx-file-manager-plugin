ARG TOOLING_IMAGE=dbx-file-manager-linux-check:rust-1.98-node-22
FROM ${TOOLING_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 g++-mingw-w64-x86-64 nasm && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-pc-windows-gnu
ENV CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
    CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc \
    CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++ \
    AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
CMD ["node", "/source/scripts/windows-cross-check.mjs"]

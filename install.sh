#!/usr/bin/env bash
set -euo pipefail

OS=$(uname -s)
case "$OS" in
    Linux) OS_LOWER=linux; EXT=tar.gz ;;
    Darwin) OS_LOWER=darwin; EXT=zip ;;
    *) echo "HESARI OS Wizard supports Linux, Android (Termux), and macOS."; exit 1 ;;
esac
ARCH=$(uname -m)
case "$ARCH" in
    aarch64|arm64) ARCH=arm64 ;;
    x86_64) ARCH=amd64 ;;
    armv7*|armv8*) ARCH=arm ;;
    i386|i686) ARCH=386 ;;
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac
if [ "$OS_LOWER" = darwin ] && [ "$ARCH" != arm64 ] && [ "$ARCH" != amd64 ]; then
    echo "Unsupported macOS architecture: $ARCH"; exit 1
fi

BINARY=wizard
INSTALL_DIR=hesari-wizard
ARCHIVE="HESARI-Wizard-${OS_LOWER}-${ARCH}.${EXT}"
RELEASE_URL=https://github.com/mjhesari/Hesari-Os-Wizard/releases/latest/download
WORKER_URL=https://github.com/mjhesari/Hesari-Os/releases/latest/download/worker.js
LATEST_VERSION=$(curl -fsSL --retry 2 https://raw.githubusercontent.com/mjhesari/Hesari-Os-Wizard/main/VERSION)
if [[ ! "$LATEST_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Could not determine the Wizard version."; exit 1
fi
# Pin the binary and checksum to the same release, even if a new release appears mid-install.
RELEASE_URL="https://github.com/mjhesari/Hesari-Os-Wizard/releases/download/${LATEST_VERSION}"
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT
mkdir -p "$INSTALL_DIR"
NEEDS_INSTALL=1
if [ -x "${INSTALL_DIR}/${BINARY}" ]; then
    INSTALLED_VERSION=$("${INSTALL_DIR}/${BINARY}" --version)
    if [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ]; then NEEDS_INSTALL=0; fi
fi
if [ "$NEEDS_INSTALL" = 1 ]; then
    echo "Downloading HESARI OS Wizard ${LATEST_VERSION}..."
    curl -fsSL --retry 2 -o "${TEMP_DIR}/${ARCHIVE}" "${RELEASE_URL}/${ARCHIVE}"
    curl -fsSL --retry 2 -o "${TEMP_DIR}/SHA256SUMS" "${RELEASE_URL}/SHA256SUMS"
    EXPECTED=$(awk -v name="$ARCHIVE" '$2 == name { print $1 }' "${TEMP_DIR}/SHA256SUMS")
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL=$(sha256sum "${TEMP_DIR}/${ARCHIVE}" | awk '{print $1}')
    else
        ACTUAL=$(shasum -a 256 "${TEMP_DIR}/${ARCHIVE}" | awk '{print $1}')
    fi
    if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
        echo "Wizard download checksum did not match. Please try again."; exit 1
    fi
    mkdir "${TEMP_DIR}/unpacked"
    if [ "$EXT" = zip ]; then
        unzip -q -o "${TEMP_DIR}/${ARCHIVE}" -d "${TEMP_DIR}/unpacked"
    else
        tar xzf "${TEMP_DIR}/${ARCHIVE}" -C "${TEMP_DIR}/unpacked"
    fi
    cp "${TEMP_DIR}/unpacked/${BINARY}" "${INSTALL_DIR}/${BINARY}"
    cp "${TEMP_DIR}/unpacked/LICENSE" "${INSTALL_DIR}/LICENSE"
    chmod +x "${INSTALL_DIR}/${BINARY}"
fi

echo "Downloading HESARI OS..."
curl -fsSL --retry 2 -o "${TEMP_DIR}/worker.js" "$WORKER_URL"
if [ ! -s "${TEMP_DIR}/worker.js" ]; then echo "The panel download was empty."; exit 1; fi
cp "${TEMP_DIR}/worker.js" "${INSTALL_DIR}/worker.js"
rm -rf "$TEMP_DIR"
trap - EXIT
export LAUNCHED_BY_SCRIPT=1
cd "$INSTALL_DIR"
exec "./${BINARY}"

#!/bin/sh
# Builds intavolatura-cli and packs the plugin for one platform:
#   scripts/package.sh <macos|linux|windows> <version> <intavolatura-checkout> [out-dir]
# Gives musescore-intavolatura-<version>-<platform>.zip holding the folder
# intavolatura/ (the plugin files and bin/intavolatura-cli) to unzip into
# MuseScore's plugins folder. On macOS the CLI is universal (arm64 + x86_64);
# elsewhere x86_64. Used by .github/workflows/build.yml; runs locally too.
set -eu
platform=$1
version=$2
core=$(cd "$3" && pwd)
out=${4:-dist}
repo=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$out"
out=$(cd "$out" && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

dest="$stage/intavolatura"
mkdir -p "$dest/bin"
cp "$repo"/plugin/intavolatura/*.qml "$repo"/plugin/intavolatura/*.js "$dest/"
zipfile="$out/musescore-intavolatura-$version-$platform.zip"

case "$platform" in
macos)
    for target in aarch64-apple-darwin x86_64-apple-darwin; do
        (cd "$core" && cargo build --release --locked -p intavolatura-cli --target "$target")
    done
    lipo -create -output "$dest/bin/intavolatura-cli" \
        "$core/target/aarch64-apple-darwin/release/intavolatura-cli" \
        "$core/target/x86_64-apple-darwin/release/intavolatura-cli"
    (cd "$stage" && zip -qr "$zipfile" intavolatura)
    ;;
linux)
    (cd "$core" && cargo build --release --locked -p intavolatura-cli)
    cp "$core/target/release/intavolatura-cli" "$dest/bin/"
    (cd "$stage" && zip -qr "$zipfile" intavolatura)
    ;;
windows)
    (cd "$core" && cargo build --release --locked -p intavolatura-cli)
    cp "$core/target/release/intavolatura-cli.exe" "$dest/bin/"
    (cd "$stage" && 7z a -tzip "$zipfile" intavolatura >/dev/null)
    ;;
*)
    echo "unknown platform: $platform (macos, linux or windows)" >&2
    exit 2
    ;;
esac
ls "$out"
